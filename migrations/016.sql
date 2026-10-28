CREATE TABLE IF NOT EXISTS reading_gold_fields(
 id TEXT PRIMARY KEY,
 original_hash TEXT NOT NULL,
 file_id TEXT NOT NULL REFERENCES processing_files(id),
 field TEXT NOT NULL,
 value TEXT NOT NULL,
 extraction_hash TEXT NOT NULL,
 evidence TEXT NOT NULL,
 author TEXT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reading_gold_original ON reading_gold_fields(original_hash,field,created);
