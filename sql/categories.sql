-- PostgreSQL 16+. Urutan eksekusi: lihat sql/README.md dan migrations.json.
CREATE TABLE categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(50) NOT NULL CHECK(length(trim(name))>=2),
 description varchar(255) NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_unique ON categories(lower(name));


INSERT INTO categories(id,name,description) VALUES
 ('10000000-0000-4000-8000-000000000001','Infrastruktur lingkungan','Lampu jalan, saluran air, dan sarana umum lingkungan.'),
 ('10000000-0000-4000-8000-000000000002','Kebersihan','Sampah dan kebersihan area sekitar.'),
 ('10000000-0000-4000-8000-000000000003','Ketertiban lingkungan','Gangguan ketertiban lingkungan.'),
 ('10000000-0000-4000-8000-000000000004','Pelayanan administrasi','Keluhan tentang proses pelayanan kelurahan.');
