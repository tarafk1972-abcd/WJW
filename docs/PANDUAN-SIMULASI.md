# Panduan Simulasi — Warga Jaga Warga

Cara mencoba seluruh alur aplikasi tanpa perlu banyak HP.

---

## Persiapan (10 detik)

Buka aplikasi → tekan **"Isi data contoh"** di layar awal.

Ini membuat lingkungan **RW 05 Griya Soreang** lengkap dengan 8 anggota,
laporan, buku tamu, riwayat patroli, siaran, dan 2 pendaftar yang sedang
menunggu persetujuan. Anda langsung masuk sebagai **Budi (Admin)**.

### Akun demo

| Peran | Email | Sandi |
| --- | --- | --- |
| **Admin** (pendiri) | `budi@warga.id` | `warga123` |
| Admin kedua | `siti@warga.id` | `warga123` |
| **Satpam** | `joko@warga.id` | `warga123` |
| Satpam | `rahmat@warga.id` | `warga123` |
| **Warga** | `dewi@warga.id` | `warga123` |
| Warga | `agus@warga.id` | `warga123` |
| **Superadmin** | `tarafk1972@gmail.com` | `superadmin` |

Ganti akun: **Pengaturan → Keluar**, lalu **Masuk** dengan akun lain.

---

## Simulasi 1 — Tombol panik (2 menit)

Inti aplikasi. Lakukan sebagai **Dewi (warga)**.

1. Keluar, masuk sebagai `dewi@warga.id`.
2. Di tab **DARURAT** (layar utama), **tekan dan tahan** tombol merah besar.
   - Coba dulu **tekan sebentar lalu lepas** → tidak terjadi apa-apa.
     Ini pengaman alarm palsu.
   - Sekarang **tahan penuh 2 detik** sampai cincin putih memutar penuh.
3. Izinkan lokasi bila diminta. Peringatan langsung terkirim.
4. Perhatikan layar peringatan aktif:
   - Lokasi GPS terkunci + akurasi
   - "Lokasi langsung aktif" — titik terus bertambah
   - "Merekam suara 15 dtk…" berjalan otomatis
   - Profil & waktu kejadian tercatat
   - Daftar **penerima** beserta status "Terkirim"
5. Coba **Foto** / **Video**, dan pilih **jenis darurat**.

### Melihat sisi penerima

6. Keluar, masuk sebagai `joko@warga.id` (Satpam).
7. Di layar utama muncul spanduk merah berdenyut → tekan
   **"Saya menuju lokasi"**.
8. Buka insidennya: ada peta lokasi, **profil darurat** Dewi (golongan
   darah, alergi), dan kolom percakapan. Kirim pesan.
9. Kembali ke akun Dewi → status penerima berubah jadi **"Menuju lokasi"**,
   dan pesan Joko muncul.
10. Tutup dengan **"Saya sudah aman"** atau **"Alarm palsu — batalkan"**.

---

## Simulasi 2 — Tiga cara bergabung (3 menit)

### A. Buat lingkungan baru → jadi Admin

1. **Pengaturan → Reset data demo** (menghapus semua) → **Daftar**.
2. Pilih bahasa → **Buat lingkungan baru** → isi nama → isi profil.
3. Anda langsung **aktif sebagai Admin**, tanpa antre.

### B. Cari lingkungan → minta izin

1. Keluar → **Daftar** → **Cari lingkungan**.
2. Ketik `griya` atau `bandung` → pilih hasilnya.
3. Tulis pesan untuk admin → isi profil → **Ajukan permintaan gabung**.
4. Muncul layar **"Menunggu persetujuan admin"** — belum bisa masuk.
5. Masuk sebagai `budi@warga.id` → tab **Admin** → **Menunggu persetujuan**.
   Terlihat label *"Lewat pencarian"* dan pesan yang tadi ditulis.
6. Tekan **Konfirmasi** → pilih **Warga / Satpam / Admin** → **Terima**.

### C. Kode undangan / QR

1. Sebagai Budi: tab **Admin → Undangan → Ajak jadi Admin**.
2. Atur peran, masa berlaku, batas pakai → buat kode.
3. Muncul **QR code** + kode 6 huruf. Salin kodenya.
4. Keluar → **Daftar** → **Punya kode undangan** → tempel kode →
   **Periksa kode**.
5. Nama lingkungan muncul otomatis beserta peran yang diusulkan.
6. Lanjutkan → **tetap masuk antrean persetujuan admin**.
   Kode undangan tidak melewati antrean — ini disengaja.

> Untuk mencoba QR sungguhan, buka aplikasi di HP lalu pindai QR yang
> tampil di layar laptop.

---

## Simulasi 3 — Peta area (1 menit)

Sebagai **Budi (Admin)**:

1. Tab **Peta** → **Gambar area**.
2. **Ketuk peta** beberapa kali untuk membuat titik batas (minimal 3).
3. **Simpan area**.
4. Area kini tampil di aplikasi semua anggota. Laporan di luar poligon
   otomatis diberi label **"Di luar area lingkungan"**.

---

## Simulasi 4 — Siaran & konfirmasi keselamatan (2 menit)

1. Sebagai Budi: **Admin → Siaran darurat**.
2. Pilih tingkat **Darurat**, isi judul + instruksi keselamatan,
   centang **minta konfirmasi keselamatan** → kirim.
3. Keluar, masuk sebagai `dewi@warga.id` → di layar utama muncul kartu
   siaran → tekan **"Saya aman"** atau **"Butuh bantuan"**.
4. Kembali sebagai Budi → **Admin → Siaran**: terlihat rekap siapa aman,
   siapa butuh bantuan, siapa belum menjawab.

---

## Simulasi 5 — Jaringan bantuan (1 menit)

1. Sebagai Dewi: **Pengaturan → Jaringan bantuan saya**.
2. **Tambah kontak** → pilih **Keluarga** → isi nama & nomor.
3. Kontak ini sekarang menerima peringatan panik Dewi.
4. Tambahkan **Relawan** → statusnya *"Belum diverifikasi"*.
   Hanya admin yang bisa memverifikasi, dan sebelum itu ia **tidak**
   menerima peringatan.
5. Di layar DARURAT, angka **"Akan menerima peringatan"** ikut bertambah.

---

## Simulasi 6 — Superadmin (1 menit)

1. Keluar → masuk `tarafk1972@gmail.com` / `superadmin`.
2. **Konsol Superadmin**: ringkasan semua lingkungan, daftar admin,
   pembayaran, tiket bantuan, dan catatan aktivitas.
3. Buka **Lingkungan** → pilih RW 05 → bisa **perpanjang percobaan**
   atau **tangguhkan lingkungan**.
4. Buka **Tiket** → ada tiket dari Budi → balas sebagai customer service.

---

## Simulasi 7 — Langganan (1 menit)

1. Sebagai Budi: **Admin → Langganan**.
2. Terlihat sisa masa percobaan (11 hari pada data contoh).
3. Pilih paket → isi metode & nomor referensi → **Kirim konfirmasi**.
4. Masuk sebagai superadmin → **Pembayaran** → **Verifikasi**.
5. Kembali sebagai Budi → status berubah **Aktif** beserta tanggal berakhir.

---

## Mencoba dengan 2 perangkat sekaligus

Karena data disimpan per-browser, Anda bisa meniru dua orang berbeda:

- **Jendela biasa** = Budi (Admin)
- **Jendela penyamaran / browser lain** = Dewi (Warga)

Keduanya punya data terpisah, jadi cocok untuk melihat kedua sisi.

> Catatan: data belum tersinkron antar perangkat sungguhan — itu perlu
> backend. Untuk sekarang, simulasi cukup dilakukan lewat ganti akun.

---

## Mengulang dari awal

**Pengaturan → Reset data demo** menghapus seluruh data lokal dan
mengembalikan aplikasi ke keadaan baru.

---

## Catatan izin browser

| Fitur | Syarat |
| --- | --- |
| Lokasi GPS | Izinkan saat diminta |
| Rekaman suara 15 dtk | Izinkan mikrofon |
| Pindai QR | Izinkan kamera |

Kamera & mikrofon **hanya diizinkan browser di `localhost` atau HTTPS**.
Bila membuka lewat alamat IP jaringan (mis. `192.168.x.x`), fitur ini
diblokir browser — tombol panik, GPS, dan sisanya tetap berfungsi.

Aplikasi dirancang agar **izin yang ditolak tidak pernah membatalkan
pengiriman peringatan**.
