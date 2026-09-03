# Panduan Submit ke Google Play Store — WJW

Alur lengkap dari kode → AAB rilis → publikasi. Perkiraan waktu total: **3–5 jam kerja + 1–3 hari tunggu review**.

---

## 0. Prasyarat
- Akun Google Play Console aktif (pendaftaran US$25 sekali bayar). Daftar di <https://play.google.com/console/signup>.
- Server API WJW sudah menyala di HTTPS publik (default: `https://warga-jaga-warga-wjw.fly.dev`). Ini **wajib**, tanpa server APK menjadi layar kosong.
- CORS API mengizinkan `https://localhost` dan `capacitor://localhost` (sudah ada di `fly.toml`).
- JDK 21 + Android Studio + Android SDK (bila build lokal) **atau** GitHub Actions.
- File keystore rilis — lihat [`generate-keystore.md`](generate-keystore.md).

---

## 1. Buat aplikasi di Play Console

1. Masuk Play Console → **Create app**.
2. Isi:
   - App name: **Warga Jaga Warga**
   - Default language: **Indonesian – id-ID**
   - App or game: **App**
   - Free or paid: **Free** (langganan diverifikasi manual, bukan IAP)
   - Declarations: centang semua yang berlaku.
3. Klik **Create app**.

---

## 2. Isi "Set up your app"

Sidebar → **Dashboard** memandu Anda mengisi semua kartu berikut:

| Kartu | Isi dari berkas | Catatan |
|---|---|---|
| App access | "All functionality available without special access" → **No**, lalu tulis: aplikasi butuh akun (email+sandi). Kirim akun demo (lihat `../app-store/review-notes-and-demo.md`). | Wajib akun demo |
| Ads | **No, app does not contain ads** | ✅ |
| Content rating | Isi kuesioner IARC sesuai `../shared/content-rating-questionnaire.md` | Rating diterbitkan otomatis |
| Target audience & content | 13–17, 18+. **Tidak** appeal to children. | |
| News app | **No** | |
| COVID-19 contact tracing | **No** | |
| Data safety | Isi persis seperti `../shared/data-safety-and-privacy.md` bagian A | |
| Government app | **No** (kecuali Anda badan pemerintah) | |
| Financial features | **No** | |
| Health | Aplikasi menampilkan info kesehatan (profil darurat) tapi bukan aplikasi medis → **No** untuk *Health app* | |
| App category | Category: **Lifestyle**. Tags: pilih 5 yang cocok | |
| Store listing contact details | Website, email, phone, alamat | Alamat wajib |
| Store presence — Main store listing | Isi dari `../shared/store-listing.md` bagian Play + upload aset | |
| Store settings | Kategori & Tags | |
| Store listing — Graphic assets | Icon 512, feature graphic 1024×500, 2–8 screenshot phone | |

---

## 3. Bangun AAB rilis bertanda tangan

**Ikuti langkah lengkap di [`build-signed-aab.md`](build-signed-aab.md).** Hasil: `app-release.aab` di `android/app/build/outputs/bundle/release/`.

> **PENTING**: AAB rilis pertama menetapkan `versionCode = 1` dan `versionName = "1.0.0"`. Setiap upload berikutnya wajib **menaikkan `versionCode`** (`+1`) tanpa perlu ganti `versionName`.

---

## 4. Aktifkan Play App Signing

Play Console → **Setup → App integrity → Play App Signing → App Signing**.

Pilih **Let Google create and manage my app signing key** (paling aman) **atau** upload kunci Anda sendiri. Kalau memilih upload sendiri:
- Ekspor kunci dari keystore dengan **Play Encrypt Private Key (PEPK) tool** yang disediakan Google.
- Simpan file `.pem` yang dihasilkan dan setoran encrypted.

Ini **hanya sekali seumur hidup aplikasi**. Setelah ini kunci upload (yang Anda pegang) berbeda dari kunci penandatangan final di server Google — jauh lebih aman.

---

## 5. Buat release track pertama

Play Console → **Testing → Internal testing → Create new release**.

1. Upload `app-release.aab`.
2. Release name otomatis (`1 (1.0.0)`).
3. Release notes (Indonesian):
   ```
   Rilis awal — tombol panik, laporan kejadian, buku tamu, patroli satpam, peta area, pengumuman & siaran darurat, dukungan tiket.
   ```
4. **Save → Review release → Start rollout to Internal testing**.
5. Tambahkan testers (max 100 email di internal). Setelah dua hari uji stabil, promote ke **Closed testing** (bila perlu) atau langsung ke **Production**.

---

## 6. Rollout ke Production

Play Console → **Production → Create new release** → **Promote from Internal testing** → pilih release yang sama.

- Rollout percentage: **20%** untuk minggu pertama, lalu 50%, lalu 100%. Ini standar aman.
- Klik **Review** → **Start rollout to Production**.
- Review Google: biasanya **1–3 hari kerja**. Ada dua reviewer manual + otomatis.

---

## 7. Bila ditolak — penyebab umum

| Alasan | Cara benerin |
|---|---|
| Data safety tidak konsisten | Cocokkan setiap izin di manifest dengan tipe data yang Anda deklarasikan. |
| Tidak ada demo account | Tambahkan di **App content → App access**. |
| Deceptive behaviour (nama mirip aplikasi lain) | Ganti nama/screenshot bila mirip aplikasi populer. |
| Missing privacy policy URL | Publish di server publik yang selalu 200 OK. |
| SDK berisiko | Jangan pakai SDK iklan/pelacak. WJW default sudah bersih. |
| Foreground service without disclosure | Bila kelak Anda tambah `@capacitor/geolocation` mode background, wajib jelaskan di listing. Sekarang tidak dipakai — aman. |

---

## 8. Setelah live
- Aktifkan **Play Console → Quality → Android vitals**.
- Aktifkan **Play Console → Setup → App integrity → Play Integrity API** bila ingin proteksi anti-emulator (opsional).
- Untuk update, bump `versionCode` di `android/app/build.gradle`, build ulang AAB, upload.
