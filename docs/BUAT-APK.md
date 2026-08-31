# Membuat APK Warga Jaga Warga

Aplikasi ini dibuat sebagai web (PWA). Untuk menjadikannya APK, isinya
dibungkus memakai **Capacitor** — kerangka resmi yang menjalankan aplikasi
web di dalam wadah Android.

Ada dua jalan:

- **Bangun di GitHub Actions** — tidak perlu memasang apa pun. Ini yang
  paling mudah, dijelaskan tepat di bawah.
- **Bangun di komputer sendiri** — perlu JDK dan Android Studio.
  Dijelaskan setelahnya.

---

## Cara termudah: bangun di GitHub (tanpa memasang apa pun)

Mesin GitHub Actions sudah punya JDK dan Android SDK, jadi APK bisa
dibuat tanpa Android Studio di komputer Anda.

### Workflow sudah tersedia

Pada cabang `arena/01a03e4e-wjw`, workflow sudah ada di
`.github/workflows/apk.yml`. Tidak perlu menyalin berkas atau menjalankan
`npm run pasang-workflow` lagi.

Bila **Build APK** tidak tampak di tab Actions, pastikan Actions diizinkan
pada **Settings → Actions → General**. Menjalankan workflow tetap perlu
dilakukan oleh akun GitHub yang memiliki akses ke repositori; token otomatis
Arena tidak diberi izin untuk memulai workflow.

### Setiap kali ingin membuat APK

1. Buka repositori di GitHub → tab **Actions**
2. Pilih **Build APK** di daftar kiri
3. Pada pemilih branch, pilih **`arena/01a03e4e-wjw`** — jangan `main` atau
   artifact lama.
4. Klik **Run workflow**
5. Isi **Alamat server API** — lihat bagian berikutnya, ini yang paling
   menentukan
6. Klik **Run workflow** hijau

Tunggu sekitar 5–10 menit. Setelah selesai, buka jalannya workflow lalu
unduh **wjw-apk** di bagian **Artifacts**.

Berkas itu berisi `app-debug.apk`. Salin ke HP, lalu pasang — Android
akan meminta izin "Instal aplikasi tidak dikenal" satu kali. Periksa penanda
waktu build (`v…`) di halaman depan aplikasi untuk membedakan artifact baru
dari APK lama.

Jika Android menolak pemasangan pembaruan karena versionCode atau sertifikat
debug berbeda, hapus **APK uji** lama terlebih dahulu lalu pasang yang baru;
data lokal uji akan ikut terhapus.

> **Ini APK "debug", bukan versi rilis.** Cukup untuk dipasang sendiri
> dan diuji satpam, tetapi **tidak bisa** diunggah ke Play Store dan
> tidak boleh disebarkan luas: kunci debug bukan identitas penerbit yang
> aman. Untuk sebaran sungguhan diperlukan keystore milik sendiri — lihat
> bagian "APK untuk disebarkan (bukan debug)" di bawah bila sudah sampai
> tahap itu.

> Bila tab Actions belum aktif, buka **Settings → Actions → General**
> lalu izinkan menjalankan workflow.

Workflow ini juga menjalankan seluruh tes lebih dulu, dan berhenti bila
alamat servernya tidak masuk akal — supaya Anda tidak menunggu sepuluh
menit hanya untuk mendapat APK yang layarnya kosong.

### Jika peta menulis “API key required”

Jangan memasukkan key apa pun. Teks diagonal `API KEY REQUIRED`, URL
`carto.com/basemaps`, atau atribusi `© CARTO` berarti APK itu masih membawa
layer CARTO lama. Build dari cabang `arena/01a03e4e-wjw` memakai tile resmi
OpenStreetMap, menampilkan atribusi OpenStreetMap, dan tidak memakai key
penyedia peta. Buat artifact baru dari branch tersebut, lalu ganti APK uji
lama. Periksa penanda waktu build di halaman depan untuk memastikan yang
terpasang bukan lagi artifact lama.

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

### Izinkan origin APK di API

Wadah Capacitor Android memuat aplikasi dari origin lokal yang aman,
`https://localhost`, lalu memanggil API HTTPS publik. Jadi API perlu
mengizinkan **hanya** origin tersebut melalui CORS:

```bash
WJW_CORS_ORIGINS=https://localhost,capacitor://localhost
```

Konfigurasi `fly.toml` WJW sudah menyetel nilai ini untuk deployment Fly.
Bila memakai server sendiri, tambahkan nilai yang sama ke `.env` lalu
restart server. Jangan gunakan `*`: API memakai token Bearer dan tidak
boleh mengizinkan situs sembarang membaca responsnya.

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
npm install @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7
```

**Sebutkan `@7`.** Diuji satu per satu pada Agustus 2026:

| Versi | Hasil `npm audit` |
|---|---|
| 6 | `tar` **critical** |
| **7** | **0 kerentanan** |
| 8 | `uuid` moderate lewat `xcode` |

Tanpa nomor versi, npm memasang v8 dan `npm audit` langsung memunculkan
peringatan. Perlu diketahui: kerentanan itu ada pada **perkakas
pembangun**, bukan pada aplikasi yang dihasilkan — tetapi tidak ada
alasan memakainya bila v7 bersih.

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
