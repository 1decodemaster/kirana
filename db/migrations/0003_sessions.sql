-- 0003 — sessions (ADR-0006, PRD §7.6)
-- Server-side session store so sessions survive container restarts (G4.6).
-- The raw token is never stored: id is sha256(token); the cookie additionally
-- carries an HMAC signature over the token (SESSION_SECRET).
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id),
  member_id     TEXT NOT NULL REFERENCES members(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX idx_sessions_member  ON sessions(member_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
