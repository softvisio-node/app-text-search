import sql from "#core/sql";

export default sql`

CREATE EXTENSION IF NOT EXISTS softvisio_types;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE text_search_embedding_model (
    id serial8 PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE text_search_embedding_type (
    id serial8 PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE TABLE text_search_embedding_cache (
    id serial8 PRIMARY KEY,
    hash text NOT NULL,
    model_id int8 NOT NULL REFERENCES text_search_embedding_model ( id ) ON DELETE RESTRICT,
    type_id int8 NOT NULL REFERENCES text_search_embedding_type ( id ) ON DELETE RESTRICT,
    embedding vector NOT NULL,
    UNIQUE ( hash, model_id, type_id )
);

-- XXX enabled index
-- NOTE https://github.com/pgvector/pgvector#indexing
-- CREATE INDEX ON text_search_embedding_cache USING hnsw ( embedding vector_cosine_ops );

CREATE SEQUENCE text_search_embedding_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE text_search_embedding (
    id int53 PRIMARY KEY DEFAULT nextval( 'text_search_embedding_id_seq' ),
    embedding_cache_id int8 NOT NULL REFERENCES text_search_embedding_cache ( id ) ON DELETE RESTRICT
);

ALTER SEQUENCE text_search_embedding_id_seq OWNED BY text_search_embedding.id;

CREATE INDEX ON text_search_embedding ( embedding_cache_id );

CREATE FUNCTION text_search_create_embedding ( _hash text, _model text, _type text, _embedding json ) RETURNS int53 AS $$
DECLARE
    _model_id int8;
    _type_id int8;
    _embedding_cache_id int8;
    _emnedding_id int53;
BEGIN

    -- create model
    _model_id := ( SELECT id FROM text_search_embedding_model WHERE name = _model );

    IF _model_id IS NULL THEN
        INSERT INTO text_search_embedding_model ( name ) VALUES ( _model ) RETURNING id INTO _model_id;
    END IF;

    -- create type
    _type_id := ( SELECT id FROM text_search_embedding_type WHERE name = _type );

    IF _type_id IS NULL THEN
        INSERT INTO text_search_embedding_type ( name ) VALUES ( _type ) RETURNING id INTO _type_id;
    END IF;

    _embedding_cache_id := ( SELECT id FROM text_search_embedding_cache WHERE hash = _hash AND model_id = _model_id AND type_id = _type_id );

    IF _embedding_cache_id IS NULL THEN
        IF _embedding IS NULL THEN
            RETURN NULL;
        ELSE
            INSERT INTO
                text_search_embedding_cache
            ( hash, model_id, type_id, embedding )
            VALUES
            ( _hash, _model_id, _type_id, ( SELECT array( SELECT json_array_elements( _embedding )::text::float8 ) )::vector )
            RETURNING id INTO _embedding_cache_id;
        END IF;
    END IF;

    INSERT INTO
        text_search_embedding
    ( embedding_cache_id )
    VALUES
    ( _embedding_cache_id )
    RETURNING id INTO _emnedding_id;

    RETURN _emnedding_id;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION text_search_similarity_rank ( _document_embedding_id int53, _query_embedding_id int53 ) RETURNS float8 STABLE AS $$
BEGIN
    RETURN (
        SELECT
            1 - (
                ( SELECT embedding FROM text_search_embedding, text_search_embedding_cache WHERE text_search_embedding.embeddng_cache_id = text_search_embedding_cache.id AND text_search_embedding.id = _document_embedding_id )
                <=>
                ( SELECT embedding FROM text_search_embedding, text_search_embedding_cache WHERE text_search_embedding.embeddng_cache_id = text_search_embedding_cache.id AND text_search_embedding.id = _query_embedding_id )
            )
    );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION text_search_embedding_after_delete_trigger () RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS ( SELECT FROM text_search_embedding WHERE embedding_cache_id = embedding_cache_id ) THEN
        DELETE FROM text_search_embedding_cache WHERE id = OLD.embedding_cache_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER text_search_embedding_after_delete AFTER DELETE ON text_search_embedding FOR EACH ROW EXECUTE FUNCTION text_search_embedding_after_delete_trigger();

`;
