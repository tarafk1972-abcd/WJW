# Kesiapan Produksi — Warga Jaga Warga

Penilaian jujur per 5 Agustus 2026.

## Kesimpulan singkat

**Belum layak dipakai sebagai aplikasi darurat sungguhan.**

Aplikasi ini **prototipe yang berfungsi penuh** — semua alur bisa dicoba
dari ujung ke ujung, 83 tes lulus, tanpa kerentanan. Sangat layak untuk
**demo ke pengurus RW, uji coba tampilan, dan mencari investor**.

Tetapi ada tiga hal yang membuatnya belum boleh diandalkan saat nyawa
orang bergantung padanya.

---

## Tiga penghalang utama

### 1. Data tidak terkirim ke mana-mana (paling kritis)

Semua data disimpan di `localStorage` — **di dalam browser masing-masing
HP**. Tidak ada server.

Artinya, saat Warga A menekan tombol panik:

- Peringatan **tidak sampai** ke HP satpam atau keluarga
- Yang terlihat di layar Warga A hanyalah simulasi di HP-nya sendiri
- Admin di HP lain **tidak melihat** pendaftar baru

Aplikasi terlihat bekerja karena semua peran diuji di satu HP yang sama.
Untuk sungguhan, ini **wajib** ada backend (server + basis data).

**Perkiraan:** 2–4 minggu untuk backend + autentikasi.

### 2. Peringatan tidak berbunyi kalau aplikasi tertutup

Belum ada notifikasi push. Penerima hanya tahu ada peringatan bila
kebetulan sedang membuka aplikasi.

Untuk aplikasi panik, ini sama pentingnya dengan poin 1 — percuma
peringatan terkirim kalau HP penerima diam saja di dalam saku.

**Perkiraan:** 1–2 minggu (Firebase Cloud Messaging / Web Push).

### 3. Sandi disimpan apa adanya

Sandi tersimpan sebagai teks biasa. Ini aman-aman saja selama datanya
hanya ada di HP sendiri, tetapi **berbahaya begitu ada server**.

Saat membuat backend, sandi wajib di-*hash* (bcrypt/argon2) dan tidak
pernah dikirim balik ke aplikasi.

**Perkiraan:** sudah termasuk dalam pekerjaan backend.

---

## Yang sudah kokoh

| Bagian | Status |
| --- | --- |
| Alur pengguna lengkap (daftar → approval → panik → respons) | ✅ |
| Aturan bisnis (peran, izin, langganan, area) | ✅ |
| Pengaman alarm palsu (tahan 2 detik, batal, konfirmasi) | ✅ |
| Tiga cara bergabung + QR | ✅ |
| Ronda satu tombol dengan verifikasi GPS & jadwal | ✅ |
| Tiga bahasa (ID/EN/SU) | ✅ |
| 83 tes otomatis, 0 kerentanan | ✅ |
| Tahan penyimpanan penuh (media lama dibuang, peringatan selamat) | ✅ |

Struktur kodenya juga membantu: **seluruh akses data lewat satu berkas**
(`src/lib/db.ts`), jadi pemindahan ke API nyata terpusat di sana, bukan
tersebar di 20 halaman.

---

## Yang perlu disiapkan sebelum live

### Wajib

1. **Backend + basis data** — agar data tersinkron antar HP
2. **Notifikasi push** — agar peringatan sampai walau aplikasi tertutup
3. **Hash sandi** + token sesi yang benar
4. **Domain HTTPS** — kamera, mikrofon, dan GPS butuh ini
5. **Uji lapangan** — coba di lingkungan sungguhan, malam hari, sinyal jelek

### Sangat dianjurkan

6. **Cadangan SMS/WhatsApp** — kalau internet mati, peringatan tetap sampai
7. **Batas kirim (rate limit)** — cegah penyalahgunaan tombol panik
8. **Kebijakan privasi** — aplikasi ini mengumpulkan lokasi & data medis
9. **Persetujuan pengguna** untuk pelacakan lokasi
10. **Pembayaran sungguhan** (Midtrans/Xendit) — sekarang masih manual

### Pertimbangan hukum

- Data lokasi & kesehatan termasuk **data pribadi sensitif** menurut
  UU PDP No. 27/2022. Perlu kebijakan privasi dan dasar pemrosesan yang jelas.
- Aplikasi ini **tidak** menghubungi polisi. Itu keputusan yang benar
  secara regulasi, tetapi harus dinyatakan jelas ke pengguna — sudah
  dilakukan lewat catatan tetap di layar utama.

---

## Rekomendasi bertahap

**Sekarang** — pakai untuk demo ke pengurus RW dan kumpulkan masukan.
Tampilannya sudah meyakinkan dan semua alur bisa diperagakan.

**Tahap 1 (1 bulan)** — backend + push + hash sandi. Setelah ini bisa
uji coba terbatas di satu RW dengan catatan jelas bahwa masih percobaan.

**Tahap 2 (1 bulan)** — uji lapangan, cadangan SMS, pembayaran,
kebijakan privasi. Baru setelah ini layak disebut siap pakai.

---

## Peringatan penting

Selama belum ada backend dan notifikasi push, **jangan sampai ada warga
yang mengandalkan aplikasi ini untuk keselamatan sungguhan**. Risiko
terbesar bukan aplikasinya error, melainkan seseorang menekan tombol
panik lalu menunggu bantuan yang tidak pernah datang karena peringatannya
memang tidak pernah keluar dari HP-nya.

Bila ingin diuji coba lebih awal, sampaikan jelas ke warga bahwa ini
masih tahap percobaan dan tetap gunakan cara lama (telepon, grup WA)
sebagai andalan utama.
