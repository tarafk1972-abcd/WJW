# Bangun IPA iOS lewat Capacitor + Xcode

Perkiraan waktu 45–90 menit pertama kali.

---

## 1. Prasyarat

- **macOS 13+** dengan **Xcode 16+** (dari App Store).
- **CocoaPods**: `brew install cocoapods` atau `sudo gem install cocoapods`.
- Apple ID login di Xcode (Xcode → Settings → Accounts).
- Apple Developer Program aktif, App ID `id.wargajagawarga.app` terdaftar.
- Server API publik HTTPS.

---

## 2. Build web + tambahkan wadah iOS

Di folder repo WJW:

```bash
npm ci
npm install @capacitor/core@7 @capacitor/cli@7 @capacitor/ios@7

# Build web dengan URL API produksi
VITE_API_BASE=https://warga-jaga-warga-wjw.fly.dev npm run build

# Sekali saja: tambahkan wadah iOS
npx cap add ios

# Copy hasil build ke wadah iOS
npx cap sync ios
```

Hasil: folder `ios/App/` dengan proyek Xcode `App.xcworkspace`.

---

## 3. Buka di Xcode

```bash
npx cap open ios
```

Xcode terbuka dengan `App.xcworkspace`. Di panel kiri:
1. Pilih target **App** → tab **Signing & Capabilities**.
2. Centang **Automatically manage signing**.
3. **Team**: pilih tim Apple Developer Anda (perlu login).
4. **Bundle Identifier**: `id.wargajagawarga.app` (sudah otomatis).
5. Pastikan **Provisioning Profile** muncul tanpa error merah.

---

## 4. Tempel usage descriptions di Info.plist

Buka `ios/App/App/Info.plist` (kanan-klik → **Open As → Source Code**). Tempel isi dari [`Info-plist-usage-descriptions.md`](Info-plist-usage-descriptions.md) di dalam `<dict>` utama, **sebelum** `</dict>` penutup.

Tanpa usage descriptions, iOS langsung crash saat aplikasi mencoba akses kamera/lokasi/mikrofon.

---

## 5. Naikkan versi & build

Di Xcode → target **App** → tab **General**:

- **Version** (Marketing): `1.0.0` (rilis pertama)
- **Build**: `1` (naikkan +1 setiap upload berikutnya, meski `Version` tetap)
- **Deployment Info** → **iOS Deployment Target**: **14.0** (cakupan >97%).
- **Device Orientation**: Portrait saja (aplikasi mobile-first).
- **iPad**: tanpa Multitasking bila hanya iPhone-only → **Target Device Family = 1 (iPhone)**.

---

## 6. Uji di simulator dulu

Di Xcode toolbar atas: pilih simulator (mis. iPhone 15 Pro) → tombol ▶ **Run**.

- Aplikasi harus terbuka, memuat UI, memanggil API (`VITE_API_BASE`) tanpa error.
- Coba tombol panik (memerlukan lokasi — simulator: **Features → Location → City Run**).
- Bila error network, cek Xcode console + Safari Web Inspector (Develop → Simulator → App).

Perbaiki bug sebelum lanjut.

---

## 7. Archive untuk App Store

Di Xcode toolbar → **Device**: pilih **Any iOS Device (arm64)** (tidak boleh simulator).

Menu **Product → Archive**. Tunggu 3–10 menit.

Bila error signing: cek Team + auto-signing.
Bila error "no such provisioning profile": bersihkan dulu — **Product → Clean Build Folder** (⇧⌘K), lalu Archive lagi.

Setelah selesai, **Organizer** terbuka otomatis dengan archive baru.

---

## 8. Validate + Upload

Di Organizer → pilih archive baru:

1. **Validate App** → pilih App Store Connect → Next → Upload symbols: Yes → Automatically manage signing → Validate.
   - Perbaiki peringatan yang muncul (biasanya "Missing Purpose Strings" → berarti Info.plist kurang usage description).
2. **Distribute App** → **App Store Connect** → **Upload**.
3. Xcode akan meng-upload build (5–15 menit). Setelah selesai, buka App Store Connect.

---

## 9. Cek di App Store Connect

App Store Connect → **My Apps → Warga Jaga Warga → TestFlight → Builds**.

- Status **Processing** (5–20 menit) → **Ready to Submit** atau **Missing Compliance** (isi ITSAppUsesNonExemptEncryption = false, sudah otomatis dari Info.plist).

Setelah "Ready to Submit", pilih build ini pada halaman versi App Store, isi kolom lain, dan **Submit for Review**.

---

## 10. Menaikkan versi untuk rilis berikutnya

```bash
VITE_API_BASE=... npm run build
npx cap sync ios
```
Buka Xcode → naikkan **Build** ke `2` (bahkan bila `Version` sama). Archive → Upload.

Bila ada perubahan fitur, ganti juga **Version** (mis. `1.0.0` → `1.1.0`).

---

## 11. Alternatif CLI (opsional)

Untuk CI/CD:

```bash
cd app-store/App
xcodebuild -workspace App.xcworkspace -scheme App \
  -configuration Release -sdk iphoneos \
  -archivePath $PWD/build/App.xcarchive archive

xcodebuild -exportArchive -archivePath $PWD/build/App.xcarchive \
  -exportPath $PWD/build -exportOptionsPlist ExportOptions.plist
```

`ExportOptions.plist` minimal:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>              <string>app-store</string>
  <key>teamID</key>              <string>[GANTI: TEAM_ID Apple Developer]</string>
  <key>signingStyle</key>        <string>automatic</string>
  <key>uploadSymbols</key>       <true/>
</dict>
</plist>
```

Untuk upload via CLI:
```bash
xcrun altool --upload-app -f build/App.ipa \
  -t ios -u YOUR_APPLE_ID -p @keychain:APP_STORE_APP_PASS
```
Gunakan **App-Specific Password** dari <https://appleid.apple.com>.
