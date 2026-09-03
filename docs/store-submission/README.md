# Paket Pengajuan Play Store & App Store — Warga Jaga Warga (WJW)

Folder ini berisi **semua berkas yang perlu Anda unggah** ke Google Play Console dan Apple App Store Connect untuk aplikasi **Warga Jaga Warga**. Aplikasi ini adalah PWA (React + Vite + TypeScript) yang dibungkus dengan **Capacitor** untuk menjadi APK/AAB (Android) dan IPA (iOS).

> Semua berkas di sini adalah **template siap-pakai** — sesuaikan bagian yang bertanda `[GANTI: ...]` dengan data Anda (nama pemilik, email dukungan, URL kebijakan, dll.) sebelum diunggah.

---

## Ringkasan aplikasi

| Kolom | Nilai |
|---|---|
| Nama aplikasi | Warga Jaga Warga |
| ID paket / Bundle ID | `id.wargajagawarga.app` |
| Versi awal rilis | `1.0.0` (versionCode 1 / build 1) |
| Bahasa utama | Indonesia (`id-ID`) |
| Bahasa tambahan | English (`en-US`), Basa Sunda (`su`) |
| Kategori Play Store | **Lifestyle** (utama), Communication (sekunder) |
| Kategori App Store | **Lifestyle** (utama), Social Networking (sekunder) |
| Kelompok usia | 13+ (Play) / 12+ (App Store) |
| Jenis konten | Bukan game, mengandung UGC (laporan warga), memerlukan akun |
| Berbayar | Ya — uji coba gratis 14 hari, lalu langganan bulanan / tahunan (in-app di luar toko: verifikasi manual oleh superadmin) |

---

## Daftar isi

### Umum (dipakai kedua toko)
- [`shared/privacy-policy.md`](shared/privacy-policy.md) — Kebijakan Privasi (harus dipublikasi di URL publik)
- [`shared/terms-of-service.md`](shared/terms-of-service.md) — Syarat & Ketentuan
- [`shared/store-listing.md`](shared/store-listing.md) — Judul, deskripsi pendek/panjang, kata kunci (ID + EN)
- [`shared/assets-specs.md`](shared/assets-specs.md) — Spesifikasi ikon, feature graphic, screenshot
- [`shared/data-safety-and-privacy.md`](shared/data-safety-and-privacy.md) — Jawaban Google Data Safety **dan** Apple Privacy Nutrition Labels
- [`shared/content-rating-questionnaire.md`](shared/content-rating-questionnaire.md) — Jawaban IARC + App Store rating

### Android (Google Play)
- [`play-store/PANDUAN-PLAY-STORE.md`](play-store/PANDUAN-PLAY-STORE.md) — Panduan langkah demi langkah
- [`play-store/build-signed-aab.md`](play-store/build-signed-aab.md) — Cara membuat AAB rilis bertanda tangan
- [`play-store/generate-keystore.md`](play-store/generate-keystore.md) — Membuat & menyimpan keystore
- [`play-store/AndroidManifest-permissions.xml`](play-store/AndroidManifest-permissions.xml) — Blok izin siap tempel

### iOS (Apple App Store)
- [`app-store/PANDUAN-APP-STORE.md`](app-store/PANDUAN-APP-STORE.md) — Panduan langkah demi langkah
- [`app-store/build-ipa-capacitor.md`](app-store/build-ipa-capacitor.md) — Membuat IPA lewat Capacitor + Xcode
- [`app-store/Info-plist-usage-descriptions.md`](app-store/Info-plist-usage-descriptions.md) — Teks izin siap tempel
- [`app-store/review-notes-and-demo.md`](app-store/review-notes-and-demo.md) — Catatan untuk App Review + akun demo

---

## Urutan kerja yang disarankan

1. **Publikasikan `privacy-policy.md`** dan `terms-of-service.md` di URL publik (mis. `https://warga-jaga-warga-wjw.fly.dev/privacy` dan `/terms`). Kedua toko mensyaratkan URL publik ini.
2. **Siapkan aset grafis** sesuai [`shared/assets-specs.md`](shared/assets-specs.md) — ikon 512, feature graphic 1024×500, minimal 4 screenshot per tipe perangkat.
3. **Android**: ikuti [`play-store/PANDUAN-PLAY-STORE.md`](play-store/PANDUAN-PLAY-STORE.md) sampai AAB terunggah dan formulir Data Safety terisi.
4. **iOS**: ikuti [`app-store/PANDUAN-APP-STORE.md`](app-store/PANDUAN-APP-STORE.md) — perlu Mac + Xcode + akun Apple Developer aktif ($99/tahun).
5. **Kirim untuk review**. Play biasa disetujui 1–3 hari; App Store 1–3 hari untuk build pertama (bisa lebih lama).

---

## Yang wajib Anda siapkan sendiri sebelum submit

| Item | Play Store | App Store |
|---|---|---|
| Akun developer aktif | Google Play Console (US$25 sekali bayar) | Apple Developer Program (US$99/tahun) |
| Server API publik dengan HTTPS | Wajib — sudah aktif di `https://warga-jaga-warga-wjw.fly.dev` | Sama |
| URL kebijakan privasi (publik) | Wajib | Wajib |
| Email dukungan aktif | `[GANTI: email dukungan]` | Sama |
| Akun demo untuk reviewer | Direkomendasikan | **Wajib** (login diperlukan aplikasi) |
| Keystore Android | Wajib (buat sekali, simpan seumur hidup aplikasi) | — |
| Sertifikat & profil provisioning iOS | — | Diurus otomatis oleh Xcode bila login akun Apple Developer |
| Aset ikon 1024×1024 (tanpa alpha untuk iOS) | 512×512 | 1024×1024 |
| Minimal 2 screenshot per tipe perangkat | Phone + Tablet | iPhone 6.7" + iPhone 5.5" (min) |

---

## Kontak & catatan penting

- **Backup keystore Android**: bila hilang, aplikasi **tidak bisa diperbarui selamanya** — pengguna harus uninstall & install ulang. Simpan di manajer sandi + cadangan offline.
- **Kebijakan berlangganan**: karena pembayaran langganan diverifikasi manual oleh superadmin (di luar Google/Apple), langganan tersebut **tidak dianggap in-app purchase** oleh kedua toko. Aman selama tidak ada tombol "Beli sekarang" yang mengumpulkan pembayaran di dalam aplikasi. Bila kelak ditambah IAP, wajib pakai Google Play Billing / StoreKit.
- **Konten UGC (laporan warga)**: kedua toko meminta mekanisme moderasi + laporkan konten. Sudah ada tiket dukungan ke superadmin dan Admin komunitas bisa menolak laporan — dokumentasikan di deskripsi.
