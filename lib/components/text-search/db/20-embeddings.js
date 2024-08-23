import sql from "#core/sql";

export default sql`

CREATE EXTENSION IF NOT EXISTS softvisio_types;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE text_search_model (
    id serial4 PRIMARY KEY,
    name text NOT NULL UNIQUE,
    vector_dimensions int4 NOT NULL
);

CREATE TABLE text_search_document_type (
    id serial4 PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE SEQUENCE text_search_storage_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE text_search_storage (
    id int53 PRIMARY KEY DEFAULT nextval( 'text_search_storage_id_seq' ),
    model_id int4 NOT NULL REFERENCES text_search_model ( id ) ON DELETE RESTRICT,
    document_type_id int4 NOT NULL REFERENCES text_search_document_type ( id ) ON DELETE RESTRICT
);

ALTER SEQUENCE text_search_storage_id_seq OWNED BY text_search_storage.id;

CREATE TABLE text_search_embedding (
    storage_id int53 NOT NULL REFERENCES text_search_storage ( id ) ON DELETE RESTRICT,
    embedding_id serial8 NOT NULL,
    hash text NOT NULL,
    vector vector NOT NULL,
    PRIMARY KEY ( storage_id, embedding_id ),
    UNIQUE ( storage_id, hash )
) PARTITION BY LIST ( storage_id );

CREATE SEQUENCE text_search_document_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE text_search_document (
    id int53 PRIMARY KEY DEFAULT nextval( 'text_search_document_id_seq' ),
    storage_id int53 NOT NULL,
    embedding_id int8 NOT NULL,
    FOREIGN KEY ( storage_id, embedding_id ) REFERENCES text_search_embedding ( storage_id, embedding_id ) ON DELETE RESTRICT
);

ALTER SEQUENCE text_search_document_id_seq OWNED BY text_search_document.id;

CREATE INDEX text_search_document_storage_id_embedding_id_idx ON text_search_document ( storage_id, embedding_id );

CREATE FUNCTION text_search_document_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    IF ( NOT EXISTS ( SELECT FROM text_search_document WHERE storage_id = OLD.storage_id AND embedding_id = OLD.embedding_id ) ) THEN
        DELETE FROM text_search_embedding WHERE storage_id = OLD.storage_id AND embedding_id = OLD.embedding_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER text_search_document_after_delete AFTER DELETE ON text_search_document FOR EACH ROW EXECUTE FUNCTION text_search_document_after_delete_trigger();

CREATE VIEW text_search_vector AS
    SELECT
        text_search_document.id,
        text_search_embedding.storage_id,
        text_search_embedding.vector
    FROM
        text_search_document,
        text_search_embedding
    WHERE
        text_search_document.storage_id = text_search_embedding.storage_id
        AND text_search_document.embedding_id = text_search_embedding.embedding_id
;

CREATE FUNCTION create_text_search_storage ( _model_name text, _document_type_name text, _createIndex bool DEFAULT TRUE ) RETURNS int53 AS $$
DECLARE
    _id int53;
BEGIN

    -- create storage
    INSERT INTO text_search_storage
    ( model_id, document_type_id )
    VALUES
    (
        ( SELECT id FROM text_search_model WHERE name = _model_name ),
        ( SELECT id FROM text_search_document_type WHERE name = _document_type_name )
    )
    RETURNING id INTO _id;

    -- create partition
    EXECUTE 'CREATE TABLE
            text_search_embedding_' || _id || ' ' ||
        'PARTITION OF
            text_search_embedding
        FOR VALUES IN ( ' || _id || ' )';

    IF _createIndex THEN
        CALL create_text_search_storage_index( _id );
    END IF;

    RETURN _id;

END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE delete_text_search_storage ( _id int53 ) AS $$
BEGIN

    -- delete partition
    EXECUTE 'DROP TABLE text_search_embedding_' || _id || ' CASCADE';

    -- delete storage
    DELETE FROM text_search_storage WHERE id = _id;

END;
$$ LANGUAGE plpgsql;

-- XXX
CREATE PROCEDURE create_text_search_storage_index ( _storage_id int53 ) AS $$
BEGIN

    SET maintenance_work_mem = '1GB';

    -- create index
    EXECUTE 'CREATE INDEX IF NOT EXISTS text_search_embedding_' || _storage_id || '_vector_idx ON text_search_embedding_' || _storage_id || ' USING hnsw ( ( vector::vector( ' || ( SELECT vector_dimensions FROM text_search_storage, text_search_model WHERE text_search_storage.model_id = text_search_model.id AND text_search_storage.id = _storage_id ) || ' ) ) vector_cosine_ops )';

END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE delete_text_search_storage_index ( _storage_id int53 ) AS $$
BEGIN

    -- delete index
    EXECUTE 'DROP INDEX IF EXISTS text_search_embedding_' || _storage_id || '_vector_idx';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_vector ( _vector json ) RETURNS vector STABLE AS $$
BEGIN

    RETURN ( SELECT array( SELECT json_array_elements( _vector )::text::float8 ) )::vector;

END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_vector ( _document_id int53 ) RETURNS vector STABLE AS $$
BEGIN

    RETURN (
        SELECT
            vector
        FROM
            text_search_document,
            text_search_embedding
        WHERE
            text_search_document.id = _document_id
            AND text_search_document.storage_id = text_search_embedding.storage_id
            AND text_search_document.embedding_id = text_search_embedding.embedding_id
    );

END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION create_text_search_document ( _storage_id int53, _hash text, _vector json ) RETURNS int53 AS $$
DECLARE
    _document_id int53;
    _embedding_id int8;
BEGIN
    _embedding_id := ( SELECT embedding_id FROM text_search_embedding WHERE storage_id = _storage_id AND hash = _hash );

    IF _embedding_id IS NULL THEN
        IF _vector IS NULL THEN
            RETURN NULL;
        ELSE
            INSERT INTO
                text_search_embedding
            ( storage_id, hash, vector )
            VALUES
            ( _storage_id, _hash, get_text_search_vector( _vector ) )
            RETURNING embedding_id INTO _embedding_id;
        END IF;
    END IF;

    INSERT INTO
        text_search_document
    ( storage_id, embedding_id )
    VALUES
    ( _storage_id, _embedding_id )
    RETURNING id INTO _document_id;

    RETURN _document_id;
END;
$$ LANGUAGE plpgsql;

`;
