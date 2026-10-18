-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE idempotency_requests (
 user_id uuid NOT NULL REFERENCES users(id), key uuid NOT NULL, payload_hash char(64) NOT NULL,
 report_id uuid NOT NULL REFERENCES reports(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,key)
);
