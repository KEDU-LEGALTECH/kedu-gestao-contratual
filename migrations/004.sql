CREATE TABLE IF NOT EXISTS demand_baselines(
 id TEXT PRIMARY KEY,
 demand_id TEXT NOT NULL REFERENCES demands(id),
 subtype TEXT NOT NULL,
 payload TEXT NOT NULL,
 reference TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 created TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_baseline BEFORE UPDATE ON demand_baselines BEGIN SELECT RAISE(ABORT,'Retrato confirmado é imutável; registre nova versão'); END;
CREATE TRIGGER IF NOT EXISTS no_delete_baseline BEFORE DELETE ON demand_baselines BEGIN SELECT RAISE(ABORT,'Retrato confirmado é imutável'); END;
CREATE TABLE IF NOT EXISTS cashback_values(demand_id TEXT PRIMARY KEY REFERENCES demands(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>=0));
