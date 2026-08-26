# Deploy WJW Phase 1 di Fly.io

Dokumen ini untuk operator, bukan sekadar cara membuat URL. Phase 1 menyimpan
SQLite pada satu Fly Volume dan broker SSE berada di memori proses. Karena itu
**jalankan tepat satu Machine** sampai database dipindah ke PostgreSQL dan event
broker diganti Redis/NATS.

> Region yang disarankan dari Bandung adalah `sin` (Singapore). Gunakan region
> lain hanya bila uji latency lapangan menunjukkan hasil yang lebih baik.

## 1. Persiapan lokal

```bash
npm ci
npm run build
npm run build:server
npm test
fly auth login
```

`build:server` otomatis menyalin `schema.sql` ke artefak `build/server`, jadi
server hasil kompilasi dapat diuji dengan `npm start` tanpa langkah copy manual.

Repository ini sudah ditujukan ke app Fly **`warga-jaga-warga-wjw`**. Bila app
belum dibuat, buat sekali dengan nama yang sama; nama Fly hanya boleh berisi
huruf kecil, angka, dan tanda hubung:

```bash
fly apps create warga-jaga-warga-wjw
fly volumes create wjw_data --app warga-jaga-warga-wjw --region sin --size 3
```

Jangan membuat volume kedua atau menaikkan jumlah Machine untuk app ini. Dua
Machine dengan volume SQLite berbeda akan menghasilkan data dan event darurat
yang terpecah.

## 2. Secret wajib

Buat kunci enkripsi baru **sekali** dan simpan di password manager organisasi.
Kunci yang hilang atau diganti tanpa prosedur rotasi membuat snapshot medis lama
tidak dapat dibaca.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

fly secrets set --app warga-jaga-warga-wjw \
  WJW_DATA_ENCRYPTION_KEY='hasil-perintah-di-atas' \
  WJW_SUPERADMIN_PASSWORD='sandi-panjang-unik'
```

Tambahkan secret berikut sebelum mengandalkan notifikasi push/email:

```bash
# hasilkan sekali dengan npm run vapid; jangan gunakan contoh nilai
fly secrets set --app warga-jaga-warga-wjw \
  VAPID_PUBLIC_KEY='...' \
  VAPID_PRIVATE_KEY='...' \
  VAPID_SUBJECT='mailto:operator@domain.id'

# opsional, hanya bila email tagihan dipakai
fly secrets set --app warga-jaga-warga-wjw \
  SMTP_HOST='smtp.contoh.id' SMTP_PORT='587' \
  SMTP_USER='...' SMTP_PASS='...' \
  MAIL_FROM='Warga Jaga Warga <noreply@domain.id>'
```

`NODE_ENV=production`, `PORT=8080`, `WJW_DB=/data/wjw.sqlite`, dan
`TZ=Asia/Jakarta` (agar jadwal ronda tidak dibaca sebagai UTC host) sudah ada di
`fly.toml`. Server **menolak boot produksi** bila
`WJW_DATA_ENCRYPTION_KEY` kosong; itu disengaja agar profil medis dan snapshot
SOS tidak tertulis plaintext.

## 3. Deploy dan verifikasi

```bash
fly deploy --app warga-jaga-warga-wjw
fly status --app warga-jaga-warga-wjw
fly logs --app warga-jaga-warga-wjw
curl -fsS https://warga-jaga-warga-wjw.fly.dev/api/health
```

Respons health yang sehat berbentuk `{"ok":true,...}` dan memeriksa proses
serta SQLite, bukan hanya bahwa port terbuka. `fly.toml` mematikan auto-stop dan
menjaga minimal satu Machine agar tidak ada cold start saat SOS.

Setelah domain final aktif, set URL publik untuk tautan email/QR lalu deploy
ulang bila konfigurasi berubah:

```bash
fly secrets set --app warga-jaga-warga-wjw \
  WJW_APP_URL='https://warga.contoh.id'
```

Gunakan HTTPS Fly atau sertifikat domain kustom. GPS, kamera, Web Push, dan
instalasi PWA tidak boleh divalidasi dari HTTP biasa.

## 4. Uji penerimaan sebelum warga diundang

Lakukan ini dari **dua ponsel nyata** di jaringan yang berbeda, dengan akun
warga dan satpam/admin aktif dalam tenant yang sama:

1. Warga memilih kategori, melepas sebelum 1,5 detik, lalu memastikan tidak ada
   SOS di command center.
2. Ulangi, tahan penuh, lalu batalkan pada hitung mundur lima detik; kembali
   pastikan tidak ada SOS.
3. Ulangi dan biarkan hitung mundur selesai. Pastikan UI baru berkata **SOS
   dicatat server** setelah balasan server, laporan muncul di satpam tanpa refresh manual,
   dan push tiba pada perangkat yang telah subscribe.
4. Satpam menekan **Saya menuju lokasi**, **Sudah di lokasi**, mengirim chat dan
   foto, lalu menyelesaikan insiden. Periksa timeline berurutan dan audit.
5. Login sebagai warga lain yang bukan penerima. Pastikan lokasi, alamat,
   snapshot medis, chat, foto, penerima, dan timeline tidak terlihat.
6. Matikan data/Wi-Fi pelapor lalu ulangi pengiriman. Pesan yang benar harus
   berbunyi **darurat belum terkirim**, bukan sukses.

Catat waktu terima dan kendala izin GPS/push. Jangan menyatakan layanan siap
untuk keselamatan manusia sebelum simulasi ini lolos di lokasi sebenarnya.

## 5. Backup SQLite dan pemulihan

Fly Volume bukan backup. Buat backup terenkripsi di luar Fly setidaknya harian,
simpan 30 hari atau sesuai kebijakan retensi, dan **uji restore** secara berkala.

Contoh membuat salinan konsisten memakai SQLite backup API (tidak menyalin file
live secara buta):

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
fly ssh console --app warga-jaga-warga-wjw -C \
  "mkdir -p /data/backups && node --input-type=module -e \"import Database from 'better-sqlite3'; const db=new Database('/data/wjw.sqlite',{readonly:true}); await db.backup('/data/backups/wjw-${STAMP}.sqlite'); db.close()\""
fly ssh sftp get --app warga-jaga-warga-wjw \
  "/data/backups/wjw-${STAMP}.sqlite" "./backups/wjw-${STAMP}.sqlite"
```

Enkripsikan file hasil download dengan sistem backup organisasi; SQLite berisi
akun, lokasi, dan data darurat. Jangan commit atau kirim file `.sqlite` ke Git.

Untuk pemulihan: aktifkan mode pemeliharaan operasional, **hentikan Machine
terlebih dulu** agar tidak ada penulisan baru, unggah salinan yang telah diuji ke
`/data/wjw.sqlite`, mulai lagi Machine, lalu cek `/api/health`, login, dan satu
insiden uji. Selalu latihan restore ke app/staging terpisah sebelum menyentuh
produksi.

## 6. Operasi dan batas skala

- Pantau `fly logs`, health check, kapasitas volume, kegagalan push, dan waktu
  respons SOS. Tetapkan orang/piket yang benar-benar menindaklanjuti alarm.
- SSE saat ini hanya memberi invalidasi kecil; data sensitif selalu diambil ulang
  melalui `/api/state` yang menerapkan tenant/RBAC.
- Jangan gunakan `fly scale count 2`, multi-region, atau auto-stop untuk app ini.
  Sebelum skala horizontal, migrasikan SQLite ke PostgreSQL, penyimpanan foto ke
  object storage, dan broker event ke Redis/NATS.
- Rotasi `WJW_DATA_ENCRYPTION_KEY` adalah proyek migrasi data, bukan perintah
  `fly secrets set` biasa. Simpan versi/kunci lama sampai semua record
  didekripsi dan dienkripsi ulang.
- Web Push adalah *best effort*, bukan bukti penerima sudah melihat/menerima
  bantuan. Audit `alert.push_dispatch` hanya mencatat request yang diterima
  layanan Web Push, subscription, dan kegagalan transport; bukti manusia
  merespons tetap berasal dari acknowledgement responder.

Lihat juga [KESIAPAN-PRODUKSI.md](KESIAPAN-PRODUKSI.md) untuk risiko hukum,
privasi, SOP respons, dan daftar hal yang belum dapat dijamin aplikasi.
