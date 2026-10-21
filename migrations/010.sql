CREATE TABLE IF NOT EXISTS glpi_intakes(
 demand_id TEXT PRIMARY KEY REFERENCES demands(id),
 ticket_id TEXT NOT NULL UNIQUE REFERENCES glpi_tickets(external_id),
 received_hash TEXT NOT NULL,
 received_at TEXT NOT NULL,
 confirmed_at TEXT,
 confirmed_by TEXT REFERENCES users(id),
 note TEXT NOT NULL DEFAULT ''
);
