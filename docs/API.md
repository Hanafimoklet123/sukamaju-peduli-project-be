# Kontrak API v0.1

Base path: `/api`. JSON memakai camelCase pada HTTP; tabel PostgreSQL memakai snake_case. UUID digunakan untuk parameter ID. Respons tidak memuat hash sandi, token sesi, maupun catatan internal bagi warga.

## Autentikasi

`POST /auth/login` dengan `{"email":"ahmad.contoh@example.com","password":"DemoSukamaju2026!"}` mengembalikan `{user}` dan cookie `sukamaju_session`. Cookie HttpOnly, SameSite=Lax, path `/api`, Secure ketika NODE_ENV=production. Tidak ada token dalam localStorage. Browser mengakses API melalui proxy Next.js.

Session adalah nilai acak 256-bit; database menyimpan hash SHA-256 dan waktu kedaluwarsa. API juga menerima `Authorization: Bearer <nilai-session>` untuk klien API yang sudah memiliki nilai cookie. Endpoint login tidak mengembalikan bearer token dalam JSON.

Permintaan perubahan dengan cookie harus memiliki header Origin sesuai `FRONTEND_ORIGIN`. Permintaan dari origin lain ditolak. Pemanggil non-browser dapat menggunakan bearer session. Akun nonaktif, session kedaluwarsa/dicabut menghasilkan 401. API hanya mendukung HTTP lokal pada setup review; produksi memerlukan HTTPS.

| Metode / path              | Body atau query                                                    | Akses                                                                              |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| GET /health                | —                                                                  | Publik; memeriksa koneksi database                                                 |
| POST /auth/register        | name, email, phone opsional, password 12–128, privacyAccepted=true | Publik; role selalu warga                                                          |
| POST /auth/login           | email, password                                                    | Publik                                                                             |
| GET /auth/session          | —                                                                  | Semua akun aktif                                                                   |
| POST /auth/logout          | `{}`                                                               | Akun aktif; mencabut session saat ini                                              |
| POST /auth/password/change | current, password 12–128                                           | Akun aktif; mencabut seluruh session lama dan menerbitkan session baru pada cookie |
| POST /auth/token/consume   | token, password 12–128                                             | Token valid sekali pakai; mencabut session lama dan tidak login otomatis           |
| GET /me                    | —                                                                  | Akun sendiri                                                                       |
| PATCH /me                  | name, phone                                                        | Akun sendiri; email/role tidak dapat diubah                                        |
| GET /workspace             | —                                                                  | Proyeksi data sesuai role untuk frontend review                                    |

Properti DTO yang tidak dikenal ditolak (422), termasuk actorId/role dari klien. Aktor berasal dari session.

## Pengaduan

| Metode / path               | Body                                                                                            | Aturan                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| POST /reports               | requestId UUID, title 10–150, description 30–5000, location 5–255, categoryId, photoId opsional | Warga; kategori aktif; foto milik pengirim dan belum dipakai                                   |
| GET /reports                | Filter dan pagination                                                                           | Warga: sendiri; pegawai: penanggung jawab aktif atau arsip terakhirnya; admin: seluruh laporan |
| GET /reports/:id            | —                                                                                               | Scoping sama; ID di luar akses mengembalikan 404                                               |
| POST /reports/:id/verify    | version, employeeId, text 10–3000                                                               | Admin; Diterima → Diproses; pegawai aktif                                                      |
| POST /reports/:id/reassign  | version, employeeId, text 10–3000                                                               | Admin; Diproses; penanggung jawab baru berbeda; akses lama dicabut                             |
| POST /reports/:id/reject    | version, code, text 20–1000                                                                     | Admin; Diterima/Diproses → Ditolak                                                             |
| POST /reports/:id/responses | version, text 10–3000, internal boolean                                                         | Diproses; pegawai aktif boleh publik/internal; admin hanya internal                            |
| POST /reports/:id/complete  | version, text 20–3000, photoId opsional                                                         | Hanya penanggung jawab aktif; Diproses → Selesai                                               |

Kode penolakan: `outside_area`, `outside_authority`, `duplicate`, `incomplete`, `other`. Selesai/Ditolak adalah arsip baca. Setiap mutasi laporan meningkatkan version. Version lama menghasilkan 409 dan tidak mengubah data. Seluruh perubahan laporan, assignment, response, status history dan audit terjadi dalam satu transaksi.

`requestId` wajib unik per pengguna. Retry dengan requestId dan isi sama mengembalikan reportId sama. Isi berbeda pada requestId sama menghasilkan 409. Simpan photoId yang sudah diunggah ketika melakukan retry agar payload tetap sama.

Filter daftar: `page` mulai 1, `pageSize` 1–100 (default 20), `q`, `status`, `categoryId`, `employeeId` (admin), `from`, `to`. Tanggal YYYY-MM-DD, kedua batas inklusif berdasarkan hari Asia/Jakarta. Urutan terbaru dahulu. Bentuk respons:

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0 }
```

Respons mutasi laporan: `{ok:true,reportId:"uuid"}`. Detail memuat isi asli, status/version, riwayat, tanggapan yang berhak dibaca dan URL foto privat. Riwayat assignment tidak dikirim ke warga. Penolakan dan hasil akhir ditampilkan dalam detail serta timeline.

## Berkas privat

`POST /files`: multipart/form-data dengan satu field `file`. Input JPG/PNG maksimal 2 MB dan 12 megapiksel. Isi magic bytes dan decoder diperiksa, orientasi dinormalisasi, ukuran maksimal 1920×1920 dan re-encode WebP tanpa metadata. Respons `{id,url}`. Header MIME dari klien tidak dipercaya.

`GET /files/:id`: cookie/session wajib. Foto draft hanya untuk pemilik unggahan; foto yang sudah dikaitkan mengikuti akses laporan. Tidak ada direktori public upload. Bytea disimpan di PostgreSQL, respons `image/webp` dan `Cache-Control: private, no-store`. Satu foto asli dan satu foto hasil per laporan. Klaim foto hanya dapat dilakukan satu kali oleh pemilik.

## Akun, kategori, audit

| Metode / path                  | Body/query                                     | Akses                                                                                            |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET /employees                 | q, page, pageSize                              | Admin                                                                                            |
| POST /employees                | name, email                                    | Admin; selalu pending, tanpa password permanen                                                   |
| PATCH /employees/:id           | name, email, state                             | Admin; email tetap; aktif memerlukan password hasil aktivasi; nonaktif diblokir jika tugas aktif |
| POST /employees/:id/activation | reason 20–1000, identityVerified=true          | Admin; akun pending                                                                              |
| GET /citizens                  | q, page, pageSize                              | Admin                                                                                            |
| POST /users/:id/recovery       | reason 20–1000, identityVerified=true          | Admin; pending menghasilkan token aktivasi, aktif menghasilkan pemulihan; akun nonaktif ditolak  |
| GET /categories                | —                                              | Akun aktif; termasuk nama kategori historis nonaktif                                             |
| POST /categories               | name 2–50, description ≤255, active            | Admin                                                                                            |
| PATCH /categories/:id          | name, description, active                      | Admin; nama kategori yang sudah dipakai tidak dapat diubah                                       |
| GET /audit                     | from, to, action, actor (nama), page, pageSize | Admin; terbaru dahulu                                                                            |

Penerbitan token mengembalikan `{url,expiresInMinutes:30}`. Nilai token hanya pada fragmen URL (`#token=...`), ditampilkan satu kali pada respons penerbitan. Database menyimpan hash; penerbitan ulang mencabut seluruh token akun yang belum dipakai. Kata sandi permanen dipilih pemilik. Tidak ada pengiriman email otomatis. Jangan menaruh nilai token di log/aplikasi analitik.

## Statistik

`GET /analytics/events?year=2026&period=month` atau `period=quarter`: jumlah laporan dibuat berdasarkan created_at dan selesai berdasarkan resolved_at. Laporan selesai dapat berasal dari periode pengiriman sebelumnya. Selalu 12 atau 4 bucket, termasuk nol; zona Asia/Jakarta.

`GET /analytics/cohort?from=2026-01-01&to=2026-12-31&categoryId=...&status=...`: menghitung kelompok berdasarkan tanggal pengiriman, kemudian status saat ini, rasio selesai dan rata-rata waktu kalender selesai. Hanya admin. Rasio berupa 0–1; rata-rata null jika belum ada laporan selesai.

## Kesalahan

```json
{ "statusCode": 409, "message": "Laporan telah diperbarui. Muat data terbaru." }
```

400 data/referensi tidak valid; 401 sesi/kredensial; 403 role/origin; 404 objek tidak tersedia; 409 konflik aturan/versi/duplikasi; 413 foto terlalu besar; 422 validasi DTO (message dapat berupa array); 429 pembatasan permintaan; 500 kesalahan internal yang disamarkan; 503 health database. Aplikasi tidak mengembalikan SQL, stack trace atau kredensial dalam respons kesalahan.

Limiter lokal: 20 request/menit/IP untuk gabungan login/register/konsumsi token dan 300 untuk kelompok lain. Header Retry-After tersedia saat 429. Ini belum merupakan limiter terdistribusi.
