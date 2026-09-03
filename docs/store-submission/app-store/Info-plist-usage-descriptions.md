# Info.plist — Usage Descriptions siap tempel

Tempel blok berikut di `ios/App/App/Info.plist`, di dalam `<dict>` utama, sebelum `</dict>` penutup.

Teks dijaga **singkat, jelas, dan menjelaskan manfaat bagi pengguna** — inilah yang paling penting untuk lolos review Apple 5.1.1 (Data Collection & Storage).

```xml
<!-- ==== IZIN PERANGKAT (WAJIB, jangan skip yang aplikasinya minta) ==== -->

<key>NSLocationWhenInUseUsageDescription</key>
<string>Membagi lokasi ke tetangga saat Anda menekan tombol panik atau menjalankan patroli.</string>

<key>NSCameraUsageDescription</key>
<string>Mengambil foto bukti kejadian dan memindai QR undangan lingkungan.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Melampirkan foto bukti dari galeri ke laporan kejadian.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>Menyimpan foto bukti yang Anda kirim ke galeri Anda.</string>

<key>NSMicrophoneUsageDescription</key>
<string>Merekam bukti audio saat panik aktif, hanya bila Anda memilih.</string>

<key>NSFaceIDUsageDescription</key>
<string>Membuka aplikasi dengan Face ID untuk keamanan akun keluarga.</string>

<key>NSContactsUsageDescription</key>
<string>Mengisi cepat kontak darurat keluarga Anda.</string>

<!-- ==== APLIKASI & JARINGAN ==== -->

<!-- Jangan hapus: iOS 14+ butuh justifikasi teknis untuk cross-app tracking; WJW TIDAK melacak -->
<key>NSUserTrackingUsageDescription</key>
<string>Warga Jaga Warga tidak melacak aktivitas Anda di aplikasi atau situs web lain.</string>

<!-- Wajib: menyatakan aplikasi tidak memakai enkripsi non-standar (hanya TLS + AES-GCM standar OS) -->
<key>ITSAppUsesNonExemptEncryption</key>
<false/>

<!-- Orientasi (mobile-first, portrait saja) -->
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
</array>

<key>UISupportedInterfaceOrientations~ipad</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
  <string>UIInterfaceOrientationPortraitUpsideDown</string>
</array>

<!-- Dark mode: aplikasi Anda berbasis warna gelap; sesuaikan bila mau ikut sistem -->
<key>UIUserInterfaceStyle</key>
<string>Dark</string>

<!-- Splash background (Capacitor sudah menyetel, ini fallback) -->
<key>UILaunchStoryboardName</key>
<string>LaunchScreen</string>
```

## Catatan penting

1. **Setiap** `NS...UsageDescription` yang Anda tempel HARUS cocok dengan izin yang benar-benar diminta aplikasi. Bila teks ada tapi kode tidak pernah meminta, itu tidak apa-apa. Bila kode meminta tapi teks tidak ada, iOS akan **crash aplikasi** dan Apple menolak review.

2. **`NSUserTrackingUsageDescription`** tetap dipertahankan karena beberapa library WebView bisa memicu prompt ATT walau Anda tidak melacak. Menambahkannya aman.

3. **Bahasa**: teks di atas dalam Bahasa Indonesia karena `CFBundleDevelopmentRegion` default akan menyesuaikan. Bila ingin dua bahasa, pakai file `InfoPlist.strings` per language folder:
   ```
   ios/App/App/en.lproj/InfoPlist.strings
   ios/App/App/id.lproj/InfoPlist.strings
   ```

4. **Background Modes** — WJW *tidak* memerlukan background modes saat ini. Jika kelak Anda menambahkan `@capacitor/background-runner`, WAJIB centang mode yang sesuai di **Signing & Capabilities → + Capability → Background Modes** dan Apple review akan lebih ketat.

5. **Push notifications** — bila push notification VAPID Web Push berjalan lewat Safari WebPush, tidak butuh capability tambahan. Bila kelak beralih ke APNs (via `@capacitor/push-notifications`), tambahkan capability **Push Notifications** dan `NSUserNotificationsUsageDescription` (tidak wajib, tapi rekomendasi).
