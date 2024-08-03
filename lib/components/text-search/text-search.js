import sql from "#core/sql";
import crypto from "node:crypto";
import Mutex from "#core/threads/mutex";
import OpenAiApi from "#core/api/openai";

var XENOVA;

const MODELS = {

    // xenova
    "Xenova/all-MiniLM-L6-v2": {
        "provider": "xenova",
        "dimensions": 384,
    },

    // google english
    "text-embedding-004": {
        "provider": "google",
        "dimensions": 768,
    },

    // google multiligual
    "text-multilingual-embedding-002": {
        "provider": "google",
        "dimensions": 768,
    },

    // openai
    "text-embedding-3-small": {
        "provider": "openai",
        "dimensions": 1536,
    },
    "text-embedding-3-large": {
        "provider": "openai",
        "dimensions": 3072,
    },
};

const SQL = {
    "createEmbedding": sql`SELECT text_search_create_embedding( ?, ?, ?, ? ) AS id`.prepare(),
};

export default class {
    #app;
    #config;
    #mutexes = new Mutex.Set();
    #openAiApi;

    constructor ( app, config ) {
        this.#app = app;
        this.#config = config;
    }

    // properties
    get app () {
        return this.#app;
    }

    get config () {
        return this.#config;
    }

    get dbh () {
        return this.#app.dbh;
    }

    // public
    async init () {

        // init db
        var res = await this.dbh.schema.migrate( new URL( "db", import.meta.url ), {
            "app": this.app,
        } );
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async createEmbedding ( text, { model, type, dbh } = {} ) {
        model ||= this.config.model;
        type ||= this.config.type;

        const hash = crypto.createHash( "MD5" ).update( text ).digest( "base64url" );

        var res;

        res = await this.#createEmbedding( hash, model, type, { dbh } );

        // error
        if ( !res.ok ) return res;

        // embedding created
        else if ( res.data ) return res;

        const mutex = this.#getMutex( hash );

        await mutex.lock();

        res = await this.#createEmbedding( hash, model, type, { text, dbh } );

        mutex.unlock();

        return res;
    }

    // private
    #getMutex ( hash ) {
        const id = "text-search/create-embedding/" + hash;

        if ( this.app.cluster ) {
            return this.app.cluster.mutexes.get( id );
        }
        else {
            return this.#mutexes.get( id );
        }
    }

    async #createEmbedding ( hash, model, type, { text, dbh } = {} ) {
        dbh ||= this.dbh;

        var res;

        res = await dbh.selectRow( SQL.createEmbedding, [ hash, model, type, null ] );

        // error
        if ( !res.ok ) {
            return res;
        }

        // embedding cached
        else if ( res.data?.id ) {
            return res;
        }

        // not created
        else if ( !text ) {
            return result( 200 );
        }

        res = await this.#getEmbedding( text, model, type );

        if ( !res.ok ) return res;

        return dbh.selectRow( SQL.createEmbedding, [ hash, model, type, res.data ] );
    }

    async #getEmbedding ( text, model, type ) {
        if ( MODELS[ model ].provider === "xenova" ) {
            XENOVA ??= ( await import( "@xenova/transformers" ) ).default;

            const pipe = await XENOVA.pipeline( "feature-extraction", model );

            const embedding = await pipe( text, { "pooling": "mean", "normalize": true } );

            return result( 200, Array.from( embedding.data ) );
        }
        else if ( MODELS[ model ].provider === "openai" ) {
            if ( !this.config.openAiApiKey ) return result( 500 );

            this.#openAiApi ??= new OpenAiApi( this.config.openAiApiKey );

            const res = await this.#openAiApi.getEmbeddings( text, model );

            if ( !res.ok ) return res;

            return result( 200, res.data.data[ 0 ].embedding );
        }
        else if ( MODELS[ model ].provider === "google" ) {

            // XXX
            return result( 500 );
        }
        else {
            return result( 404 );
        }
    }
}
