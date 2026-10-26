CREATE TABLE IF NOT EXISTS processing_field_reviews(
 file_id TEXT NOT NULL REFERENCES processing_files(id),
 field TEXT NOT NULL,
 extraction_hash TEXT NOT NULL,
 value TEXT NOT NULL,
 author TEXT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL,
 PRIMARY KEY(file_id,field)
);
