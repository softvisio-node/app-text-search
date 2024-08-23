import sql from "#core/sql";
import crypto from "node:crypto";
import Mutex from "#core/threads/mutex";
import { encode as encodeTokens, decode as decodeTokens } from "gpt-tokenizer";

var XENOVA;

const MODELS = {

    // xenova
    "Xenova/all-MiniLM-L6-v2": {
        "provider": "xenova",
        "vectorDimensions": 384,
    },

    // google english
    "text-embedding-004": {
        "provider": "google",
        "vectorDimensions": 768,
    },

    // google multiligual
    "text-multilingual-embedding-002": {
        "provider": "google",
        "vectorDimensions": 768,
    },

    // openai
    "text-embedding-3-small": {
        "provider": "openai",
        "vectorDimensions": 1536,
    },
    "text-embedding-3-large": {
        "provider": "openai",
        "vectorDimensions": 3072,
    },
};

const DOCUMENT_TYPES = new Set( [

    //
    "RETRIEVAL_QUERY",
    "RETRIEVAL_DOCUMENT",
    "SEMANTIC_SIMILARITY",
    "CLASSIFICATION",
    "CLUSTERING",
    "QUESTION_ANSWERING",
    "FACT_VERIFICATION",
] );

const SQL = {
    "createEmbedding": sql`SELECT text_search_create_embedding( ?, ?, ?, ? ) AS id`.prepare().readOnly( false ),
};

export default class {
    #app;
    #config;
    #mutexes = new Mutex.Set();

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
        var res;

        // init db
        res = await this.dbh.schema.migrate( new URL( "db", import.meta.url ), {
            "app": this.app,
        } );
        if ( !res.ok ) return res;

        // init models
        res = await this.dbh.do( sql`INSERT INTO text_search_model ( name, vector_dimensions )`.VALUES( Object.keys( MODELS ).map( name => {
            return {
                name,
                "vector_dimensions": MODELS[ name ].vectorDimensions,
            };
        } ) ).sql`ON CONFLICT ( name ) DO NOTHING` );
        if ( !res.ok ) return res;

        // init document types
        res = await this.dbh.do( sql`INSERT INTO text_search_document_type ( name )`.VALUES( [ ...DOCUMENT_TYPES ].map( name => {
            return {
                name,
            };
        } ) ).sql`ON CONFLICT ( name ) DO NOTHING` );
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

    encodeTokens ( text ) {
        return encodeTokens( text );
    }

    decodeTokens ( tokens ) {
        return decodeTokens( tokens );
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
            XENOVA ??= await import( "@xenova/transformers" );

            const pipe = await XENOVA.pipeline( "feature-extraction", model );

            const embedding = await pipe( text, { "pooling": "mean", "normalize": true } );

            return result( 200, Array.from( embedding.data ) );
        }
        else if ( MODELS[ model ].provider === "openai" ) {
            const openAiApi = this.app.services.get( "openai" );

            if ( !openAiApi ) return result( [ 500, "OpenAI service is required" ] );

            const res = await openAiApi.getEmbeddings( text, model );

            if ( !res.ok ) return res;

            return result( 200, res.data.data[ 0 ].embedding );
        }
        else if ( MODELS[ model ].provider === "google" ) {
            const vertexAiApi = this.app.services.get( "vertexai" );

            if ( !vertexAiApi ) return result( [ 500, "Google Vertex AI service is required" ] );

            // XXX
            return result( 500 );
        }
        else {
            return result( 404 );
        }
    }
}
