-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE SEQUENCE report_number_seq;
CREATE TABLE reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id), category_id uuid NOT NULL REFERENCES categories(id),
 title varchar(150) NOT NULL CHECK(length(trim(title))>=10),
 description varchar(5000) NOT NULL CHECK(length(trim(description))>=30),
 location varchar(255) NOT NULL CHECK(length(trim(location))>=5),
 status text NOT NULL DEFAULT 'Diterima' CHECK(status IN ('Diterima','Diproses','Selesai','Ditolak')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz, result varchar(3000), rejection_code text, rejection varchar(1000),
 last_employee_id uuid REFERENCES users(id),
 CHECK((status='Selesai')=(resolved_at IS NOT NULL AND result IS NOT NULL)),
 CHECK(status <> 'Ditolak' OR (rejection IS NOT NULL AND rejection_code IS NOT NULL))
);
CREATE INDEX reports_owner_date ON reports(user_id,created_at DESC);
CREATE INDEX reports_status_date ON reports(status,created_at DESC);
CREATE INDEX reports_category_date ON reports(category_id,created_at DESC);
CREATE INDEX reports_resolved_date ON reports(resolved_at) WHERE status='Selesai';
CREATE INDEX reports_last_employee ON reports(last_employee_id) WHERE status IN ('Selesai','Ditolak');
CREATE FUNCTION protect_report_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.user_id,NEW.category_id,NEW.title,NEW.description,NEW.location,NEW.created_at,NEW.number)
 IS DISTINCT FROM (OLD.user_id,OLD.category_id,OLD.title,OLD.description,OLD.location,OLD.created_at,OLD.number)
 THEN RAISE EXCEPTION 'original report is immutable'; END IF;
 IF OLD.status IN ('Selesai','Ditolak') THEN RAISE EXCEPTION 'terminal report is read-only'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_original BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION protect_report_original();
