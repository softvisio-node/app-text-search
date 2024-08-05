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
    text text
);

-- if you don't know text language or documents can be in the various languages
CREATE INDEX document_text_ts_vector_idx ON document USING GIN ( get_text_search_tsvector( text ) );

-- or if you know the document language, for example: english
CREATE INDEX document_text_ts_vector_idx ON document USING GIN ( get_text_search_tsvector( text, 'english' ) );

-- search, document language is unknown
SELECT
    text
FROM
    document
WHERE
    get_text_search_tsvector( text ) @@ get_text_search_tsquery( 'query text' );

-- or search, document language is known, for example 'english'
SELECT
    text
FROM
    document
WHERE
    get_text_search_tsvector( text, 'english' ) @@ get_text_search_tsquery( 'query text', 'english' );
```
