-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 report_id uuid REFERENCES reports(id), purpose text CHECK(purpose IN ('original','result')),
 name varchar(255) NOT NULL, mime text NOT NULL CHECK(mime='image/webp'),
 bytes bytea NOT NULL CHECK(octet_length(bytes)<=2097152), checksum char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((report_id IS NULL)=(purpose IS NULL))
);
CREATE UNIQUE INDEX attachment_report_purpose ON attachments(report_id,purpose) WHERE report_id IS NOT NULL;
CREATE INDEX attachments_owner_drafts ON attachments(owner_id,created_at) WHERE report_id IS NULL;
