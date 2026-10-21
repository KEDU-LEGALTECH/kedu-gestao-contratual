CREATE TABLE IF NOT EXISTS school_glpi_origins(
 school_id TEXT PRIMARY KEY REFERENCES schools(id),
 first_ticket TEXT NOT NULL REFERENCES glpi_tickets(external_id),
 imported_at TEXT NOT NULL,
 reviewed_at TEXT,
 reviewed_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS school_glpi_sources(
 school_id TEXT NOT NULL REFERENCES schools(id),
 ticket_id TEXT NOT NULL REFERENCES glpi_tickets(external_id),
 ticket_hash TEXT NOT NULL,
 source_name TEXT NOT NULL,
 source_cnpj TEXT NOT NULL,
 name_conflict INTEGER NOT NULL CHECK(name_conflict IN(0,1)),
 created TEXT NOT NULL,
 PRIMARY KEY(school_id,ticket_id,ticket_hash)
);
