# Backend WJW

Server API + basis data yang membuat data benar-benar tersinkron antar HP,
dan notifikasi darurat sampai walau aplikasi tertutup.

## Menjalankan

```bash
npm install
cp .env.example .env      # lalu isi
npm run vapid             # hasilkan kunci push, tempel ke .env

# dua terminal:
npm run server            # API  → http://localhost:8787
npm run dev               # web  → http://localhost:5173
```

Vite meneruskan `/api/*` ke server, jadi browser cukup memanggil origin
yang sama — tidak perlu CORS saat pengembangan.

## Tiga masalah yang diselesaikan

### 1. Data kini keluar dari perangkat

Sebelumnya semua tersimpan di `localStorage`, sehingga peringatan panik
tidak pernah sampai ke HP satpam. Kini semua lewat SQLite di server.

Terbukti lewat tes: admin di sesi berbeda melihat pendaftar yang dibuat
perangkat lain, dan satpam melihat peringatan darurat milik warga lain.

### 2. Notifikasi push

Peringatan darurat memicu Web Push ke semua penerima yang punya akun —
berbunyi walau aplikasi tertutup. Notifikasi darurat memakai
`requireInteraction` dan pola getar panjang agar terasa di dalam saku.

Push dikirim untuk: peringatan panik, pendaftar baru, keputusan admin,
siaran, dan permintaan "butuh bantuan".

Kegagalan push tidak pernah menggagalkan penyimpanan peringatan.
Langganan mati (404/410) dibersihkan otomatis.

### 3. Sandi di-hash

Sandi disimpan sebagai hash bcrypt (10 putaran) dan **tidak pernah**
dikembalikan ke klien. Login memakai token sesi acak 32 byte yang
berlaku 30 hari dan bisa dicabut.

Login juga selalu membandingkan hash meski email tidak ditemukan,
sehingga waktu respons tidak membocorkan email mana yang terdaftar.

## Keamanan yang diterapkan

| Aturan | Cara kerja |
| --- | --- |
| Wajib login | Middleware `auth` pada seluruh endpoint privat |
| Wajib disetujui | Middleware `active` — anggota pending hanya melihat dirinya |
| Batas peran | Warga tidak bisa menyetujui, mengubah area, atau membuat undangan |
| Batas lingkungan | `sameCommunity()` mencegah admin RW A menyentuh RW B |
| Privasi medis/SOS | Snapshot terenkripsi AES-256-GCM di produksi; detail SOS hanya untuk pelapor/penerima/satpam/admin tenant yang sama |
| Privasi kontak | Kontak pribadi satu anggota tidak terlihat anggota lain |
| Kode undangan | Tetap wajib approval admin — hanya mengusulkan peran |
| Ronda | Jarak GPS diverifikasi **di server**, tidak bisa dipalsukan klien |
| Superadmin | Sandi dari environment; bila kosong dibuat acak, bukan bawaan |

## Lifecycle insiden SOS

`POST /api/alerts` menerima kategori, titik GPS opsional, akurasi, dan
`idempotencyKey`. Kunci yang sama dari pelapor yang sama selalu mengembalikan
insiden pertama sehingga retry jaringan tidak menggandakan alarm.

| Aksi | Endpoint | Status kanonis |
| --- | --- | --- |
| Alarm dibuat | `POST /api/alerts` | `NEW` |
| Saya menuju lokasi | `POST /api/alerts/:id/respond` | `ACKNOWLEDGED → RESPONDING` |
| Tiba | `POST /api/alerts/:id/status` | `ON_SITE` |
| Selesai | `POST /api/alerts/:id/status` | `RESOLVED` |
| Alarm palsu | `POST /api/alerts/:id/status` | `CANCELLED` |

Setiap transition memasukkan baris immutable ke `incident_timeline`, audit,
dan event SSE tenant. Endpoint lama `/ack` dan `/close` hanya alias kompatibilitas;
klien baru memakai `/respond` dan `/status`.

## Bagaimana UI tersambung

Halaman **tidak** memanggil `fetch` langsung. Alurnya:

1. Halaman membaca dari cache lokal (`DBShape`) — instan, tanpa menunggu jaringan.
2. Setiap perubahan dikirim ke server lewat `src/lib/api.ts`.
3. Server menerbitkan invalidasi kecil melalui `GET /api/events` (SSE),
   terikat pada community dari token.
4. `src/lib/realtime.ts` membuka SSE dengan `fetch` + header Authorization
   (bukan token di URL), lalu `src/lib/sync.ts` menarik ulang `/api/state`
   yang telah difilter RBAC.
5. Refresh saat browser kembali online/terlihat hanya pelengkap pemulihan,
   bukan mekanisme real-time utama.

Keuntungannya: layar tetap responsif, tetapi **server yang menentukan hasil
akhir** — termasuk menolak aksi yang tidak diizinkan dan menyaring data tenant.

### Masalah umum

**"Email/HP atau kata sandi salah" padahal merasa benar**
Akun disimpan di server, bukan di HP. Basis data yang baru dibuat masih
kosong — akun demo `budi@warga.id` dan sejenisnya hanya ada di mode lokal
(tombol "Isi data contoh"), bukan di server.

Lihat akun yang benar-benar ada:

```bash
npm run reset-password -- --list
```

Ganti sandi yang terlupa:

```bash
npm run reset-password -- budi@warga.id sandibaru123
```

Untuk superadmin, cukup set `WJW_SUPERADMIN_PASSWORD` di `.env` lalu
jalankan ulang server — sandinya diterapkan ulang otomatis.

**"Terjadi kesalahan" saat memeriksa kode undangan**
API belum jalan. Buka terminal kedua lalu `npm run server`. Aplikasi kini
menampilkan pesan "Server tidak aktif" alih-alih error umum.

**`vite: not found` atau `Cannot find package`**
`node_modules` hilang. Jalankan `npm install`.

### Mode luring

Cache lokal boleh dipakai agar layar terakhir tetap dapat dibaca, tetapi **SOS
tidak pernah dibuat lokal**. Bila server tidak terjangkau, layar menampilkan
"Darurat belum terkirim" dan tidak mengaku bantuan telah dihubungi. Gunakan
telepon/SMS/nomor darurat resmi sesuai SOP komunitas sebagai jalur cadangan.

Tidak ada antrean SOS otomatis: mengirim ulang alarm tanpa tindakan sadar warga
setelah koneksi kembali dapat menciptakan insiden yang sudah tidak relevan.

## Struktur

```
server/
  schema.sql      skema SQLite
  db.ts           koneksi, hash sandi, sesi, tipe baris
  crypto.ts       AES-256-GCM untuk snapshot/profil darurat
  incidents.ts    state machine dan timeline immutable SOS
  events.ts       broker invalidasi SSE per tenant
  geo.ts          jarak haversine, poligon, jadwal lintas tengah malam
  push.ts         Web Push + pembersihan langganan mati
  index.ts        seluruh endpoint API
  api.test.ts     28 tes
  push.test.ts    4 tes
src/lib/
  api.ts          klien HTTP (token, error, offline)
  pushClient.ts   pendaftaran push di browser
public/sw.js      service worker notifikasi
```

## Catatan penerapan

- Ganti `WJW_SUPERADMIN_PASSWORD` sebelum dipakai sungguhan.
- Wajib HTTPS di produksi — push, kamera, mikrofon, dan GPS memerlukannya.
- Untuk Fly.io, ikuti [FLY-IO.md](FLY-IO.md): database berada di `/data` volume
  tunggal dan harus dibackup dengan SQLite backup API, bukan salin file live.
- Phase 1 sengaja satu Machine karena SQLite dan broker SSE in-memory. Sebelum
  scale-out, migrasikan ke PostgreSQL + broker event bersama.

## Yang masih perlu sebelum live

1. Uji lapangan di lingkungan sungguhan (malam hari, sinyal jelek)
2. Cadangan SMS/WhatsApp bila internet mati
3. Batas kirim (rate limit) untuk mencegah penyalahgunaan
4. Kebijakan privasi (UU PDP No. 27/2022 — lokasi & data kesehatan)
5. Pembayaran sungguhan (Midtrans/Xendit)
