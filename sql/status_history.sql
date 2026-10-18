-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE status_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES reports(id),
 status text NOT NULL CHECK(status IN ('Diterima','Diproses','Selesai','Ditolak')),
 actor_id uuid NOT NULL REFERENCES users(id), text varchar(3000) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_report_date ON status_history(report_id,created_at);
