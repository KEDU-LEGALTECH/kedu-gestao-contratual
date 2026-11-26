-- Failed sign-ins per e-mail and per address, shared by every server instance:
-- the in-memory limit of express-rate-limit is per instance and resets with it.
CREATE TABLE IF NOT EXISTS login_attempts (
 subject TEXT NOT NULL,
 created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_subject ON login_attempts(subject,created);
