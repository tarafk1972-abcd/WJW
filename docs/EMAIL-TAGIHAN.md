# Penagihan Langganan lewat Email

Tidak ada penyedia pembayaran pihak ketiga. Tagihan dikirim lewat email,
warga transfer, lalu pengelola memverifikasi.

## Alur lengkap

1. **Tagihan dibuat** — otomatis pada H-7 sebelum jatuh tempo, atau admin
   menekan *Buat tagihan* di halaman Langganan.
2. **Email masuk ke admin klaster** — berisi rincian, total, nomor
   rekening, dan nomor tagihan untuk berita transfer.
3. **Admin transfer**, lalu menekan **"Saya sudah bayar"** di aplikasi
   sambil mengisi nomor rujukan (atau membalas email dengan bukti).
4. **Superadmin memverifikasi** di Konsol → Pembayaran.
5. **Langganan aktif** dan admin menerima email kuitansi.

Langganan tidak pernah aktif otomatis — selalu ada manusia yang
memeriksa. Ini disengaja karena tidak ada konfirmasi dari bank.

## Empat template email

| Kapan | Template | Isi |
| --- | --- | --- |
| H-7 | **Tagihan** | Rincian, total, rekening, nomor tagihan |
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

# Rekening tujuan — muncul di email dan di aplikasi
WJW_BANK_INFO=BCA 1234567890
a.n. Yayasan Warga RW 05

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
bisa melihat nomor rekening dan menandai sudah bayar lewat aplikasi.

## Verifikasi pembayaran

Superadmin membuka **Konsol → Pembayaran**. Setiap klaim menampilkan
klaster, nama admin, email, nomor tagihan, dan nomor rujukan.

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
