CREATE TABLE IF NOT EXISTS reading_pages (
 original_hash TEXT NOT NULL,
 reader_fingerprint TEXT NOT NULL,
 page INTEGER NOT NULL CHECK(page > 0),
 reading TEXT NOT NULL,
 created TEXT NOT NULL,
 PRIMARY KEY(original_hash,reader_fingerprint,page)
);
CREATE INDEX IF NOT EXISTS reading_pages_created ON reading_pages(created);
