-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL, object text NOT NULL, reason varchar(1000) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_date ON audit_events(created_at DESC);

CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events are append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION protect_audit();
