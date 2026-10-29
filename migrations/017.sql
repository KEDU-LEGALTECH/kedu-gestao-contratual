CREATE TABLE IF NOT EXISTS reading_jobs (
 demand_id TEXT NOT NULL,
 ticket_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','retry','done','exhausted','superseded')),
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at INTEGER NOT NULL,
 owner TEXT,
 updated INTEGER NOT NULL,
 last_error TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(demand_id,ticket_hash)
);
CREATE INDEX IF NOT EXISTS reading_jobs_ready ON reading_jobs(state,available_at);
