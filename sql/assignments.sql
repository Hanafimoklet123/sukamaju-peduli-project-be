-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES reports(id),
 employee_id uuid NOT NULL REFERENCES users(id), assigned_by uuid NOT NULL REFERENCES users(id),
 assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, reason varchar(3000) NOT NULL,
 CHECK(ended_at IS NULL OR ended_at>=assigned_at)
);
CREATE UNIQUE INDEX one_active_assignment ON assignments(report_id) WHERE ended_at IS NULL;
CREATE INDEX assignments_employee ON assignments(employee_id,ended_at);
