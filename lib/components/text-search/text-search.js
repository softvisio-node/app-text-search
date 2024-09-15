import sql from "#core/sql";
import crypto from "node:crypto";
import Mutex from "#core/threads/mutex";
import { encode as encodeTokens, decode as decodeTokens } from "gpt-tokenizer";

const MODELS = {

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
    "createDocument": sql`SELECT create_text_search_document( ?, ?, ? ) AS id`.prepare().readOnly( false ),

    "getStorage": sql`
SELECT
    text_search_storage.id,
    text_search_model.name AS model,
    text_search_document_type.name AS document_type,
    text_search_storage.store_content,
    text_search_storage.unique_document
FROM
    text_search_storage,
    text_search_model,
    text_search_document_type
WHERE
    text_search_storage.id = ?
    AND text_search_storage.model_id = text_search_model.id
    AND text_search_storage.document_type_id = text_search_document_type.id
`.prepare(),
};

const STORAGE_CACHE = {};

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
        res = await this.dbh.do( sql`INSERT INTO text_search_model`.VALUES( Object.keys( MODELS ).map( name => {
            return {
                name,
                "vector_dimensions": MODELS[ name ].vectorDimensions,
            };
        } ) ).sql`ON CONFLICT ( name ) DO NOTHING` );
        if ( !res.ok ) return res;

        // init document types
        res = await this.dbh.do( sql`INSERT INTO text_search_document_type`.VALUES( [ ...DOCUMENT_TYPES ].map( name => {
            return {
                name,
            };
        } ) ).sql`ON CONFLICT ( name ) DO NOTHING` );
        if ( !res.ok ) return res;

        return result( 200 );
    }

    encodeTokens ( text ) {
        return encodeTokens( text );
    }

    decodeTokens ( tokens ) {
        return decodeTokens( tokens );
    }

    async createStorage ( modelName, documentTypeName, { storeContent, uniqueDocument = true, createIndex = true, dbh } = {} ) {
        dbh ||= this.dbh;

        return dbh.selectRow( sql`SELECT create_text_search_storage( ?, ?, ?, ?, ? ) AS id`, [

            //
            modelName,
            documentTypeName,
            !!storeContent,
            !!uniqueDocument,
            !!createIndex,
        ] );
    }

    async deleteStorage ( storageId, { dbh } = {} ) {
        dbh ||= this.dbh;

        return dbh.do( sql`CALL delete_text_search_storage( ? )`, [

            //
            storageId,
        ] );
    }

    async createStorageIndex ( storageId, { dbh } = {} ) {
        dbh ||= this.dbh;

        return dbh.do( sql`CALL create_text_search_storage_index( ? )`, [

            //
            storageId,
        ] );
    }

    async deleteStorageIndex ( storageId, { dbh } = {} ) {
        dbh ||= this.dbh;

        return dbh.do( sql`CALL delete_text_search_storage_index( ? )`, [

            //
            storageId,
        ] );
    }

    async createDocument ( storageId, content, { dbh } = {} ) {
        const storage = await this.#getStorage( storageId, { dbh } );

        if ( !storage ) return result( [ 400, "Text search storage not found" ] );

        var hash;

        if ( storage.storeContent ) {
            hash = content;
        }
        else {
            hash = crypto.createHash( "MD5" ).update( content ).digest( "base64url" );
        }

        var res;

        res = await this.#createDocument( storage, hash, { dbh } );

        // error
        if ( !res.ok ) return res;

        // embedding created
        else if ( res.data ) return res;

        const mutex = this.#getMutex( hash );

        await mutex.lock();

        res = await this.#createDocument( storage, hash, { content, dbh } );

        mutex.unlock();

        return res;
    }

    async getStorageVectorDimensions ( storageId ) {
        const storage = await this.#getStorage( storageId );

        return MODELS[ storage?.model ]?.vectorDimensions;
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

    async #createDocument ( storage, hash, { content, dbh } = {} ) {
        dbh ||= this.dbh;

        var res;

        res = await dbh.selectRow( SQL.createDocument, [ storage.id, hash, null ] );

        // error
        if ( !res.ok ) {
            return res;
        }

        // document cached
        else if ( res.data?.id ) {
            return res;
        }

        // not created
        else if ( !content ) {
            return result( 200 );
        }

        res = await this.#getEmbedding( content, storage.model, storage.documentType );
        if ( !res.ok ) return res;

        const vector = res.data;

        return dbh.selectRow( SQL.createDocument, [ storage.id, hash, vector ] );
    }

    // XXX vertex api
    async #getEmbedding ( text, model, type ) {
        if ( MODELS[ model ].provider === "openai" ) {
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

    async #getStorage ( storageId, { dbh } = {} ) {
        var storage = STORAGE_CACHE[ storageId ];

        if ( !storage ) {
            dbh ||= this.dbh;

            const res = await dbh.selectRow( SQL.getStorage, [ storageId ] );

            if ( !res.ok ) return false;

            if ( !res.data ) return;

            storage = STORAGE_CACHE[ storageId ] = {
                "id": res.data.id,
                "model": res.data.model,
                "documentType": res.data.document_type,
                "storeContent": res.data.store_content,
                "uniqueDocument": res.data.unique_document,
            };
        }

        return storage;
    }
}
