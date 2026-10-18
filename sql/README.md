# SQL PostgreSQL per tabel

Setiap tabel memiliki file sendiri. Indeks, constraint, sequence, dan trigger yang terkait diletakkan dalam file tabel tersebut. Data kategori awal ada di categories.sql. Data contoh tetap di demo-data.json.

## Menjalankan

Disarankan: `npm run db:migrate`. Runner membaca urutan dari migrations.json, menjalankan migrasi dalam satu transaksi, dan mencatat checksum di schema_migrations. File schema_migrations.sql dijalankan otomatis terlebih dahulu.

Untuk eksekusi manual pada database kosong, jalankan file berikut sesuai urutan, dalam satu transaksi:

1. schema_migrations.sql — pencatatan migrasi (tabel teknis).
2. users.sql — akun warga, pegawai, admin.
3. sessions.sql — sesi login.
4. recovery_tokens.sql — aktivasi dan pemulihan akun.
5. categories.sql — kategori dan empat kategori awal.
6. reports.sql — laporan, sequence nomor laporan, dan trigger perlindungan laporan.
7. assignments.sql — penugasan dan indeks satu penugasan aktif.
8. responses.sql — tanggapan.
9. status_history.sql — riwayat status dan indeksnya.
10. attachments.sql — foto dan indeks unggahan.
11. audit_events.sql — audit dan trigger append-only.
12. idempotency_requests.sql — pencegahan pengiriman laporan berulang.

File dengan foreign key membutuhkan tabel rujukannya sudah tersedia. Jangan menjalankan satu file lagi pada tabel yang sudah dibuat. Eksekusi manual tidak mengisi ledger checksum; jangan mencampur eksekusi manual dan runner pada database yang sama.

## Database yang sudah memakai struktur lama

Runner mengenali ketiga migrasi lama melalui checksum yang disimpan di migrations.json. Jika semuanya sudah diterapkan dan checksum cocok, runner mencatat baseline per tabel tanpa menjalankan ulang CREATE TABLE atau memasukkan ulang kategori. Data tetap dipertahankan. Migrasi lama yang belum lengkap atau berubah ditolak agar skema tidak dianggap lengkap secara keliru.

Setelah migrasi diterapkan, jangan mengubah isi file baseline. Perubahan skema selanjutnya memakai file migrasi baru yang ditambahkan ke akhir daftar files di migrations.json; baseline dan legacy dipertahankan untuk kompatibilitas.

Akun demo: `npm run db:seed` dengan opt-in pada database kosong. Admin awal tanpa demo: `npm run admin:create`.
