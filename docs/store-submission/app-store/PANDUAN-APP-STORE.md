# Panduan Submit ke Apple App Store — WJW

Alur lengkap: kode → IPA rilis → publikasi. Perkiraan **1 hari kerja + 1–3 hari review**.

---

## 0. Prasyarat wajib

- **macOS 13+** dengan **Xcode 16+** (App Store menuntut build dengan Xcode 16 sejak April 2025).
- **Apple Developer Program aktif** — US$99/tahun, daftar di <https://developer.apple.com/programs/>. Verifikasi bisa 24–48 jam.
- **Apple ID** yang digunakan sudah ditambahkan sebagai role Admin di App Store Connect.
- Server API publik HTTPS (`https://warga-jaga-warga-wjw.fly.dev`) menyala.

---

## 1. Setup di App Store Connect

<https://appstoreconnect.apple.com> → **My Apps** → **+** → **New App**:

- Platform: **iOS**
- Name: **Warga Jaga Warga**
- Primary language: **Indonesian**
- Bundle ID: pilih dari daftar (buat dulu di [Certificates, IDs & Profiles](https://developer.apple.com/account/resources/identifiers/list) → **Identifiers → +** → App IDs → App → `id.wargajagawarga.app`).
- SKU: `wjw-ios-001` (bebas, kunci internal).
- User access: **Full Access**.

Klik **Create**.

Isi kartu:

| Kartu | Isi |
|---|---|
| **App Information** | Category primary **Lifestyle**, secondary **Social Networking**. Content rights: **No**. |
| **Pricing and Availability** | Price **Free**. Availability: Indonesia + `[GANTI: negara lain bila mau]`. |
| **App Privacy** | Sesuai `../shared/data-safety-and-privacy.md` bagian B. Privacy Policy URL wajib. |
| **Age Rating** | Sesuai `../shared/content-rating-questionnaire.md` bagian B. |
| **Prepare for Submission** (per versi) | Nama, subjudul, deskripsi, kata kunci, screenshot, keywords, promotional text, "What's New" (kosong untuk 1.0). |
| **App Review Information** | Demo account + review notes (lihat `review-notes-and-demo.md`). |
| **Version Release** | Manual atau otomatis setelah approved. |

---

## 2. Build IPA lewat Capacitor + Xcode

Ikuti [`build-ipa-capacitor.md`](build-ipa-capacitor.md). Hasil: IPA di App Store Connect via Xcode Organizer atau Transporter.

---

## 3. Upload build

**Cara A (Xcode Organizer, direkomendasikan)**:
1. Di Xcode, **Product → Archive**.
2. Setelah selesai, Organizer terbuka → pilih archive → **Distribute App → App Store Connect → Upload**.
3. Xcode menandatangani, memvalidasi, dan mengunggah otomatis.
4. Tunggu 10–20 menit sampai muncul di App Store Connect → **TestFlight → Builds** dengan status "Processing", lalu "Ready to Submit".

**Cara B (Transporter)**: bila Anda memakai `xcodebuild archive` + `xcodebuild -exportArchive` di CLI, upload IPA lewat aplikasi **Transporter** (App Store).

---

## 4. TestFlight (uji sebelum publik)

Sangat direkomendasikan sebelum submit ke review publik:

1. App Store Connect → **TestFlight** → pilih build.
2. Isi **Test Information** (email, URL, catatan).
3. Tambah **Internal Testers** (sampai 100, tanpa review Apple, tersedia dalam menit).
4. Kirim link TestFlight ke penguji.

Bila stabil setelah 1–2 hari uji lapangan, lanjut ke submit review publik.

---

## 5. Submit for Review

Kembali ke halaman versi (mis. `1.0.0`) → tab **Prepare for Submission**:

1. Pastikan **Build** sudah dipilih dari TestFlight.
2. Isi semua kolom:
   - Screenshot per device size wajib (6.9" iPhone minimum).
   - App Review Information: **wajib** demo account (email + sandi Warga demo dari seed data).
   - Contact info: nama, telp, email.
3. Klik **Add for Review** → **Submit for Review**.

Status: `Waiting for Review` → `In Review` (dalam 24 jam biasanya) → `Approved` atau `Rejected`.

Median review time saat ini: **24–48 jam**.

---

## 6. Bila ditolak — penyebab umum & solusi

| Guideline | Kesalahan umum WJW-style | Solusi |
|---|---|---|
| 2.1 App Completeness | Reviewer tidak bisa login | Sertakan **akun demo yang berfungsi tanpa OTP/telepon**. |
| 3.1.1 In-App Purchase | Menagih langganan lewat form dalam aplikasi | Pastikan tombol "Bayar" hanya menampilkan instruksi transfer bank + upload bukti; **tidak ada** UI checkout kartu kredit. Bila ada, wajib pakai Apple StoreKit. |
| 4.3 Spam | Aplikasi mirip aplikasi lain | Tekankan konteks Indonesia + fitur unik (buku tamu Satpam, patroli). |
| 5.1.1 Privacy — Data Collection | Data safety kurang lengkap | Deklarasi persis sesuai `data-safety-and-privacy.md`. |
| 5.1.5 Location Services | Meminta lokasi tanpa alasan jelas | Info.plist harus punya `NSLocationWhenInUseUsageDescription` yang jelas (lihat `Info-plist-usage-descriptions.md`). |
| 1.1.6 False information | "Panic app terhubung 911" — WJW tidak | Deskripsi WJW **eksplisit** menyatakan bukan pengganti 110/112. |
| 4.7 UGC | Tidak ada mekanisme laporkan konten | Tambahkan tombol **Laporkan** di setiap laporan/pesan warga + kebijakan moderasi 24 jam. |

Bila ditolak: perbaiki, upload build baru (naikkan build number), reply di Resolution Center dengan penjelasan.

---

## 7. Rilis

Setelah `Approved`, versi Anda:
- **Automatically release** — publik dalam beberapa jam.
- **Manually release** — Anda tekan "Release this version" saat siap.
- **Scheduled** — tanggal tertentu.

Pilih **Manual** untuk kontrol maksimal.

---

## 8. Update selanjutnya

- Naikkan **build number** di Xcode (`General → Build`, +1) untuk setiap upload.
- Marketing version (`1.0.0` → `1.0.1`) ditingkatkan bila ada fitur/perbaikan baru.
- Kirim ke TestFlight → uji → Submit for Review.
- Bila hanya perbaikan bug tanpa perubahan fitur: sertakan catatan di review "bug fixes only, no behavior change" — biasanya lebih cepat direview.
