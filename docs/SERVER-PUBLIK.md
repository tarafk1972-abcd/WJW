# Menyiapkan server publik (domain + HTTPS + API)

Panduan ini membawa WJW dari "hanya jalan di Wi-Fi rumah" menjadi bisa
dibuka warga dari mana saja, dengan HTTPS asli.

Setelah selesai:

- warga mendaftar dari rumah masing-masing, tanpa peringatan sertifikat;
- notifikasi darurat berfungsi (Web Push **wajib** HTTPS);
- GPS ronda berfungsi di HP satpam;
- aplikasi bisa dipasang sebagai PWA, dan APK punya alamat untuk dituju.

Perkiraan waktu: **1–2 jam**. Biaya: **domain ± Rp 150–200 rb/tahun**,
**VPS ± Rp 50–90 rb/bulan**. Sertifikat HTTPS gratis.

---

## Gambaran susunannya

```
        Internet
           │
     https://wargajagawarga.my.id
           │
        [ Nginx ]  ← memegang sertifikat HTTPS
           │
     ┌─────┴─────────────┐
     │                   │
  berkas web        /api/*  →  Node (WJW API) di port 8787
  (folder dist)                       │
                                 SQLite (satu berkas)
```

Satu domain saja. Nginx menyajikan tampilan web, dan meneruskan yang
berawalan `/api/` ke Node. Karena keduanya satu alamat, tidak ada urusan
CORS dan `VITE_API_BASE` boleh dikosongkan.

---

## 1. Beli domain

Yang murah dan cukup: `.my.id` (± Rp 150 rb/tahun) di Niagahoster,
Rumahweb, atau Domainesia. Bebas memilih penyedia mana pun.

Contoh di panduan ini: **`wargajagawarga.my.id`**

## 2. Sewa VPS

Spesifikasi terkecil sudah cukup untuk beberapa RW — **1 vCPU, 1 GB
RAM**. Aplikasi ini ringan dan SQLite tidak butuh server basis data
terpisah.

| Penyedia | Perkiraan |
|---|---|
| Biznet Gio / IDCloudHost (server di Indonesia — lebih cepat bagi warga) | ± Rp 50–100 rb/bln |
| Hetzner / DigitalOcean / Vultr | ± Rp 60–90 rb/bln |

Pilih **Ubuntu 24.04 LTS**. Catat alamat IP-nya, misal `203.0.113.10`.

## 3. Arahkan domain ke VPS

Di panel domain, tambahkan dua data DNS:

| Tipe | Nama | Nilai |
|---|---|---|
| A | `@` | `203.0.113.10` |
| A | `www` | `203.0.113.10` |

Tunggu 5–30 menit, lalu uji dari komputer Anda:

```
ping wargajagawarga.my.id
```

Harus menjawab dengan IP VPS Anda. **Jangan lanjut sebelum ini benar** —
Let's Encrypt memverifikasi lewat domain, jadi akan gagal bila DNS belum
mengarah.

## 4. Masuk ke VPS dan pasang kebutuhannya

```bash
ssh root@203.0.113.10

apt update && apt upgrade -y
apt install -y nginx git curl build-essential

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node -v    # harus v22.x
```

`build-essential` diperlukan `better-sqlite3` untuk mengompilasi
bagian nativenya.

## 5. Ambil kodenya

Repositori ini **privat**, jadi perlu cara masuk. Termudah: buat
[Personal Access Token](https://github.com/settings/tokens) dengan izin
`repo`, lalu:

```bash
mkdir -p /opt && cd /opt
git clone -b arena/019fad5f-wjw https://github.com/tarafk1972-abcd/WJW.git wjw
cd /opt/wjw
npm install
```

Saat diminta sandi, tempelkan token itu (bukan sandi akun GitHub).

## 6. Isi berkas .env

```bash
nano /opt/wjw/.env
```

```
PORT=8787
WJW_DB=/var/lib/wjw/wjw.sqlite

# Sandi superadmin — ganti dengan yang kuat
WJW_SUPERADMIN_PASSWORD=ganti-dengan-sandi-panjang-dan-acak

# Kunci notifikasi (dibuat di langkah berikutnya)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:tarafk1972@gmail.com

WJW_APP_URL=https://wargajagawarga.my.id
```

Buat foldernya dan kunci notifikasinya:

```bash
mkdir -p /var/lib/wjw
cd /opt/wjw && npm run vapid
```

Salin kedua baris keluarannya ke `.env`.

> **Basis data ditaruh di `/var/lib/wjw/`, bukan di dalam folder
> aplikasi.** Dengan begitu memperbarui kode tidak akan pernah
> menyentuh data warga.

## 7. Bangun tampilan web

```bash
cd /opt/wjw
npm run build
```

Hasilnya di `/opt/wjw/dist`. `VITE_API_BASE` **tidak** perlu diisi:
tampilan dan API berbagi satu domain.

## 8. Jalankan API sebagai layanan systemd

Agar hidup lagi otomatis setelah server dinyalakan ulang atau proses
mati.

```bash
nano /etc/systemd/system/wjw.service
```

```ini
[Unit]
Description=WJW API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wjw
ExecStart=/usr/bin/npm run server:start
Restart=always
RestartSec=5
User=www-data
Group=www-data

# Pengamanan dasar
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/wjw

[Install]
WantedBy=multi-user.target
```

> **Tidak ada `EnvironmentFile=` di sini, dan itu disengaja.** Aplikasi
> sudah membaca `/opt/wjw/.env` sendiri. Menyuruh systemd ikut
> membacanya justru berisiko: systemd punya aturan kutip sendiri, dan
> nilai seperti `MAIL_FROM=Warga Jaga Warga <noreply@...>` bisa ditolak
> atau terpotong — layanan gagal hidup karena berkas yang sebenarnya
> sudah benar.

```bash
chown -R www-data:www-data /var/lib/wjw /opt/wjw
chmod 600 /opt/wjw/.env && chown www-data:www-data /opt/wjw/.env
systemctl daemon-reload
systemctl enable --now wjw
systemctl status wjw --no-pager
```

Uji dari dalam VPS:

```bash
curl http://127.0.0.1:8787/api/health
```

Harus menjawab `{"ok":true,...}`.

Melihat log bila bermasalah:

```bash
journalctl -u wjw -f
```

## 9. Atur Nginx

```bash
nano /etc/nginx/sites-available/wjw
```

```nginx
server {
    listen 80;
    server_name wargajagawarga.my.id www.wargajagawarga.my.id;
    root /opt/wjw/dist;
    index index.html;

    # Foto bukti dikirim sebagai data URL di dalam JSON — bawaan Nginx
    # 1 MB terlalu kecil dan akan menolaknya dengan galat 413.
    client_max_body_size 12M;

    # API diteruskan ke Node.
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Tanpa baris ini semua permintaan tampak berasal dari 127.0.0.1,
        # sehingga pembatasan laju menghitung seluruh warga sebagai satu.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Berkas ber-hash boleh disimpan lama; sisanya jangan.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Aplikasi satu halaman: alamat apa pun dilayani index.html.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Service worker tidak boleh disimpan cache, kalau tidak pembaruan
    # tertahan berhari-hari di HP warga.
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

```bash
ln -s /etc/nginx/sites-available/wjw /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Sekarang `http://wargajagawarga.my.id` sudah bisa dibuka — masih tanpa
HTTPS.

## 10. Pasang HTTPS (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d wargajagawarga.my.id -d www.wargajagawarga.my.id
```

Ikuti pertanyaannya; pilih **redirect** agar `http://` otomatis
dialihkan ke `https://`. Certbot menyunting konfigurasi Nginx sendiri.

Perpanjangan otomatis sudah terpasang. Ujilah:

```bash
certbot renew --dry-run
```

Buka <https://wargajagawarga.my.id> — harus muncul gembok, tanpa
peringatan apa pun.

## 11. Uji sebelum dianggap selesai

Dari komputer mana pun:

```bash
curl https://wargajagawarga.my.id/api/health
```

Harus menjawab `{"ok":true,...}`.

Lalu di peramban, periksa empat hal ini:

1. <https://wargajagawarga.my.id> terbuka, gembok hijau, **tanpa**
   peringatan.
2. Di halaman depan ada tulisan `v...` — itu penanda versi build.
3. Buka `https://wargajagawarga.my.id/app/patrol` **langsung** (bukan
   lewat klik). Harus tampil, bukan galat 404 dari Nginx — inilah yang
   dijamin `try_files`.
4. Daftar satu akun percobaan. Kalau berhasil, berarti tampilan, API,
   dan basis data sudah tersambung.

## 12. Tutup pintu yang tidak dipakai

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

Port 8787 sengaja **tidak** dibuka: Node hanya dihubungi Nginx dari
dalam.

---

## Memperbarui aplikasi nanti

```bash
cd /opt/wjw
git pull origin arena/019fad5f-wjw
npm install
npm run build
systemctl restart wjw
```

Basis data tidak tersentuh karena berada di `/var/lib/wjw/`.

## Mencadangkan data

Satu berkas saja, dan inilah seluruh data warga Anda:

```bash
sqlite3 /var/lib/wjw/wjw.sqlite ".backup '/root/wjw-$(date +%F).sqlite'"
```

Otomatiskan harian:

```bash
crontab -e
```

```
0 2 * * * sqlite3 /var/lib/wjw/wjw.sqlite ".backup '/root/backup/wjw-$(date +\%F).sqlite'"
```

> Cadangan yang hanya ada di server yang sama bukan cadangan. Sesekali
> unduh berkas itu ke komputer Anda.

---

## Setelah server hidup

1. **Masuk sebagai superadmin** (`tarafk1972@gmail.com`) dan unggah
   gambar QRIS lewat Konsol.
2. **Isi SMTP** di `.env` agar email tagihan terkirim — lihat
   `docs/EMAIL-TAGIHAN.md`.
3. **Buat kode undangan baru** dari akun admin. Kode dari komputer lama
   Anda tidak berlaku di sini: basis datanya berbeda.
4. **Bangun APK** (opsional) dengan `api_base` =
   `https://wargajagawarga.my.id` — lihat `docs/BUAT-APK.md`.

## Yang masih perlu diperhatikan

Server publik menyelesaikan penghalang teknis, bukan seluruhnya:

- **UU PDP No. 27/2022** — aplikasi menyimpan lokasi dan data kesehatan.
  Perlu kebijakan privasi tertulis dan persetujuan yang tercatat.
- **Belum diuji lapangan** — belum pernah dipakai satpam dan warga
  sungguhan dengan sinyal naik-turun.
- **Tidak ada cadangan saat internet mati** — bila jaringan padam,
  peringatan tidak sampai ke mana pun.

Selengkapnya di `docs/KESIAPAN-PRODUKSI.md`.

---

## Bila ada yang tidak beres

| Gejala | Periksa |
|---|---|
| Halaman kosong | `journalctl -u wjw -f`, lalu `nginx -t` |
| `502 Bad Gateway` | Node mati: `systemctl status wjw` |
| `413` saat unggah foto | `client_max_body_size` di Nginx |
| Certbot gagal | DNS belum mengarah — uji `ping domain-anda` |
| Notifikasi tidak muncul | VAPID kosong di `.env`; isi lalu `systemctl restart wjw` |
| Perbaikan tidak terlihat | Cek angka `v...` di halaman depan; ulangi `npm run build` |
