<!-- !!! DO NOT EDIT, THIS FILE IS GENERATED AUTOMATICALLY !!!  -->

> :information_source: Please, see the full project documentation here: [https://softvisio-node.github.io/app-component-text-search/](https://softvisio-node.github.io/app-component-text-search/).

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
