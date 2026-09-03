# Spesifikasi Aset Grafis — Play Store & App Store

Semua ukuran dalam piksel. Semua format PNG **tanpa alpha** kecuali disebutkan.

---

## Ikon aplikasi

| Toko | Ukuran | Format | Sudut | Catatan |
|---|---|---|---|---|
| Google Play — ikon rilis toko | **512 × 512** | PNG 32-bit | Persegi | Latar solid, tanpa bayangan. |
| Google Play — ikon adaptif dalam APK | 108 × 108 dp (foreground) + 108 × 108 dp (background) | XML/PNG | — | Diatur di `android/app/src/main/res/mipmap-anydpi-v26/`. |
| Apple App Store — Marketing icon | **1024 × 1024** | PNG **tanpa alpha, tanpa sudut membulat** | Persegi | Apple sendiri yang membulatkan. |
| Apple iOS — ikon dalam bundle | 20/29/40/60/76/83.5/1024pt @1x/@2x/@3x | PNG | — | Diatur di `ios/App/App/Assets.xcassets/AppIcon.appiconset`. |

**Sumber**: file `public/icon-512.png` (sudah ada di repo). Untuk App Store 1024, upscale/generate ulang dari SVG di `public/favicon.svg` supaya tetap tajam. Pastikan **tidak ada alpha** untuk App Store.

Perintah generate cepat (butuh ImageMagick):
```bash
# Android maskable & Play listing icon
magick public/icon-512.png -background "#0d1117" -flatten -resize 512x512 android-play-icon-512.png

# App Store 1024 tanpa alpha
magick public/icon-512.png -background "#0d1117" -flatten -resize 1024x1024 -strip appstore-icon-1024.png
```

Atau pakai layanan online: <https://icon.kitchen> (import `icon-512.png`, export "iOS + Google Play").

---

## Feature Graphic (Play Store saja)

- **1024 × 500 PNG** atau JPG, ≤ 15 MB.
- Tampilkan nama + tagline: *"Warga Jaga Warga — Tetangga saling menjaga"*.
- Warna latar: `#0d1117` (sesuai brand). Teks putih. Sertakan ikon di kiri.
- Tanpa teks kecil (Google mem-reduce ukurannya di grid).

Template kanvas (Figma / Canva): buat frame 1024×500, `#0d1117`, teks Inter 900 60pt.

---

## Screenshot

### Google Play

Minimum 2, maksimum 8 per tipe perangkat. Semua PNG/JPG, sisi 320–3840 px, rasio antara 16:9 dan 9:16.

| Tipe | Ukuran disarankan | Wajib? |
|---|---|---|
| Phone | **1080 × 1920** (potret) | Wajib min. 2 |
| 7-inch tablet | 1200 × 1920 | Opsional (tapi disarankan) |
| 10-inch tablet | 1920 × 1200 | Opsional |

### Apple App Store

Wajib min. 1 per set. Yang wajib **paling besar**:

| Perangkat | Resolusi | Wajib? |
|---|---|---|
| iPhone 6.9" (15/16 Pro Max) | **1290 × 2796** | **Wajib** |
| iPhone 6.5" (11 Pro Max) | 1284 × 2778 | Opsional (autoscale dari 6.9") |
| iPhone 5.5" (8 Plus) | **1242 × 2208** | **Wajib** untuk build yang menargetkan iOS lama |
| iPad Pro 13" gen 6/7 | **2064 × 2752** | Wajib bila mendukung iPad |
| iPad Pro 12.9" gen 3–6 | 2048 × 2732 | Opsional |

Bila Anda hanya iPhone-only, iPad tidak diperlukan. Set flag di Xcode: **Targeted Device Family = 1** (iPhone only).

### Isi 5 screenshot yang direkomendasikan (dua bahasa)

Susun urutan yang menceritakan alur:

1. **Landing** — sapaan "Apa kabar hari ini?" + logo besar → tagline: *"Satu tombol untuk memanggil tetangga."*
2. **Panic grid** — 6 kartu darurat besar → *"Tekan-tahan 1,5 detik. Batal 5 detik."*
3. **Insiden aktif** — banner merah + peta + tombol "Saya menuju lokasi" → *"Semua tetangga terdekat langsung tahu."*
4. **Peta area** — poligon area lingkungan → *"Admin gambar batas RT/RW."*
5. **Profil darurat** — form gol. darah/alergi → *"Terenkripsi. Hanya untuk Satpam saat panik."*

Buat versi teks Indonesia (default) dan English (untuk pasar `en-US`).

---

## App preview (video) — opsional

| Toko | Panjang | Resolusi | Format |
|---|---|---|---|
| Play — Promo video | 30 s – 2 mnt | YouTube link (unlisted OK) | — |
| App Store — App Preview | 15–30 s | Sama seperti screenshot | .mov / .mp4 H.264 |

Video opsional tapi meningkatkan konversi. Bila dibuat, jangan pakai musik berlisensi ketat — Apple menolak.

---

## Splash screen (untuk build APK/IPA)

Sudah dikonfigurasi di `capacitor.config.json` (`backgroundColor: #0d1117`). Bila ingin logo di splash:

```bash
# Generate splash lewat @capacitor/assets
npm install --save-dev @capacitor/assets
mkdir -p assets
cp public/icon-512.png assets/icon.png                    # 1024x1024 lebih baik
cp public/icon-512.png assets/splash.png                  # 2732x2732 lebih baik (isi tengah)
npx capacitor-assets generate
```

Perintah di atas menghasilkan semua ukuran ikon Android + iOS dan splash otomatis.

---

## Checklist aset sebelum submit

- [ ] `android-play-icon-512.png` (PNG solid, tanpa alpha)
- [ ] `feature-graphic-1024x500.png`
- [ ] Minimal 4 screenshot phone Android (1080×1920)
- [ ] `appstore-icon-1024.png` (PNG tanpa alpha)
- [ ] Minimal 4 screenshot iPhone 6.9" (1290×2796)
- [ ] Minimal 4 screenshot iPhone 5.5" (1242×2208)
- [ ] (Opsional) Screenshot iPad bila mendukung iPad
- [ ] (Opsional) App preview video max 30 detik
