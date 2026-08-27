# Warga Jaga Warga (WJW)

Aplikasi keamanan lingkungan warga — PWA mobile-first (React + TypeScript + Vite).
Bahasa default **Indonesia**, dengan opsi Bahasa Inggris dan Basa Sunda.

## Menjalankan

Aplikasi ini punya dua bagian: API (port 8787) dan tampilan web
(port 5173). Keduanya harus berjalan.

```bash
npm install
npm run dev:all  # menjalankan API + web sekaligus (paling praktis)
```

Atau dua terminal terpisah:

```bash
npm run server   # terminal 1 — API di http://localhost:8787
npm run dev      # terminal 2 — web di http://localhost:5173
```

Keduanya harus hidup. Bila hanya `npm run dev` yang jalan, halaman tetap
terbuka tetapi tidak ada data — terminal akan menampilkan
`ECONNREFUSED 127.0.0.1:8787`, artinya API belum berjalan.

```bash
npm run build    # build produksi ke dist/
npm test         # tes otomatis
```

Pengguna Windows: jangan menyalin komentar `# ...` ke Command Prompt —
tidak dianggap catatan, melainkan ikut dijalankan dan menimbulkan galat.

Cara memperbarui salinan di Windows (termasuk bila `git` belum terpasang)
ada di [docs/UPDATE-DI-WINDOWS.md](docs/UPDATE-DI-WINDOWS.md).


## Memasang di ponsel

Buka alamat aplikasi di **Chrome Android** → menu ⋮ → **Instal aplikasi**.
Ikonnya muncul di layar utama dan berjalan tanpa bilah alamat.

Menu itu hanya muncul bila aplikasi dilayani lewat **HTTPS** — alamat
`http://192.168.x.x` dari jaringan lokal tidak bisa dipasang. Langkah
lengkap dan cara mengatasinya bila menunya tak muncul ada di
[docs/PASANG-DI-HP.md](docs/PASANG-DI-HP.md).

Untuk membuat berkas APK, lihat [docs/BUAT-APK.md](docs/BUAT-APK.md).

## Phase 1 — alur tanggap darurat yang utuh

Prioritas rilis ini adalah **satu alur keselamatan yang dapat dibuktikan
ujung-ke-ujung**, bukan menambah modul administrasi yang rapuh:

1. Warga aktif masuk dan melengkapi profil darurat.
2. Di `/app`, warga memilih kategori (medis, kebakaran, pencurian, dan lain-lain).
3. Tombol kategori wajib ditahan **1,5 detik** dengan progres visual.
4. Setelah tahan berhasil, muncul **jendela pembatalan lima detik**. Tidak ada
   pengiriman pada ketukan singkat atau pembatalan.
5. Setelah hitung mundur, aplikasi mencoba GPS cepat lalu mengirim `POST /api/alerts`
   dengan idempotency key. **Pesan sukses hanya ditampilkan setelah server membalas.**
   Bila jaringan/server tidak dapat dijangkau, layar tegas menyatakan darurat
   *belum terkirim*; tidak dibuat alarm lokal palsu.
6. Server membekukan profil saat kejadian, menentukan penerima dari tenant yang
   sama, menulis audit/timeline, dan memberi sinyal real-time SSE.
7. Satpam/Admin/penerima berwenang memilih **“Saya menuju lokasi”**; pelapor melihat
   responder. Petugas dapat menandai **di lokasi**, pesan, foto bukti, lalu selesai.
8. State kanonis adalah `NEW → ACKNOWLEDGED → RESPONDING → ON_SITE → RESOLVED`
   (atau `CANCELLED` untuk alarm palsu). Perpindahan ilegal ditolak server.

Lokasi presisi, snapshot medis, chat, foto, daftar penerima, dan timeline hanya
masuk ke state pelapor atau penanggap berwenang. Dengan
`WJW_DATA_ENCRYPTION_KEY`, snapshot serta blob SOS sensitif (foto/audio bukti,
jejak lokasi, pesan, responders, dan daftar penerima) disimpan AES-256-GCM dan
record lama yang valid dimigrasikan saat boot. Ini **bukan** klaim bahwa seluruh
SQLite telah terenkripsi: koordinat operasional relasional masih memerlukan
migrasi privasi khusus. Seluruh perubahan juga dibatasi `community_id` di backend.
Real-time memakai SSE autentikasi-header sebagai jalur utama, bukan polling.

> **Tidak ada integrasi polisi / layanan darurat.** WJW tidak menghubungi
> 110/112/911. Alarm mengalir ke jaringan komunitas yang telah ditentukan;
> pengguna tetap perlu menghubungi layanan resmi bila situasi memerlukannya.

### Fase berikutnya

Setelah simulasi lapangan Phase 1 lolos, perluasan dilakukan berurutan:

| Fase | Fokus |
| --- | --- |
| 2 | Laporan mencurigakan, siaran & konfirmasi keselamatan, patroli, pengunjung |
| 3 | Data warga, iuran/keuangan, surat, keluhan, pengumuman |
| 4 | Voting, kampanye/donasi, arisan dan rukun kematian |
| 5 | Bantuan AI serta administrasi SaaS dan observabilitas skala besar |

Panduan operasi/deploy Fly.io dan backup ada di
[docs/FLY-IO.md](docs/FLY-IO.md); checklist risiko sebelum dipakai sungguhan ada
di [docs/KESIAPAN-PRODUKSI.md](docs/KESIAPAN-PRODUKSI.md).

## Cara gabung atau buat lingkungan

Saat mendaftar, pengguna memilih **satu dari tiga jalur** (langkah 2 dari 4):

| Jalur | Alur | Hasil |
| --- | --- | --- |
| **Punya kode undangan** | Ketik kode 6 karakter **atau pindai QR** dari pengurus. Kode divalidasi langsung. | Masuk antrean, **tetap perlu persetujuan admin**. Kode hanya *mengusulkan* peran. |
| **Cari lingkungan** | Cari berdasarkan nama / kota / alamat, pilih hasilnya, tulis pesan untuk admin. | Masuk antrean sebagai Warga, **perlu persetujuan admin**. |
| **Buat lingkungan baru** | Isi nama, alamat, kota. | Langsung aktif sebagai **Admin** pendiri. |

**Semua permintaan gabung harus disetujui admin** — termasuk yang memakai kode
undangan. Kode undangan hanya mempercepat (mengisi lingkungan otomatis dan
mengusulkan peran), bukan melewati antrean.

### Kode & QR undangan

Admin membuat undangan di **Admin → Undangan**:

- Kode 6 karakter tanpa huruf/angka rancu (tanpa `O`, `0`, `I`, `1`).
- **QR code** siap dipindai, plus tautan `#/join/<KODE>` yang membuka
  pendaftaran dengan kode terisi otomatis.
- Atur masa berlaku (1/3/7/30 hari) dan batas pemakaian (1/5/10/25 atau tanpa
  batas). Bisa **dicabut** kapan saja.
- Tombol *Bagikan* memakai Web Share API bila tersedia, jika tidak menyalin ke papan klip.

Pemindaian QR memakai kamera belakang; bila kamera ditolak tersedia opsi
**unggah gambar QR** dan pengetikan kode manual.

### Yang dilihat admin

Di antrean persetujuan, setiap pendaftar menampilkan **cara bergabung**
(lewat kode undangan / lewat pencarian), kode yang dipakai, dan pesan yang
ditulis pendaftar. Peran yang diusulkan undangan otomatis terpilih, dan admin
tetap bebas mengubahnya ke Warga / Satpam / Admin sebelum menerima.

## Aturan utama

| Aturan | Implementasi |
| --- | --- |
| Bahasa default Indonesia, bisa dipilih saat registrasi | `src/lib/i18n.ts` — kamus `id` / `en` / `su`. Bahasa dipilih di langkah 1 registrasi dan disimpan pada profil anggota (`member.language`), lalu jadi bahasa seluruh aplikasi. |
| Warga pertama otomatis jadi Admin | `register()` di `src/lib/db.ts` — pembuat lingkungan langsung `role: 'admin'`, `status: 'active'`. |
| Admin bisa mengajak Admin lain | Halaman Admin → tab **Undangan** → kode + QR berperan Admin/Satpam/Warga, masa berlaku & batas pakai diatur, bisa dicabut. |
| Admin accept/reject anggota baru & menetapkan peran | Halaman Admin → tab **Menunggu persetujuan** → terima sebagai Warga / Satpam / Admin, atau tolak dengan alasan. Berlaku untuk semua jalur gabung, termasuk kode undangan. |
| Admin menentukan area lewat peta | Halaman **Peta** → *Gambar area*: ketuk peta untuk menambah titik batas, simpan. Poligon langsung tampil di aplikasi semua anggota, dan laporan dicek di dalam/luar area (`pointInPolygon`). |
| Setelah disetujui, tombol daftar diganti sapaan | `src/pages/Landing.tsx` — jika `deviceId` cocok dengan anggota berstatus aktif, tombol *Daftar* hilang dan muncul **“Apa kabar hari ini, &lt;nama&gt;?”**. |
| `tarafk1972@gmail.com` = superadmin | Akun dibuat otomatis (`ensureSuperadmin`). Login → **Konsol Superadmin**: pantau lingkungan & admin, verifikasi pembayaran, jawab tiket CS, catatan aktivitas. |
| Aplikasi berbayar, percobaan gratis 14 hari | `TRIAL_DAYS = 14`. Status langganan dihitung `planState()`; setelah habis muncul banner dan halaman **Langganan** (bulanan / tahunan), pembayaran diverifikasi superadmin. |

## Peran

- **Superadmin** — mengawasi semua lingkungan, verifikasi pembayaran, customer service.
- **Admin** — menyetujui anggota, menetapkan peran, menggambar area, pengumuman, langganan.
- **Satpam** — buku tamu, patroli berikut titik pantau, menangani laporan.
- **Warga** — tombol panik, lapor kejadian, lihat peta & pengumuman.

## Fitur

### Tanggap darurat (terinspirasi SaferWatch)

- **Tombol panik tekan-tahan** — enam jenis darurat (Pencurian, Keributan,
  Darurat Medis, Kebakaran, Banjir, Lainnya). Wajib ditahan 1,5 detik dengan
  cincin progres, lalu ada **hitung mundur 5 detik untuk membatalkan**, supaya
  tidak ada alarm palsu karena tidak sengaja tersentuh.
- **Profil darurat** — golongan darah, alergi, riwayat penyakit, dan kontak
  keluarga; otomatis ditampilkan ke Satpam/Admin saat panik ditekan.
- **Insiden langsung** — spanduk merah berdenyut di beranda, tombol
  *"Saya menuju lokasi"*, daftar petugas yang merespons, dan **percakapan dua
  arah** berikut foto bukti di dalam setiap insiden.
- **Kirim info (anonim)** — warga bisa melaporkan hal mencurigakan (narkoba,
  perusakan, orang hilang, dll.) tanpa menampilkan namanya ke anggota lain.
- **Siaran darurat + konfirmasi keselamatan** — admin mengirim notifikasi massal
  bertingkat (Informasi / Peringatan / Darurat) berisi instruksi keselamatan,
  lalu warga menjawab **"Saya aman"** atau **"Butuh bantuan"**; admin melihat
  rekapnya secara langsung.

### Lainnya

Laporan kejadian 11 kategori dengan status terbuka/ditangani/selesai · peta
lingkungan (Leaflet + OpenStreetMap) dengan editor area · buku tamu
masuk/keluar · patroli satpam dengan jejak dan titik pantau · pengumuman ·
kontak darurat · tiket dukungan ke superadmin.

> Catatan: berbeda dengan SaferWatch, aplikasi ini **tidak** terhubung ke 911/112
> atau kepolisian. Semua peringatan hanya mengalir ke jaringan warga.

## Akun demo

Tekan **“Isi data contoh”** di layar awal untuk membuat lingkungan contoh
(*RW 05 Griya Soreang*) lengkap dengan anggota, laporan, tamu, dan patroli.

| Peran | Email | Sandi |
| --- | --- | --- |
| Superadmin | `tarafk1972@gmail.com` | `superadmin` |
| Admin | `budi@warga.id` | `warga123` |
| Satpam | `joko@warga.id` | `warga123` |
| Warga | `dewi@warga.id` | `warga123` |

## Struktur

```
src/
  lib/     types.ts  db.ts (data + aturan bisnis)  i18n.ts  store.tsx  format.ts  seed.ts
  ui/      Icon.tsx  MapView.tsx  Sheet.tsx  Toast.tsx
  lib/     capture.ts (GPS satu kali + pembaruan lokasi saat SOS aktif)
           realtime.ts (SSE fetch-stream terautentikasi)
  ui/      PanicGrid.tsx (tahan 1,5 dtk)  Countdown.tsx (batal 5 dtk)
           BigSOS.tsx (komponen kompatibilitas lama)
           SafetyCheck.tsx  QrCode.tsx  QrScanner.tsx
  pages/   Landing  Register  Login  Pending  AppShell  Home  Reports
           MapPage  Guests  Patrol  Admin  Settings  Billing  Support  Console
           Panic (layar utama MVP)  Network  Broadcast  EmergencyProfile
  __tests__/  flow.test.tsx (alur UI)  rules.test.ts (aturan bisnis)
              panic.test.tsx (tombol panik)  alert.test.ts (isi & penerima peringatan)
              join.test.ts (tiga jalur gabung)  qr.test.tsx
```

## Catatan penyimpanan

Data disimpan di `localStorage` browser (`src/lib/db.ts`) sehingga aplikasi bisa
dijalankan tanpa backend. Seluruh akses data melewati fungsi-fungsi di `db.ts`,
jadi penggantian ke API/database nyata cukup dilakukan pada satu berkas itu.
