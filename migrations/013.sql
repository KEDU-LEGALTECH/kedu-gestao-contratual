CREATE TABLE IF NOT EXISTS contract_processing(
 demand_id TEXT PRIMARY KEY REFERENCES demands(id),ticket_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('Analisando','Aguardando correção','Pronto para download')),
 revision INTEGER NOT NULL DEFAULT 1,overrides TEXT NOT NULL DEFAULT '{}',template_id TEXT,
 result TEXT NOT NULL DEFAULT '{}',updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_files(
 id TEXT PRIMARY KEY,demand_id TEXT NOT NULL REFERENCES demands(id),document_id TEXT NOT NULL,
 ticket_hash TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,
 extracted TEXT NOT NULL,problem TEXT NOT NULL,created TEXT NOT NULL,
 UNIQUE(demand_id,document_id,ticket_hash)
);
CREATE TABLE IF NOT EXISTS processing_exports(
 id TEXT PRIMARY KEY,demand_id TEXT NOT NULL REFERENCES demands(id),revision INTEGER NOT NULL,
 ticket_hash TEXT NOT NULL,template_id TEXT NOT NULL REFERENCES template_versions(id),
 template_hash TEXT NOT NULL,snapshot TEXT NOT NULL,bytes BLOB NOT NULL,
 author TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS processing_export_immutable BEFORE UPDATE ON processing_exports BEGIN SELECT RAISE(ABORT,'Contrato gerado é imutável'); END;
CREATE TRIGGER IF NOT EXISTS processing_export_keep BEFORE DELETE ON processing_exports BEGIN SELECT RAISE(ABORT,'Contrato gerado é imutável'); END;
