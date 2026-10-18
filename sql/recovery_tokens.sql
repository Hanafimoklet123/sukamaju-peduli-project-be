-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE recovery_tokens (
 token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('activation','recovery')), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX recovery_user ON recovery_tokens(user_id);
