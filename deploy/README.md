# Domain backend VPS

Domain: https://be.capstone-klmpk-b.my.id

Konfigurasi ini untuk Nginx yang terpasang langsung di VPS Ubuntu/Debian, dengan backend Docker pada `127.0.0.1:4002`. Jangan gunakan bersamaan dengan reverse proxy lain yang sudah memakai port 80/443 tanpa menyesuaikan konfigurasinya.

1. Buat DNS record A untuk `be.capstone-klmpk-b.my.id` menuju IP publik VPS. Jika ada record AAAA, pastikan IPv6 juga menuju VPS yang sama atau hapus record yang tidak digunakan.
2. Izinkan TCP 80 dan 443 di firewall VPS/provider. Database tetap diakses melalui network internal Docker.
3. Di `.env` backend, gunakan:

```dotenv
NODE_ENV=production
DOCKER_BACKEND_PORT=4002
FRONTEND_ORIGIN=https://fe.capstone-klmpk-b.my.id
ALLOW_DEMO_SEED=false
```

Pertahankan POSTGRES_PASSWORD yang sesuai dengan volume database. Domain backend tidak menggantikan FRONTEND_ORIGIN.

Jalankan dari root repository di VPS:

```sh
sudo docker compose up -d --build
curl --fail http://127.0.0.1:4002/api/health
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo install -m 644 deploy/nginx/backend.conf /etc/nginx/sites-available/sukamaju-backend
sudo ln -s /etc/nginx/sites-available/sukamaju-backend /etc/nginx/sites-enabled/sukamaju-backend
sudo nginx -t
```

Jika symlink sudah ada dari pemasangan sebelumnya, lewati perintah ln. Jika `nginx -t` berhasil, lanjutkan:

```sh
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo certbot --nginx -d be.capstone-klmpk-b.my.id --redirect
sudo certbot renew --dry-run
curl --fail https://be.capstone-klmpk-b.my.id/api/health
```

Certbot menambahkan konfigurasi TLS dan redirect HTTPS pada file Nginx di VPS setelah validasi domain berhasil. File dalam repository adalah konfigurasi HTTP awal; jangan menyalinnya ulang setelah pemasangan TLS tanpa mempertahankan konfigurasi sertifikat.

Jika UFW sudah aktif, izinkan Nginx menggunakan `sudo ufw allow 'Nginx Full'`. Tidak perlu membuka port 4002 atau 5433 ke internet.

Pada environment frontend, atur:

```dotenv
BACKEND_URL=https://be.capstone-klmpk-b.my.id
```

Restart atau build ulang frontend agar environment terbaca. Jika frontend memakai Docker, sesuaikan environment service frontend. URL pengecekan backend adalah `/api/health`; root domain tidak memiliki halaman aplikasi.
