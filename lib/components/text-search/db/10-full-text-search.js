import sql from "#core/sql";

export default sql`

CREATE FUNCTION get_text_search_tsvector ( content text, language regconfig ) RETURNS tsvector IMMUTABLE AS $$
BEGIN
    IF language IS NOT NULL THEN
        RETURN (
            SELECT to_tsvector( language, content )
        );
    ELSE
        RETURN (
            SELECT
                setweight( to_tsvector( 'simple', content ), 'A' ) || setweight( tsvector, 'B' )
            FROM
                pg_ts_config,
                LATERAL to_tsvector( cfgname::regconfig, content ) AS tsvector
            WHERE
                cfgname != 'simple'
            ORDER BY
                length( tsvector ),
                length( tsvector::text )
            LIMIT 1
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_tsquery ( content text, language regconfig ) RETURNS tsquery IMMUTABLE AS $$
BEGIN
    IF language IS NOT NULL THEN
        RETURN (
            SELECT to_tsvector( language, content )
        );
    ELSE
        RETURN (
            SELECT
                tsquery
            FROM
                pg_ts_config,
                LATERAL websearch_to_tsquery( cfgname::regconfig, content ) AS tsquery
            WHERE
                cfgname != 'simple'
            ORDER BY
                length( tsquery::text )
            LIMIT 1
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

`;
