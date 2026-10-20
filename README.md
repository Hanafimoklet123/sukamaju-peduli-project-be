# Sukamaju Peduli — Backend NestJS

Backend layanan pengaduan masyarakat, tersambung dengan frontend Next.js pada repository terpisah. Database menggunakan PostgreSQL dengan migrasi SQL asli; tidak memerlukan ORM atau layanan cloud.

## Menjalankan lokal

Kebutuhan: Node.js 24 LTS, npm, PostgreSQL 16 atau lebih baru. Dari repository backend:

```sh
npm ci
```

Buat database kosong `sukamaju_peduli` dan pengguna khusus melalui pgAdmin/psql. Salin `.env.example` menjadi `.env`, kemudian isi `DATABASE_URL`. Origin frontend harus konsisten; contoh memakai `http://127.0.0.1:3000`.

```sh
npm run db:migrate
npm run build
npm start
```

Backend: `http://127.0.0.1:4000/api`. Periksa `/api/health`. Untuk perubahan kode selama pengembangan, gunakan `npm run start:dev`. Watcher memakai compiler TypeScript agar metadata dependency injection Nest tetap benar.

## Backend dan database dalam Docker

Untuk domain `https://be.capstone-klmpk-b.my.id`, gunakan [panduan Nginx dan HTTPS VPS](deploy/README.md). Konfigurasi tersedia di `deploy/nginx/backend.conf`.

Isi `POSTGRES_PASSWORD` pada `.env` dengan password PostgreSQL (untuk volume yang sudah ada, gunakan password awalnya). Atur `NODE_ENV=development`, `DOCKER_BACKEND_PORT=4002` untuk port backend Docker, dan `FRONTEND_ORIGIN=http://127.0.0.1:3000`.

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Compose menunggu PostgreSQL sehat, menjalankan migrasi otomatis, kemudian memulai backend. Endpoint health: `http://127.0.0.1:<DOCKER_BACKEND_PORT>/api/health` (default DOCKER_BACKEND_PORT=4002). Jangan jalankan backend lokal pada port host yang sama. Image memakai hasil build; setelah perubahan kode, jalankan kembali `docker compose up -d --build`.

Backend memakai koneksi internal `postgres:5432`; nilai `DATABASE_URL` lokal tidak digunakan oleh container. PostgreSQL tetap tersedia dari host pada `127.0.0.1:5433`. Volume `sukamaju_pg` dipertahankan. Mengubah POSTGRES_PASSWORD tidak mengganti password pada volume yang sudah ada.

Seed development dijalankan secara eksplisit pada database tanpa akun:

```sh
docker compose exec backend node scripts/container.mjs scripts/seed.mjs --dev
```

Perintah tersebut membentuk koneksi internal yang sama, memakai SEED_PASSWORD dari Compose atau password demo default. Seeding tidak berjalan otomatis saat startup dan tetap ditolak pada NODE_ENV=production. Jika mengubah .env, jalankan kembali Compose agar environment container diperbarui.

Frontend yang berjalan di host memakai `BACKEND_URL=http://127.0.0.1:<PORT>` di `.env.local`, lalu restart frontend. Untuk menghentikan container dengan tetap menyimpan data:

```sh
docker compose down
```

## Seed development

Seeding data demo dilarang di production. Untuk pengembangan lokal, isi `DATABASE_URL` database development dan `NODE_ENV=development` pada `.env`, kemudian jalankan:

```sh
npm run db:migrate
npm run db:seed:dev
```

Perintah development mengaktifkan izin seed hanya selama proses berjalan. Jika `SEED_PASSWORD` belum diisi, kata sandi akun contoh memakai `DemoSukamaju2026!`. Isi `SEED_PASSWORD` minimal 12 karakter untuk menggantinya. Environment selain development ditolak; `.env` tidak diubah. Seed tetap menolak database yang sudah berisi akun dan tidak menghapus data.

## Data contoh

Seed hanya untuk database contoh kosong. Isi sementara pada `.env`:

```dotenv
ALLOW_DEMO_SEED=true
SEED_PASSWORD=DemoSukamaju2026!
```

Jalankan `npm run db:seed`, kemudian kembalikan `ALLOW_DEMO_SEED=false` dan hapus `SEED_PASSWORD`. Seed menolak menimpa database berisi akun dan menolak berjalan dalam `NODE_ENV=production`. Tidak ada endpoint reset database publik.

| Role         | Email contoh             | Kata sandi contoh |
| ------------ | ------------------------ | ----------------- |
| Warga        | ahmad.contoh@example.com | DemoSukamaju2026! |
| Warga lain   | siti.contoh@example.com  | DemoSukamaju2026! |
| Pegawai Rina | rina.contoh@example.com  | DemoSukamaju2026! |
| Pegawai Budi | budi.contoh@example.com  | DemoSukamaju2026! |
| Admin        | admin.contoh@example.com | DemoSukamaju2026! |

Nilai sebenarnya mengikuti `SEED_PASSWORD` saat seed. Akun Dewi masih pending dan harus diaktifkan melalui tautan. Seluruh identitas, laporan dan kontak seed adalah contoh sintetis. Ilustrasi desain tetap pada frontend; foto laporan baru disimpan privat dalam PostgreSQL.

Untuk database tanpa demo, isi `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` pada lingkungan lokal lalu jalankan `npm run admin:create`. Bootstrap menolak membuat admin kedua. Hapus variabel kata sandi bootstrap setelah selesai.

## Menghubungkan frontend

Di repository frontend, buat `.env.local`:

```dotenv
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_ENABLE_DEMO=true
BACKEND_URL=http://127.0.0.1:4000
```

`NEXT_PUBLIC_ENABLE_DEMO=true` hanya untuk review dengan seed. Tombol tersebut tetap login ke server menggunakan kredensial contoh, tidak melewati autentikasi. Set `false` pada aplikasi tanpa akun contoh. Jalankan `npm ci` dan `npm run dev` di frontend, lalu buka http://127.0.0.1:3000. Next.js meneruskan `/api/*` ke NestJS sehingga cookie tetap pada origin yang sama.

Buka `/review` untuk panduan alur. Warga membuat laporan, admin memverifikasi/menugaskan, pegawai memberi tanggapan/hasil, lalu warga memantau hasil. Tautan aktivasi/reset diterbitkan admin dan ditampilkan sekali untuk disampaikan melalui kanal resmi. Pengiriman email otomatis belum diaktifkan.

## Fitur

- Pendaftaran warga, login, sesi database, logout, profil, ubah kata sandi.
- Pegawai pending, aktivasi/pemulihan sekali pakai 30 menit, pembatalan token lama dan pencabutan sesi.
- Pengaduan: kirim, filter, detail, riwayat, persetujuan, penugasan, penolakan, pengalihan, tanggapan, catatan internal, penyelesaian dan arsip.
- Pengiriman idempotent dan pemeriksaan versi untuk konflik perubahan bersamaan.
- Hak akses server dan penyaringan data privat sebelum respons dikirim ke browser.
- Pengelolaan pegawai/warga, kategori aktif/nonaktif, nama kategori historis dan audit append-only.
- Foto JPG/PNG maksimal 2 MB dan 12 megapiksel, pemeriksaan isi, re-encode WebP tanpa metadata, akses privat berdasarkan laporan.
- Statistik bulanan/kuartalan dan metrik periode dengan zona Asia/Jakarta.
- Validasi DTO ketat, query parameterized, cookie HttpOnly, pemeriksaan origin, security headers dan pembatasan permintaan lokal.

## SQL dan kode

| Lokasi                           | Isi                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| `sql/<nama_tabel>.sql`           | Satu tabel beserta FK, constraint, indeks, dan trigger terkait |
| `sql/categories.sql`             | Kategori dan empat kategori awal                               |
| `sql/migrations.json`            | Urutan migrasi dan checksum baseline lama                      |
| `sql/demo-data.json`             | Data sintetis untuk script seed                                |
| `scripts/migrate.mjs`            | Migrasi atomik dengan checksum dan lock                        |
| `scripts/seed.mjs`               | Seed bersyarat dan hash sandi per akun                         |
| `src/auth.ts`, `security.ts`     | Autentikasi, token, guard, otorisasi                           |
| `src/reports.ts`                 | Akses data dan transaksi pengaduan                             |
| `src/management.ts`              | Akun, kategori, audit dan proyeksi workspace                   |
| `src/files.ts`, `analytics.ts`   | Foto privat dan statistik                                      |
| `src/dto.ts`, `db.ts`, `main.ts` | Validasi, koneksi, konfigurasi Nest                            |
| `test/api.test.mjs`              | HTTP dan PostgreSQL asli pada database terisolasi              |

Untuk menjalankan SQL manual di pgAdmin/psql pada database kosong, ikuti urutan file per tabel pada `sql/README.md` dalam satu transaksi. Pilih satu cara migrasi; jangan menjalankan file manual lalu runner pada database sama karena ledger berbeda. Runner menolak perubahan checksum migrasi lama; gunakan migrasi baru untuk perubahan skema.

Nomor laporan memakai sequence, unik dan dapat memiliki celah akibat rollback. Sequence tidak diulang setiap tahun; tahun memakai Asia/Jakarta. UUID menjadi ID API, bukan nomor tampilan laporan.

## Pengujian

```sh
npm run typecheck
npm test
npm audit
```

`npm test` membangun kode, membuat database `sukamaju_test_<UUID>` pada server dari `DATABASE_URL`, menjalankan migrasi/seed dan API port acak, lalu menghapus hanya database sementara itu. Pengguna PostgreSQL pengujian perlu hak **CREATEDB**. Gunakan pengguna pengujian terpisah dari pengguna aplikasi produksi.

Hasil: **11 pengujian integrasi HTTP/PostgreSQL lulus**, build/typecheck berhasil, audit dependency backend 0 temuan saat diperiksa. Frontend berhasil dibuild, lolos lint/typecheck dan 9 pengujian domain. Alur lengkap juga berhasil diperiksa melalui UI browser. Lihat [hasil pemeriksaan](docs/VALIDATION.md) dan [kontrak API](docs/API.md).

## Batasan implementasi

Untuk menjaga perubahan lintas akun/laporan, mutasi memakai satu advisory lock database bersama, row lock/version check dan unique index. Pendekatan ini membatasi paralelisme tulis; pecah lock berdasarkan agregat setelah pengujian beban jika volume meningkat.

`/workspace` mengirim seluruh data yang boleh dilihat role agar layar frontend dapat langsung terhubung. Endpoint daftar menyediakan pagination server, tetapi layar sekarang memfilter/paginasi proyeksi workspace di browser. Untuk data besar, pindahkan tiap layar ke endpoint paginated. Foto disimpan sebagai bytea; gunakan penyimpanan privat terpisah saat volume meningkat. Unggahan tak terpakai belum memiliki pembersihan terjadwal.

Limiter saat ini per proses/IP; proxy lokal terlihat sebagai satu IP. Banyak instance memerlukan limiter bersama dan pengaturan proxy terpercaya. Belum ada email otomatis, deployment, backup terjadwal, atau pengujian beban. Deployment memerlukan HTTPS, `NODE_ENV=production`, kredensial baru, hak database minimum, dan penonaktifan tombol/kredensial demo.

Rujukan: [Nest Validation](https://docs.nestjs.com/techniques/validation), [Nest Guards](https://docs.nestjs.com/guards), [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL locking](https://www.postgresql.org/docs/16/explicit-locking.html).
