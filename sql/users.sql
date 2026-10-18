-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL CHECK (length(trim(name))>=2),
 email varchar(254) NOT NULL CHECK (email=lower(trim(email))), phone varchar(20) NOT NULL DEFAULT '',
 role text NOT NULL CHECK (role IN ('warga','pegawai','admin')),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','inactive','pending')),
 password_hash text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state <> 'active' OR password_hash IS NOT NULL), UNIQUE(email)
);
