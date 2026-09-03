# Jawaban Rating Konten — Play (IARC) & App Store

## A) Play Console — IARC Questionnaire

Buka **Play Console → App content → Content ratings** dan isi:

**Kategori aplikasi**: *Reference, News, or Educational* → **All other app types**.

**Email**: `[GANTI: email dukungan]`

Jawab semua pertanyaan berikut **No** kecuali yang ditandai **Yes**:

| Pertanyaan (ringkas) | Jawaban |
|---|---|
| Violence — Realistic violence, cartoon, blood, sexual violence, dll. | **No** |
| Sexuality — Nudity, sexual innuendo, sexual activity | **No** |
| Language — Profanity | **No** |
| Controlled substance — Reference to drugs, alcohol, tobacco | **No** |
| Gambling — Simulated/real gambling | **No** |
| Fear — Horror themes | **No** |
| User-generated content shared with other users? | **Yes** (laporan, pesan, foto — antar anggota komunitas) |
| User-to-user communication (chat/messaging)? | **Yes** (pesan dalam insiden) |
| Shares user's location with other users? | **Yes** (lokasi ditampilkan ke Satpam/Admin komunitas saat SOS/patroli aktif) |
| Enables purchase of digital goods? | **No** (langganan diverifikasi manual, bukan IAP) |

Hasil rating yang diharapkan: **Everyone / PEGI 3 / USK 0 / ClassInd L**, dengan interactive elements: **Users Interact**, **Shares Location**, **Digital Purchases: No**. Rating final ditentukan IARC setelah submit — jangan kaget bila jadi 12+ karena kategori keamanan.

---

## B) App Store — Age Rating

Buka **App Store Connect → App Information → Age Rating → Edit** dan isi:

| Kategori | Frekuensi |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Sexual Content or Nudity | None |
| Profanity or Crude Humor | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Prolonged Graphic or Sadistic Realistic Violence | No |
| Gambling and Contests | No |
| Unrestricted Web Access | No |
| Gambling | No |

**Made for Kids?** → **No**.

Hasil: **4+**. Karena ada UGC dan chat, Apple mungkin naikkan ke **12+** — biarkan Apple memutuskan.

---

## C) Kolom lain di App Store Connect terkait konten

- **Content Rights**: pilih *No, it does not contain, show, or access third-party content*.
- **Export Compliance (ITSAppUsesNonExemptEncryption)**: Anda memakai TLS standar dan AES-256-GCM. Isi `Info.plist`:
  ```xml
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  ```
  Ini memakai pengecualian standar iOS (TLS + kripto standar OS). Dengan begitu **tidak perlu** dokumen ERN tambahan.
- **Sign in with Apple**: **tidak wajib** karena WJW tidak memakai login sosial pihak ketiga (hanya email + sandi). Bila kelak menambahkan login Google, WAJIB pula menambahkan Sign in with Apple.
