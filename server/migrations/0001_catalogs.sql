CREATE TABLE catalogs (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL,
    sale_company TEXT,
    sale_date    TEXT,             -- YYYY-MM-DD
    source_url   TEXT,
    sha256       TEXT NOT NULL UNIQUE,
    size_bytes   INTEGER NOT NULL,
    page_count   INTEGER,          -- NULL if the PDF could not be inspected
    listed       BOOLEAN NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE INDEX catalogs_listed_date ON catalogs (listed, sale_date DESC);
