-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE sessions (
 token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
