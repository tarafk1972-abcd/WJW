# Bangun AAB Rilis Bertanda Tangan (Android)

Hasil akhir: `android/app/build/outputs/bundle/release/app-release.aab` — inilah yang diunggah ke Play Console.

Perkiraan waktu: 30–45 menit pertama kali.

---

## 1. Prasyarat (satu kali)

Pasang di komputer:
- **Node.js 22.x**
- **JDK 21** — [Adoptium Temurin](https://adoptium.net)
- **Android Studio** — sekaligus SDK. Buka sekali agar SDK terunduh.
- Set `ANDROID_HOME`:
  ```bash
  # macOS/Linux
  export ANDROID_HOME=$HOME/Library/Android/sdk         # macOS
  export ANDROID_HOME=$HOME/Android/Sdk                 # Linux
  export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
  ```
  ```powershell
  # Windows PowerShell
  setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
  ```

Buat keystore satu kali → lihat [`generate-keystore.md`](generate-keystore.md). Setelah selesai Anda punya:
- `wjw-upload.keystore`
- alias `wjw`
- sandi keystore & sandi kunci

---

## 2. Konfigurasi versi

Edit `android/app/build.gradle` (setelah `npx cap add android`) di blok `defaultConfig`:

```gradle
defaultConfig {
    applicationId "id.wargajagawarga.app"
    minSdkVersion 24            // Android 7.0 — cakupan >99%
    targetSdkVersion 34         // wajib Play Store per Agustus 2025
    versionCode 1               // NAIKKAN +1 setiap upload
    versionName "1.0.0"
}
```

> Play mensyaratkan `targetSdkVersion 34` (Android 14) untuk aplikasi baru sejak Agustus 2025.

---

## 3. Tempel izin di AndroidManifest

Buka `android/app/src/main/AndroidManifest.xml`, sisipkan blok dari [`AndroidManifest-permissions.xml`](AndroidManifest-permissions.xml) di dalam `<manifest>` sebelum `<application>`.

---

## 4. Konfigurasi signing rilis

Buat file `android/keystore.properties` (JANGAN commit ke Git — sudah di `.gitignore`):

```properties
storeFile=../../wjw-upload.keystore
storePassword=[GANTI: sandi keystore]
keyAlias=wjw
keyPassword=[GANTI: sandi kunci]
```

Edit `android/app/build.gradle` — tambah di atas `android { ... }`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Dalam blok `android { ... }` tambahkan:

```gradle
signingConfigs {
    release {
        storeFile file(keystoreProperties['storeFile'] ?: 'nowhere')
        storePassword keystoreProperties['storePassword']
        keyAlias      keystoreProperties['keyAlias']
        keyPassword   keystoreProperties['keyPassword']
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

---

## 5. Build web + sinkron Capacitor

Ganti `https://api.domain-anda.com` dengan URL API publik Anda (mis. `https://warga-jaga-warga-wjw.fly.dev`).

```bash
# Root repo
npm ci
npm install @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7

# Bangun web dengan alamat API produksi
VITE_API_BASE=https://warga-jaga-warga-wjw.fly.dev npm run build

# Sekali saja: tambahkan wadah Android
npx cap add android

# Salin hasil build ke Android
npx cap sync android
```

Windows:
```powershell
set VITE_API_BASE=https://warga-jaga-warga-wjw.fly.dev
npm run build
npx cap add android
npx cap sync android
```

---

## 6. Build AAB rilis

```bash
cd android
./gradlew bundleRelease           # macOS/Linux
gradlew bundleRelease             # Windows
```

Hasil: `android/app/build/outputs/bundle/release/app-release.aab`.

Verifikasi tanda tangan:
```bash
jarsigner -verify -verbose -certs app-release.aab
```

Baris "jar verified" = OK.

---

## 7. Bila mau APK debug juga untuk uji lokal

```bash
./gradlew assembleDebug
# hasil: app/build/outputs/apk/debug/app-debug.apk
```

Ini **bukan** yang diunggah ke Play Store — hanya untuk uji sendiri.

---

## 8. Naikkan versi untuk update selanjutnya

```gradle
versionCode 2                     // 1 → 2
versionName "1.0.1"               // opsional, boleh sama
```
Bangun ulang, upload lagi. Play menolak `versionCode` yang sama atau lebih rendah dari rilis sebelumnya.

---

## 9. Alternatif build via GitHub Actions

Repo sudah punya `.github/workflows/apk.yml` untuk **debug** APK. Untuk **rilis AAB**, tambah workflow terpisah dan simpan keystore + sandi sebagai GitHub Secrets:

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 wjw-upload.keystore`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `VITE_API_BASE`

Kemudian workflow decode base64 → tulis `keystore.properties` → `./gradlew bundleRelease`.

Contoh workflow bisa dibuat kemudian bila diperlukan — untuk rilis pertama, build lokal lebih mudah dikendalikan.
