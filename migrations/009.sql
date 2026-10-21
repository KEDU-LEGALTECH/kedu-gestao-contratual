CREATE TABLE IF NOT EXISTS organization_classifications(
 school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN('Aguardando classificação','Escola','Fornecedor','Outra organização')),
 version INTEGER NOT NULL DEFAULT 1,
 classified_by TEXT REFERENCES users(id),
 classified_at TEXT,
 note TEXT NOT NULL DEFAULT ''
);
-- Existing imports also require an explicit classification; manual school records retain their type.
INSERT OR IGNORE INTO organization_classifications(school_id,kind)
SELECT school_id,'Aguardando classificação' FROM school_glpi_origins;
