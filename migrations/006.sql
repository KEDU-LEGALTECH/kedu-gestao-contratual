CREATE TABLE IF NOT EXISTS glpi_tickets(
 external_id TEXT PRIMARY KEY,
 mode TEXT NOT NULL CHECK(mode IN('demo','real')),
 title TEXT NOT NULL,
 status TEXT NOT NULL,
 hash TEXT NOT NULL,
 payload TEXT NOT NULL,
 analysis TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('novo','alterado','vinculado','alterado após vínculo')),
 demand_id TEXT UNIQUE REFERENCES demands(id),
 first_seen TEXT NOT NULL,
 last_seen TEXT NOT NULL,
 changed_at TEXT
);
CREATE TABLE IF NOT EXISTS glpi_ticket_versions(
 id TEXT PRIMARY KEY,
 external_id TEXT NOT NULL REFERENCES glpi_tickets(external_id),
 hash TEXT NOT NULL,
 payload TEXT NOT NULL,
 seen TEXT NOT NULL,
 UNIQUE(external_id,hash)
);
CREATE TRIGGER IF NOT EXISTS immutable_glpi_version BEFORE UPDATE ON glpi_ticket_versions BEGIN SELECT RAISE(ABORT,'Versão importada do GLPI é imutável'); END;
CREATE TRIGGER IF NOT EXISTS no_delete_glpi_version BEFORE DELETE ON glpi_ticket_versions BEGIN SELECT RAISE(ABORT,'Versão importada do GLPI é imutável'); END;
