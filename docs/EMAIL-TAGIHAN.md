# Penagihan Langganan lewat Email

Tidak ada penyedia pembayaran pihak ketiga. Tagihan dikirim lewat email,
warga membayar lewat QRIS ShopeePay, lalu pengelola memverifikasi.

## Alur lengkap

1. **Tagihan dibuat** — otomatis pada H-7 sebelum jatuh tempo, atau admin
   menekan *Buat tagihan* di halaman Langganan.
2. **Email masuk ke admin klaster** — berisi rincian, total, QRIS
   ShopeePay, dan **nomor referensi** yang harus dicantumkan.
3. **Admin memindai QRIS dan membayar**, mencantumkan nomor referensi
   pada catatan pembayaran, lalu menekan **"Saya sudah bayar"**.
4. **Superadmin memverifikasi** di Konsol → Pembayaran.
5. **Langganan aktif** dan admin menerima email kuitansi.

Langganan tidak pernah aktif otomatis — selalu ada manusia yang
memeriksa. Ini disengaja karena tidak ada konfirmasi otomatis dari ShopeePay.

## Empat template email

| Kapan | Template | Isi |
| --- | --- | --- |
| H-7 | **Tagihan** | Rincian, total, QRIS, nomor referensi |
| H-3 dan H-1 | **Pengingat** | Nada mendesak di H-1 (merah) |
| Setelah jatuh tempo | **Berakhir** | Menegaskan data warga tetap tersimpan |
| Setelah diverifikasi | **Kuitansi** | Aktif sampai kapan |

Semua berbahasa Indonesia, format `Rp 149.000` dan `18 Agustus 2026`.

## Penyiapan

```bash
# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=email-anda@gmail.com
SMTP_PASS=app-password-16-digit
MAIL_FROM=Warga Jaga Warga <noreply@domain-anda.com>
MAIL_REPLY_TO=tarafk1972@gmail.com

# QRIS ShopeePay — satu-satunya metode pembayaran
WJW_QRIS_NAME=FADLUL KHAIRA
WJW_QRIS_PHONE=(+62)81****781
WJW_QRIS_IMAGE_URL=/qris.png

# Wajib agar gambar QR tampil di email (klien email tak bisa URL relatif)
WJW_APP_URL=https://wargajagawarga.app

# Harga
WJW_PRICE_MONTHLY=149000
WJW_PRICE_YEARLY=1490000
```

> **Gmail**: pakai [App Password](https://myaccount.google.com/apppasswords),
> bukan sandi akun. Aktifkan verifikasi 2 langkah dulu.
>
> Untuk volume besar, pertimbangkan layanan khusus (Resend, Brevo,
> Mailgun) agar email tidak masuk folder spam.

### Menguji setelan

Sebagai superadmin:

```bash
curl -X POST http://localhost:8787/api/email/test \
  -H "Authorization: Bearer TOKEN_SUPERADMIN" \
  -H 'content-type: application/json' \
  -d '{"to":"email-tujuan@contoh.com"}'
```

## Tanpa SMTP

Aplikasi tetap berjalan. Email dicatat berstatus `skipped` dan muncul di
riwayat, sehingga terlihat apa yang *seharusnya* terkirim. Admin tetap
bisa melihat QRIS beserta nomor referensinya di halaman Langganan dan
menandai sudah bayar lewat aplikasi.

## Nomor referensi

Setiap tagihan mendapat nomor referensi **yang ditentukan sistem**,
misalnya `WJWFXNA2`. Admin tidak bisa mengubahnya — nomor itu melekat
pada tagihan sejak dibuat.

Formatnya 8 karakter tanpa huruf/angka rancu (tanpa `O`, `0`, `I`, `1`)
supaya mudah diketik ulang di kolom catatan ShopeePay, dan dijamin unik
lewat pengecekan basis data.

Inilah yang Anda pakai untuk mencocokkan mutasi ShopeePay dengan klaster
yang membayar.

Di halaman Langganan tidak ada kolom isian apa pun untuk nomor ini —
admin hanya bisa menyalinnya. Tidak ada pula permintaan unggah bukti
transfer: pencocokan dilakukan lewat nomor referensi saja.

Saat aplikasi dipakai tanpa server (mode luring), nomor referensi tetap
dibuat sistem dengan format yang sama, tetapi tagihannya hanya tersimpan
di perangkat itu.

## Menyiapkan gambar QRIS

Cara termudah: masuk sebagai superadmin → **Konsol → Pembayaran →
Unggah gambar QRIS**. Gambarnya tersimpan di basis data, sehingga ikut
terbawa saat aplikasi dipindah atau dibangun ulang. Nama pemilik akun
diisi di layar yang sama, tanpa perlu menyentuh `.env`.

Alternatif lama masih berjalan: simpan gambar sebagai `public/qris.png`.
Yang diunggah lewat aplikasi selalu menang atas berkas itu.

Gambar tersebut tampil di halaman Langganan semua admin dan di email
tagihan.

Agar tampil di email, `WJW_APP_URL` harus berisi alamat publik aplikasi —
klien email tidak bisa membuka URL relatif.

## Verifikasi pembayaran

Superadmin membuka **Konsol → Pembayaran**. Setiap klaim menampilkan
klaster, nama admin, email, nomor tagihan, dan **nomor referensi** untuk
dicocokkan dengan mutasi ShopeePay.

- **Setujui** → langganan aktif, kuitansi terkirim
- **Tolak** → tagihan kembali ke *pending* beserta catatan alasan yang
  ditampilkan ke admin

Perpanjangan dihitung dari tanggal berakhir yang ada, bukan dari hari
pembayaran — jadi membayar lebih awal tidak menghanguskan sisa hari.

## Riwayat email

```
GET  /api/email/status          riwayat email klaster (admin)
POST /api/billing/:id/resend    kirim ulang email tagihan
GET  /api/billing/pending       menunggu verifikasi (superadmin)
POST /api/billing/:id/verify    setujui / tolak (superadmin)
```

## Catatan teknis

Template ditulis dengan tabel HTML dan gaya sebaris, bukan CSS modern.
Gmail dan Outlook membuang `<style>` di `<head>` dan tidak mendukung
flexbox. Setiap email menyertakan versi teks biasa.

Nama klaster dan admin di-*escape*, sehingga nama seperti `<script>`
tidak bisa merusak tampilan atau menyuntik kode.

## Berkas

```
server/email-templates.ts   4 template + escaping
server/mailer.ts            pengirim SMTP + pencatatan
server/billing.ts           tagihan, klaim, verifikasi
server/renewals.ts          penjadwal H-7 / H-3 / H-1
server/billing.test.ts      13 tes
server/email.test.ts        16 tes
```
