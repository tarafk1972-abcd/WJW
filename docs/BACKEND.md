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
| Privasi medis | Profil darurat hanya untuk pemilik, satpam, dan admin |
| Privasi kontak | Kontak pribadi satu anggota tidak terlihat anggota lain |
| Kode undangan | Tetap wajib approval admin — hanya mengusulkan peran |
| Ronda | Jarak GPS diverifikasi **di server**, tidak bisa dipalsukan klien |
| Superadmin | Sandi dari environment; bila kosong dibuat acak, bukan bawaan |

## Bagaimana UI tersambung

Halaman **tidak** memanggil `fetch` langsung. Alurnya:

1. Halaman membaca dari cache lokal (`DBShape`) — instan, tanpa menunggu jaringan.
2. Setiap perubahan dikirim ke server lewat `src/lib/api.ts`.
3. `src/lib/sync.ts` menarik ulang `/api/state` dan menyegarkan cache.
4. Polling tiap 8 detik saat tab terlihat, ditambah saat tab kembali aktif.

Keuntungannya: layar tetap responsif, tetapi **server yang menentukan hasil
akhir** — termasuk menolak aksi yang tidak diizinkan.

### Mode luring

Bila server tidak terjangkau, aplikasi tetap berjalan memakai penyimpanan
lokal dan menampilkan pita peringatan. Tombol darurat tetap berfungsi.
Login dan registrasi juga punya jalur cadangan lokal.

> Catatan: perubahan yang dibuat saat luring belum dikirim ulang otomatis
> ketika koneksi pulih. Antrean penyelarasan adalah pekerjaan berikutnya.

## Struktur

```
server/
  schema.sql      skema SQLite
  db.ts           koneksi, hash sandi, sesi, tipe baris
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
- Cadangkan berkas `server/data/wjw.sqlite` secara berkala.
- SQLite cukup untuk puluhan ribu pengguna. Bila perlu lebih besar,
  pindah ke PostgreSQL cukup mengubah `server/db.ts`.

## Yang masih perlu sebelum live

1. Uji lapangan di lingkungan sungguhan (malam hari, sinyal jelek)
2. Cadangan SMS/WhatsApp bila internet mati
3. Batas kirim (rate limit) untuk mencegah penyalahgunaan
4. Kebijakan privasi (UU PDP No. 27/2022 — lokasi & data kesehatan)
5. Pembayaran sungguhan (Midtrans/Xendit)
