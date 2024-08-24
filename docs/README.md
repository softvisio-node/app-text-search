# Introduction

Text search application component.

Provides possibility to perform full-text seatch and similarity search using text embeddings.

## Install

```shell
npm i @softvisio/app-component-text-search
```

## Usage

#### Full-text search

```sql
CREATE TABLE document (
    text text,
    landuage text,
    tsvector tsvector
);

CREATE INDEX document_tsvector_idx ON document USING GIN ( tsvector );

-- NOTE: you will need to insert / update tsvector column using triggers
UPDATE document SET tsvector = get_text_search_tsvector( text, language );

SELECT
    text,
    ts_rank( tsvector, get_text_search_tsquery( 'search query' ) ) AS rank
FROM
    document
WHERE
    tsvctor @@ get_text_search_tsquery( 'search query' )
ORDER BY
    rank DESC;
```

Note: Rank calculation can be slow on large result sets, because it unable to use indexes, so use it with caution.

If your documents has known language or if you don't need to rank results, you can simplify SQL structire:

```sql
CREATE TABLE document (
    text text
);

CREATE INDEX document_text_tsvector_idx ON document USING GIN ( get_text_search_tsvector( text, 'english' ) );

SELECT
    text
FROM
    document
WHERE
    get_text_search_tsvector( text, 'english' ) @@ get_text_search_tsquery( 'search query', 'english' );
```

#### Similarity search

```sql
CREATE TABLE document (
    id serial8 PRIMARY KEY,
    content text NOT NULL,
    text_search_document_id int53 NOT NULL REFERENCES text_search_document ( id ) ON DELETE RESTRICT
);

CREATE FUNCTION document_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    DELETE FROM text_search_document WHERE id = OLD.text_search_document_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_after_delete AFTER DELETE ON document FOR EACH ROW EXECUTE FUNCTION document_after_delete_trigger();

CREATE TABLE query (
    id serial8 PRIMARY KEY,
    content text NOT NULL,
    text_search_document_id int53 NOT NULL REFERENCES text_search_document ( id ) ON DELETE RESTRICT
);

CREATE FUNCTION query_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    DELETE FROM text_search_document WHERE id = OLD.text_search_document_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER query_after_delete AFTER DELETE ON query FOR EACH ROW EXECUTE FUNCTION query_after_delete_trigger();
```

Create documents

```javascript
// create documents storage
const documentsStorage = await this.app.textSearch.createStorage("text-embedding-3-small", "RETRIEVAL_DOCUMENT");

if (documentsStorage.ok) {
    // XXX store documentsStorage.data.id somewhere
}

// create document
const document = await this.app.textSearch.createDocument(documentsStorage.data.id, "DOCUMENT TEXT");

if (document.ok) {
    // XXX store document.data.id in text_search_document_id
}
```

Create queries

```javascript
// create queries storage
const queriesStorage = await this.app.textSearch.createStorage("text-embedding-3-small", "RETRIEVAL_QUERY");

if (queriesStorage.ok) {
    // XXX store queriesStorage.data.id somewhere
}

// create query
const query = await this.app.textSearch.createDocument(queriesStorage.data.id, "QUERY TEXT");

if (query.ok) {
    // XXX store query.data.id in text_search_document_id
}
```

Search documents similar to the query

```javascript
const storageId = 1,
    storageVectorDimensions = await this.app.textSearch.getStorageVectorDimensions(storageId),
    distanceThreshold = 0.2,
    queryDocumentId = 1;

const res = await dbh.select(sql`
SELECT
    document.id,
    text_search_vector.vector::vector( ${sql(storageVectorDimensions)} ) <=> get_text_search_vector( ${queryDocumentId}::int53 ) AS distance
FROM
    document,
    text_search_vector AS e
WHERE
    document.text_search_document_id = text_search_vector.id
    AND text_search_vector.storage_id = ?
    AND ( text_search_vector.vector::vector( ${sql(storageVectorDimensions)} ) <=> get_text_search_vector( ${queryDocumentId}::int53 ) ) <= ${distanceThreshold}
ORDER BY
    text_search_vector.vector::vector( ${sql(storageVectorDimensions)} ) <=> get_text_search_vector( ${queryDocumentId}::int53 )
LIMIT 10
`);
```

NOTES:

-   Cosine distance is between `0` and `2`. Less value means document more similar with the query, `0` - means documents are 100% similar.

-   `ORDER BY` distance must be `ASC` only, otherwise index will not be used.
