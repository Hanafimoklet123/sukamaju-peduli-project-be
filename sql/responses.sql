-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES reports(id),
 author_id uuid NOT NULL REFERENCES users(id), text varchar(3000) NOT NULL,
 internal boolean NOT NULL DEFAULT false,
 kind text NOT NULL CHECK(kind IN ('perkembangan','internal','verifikasi','hasil','penolakan')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX responses_report ON responses(report_id,created_at);
