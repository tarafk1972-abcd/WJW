# Membuat APK Warga Jaga Warga

Aplikasi ini dibuat sebagai web (PWA). Untuk menjadikannya APK, isinya
dibungkus memakai **Capacitor** — kerangka resmi yang menjalankan aplikasi
web di dalam wadah Android.

Semua berkas yang diperlukan sudah disiapkan di repositori ini. Yang
belum bisa dikerjakan dari sini hanyalah proses kompilasinya, karena
membutuhkan Java dan Android SDK.

---

## Hal terpenting: alamat server

**Baca bagian ini lebih dulu.** Ini kesalahan yang paling sering
membuat APK terpasang tetapi tidak bisa dipakai sama sekali.

Saat dibuka lewat peramban, aplikasi memanggil `/api/...` pada alamat
yang sama dengan halamannya. Di dalam APK tidak ada "alamat halaman" —
isinya berkas lokal di dalam ponsel. Panggilan `/api/...` tidak akan
menemukan apa pun, dan setiap layar akan tampak kosong.

Karena itu APK **wajib** dibangun dengan alamat server yang sesungguhnya:

```
VITE_API_BASE=https://api.domain-anda.com npm run build
```

Syaratnya:

- server harus bisa diakses dari internet, bukan `localhost`;
- harus **HTTPS** — Android menolak HTTP biasa;
- notifikasi push dan GPS juga hanya bekerja di atas HTTPS.

Bila Anda belum punya server publik, APK-nya akan terpasang tetapi tidak
bisa masuk maupun memuat data. Siapkan servernya lebih dulu.

---

## Yang perlu dipasang di komputer Anda

| Kebutuhan | Keterangan |
|---|---|
| **Node.js 20+** | Sudah ada bila aplikasi ini pernah dijalankan |
| **JDK 21** | [Adoptium Temurin](https://adoptium.net/) |
| **Android Studio** | [developer.android.com/studio](https://developer.android.com/studio) — sekaligus memasang Android SDK |

Setelah Android Studio terpasang, buka sekali dan biarkan ia mengunduh
SDK. Pastikan variabel `ANDROID_HOME` mengarah ke folder SDK, biasanya:

```
C:\Users\<nama>\AppData\Local\Android\Sdk
```

---

## Langkah membuat APK

Jalankan di folder proyek.

### 1. Pasang Capacitor

```
npm install @capacitor/core @capacitor/cli @capacitor/android
```

### 2. Bangun aplikasi webnya, dengan alamat server

```
VITE_API_BASE=https://api.domain-anda.com npm run build
```

Di Windows (Command Prompt):

```
set VITE_API_BASE=https://api.domain-anda.com
npm run build
```

### 3. Tambahkan wadah Android

```
npx cap add android
```

Cukup sekali. Perintah ini membuat folder `android/`.

### 4. Salin hasil build ke dalamnya

```
npx cap sync android
```

Ulangi setiap kali kode berubah.

### 5. Bangun APK

```
cd android
gradlew assembleDebug
```

APK-nya ada di:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Salin ke ponsel, lalu pasang (perlu mengizinkan "Instal aplikasi tidak
dikenal").

---

## Izin yang perlu ditambahkan

Buka `android/app/src/main/AndroidManifest.xml`, tambahkan di dalam
`<manifest>` sebelum `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
```

Tanpa `ACCESS_FINE_LOCATION`, penandaan ronda dan pemanggilan tetangga
terdekat tidak akan bekerja. Tanpa `POST_NOTIFICATIONS` (Android 13+),
notifikasi darurat tidak muncul.

---

## APK untuk disebarkan (bukan debug)

APK debug tidak boleh disebarkan luas: ia tidak ditandatangani dengan
kunci Anda dan tidak dioptimalkan.

Buat kunci sekali saja:

```
keytool -genkey -v -keystore wjw.keystore -alias wjw \
  -keyalg RSA -keysize 2048 -validity 10000
```

> Simpan berkas `wjw.keystore` dan sandinya baik-baik. **Bila hilang,
> Anda tidak akan pernah bisa memperbarui aplikasi yang sudah terpasang
> di ponsel warga** — mereka harus menghapus dan memasang ulang.
> Jangan pernah memasukkannya ke Git.

Lalu:

```
cd android
gradlew assembleRelease
```

---

## Yang berubah dan yang tidak

Yang **tetap sama** persis: seluruh tampilan dan alur, karena isinya
aplikasi web yang sama.

Yang **menjadi lebih baik** di APK:

- ikon aplikasi sendiri di layar utama, tanpa "Tambahkan ke layar utama";
- izin lokasi dan notifikasi diminta sebagai aplikasi biasa, bukan situs;
- tidak ada bilah alamat peramban.

Yang **tetap tidak bisa**, meski dalam bentuk APK:

- **mengambil lokasi saat aplikasi benar-benar tertutup.** Isinya tetap
  halaman web; wadah Capacitor tidak mengubah itu. Karena itu letak rumah
  warga dicatat sekali saat mendaftar — lihat `docs/KESIAPAN-PRODUKSI.md`.

Bila kelak fitur latar belakang sungguhan dibutuhkan, jalannya adalah
menambah plugin Capacitor asli (mis. `@capacitor/geolocation` dengan
layanan latar), bukan sekadar membungkus ulang.

---

## Alternatif tanpa memasang apa pun

Bila Anda hanya ingin mencoba di ponsel sekarang:

**Pasang sebagai PWA.** Buka alamat aplikasi di Chrome Android →
menu ⋮ → **Instal aplikasi**. Ikonnya muncul di layar utama dan berjalan
tanpa bilah alamat — hampir tidak berbeda dengan APK, dan tidak perlu
proses pembangunan sama sekali.

Ini cara tercepat untuk uji coba di lapangan.
