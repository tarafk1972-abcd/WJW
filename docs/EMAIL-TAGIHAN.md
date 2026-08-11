# Email Tagihan Otomatis

Email yang dikirim ke admin klaster untuk urusan langganan.

## Empat template

| Kapan | Template | Isi |
| --- | --- | --- |
| H-7 sebelum jatuh tempo | **Tagihan** | Rincian, total, tombol bayar / instruksi transfer |
| H-3 dan H-1 | **Pengingat** | Nada berubah mendesak di H-1 (merah) |
| Setelah jatuh tempo | **Berakhir** | Menegaskan data warga tetap tersimpan |
| Pembayaran diterima | **Kuitansi** | Tanggal aktif sampai kapan |

Semua berbahasa Indonesia, format Rupiah dan tanggal lokal
(`Rp 149.000`, `18 Agustus 2026`).

## Penyiapan SMTP

Isi `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=email-anda@gmail.com
SMTP_PASS=app-password-16-digit
MAIL_FROM=Warga Jaga Warga <noreply@domain-anda.com>
MAIL_REPLY_TO=tarafk1972@gmail.com

# Muncul di email bila tidak ada tautan bayar
WJW_BANK_INFO=BCA 1234567890
a.n. Yayasan Warga RW 05
```

> **Gmail**: pakai [App Password](https://myaccount.google.com/apppasswords),
> bukan sandi akun. Wajib mengaktifkan verifikasi 2 langkah dulu.
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

Email contoh akan dikirim. Bila SMTP salah, balasannya memuat pesan error
tanpa membuat server berhenti.

## Tanpa SMTP

Aplikasi tetap berjalan normal. Email dicatat berstatus `skipped` dan
muncul di riwayat, sehingga terlihat apa yang *seharusnya* terkirim.
Tidak ada yang error.

## Dua jalur pembayaran

**Dengan Mayar** — email memuat tombol *Bayar sekarang* menuju halaman
Mayar. Langganan aktif otomatis lewat webhook.

**Tanpa Mayar (manual)** — email memuat kotak instruksi transfer berisi
`WJW_BANK_INFO`, dan meminta admin membalas dengan bukti transfer.
Superadmin lalu mengaktifkan langganan.

Bila Mayar diaktifkan tetapi sedang gangguan, sistem **tetap mengirim
email tagihan manual** sebagai cadangan — supaya langganan tidak berakhir
diam-diam hanya karena penyedia bermasalah.

## Riwayat email

Admin dapat melihat email yang dikirim untuk klasternya:

```
GET /api/email/status
```

Berisi jenis, tujuan, subjek, status (`sent` / `failed` / `skipped`) dan
pesan error bila ada.

Kirim ulang tagihan yang belum dibayar:

```
POST /api/billing/:id/resend
```

## Catatan teknis

Template ditulis dengan tabel HTML dan gaya sebaris, bukan CSS modern.
Gmail dan Outlook membuang `<style>` di `<head>` dan tidak mendukung
flexbox — tata letak akan berantakan bila memakai cara biasa.

Setiap email menyertakan versi teks biasa untuk klien yang memblokir HTML.

Nama klaster dan admin di-*escape*, sehingga nama seperti
`<script>` tidak bisa merusak tampilan atau menyuntik kode.

## Berkas

```
server/email-templates.ts   4 template + escaping
server/mailer.ts            pengirim SMTP + pencatatan
server/email.test.ts        14 tes
server/renewals.ts          memicu email pada jadwalnya
```
