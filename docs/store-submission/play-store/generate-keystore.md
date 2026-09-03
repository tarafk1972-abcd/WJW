# Membuat & Menyimpan Keystore Rilis Android

**PERINGATAN:** Keystore ini menandatangani setiap update aplikasi Anda selamanya. Bila hilang, Anda **tidak bisa memperbarui aplikasi** yang sudah terpasang di ponsel pengguna — mereka wajib uninstall & install ulang (kehilangan data lokal).

Play Console memang menawarkan reset kunci via App Signing sejak 2020, tetapi tetap **jangan andalkan itu**.

---

## 1. Generate keystore (satu kali)

Jalankan di folder mana saja **di luar** repo Git:

```bash
keytool -genkeypair -v \
  -keystore wjw-upload.keystore \
  -alias wjw \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype JKS
```

Isi prompt:
- **Enter keystore password**: buat sandi kuat (16+ karakter, campur huruf/angka/simbol).
- **Re-enter new password**: sama.
- **What is your first and last name?** → `[GANTI: nama pemilik / badan]`
- **Organizational unit** → `Warga Jaga Warga` (atau kosongkan Enter).
- **Organization** → `[GANTI: nama badan/perorangan]`
- **City** → `[GANTI: kota]`
- **State/Province** → `[GANTI: provinsi]`
- **Country code (XX)** → `ID`
- **Is CN=..., OU=..., correct?** → `yes`
- **Enter key password for <wjw>** → Enter untuk sama dengan keystore password (paling sederhana) atau isi sandi lain.

Hasil: file `wjw-upload.keystore` di direktori aktif.

---

## 2. Verifikasi

```bash
keytool -list -v -keystore wjw-upload.keystore
```

Catat:
- **SHA1** fingerprint — dibutuhkan bila kelak pakai Firebase / Google Maps API.
- **SHA-256** fingerprint — Play App Signing memakainya untuk verifikasi.
- **Valid until** — 27 tahun cukup untuk seumur aplikasi.

---

## 3. Simpan dengan aman (WAJIB)

Simpan **tiga salinan** di lokasi berbeda:

| Salinan | Media | Kenapa |
|---|---|---|
| 1 | Manajer sandi terenkripsi (1Password / Bitwarden) — attach file + catat sandi | Cepat diakses saat build |
| 2 | Drive terenkripsi (VeraCrypt volume) di komputer utama | Cadangan lokal |
| 3 | USB stick di brankas fisik atau safe deposit box | Cadangan offline |

Catat di file **`WJW-KEYSTORE-INFO.txt`** yang disimpan bersama keystore:

```
File          : wjw-upload.keystore
Alias         : wjw
Keystore pass : ****************
Key pass      : ****************
SHA1          : XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
SHA256        : XX:XX:XX:....
Created       : YYYY-MM-DD
Application   : id.wargajagawarga.app
```

**JANGAN**:
- ❌ Commit ke Git (buat entry di `.gitignore`: `*.keystore`, `keystore.properties`)
- ❌ Kirim via email atau Telegram/WA tanpa enkripsi
- ❌ Simpan di Google Drive/Dropbox tanpa enkripsi terpisah

**Boleh**:
- ✅ Simpan sebagai GitHub Actions Secret berupa base64 (`base64 -w0 wjw-upload.keystore`) — untuk build otomatis
- ✅ Cetak di kertas & simpan di brankas (hanya sandi, bukan file)

---

## 4. Bila hilang / lupa sandi

1. Buka Play Console → **App integrity → App Signing → Request upload key reset**.
2. Kirim keystore baru + surat pernyataan hilang.
3. Google mereview 2–7 hari. Bila disetujui, kunci upload baru dipakai untuk update; kunci final di server Google tidak berubah, jadi pengguna tetap bisa update aplikasi.

Ini fitur penyelamat, tapi tetap **jangan sampai hilang**. Menit yang habis membuat build juga hilang, dan pada aplikasi keamanan lingkungan itu bukan hal remeh.
