CREATE TABLE IF NOT EXISTS external_contract_files(
 contract_id TEXT PRIMARY KEY REFERENCES contracts(id),
 name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,
 signature_date TEXT NOT NULL,reference TEXT NOT NULL,
 registered_by TEXT NOT NULL REFERENCES users(id),registered_at TEXT NOT NULL,
 origin_demand TEXT NOT NULL REFERENCES demands(id)
);
CREATE TRIGGER IF NOT EXISTS immutable_external_contract_update BEFORE UPDATE ON external_contract_files BEGIN SELECT RAISE(ABORT,'Arquivo matriz importado é imutável'); END;
CREATE TRIGGER IF NOT EXISTS immutable_external_contract_delete BEFORE DELETE ON external_contract_files BEGIN SELECT RAISE(ABORT,'Arquivo matriz importado é imutável'); END;
