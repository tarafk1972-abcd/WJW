# Pembayaran Langganan — Mayar

Integrasi [Mayar.id](https://mayar.id) untuk tagihan langganan lingkungan.

## Cara kerja

1. Admin membuka **Langganan** → pilih paket → tekan **Buat tagihan**.
2. Server mencatat tagihan sebagai *pending*, lalu memanggil Mayar.
3. **Mayar mengirim email berisi tautan pembayaran ke email admin.**
   Tautan yang sama juga muncul di aplikasi (tombol **Bayar sekarang**).
4. Admin membayar lewat QRIS / transfer bank / e-wallet di halaman Mayar.
5. Mayar memanggil webhook kita → **langganan aktif otomatis**.

Tidak ada konfirmasi manual. Superadmin tidak perlu memverifikasi apa pun.

> Akses **tidak pernah** dibuka hanya karena browser kembali dari Mayar.
> Hanya webhook yang boleh mengaktifkan langganan — kalau tidak, orang bisa
> membuka halaman "terima kasih" tanpa benar-benar membayar.

## Penyiapan

### 1. Akun & kunci API

1. Daftar di [mayar.id](https://mayar.id) (uji coba: [web.mayar.club](https://web.mayar.club)).
2. Buka **Integration → API Key**, salin kuncinya.

### 2. Isi `.env`

```bash
MAYAR_API_KEY=kunci-dari-dashboard-mayar

# Sandbox untuk uji coba, ganti ke produksi saat siap
MAYAR_API_BASE=https://api.mayar.club/hl/v1
# Produksi: https://api.mayar.id/hl/v1

# Token rahasia buatan sendiri untuk mengamankan webhook
MAYAR_WEBHOOK_TOKEN=buat-token-acak-yang-panjang

# Harga (Rupiah)
WJW_PRICE_MONTHLY=149000
WJW_PRICE_YEARLY=1490000
```

### 3. Daftarkan webhook di Mayar

Buka **Integration → Webhook**, isi URL:

```
https://domain-anda.com/api/webhooks/mayar?token=TOKEN_YANG_SAMA
```

Token pada URL harus sama persis dengan `MAYAR_WEBHOOK_TOKEN`.
Mayar hanya mengizinkan menyetel URL (bukan header), jadi token diletakkan
di query string.

Tekan **Test** di dashboard Mayar untuk memastikan URL terjangkau.

## Kejadian yang ditangani

| Kejadian Mayar | Yang dilakukan aplikasi |
| --- | --- |
| `payment.received` (lunas) | Aktifkan langganan, kirim notifikasi ke admin |
| `payment.reminder` | Ingatkan admin lewat notifikasi |

Kejadian lain dicatat tetapi tidak mengubah apa pun.

## Pengaman yang diterapkan

| Risiko | Penanganan |
| --- | --- |
| Webhook palsu | Wajib token yang cocok, jika tidak → 401 |
| Kejadian terkirim dua kali | `webhook_events.external_id` unik → dilewati |
| Masa aktif hangus saat perpanjang | Ditambahkan dari tanggal berakhir, bukan hari ini |
| Tagihan menumpuk | Tagihan pending yang masih berlaku dipakai ulang |
| Mayar error saat membuat tagihan | Tagihan ditandai `failed`, tidak menggantung |
| Id webhook ≠ id invoice | Dicocokkan lewat `extraData`, lalu id, lalu email |
| Status berbeda bentuk | Menerima `true`, `"paid"`, `"success"`, `"settled"` |

## Tanpa kunci API

Bila `MAYAR_API_KEY` kosong, aplikasi tetap berjalan:
halaman Langganan menampilkan pemberitahuan bahwa pembayaran otomatis
belum aktif. Tidak ada yang error.

## Menguji tanpa uang sungguhan

Pakai sandbox (`api.mayar.club`), atau kirim webhook palsu:

```bash
curl -X POST "http://localhost:8787/api/webhooks/mayar?token=TOKEN" \
  -H 'content-type: application/json' \
  -d '{"event":"payment.received","data":{"transactionId":"txn-1","status":"paid","extraData":{"invoiceId":"ID_TAGIHAN"}}}'
```

Langganan akan langsung aktif.

## Berkas terkait

```
server/mayar.ts         klien Mayar, pencocokan webhook, aktivasi
server/index.ts         endpoint /api/billing/* dan /api/webhooks/mayar
server/billing.test.ts  13 tes
src/pages/Billing.tsx   halaman langganan
```

## Yang masih perlu dipertimbangkan

- **Perpanjangan otomatis.** Saat ini admin membuat tagihan baru setiap
  periode. Untuk langganan berulang otomatis, Mayar punya produk
  *Membership (SaaS)* yang perlu integrasi terpisah.
- **Pengingat sebelum jatuh tempo.** Belum ada penjadwal yang mengirim
  tagihan otomatis menjelang masa aktif habis.
