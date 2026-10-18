# Pemeriksaan backend dan integrasi — 16 Oktober 2026

| Pemeriksaan                        | Hasil                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Backend NestJS 12.1.3 / TypeScript | Build berhasil                                                                                        |
| SQL PostgreSQL                     | Tiga migrasi berhasil pada database baru; runner ulang tidak menggandakan skema                       |
| Integrasi HTTP + PostgreSQL asli   | 11 pengujian lulus                                                                                    |
| Dependency backend                 | 0 temuan audit saat diperiksa                                                                         |
| Frontend Next.js                   | Build produksi berhasil; typecheck/lint berhasil; 9 pengujian domain lulus                            |
| Proxy Next.js → NestJS             | Health berhasil 200; login cookie dan mutasi melalui frontend berhasil                                |
| Alur UI browser                    | Warga kirim → admin tugaskan Rina → pegawai catatan privat dan selesai → warga membaca hasil berhasil |
| Bukti UI                           | `review-integrasi.jpg`; laporan sintetis SM-2026-00130 pada database review lokal                     |
| Playwright otomatis frontend       | Belum dinyatakan lulus; proses Edge pada sesi pengujian sebelumnya terhenti sebelum test berjalan     |

Pengujian backend membuat database sementara terpisah lalu membersihkannya. Pengujian tidak memakai mock database. Database pengujian terpisah dari database review yang tersedia untuk pengguna.

## Aturan yang sudah diperiksa

- Login, session, registrasi, penolakan properti role/actorId yang tidak dikenal, pembatasan role dan UUID/parameter daftar.
- Pengiriman idempotent, payload berbeda pada kunci sama ditolak dan akses warga lain ditolak.
- Dua verifikasi bersamaan: hanya satu berhasil, satu konflik, satu assignment aktif.
- Catatan internal disaring dari detail dan proyeksi workspace warga.
- Penyelesaian hanya oleh penanggung jawab; laporan terminal menolak mutasi berikutnya.
- Pengalihan mencabut akses pegawai lama dan nonaktif pegawai bertugas ditolak.
- Unggahan diperiksa isi, re-encode, akses file privat, file tidak boleh dipakai dua kali.
- Klaim foto gagal membatalkan seluruh transaksi penyelesaian: status/version/assignment tetap.
- Kategori nonaktif menolak laporan baru; nama kategori historis tidak dapat diubah.
- Penolakan, statistik, pagination, pencarian parameterized dan batas tanggal.
- Token lama dibatalkan saat penerbitan ulang, token hanya dapat dipakai sekali, perubahan sandi/logout mencabut session.
- Cookie HttpOnly/SameSite dan penolakan Origin lain.
- Unique index penugasan aktif dan trigger audit append-only.
- Statistik berdasarkan hari/bulan Asia/Jakarta, termasuk pergantian hari UTC.

## Pemeriksaan lanjutan

Belum ada pengujian beban, deployment, pengiriman email, pemulihan backup atau audit keamanan eksternal. Kesamaan visual seluruh frame desktop/mobile Figma belum seluruhnya diperiksa. Hak akses utama diuji melalui API dan alur utama melalui browser; ini tidak berarti seluruh kombinasi UI sudah lulus regresi otomatis.
