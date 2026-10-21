CREATE TABLE IF NOT EXISTS processing_file_reviews(
 file_id TEXT PRIMARY KEY REFERENCES processing_files(id),extraction_hash TEXT NOT NULL,
 author TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL
);
