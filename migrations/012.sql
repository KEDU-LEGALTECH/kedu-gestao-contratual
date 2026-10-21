CREATE TABLE IF NOT EXISTS attachment_checks(
 id TEXT PRIMARY KEY,demand_id TEXT NOT NULL REFERENCES demands(id),
 document_id TEXT NOT NULL,ticket_hash TEXT NOT NULL,data_version INTEGER NOT NULL,
 name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,text TEXT NOT NULL,
 expected TEXT NOT NULL,reference TEXT NOT NULL,findings TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('conforme','divergente','inconclusiva')),
 parent_id TEXT REFERENCES attachment_checks(id),author TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachment_checks_demand ON attachment_checks(demand_id,created);
CREATE TRIGGER IF NOT EXISTS immutable_attachment_check_update BEFORE UPDATE ON attachment_checks BEGIN SELECT RAISE(ABORT,'Conferência de anexo é imutável'); END;
CREATE TRIGGER IF NOT EXISTS immutable_attachment_check_delete BEFORE DELETE ON attachment_checks BEGIN SELECT RAISE(ABORT,'Conferência de anexo é imutável'); END;
