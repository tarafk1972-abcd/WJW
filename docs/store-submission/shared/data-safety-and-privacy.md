# Data Safety (Google Play) & Privacy Nutrition Labels (Apple)

Isi formulir di Play Console dan App Store Connect **persis** seperti di bawah. Ini konsisten dengan kode aplikasi dan `privacy-policy.md`.

---

## A) Google Play — Data Safety form

Buka **Play Console → App content → Data safety** dan pilih jawaban berikut.

### 1. Data collection & security
- Aplikasi mengumpulkan atau membagikan data pengguna → **Ya**.
- Semua data pengguna dienkripsi saat transit → **Ya** (TLS 1.2+).
- Anda menyediakan cara pengguna meminta hapus data → **Ya**. URL: `[GANTI: URL hapus-akun web]`.
- Data telah diaudit sesuai standar keamanan → **Belum** (kecuali Anda punya audit). Pilih **No**.

### 2. Data types collected

| Kategori | Tipe data | Dikumpulkan? | Dibagikan pihak ke-3? | Wajib atau opsional? | Tujuan |
|---|---|---|---|---|---|
| **Personal info** | Nama | Ya | Tidak | Wajib | Fungsi aplikasi, komunikasi antar-pengguna |
| Personal info | Alamat email | Ya | Tidak | Wajib | Otentikasi akun, komunikasi |
| Personal info | Nomor telepon | Ya | Tidak | Opsional | Kontak darurat (bila diisi) |
| Personal info | User ID | Ya | Tidak | Wajib | Fungsi aplikasi |
| Personal info | Alamat | Ya | Tidak | Wajib | Menentukan lingkungan/RT |
| **Location** | Approximate location | Ya | Tidak | Opsional | Fungsi aplikasi (menandai laporan) |
| Location | Precise location | Ya | Tidak | Opsional | Fungsi aplikasi (SOS aktif, patroli aktif) |
| **Health & fitness** | Health info | Ya | Tidak | Opsional | Fungsi aplikasi (profil darurat: gol. darah, alergi, riwayat penyakit — dienkripsi) |
| **Messages** | Other in-app messages | Ya | Tidak | Opsional | Fungsi aplikasi (pesan pada insiden) |
| **Photos and videos** | Photos | Ya | Tidak | Opsional | Fungsi aplikasi (foto bukti pada insiden) |
| **Audio** | Voice or sound recordings | Ya | Tidak | Opsional | Fungsi aplikasi (bukti audio SOS bila diaktifkan) |
| **App activity** | App interactions | Ya | Tidak | Wajib | Analitik in-house untuk performa & keamanan |
| **App activity** | Other actions | Ya | Tidak | Wajib | Audit log keamanan |
| **Device or other IDs** | Device or other IDs | Ya | Tidak | Wajib | Fungsi aplikasi (deviceId acak; bukan IMEI/MAC/AAID) |

Tidak ada tipe berikut yang dikumpulkan: Financial info, Contacts, Calendar, Files & docs, Health tracking Wear OS, Web browsing history, Installed apps.

### 3. Security practices
- **Data encrypted in transit**: Ya.
- **Users can request data be deleted**: Ya, lewat aplikasi (Setelan → Hapus akun) dan lewat web `[GANTI: URL]`.

### 4. Family policy
- Aplikasi target audiens 13+ → tidak masuk kebijakan Families.

---

## B) Apple App Store — App Privacy

Buka **App Store Connect → App Privacy** dan tambahkan:

### Data types collected

Untuk setiap tipe di bawah pilih:
- **Data is used to track you?** → **No** (WJW tidak ikut cross-app tracking).
- **Data is linked to the user?** → **Yes** (ke akun WJW).

| Tipe (menu Apple) | Contoh spesifik | Tujuan (App Functionality) |
|---|---|---|
| Contact Info → Name | Nama pengguna | ✅ |
| Contact Info → Email Address | Email login | ✅ |
| Contact Info → Phone Number | Kontak darurat (opsional) | ✅ |
| Contact Info → Physical Address | Alamat lingkungan | ✅ |
| Health & Fitness → Health | Golongan darah, alergi, riwayat singkat | ✅ |
| Location → Precise Location | Lokasi saat SOS/patroli aktif | ✅ |
| Location → Coarse Location | Menandai laporan | ✅ |
| User Content → Photos or Videos | Foto bukti insiden | ✅ |
| User Content → Audio Data | Rekaman bukti SOS (bila diaktifkan) | ✅ |
| User Content → Other User Content | Pesan pada insiden, buku tamu, laporan | ✅ |
| Identifiers → User ID | ID pengguna internal | ✅ |
| Identifiers → Device ID | deviceId acak internal (bukan IDFA) | ✅ |
| Usage Data → Product Interaction | Aksi UI untuk audit keamanan | ✅ |
| Diagnostics → Crash Data | (bila Anda pasang Sentry/Bugsnag; kalau tidak, skip) | ✅ |

Untuk semua di atas pilih **App Functionality** sebagai satu-satunya purpose. **Tidak** memilih Analytics, Advertising, Personalization, atau Third-Party Advertising.

### Tracking
- **Does your app use App Tracking Transparency (ATT)?** → **No**.
- Pastikan Anda **tidak** menginstal SDK iklan / analitik pihak ketiga (Facebook SDK, AdMob, Firebase Analytics dengan collection default). Bila di masa depan menambahkannya, kolom ini wajib diperbarui.

---

## C) Ringkasan data untuk formulir keduanya

Simpan sebagai referensi cepat:

```
PII:            name, email, address, phone(optional), password(hashed)
Health:         blood type, allergies, medical notes, emergency contact (encrypted at rest)
Location:       precise only during active SOS or active patrol; coarse for report tagging
Media:          photos + optional audio uploaded by user as incident evidence
Content:        incident reports, in-incident messages, guest logbook entries
Identifiers:    internal userId + random deviceId; NO IDFA, NO AAID, NO IMEI
Sharing:        none with third parties (map tiles use IP only)
Retention:      account lifetime; connection logs 30d; patrol tracks 6d; 30d wipe after delete request
Encryption:     TLS 1.2+ in transit; AES-256-GCM at rest for medical snapshots and sensitive SOS blobs
```
