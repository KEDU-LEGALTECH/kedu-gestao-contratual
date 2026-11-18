-- Access switch kept apart from users, so INSERT INTO users VALUES(...) keeps its five columns.
-- A row here means the account cannot sign in; removing it restores access.
CREATE TABLE IF NOT EXISTS user_access (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 disabled_at TEXT NOT NULL,
 disabled_by TEXT REFERENCES users(id)
);
