# Warga Jaga Warga (WJW)

Aplikasi keamanan lingkungan warga — PWA mobile-first (React + TypeScript + Vite).
Bahasa default **Indonesia**, dengan opsi Bahasa Inggris dan Basa Sunda.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build produksi ke dist/
npm test         # 20 tes (alur pendaftaran, peran, langganan, area)
```

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

Tombol panik (SOS) dengan lokasi · laporan kejadian 8 kategori dengan status
terbuka/ditangani/selesai · peta lingkungan (Leaflet + OpenStreetMap) dengan
editor area · buku tamu masuk/keluar · patroli satpam dengan jejak dan titik
pantau · pengumuman · kontak darurat · tiket dukungan ke superadmin.

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
  pages/   Landing  Register  Login  Pending  AppShell  Home  Reports
           MapPage  Guests  Patrol  Admin  Settings  Billing  Support  Console
  __tests__/  flow.test.tsx (alur UI)  rules.test.ts (aturan bisnis)
```

## Catatan penyimpanan

Data disimpan di `localStorage` browser (`src/lib/db.ts`) sehingga aplikasi bisa
dijalankan tanpa backend. Seluruh akses data melewati fungsi-fungsi di `db.ts`,
jadi penggantian ke API/database nyata cukup dilakukan pada satu berkas itu.
