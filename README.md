# Warga Jaga Warga (WJW)

Aplikasi keamanan lingkungan warga — PWA mobile-first (React + TypeScript + Vite).
Bahasa default **Indonesia**, dengan opsi Bahasa Inggris dan Basa Sunda.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build produksi ke dist/
npm test         # 44 tes (pendaftaran, peran, langganan, area, panik, kirim peringatan)
```


## MVP (Versi 1) — satu layar, satu tombol

Layar utama aplikasi (`/app`) hanya berisi **satu tombol merah besar**. Ditahan
2 detik (cincin progres), lalu peringatan langsung terkirim membawa:

| Data | Catatan |
| --- | --- |
| Lokasi GPS | Diambil sebelum peringatan dikirim, berikut akurasi (±m). |
| Lokasi langsung | `watchPosition` terus mengirim titik selama peringatan aktif; bisa dihentikan kapan saja. |
| Profil pengguna | Nama, HP, alamat, golongan darah, alergi, riwayat penyakit, kontak keluarga — dibekukan saat peringatan dibuat. |
| Jenis darurat | Opsional, dipilih **setelah** peringatan terkirim agar tidak memperlambat. |
| Rekaman suara 15 detik | Otomatis mulai setelah peringatan keluar. Mikrofon ditolak ≠ peringatan gagal. |
| Foto/video | Opsional, dilampirkan saat kejadian berlangsung (maks 8 MB). |
| Waktu kejadian | Dicatat otomatis. |

### Dikirim ke siapa

- Keluarga
- Teman terpercaya
- Responder komunitas terverifikasi
- Satpam
- Relawan

Kelola di **Jaringan bantuan saya** (`/app/network`). Keluarga & teman bersifat
pribadi per anggota; responder & relawan komunitas harus **diverifikasi admin**
sebelum menerima peringatan. Penerima bisa menekan *"Saya menuju lokasi"*, dan
pengirim melihat siapa saja yang sudah merespons.

> **Tidak ada integrasi polisi / layanan darurat.** Aplikasi ini sengaja tidak
> menghubungi 110/112/911 — itu menimbulkan kerumitan operasional dan regulasi.
> Peringatan hanya mengalir ke jaringan warga. Pengguna diingatkan lewat catatan
> tetap di layar utama untuk menghubungi pihak berwenang sendiri bila perlu.

### Pengaman alarm palsu

Tahan 2 detik, dan setelah terkirim tersedia **"Alarm palsu — batalkan"** serta
**"Saya sudah aman"**. Frame animasi yang tertinggal tidak bisa memicu
peringatan (dijaga session token + diuji).

## Aturan utama

| Aturan | Implementasi |
| --- | --- |
| Bahasa default Indonesia, bisa dipilih saat registrasi | `src/lib/i18n.ts` — kamus `id` / `en` / `su`. Bahasa dipilih di langkah 1 registrasi dan disimpan pada profil anggota (`member.language`), lalu jadi bahasa seluruh aplikasi. |
| Warga pertama otomatis jadi Admin | `register()` di `src/lib/db.ts` — pembuat lingkungan langsung `role: 'admin'`, `status: 'active'`. |
| Admin bisa mengajak Admin lain | Halaman Admin → tab **Undangan** → kode undangan berperan Admin/Satpam/Warga (berlaku 7 hari, sekali pakai). |
| Admin accept/reject anggota baru & menetapkan peran | Halaman Admin → tab **Menunggu persetujuan** → terima sebagai Warga / Satpam / Admin, atau tolak dengan alasan. |
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
  lib/     capture.ts (rekam suara 15 dtk + GPS langsung)
  ui/      BigSOS.tsx (tombol merah utama)  PanicGrid.tsx  Countdown.tsx
           SafetyCheck.tsx
  pages/   Landing  Register  Login  Pending  AppShell  Home  Reports
           MapPage  Guests  Patrol  Admin  Settings  Billing  Support  Console
           Panic (layar utama MVP)  Network  Broadcast  EmergencyProfile
  __tests__/  flow.test.tsx (alur UI)  rules.test.ts (aturan bisnis)
              panic.test.tsx (tombol panik)  alert.test.ts (isi & penerima peringatan)
```

## Catatan penyimpanan

Data disimpan di `localStorage` browser (`src/lib/db.ts`) sehingga aplikasi bisa
dijalankan tanpa backend. Seluruh akses data melewati fungsi-fungsi di `db.ts`,
jadi penggantian ke API/database nyata cukup dilakukan pada satu berkas itu.
