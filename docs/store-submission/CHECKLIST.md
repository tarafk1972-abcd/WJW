# CHECKLIST — Rilis WJW ke Play Store & App Store

Cetak halaman ini, coret satu per satu. Estimasi total: **1–2 minggu kerja** (banyak menunggu review).

---

## Fase 0 — Prasyarat (1–3 hari, bisa paralel)

- [ ] Beli **Google Play Console** (US$25, sekali bayar) di <https://play.google.com/console/signup>. Verifikasi identitas.
- [ ] Daftar **Apple Developer Program** (US$99/tahun) di <https://developer.apple.com/programs/>. Verifikasi 24–48 jam.
- [ ] Miliki komputer **macOS + Xcode 16+** (wajib untuk iOS).
- [ ] Server API WJW **HTTPS publik** menyala. Set `WJW_CORS_ORIGINS=https://localhost,capacitor://localhost`.
- [ ] Publikasikan URL kebijakan privasi & syarat ketentuan (isi dari `shared/privacy-policy.md` & `shared/terms-of-service.md`).
- [ ] Siapkan email dukungan aktif + alamat pos fisik (wajib Play Store).

---

## Fase 1 — Aset grafis (1 hari)

Lihat spec: `shared/assets-specs.md`.

- [ ] Icon 512×512 PNG solid (`android-play-icon-512.png`)
- [ ] Icon 1024×1024 PNG tanpa alpha (`appstore-icon-1024.png`)
- [ ] Feature graphic 1024×500 (Play only)
- [ ] Min. 4 screenshot phone Android (1080×1920)
- [ ] Min. 4 screenshot iPhone 6.9" (1290×2796)
- [ ] Min. 4 screenshot iPhone 5.5" (1242×2208)
- [ ] (Opsional) app preview video ≤ 30s

Perintah cepat regenerate ikon:
```bash
npm install --save-dev @capacitor/assets
cp public/icon-512.png assets/icon.png
cp public/icon-512.png assets/splash.png
npx capacitor-assets generate
```

---

## Fase 2 — Android (0.5–1 hari + 1–3 hari review)

- [ ] Buat keystore rilis → `play-store/generate-keystore.md`. Simpan **3 salinan**.
- [ ] Konfigurasi signing di `android/app/build.gradle` (lihat `play-store/build-signed-aab.md`).
- [ ] Tempel izin dari `play-store/AndroidManifest-permissions.xml` ke `AndroidManifest.xml`.
- [ ] Set `versionCode 1`, `versionName "1.0.0"`, `targetSdkVersion 34`.
- [ ] Build web: `VITE_API_BASE=<URL_API> npm run build`.
- [ ] `npx cap add android && npx cap sync android`.
- [ ] `cd android && ./gradlew bundleRelease`. Hasil: `app-release.aab`.
- [ ] Play Console → Create app → isi:
  - [ ] App info (nama, bahasa, gratis)
  - [ ] Store listing dari `shared/store-listing.md` (bahasa ID + EN)
  - [ ] Graphic assets (icon 512, feature graphic, screenshots)
  - [ ] Content rating dari `shared/content-rating-questionnaire.md`
  - [ ] Data safety dari `shared/data-safety-and-privacy.md`
  - [ ] Target audience: 13+
  - [ ] Contact details (email, phone, alamat pos)
  - [ ] App access → akun demo Play (`app-store/review-notes-and-demo.md`)
  - [ ] Ads: No · Government app: No · Financial: No
- [ ] Internal testing release → upload AAB → invite testers → uji 1–2 hari.
- [ ] Promote ke Production → rollout 20% → naikkan bila stabil.
- [ ] **Submit for review**. Tunggu 1–3 hari.

---

## Fase 3 — iOS (1 hari + 1–3 hari review)

- [ ] Buat App ID `id.wargajagawarga.app` di [Certificates, IDs & Profiles](https://developer.apple.com/account/resources/identifiers/list).
- [ ] App Store Connect → New App → isi info dasar.
- [ ] Tempel usage descriptions dari `app-store/Info-plist-usage-descriptions.md` ke `ios/App/App/Info.plist`.
- [ ] Build web: `VITE_API_BASE=<URL_API> npm run build`.
- [ ] `npx cap add ios && npx cap sync ios && npx cap open ios`.
- [ ] Xcode → Signing: pilih Team, auto-signing ON.
- [ ] Naikkan Version 1.0.0 & Build 1.
- [ ] Product → Archive → Distribute App → Upload ke App Store Connect.
- [ ] Tunggu build "Processing" → "Ready to Submit" (5–20 menit).
- [ ] App Store Connect versi 1.0.0 → isi:
  - [ ] Screenshots (6.9" + 5.5" wajib)
  - [ ] Description & keywords dari `shared/store-listing.md`
  - [ ] Age Rating dari `shared/content-rating-questionnaire.md`
  - [ ] App Privacy dari `shared/data-safety-and-privacy.md`
  - [ ] App Review Info + demo account dari `app-store/review-notes-and-demo.md`
  - [ ] Version Release: Manual (rekomendasi)
- [ ] (Opsional tapi disarankan) TestFlight internal 1–2 hari.
- [ ] **Submit for Review**. Tunggu 24–72 jam.
- [ ] Setelah Approved → **Release this version**.

---

## Fase 4 — Setelah live

- [ ] Monitor Play Console → Android vitals (crash rate < 0.5%).
- [ ] Monitor App Store Connect → Analytics & Crashes.
- [ ] Balas review pengguna dalam 48 jam.
- [ ] Tandai versi di Git: `git tag v1.0.0-play-store`, `git tag v1.0.0-app-store`.

---

## Untuk update selanjutnya

**Android:** naikkan `versionCode +1` di `build.gradle`, rebuild AAB, upload → Play Console → Production → Create new release.

**iOS:** naikkan Build number di Xcode, Archive, Upload, submit for review.

---

## Berkas rujukan cepat

```
store-submission/
├── README.md                          ← ringkasan & isi paket
├── CHECKLIST.md                       ← file ini
├── shared/
│   ├── store-listing.md               ← teks toko (ID + EN)
│   ├── privacy-policy.md              ← publish di URL publik
│   ├── terms-of-service.md            ← publish di URL publik
│   ├── data-safety-and-privacy.md     ← isian Play & Apple privacy
│   ├── content-rating-questionnaire.md
│   └── assets-specs.md
├── play-store/
│   ├── PANDUAN-PLAY-STORE.md          ← panduan lengkap
│   ├── build-signed-aab.md
│   ├── generate-keystore.md
│   └── AndroidManifest-permissions.xml
└── app-store/
    ├── PANDUAN-APP-STORE.md           ← panduan lengkap
    ├── build-ipa-capacitor.md
    ├── Info-plist-usage-descriptions.md
    └── review-notes-and-demo.md
```
