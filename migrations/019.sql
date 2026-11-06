CREATE TABLE IF NOT EXISTS processing_resolutions(
 demand_id TEXT NOT NULL REFERENCES demands(id),
 kind TEXT NOT NULL CHECK(kind IN('reference','validation')),
 field TEXT NOT NULL,
 signature TEXT NOT NULL,
 value TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL,
 author TEXT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL,
 PRIMARY KEY(demand_id,kind,field)
);
