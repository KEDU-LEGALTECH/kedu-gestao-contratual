CREATE TABLE IF NOT EXISTS commercial_terms (
 demand_id TEXT PRIMARY KEY REFERENCES demands(id),
 remuneration_bps INTEGER NOT NULL CHECK(remuneration_bps BETWEEN 0 AND 10000),
 guarantee_bps INTEGER NOT NULL CHECK(guarantee_bps BETWEEN 0 AND 10000),
 transfer_bps INTEGER NOT NULL CHECK(transfer_bps BETWEEN 0 AND 10000),
 cashback_bps INTEGER NOT NULL CHECK(cashback_bps BETWEEN 0 AND 10000),
 reference_cents INTEGER NOT NULL CHECK(reference_cents>=0)
);
CREATE TABLE IF NOT EXISTS inactive_template_versions(version_id TEXT PRIMARY KEY REFERENCES template_versions(id),user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);
