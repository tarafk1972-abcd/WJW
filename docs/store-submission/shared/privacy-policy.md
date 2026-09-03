# Kebijakan Privasi — Warga Jaga Warga

**Tanggal berlaku:** `[GANTI: tanggal terbit]`
**Pemilik:** `[GANTI: nama badan / perorangan]`
**Kontak:** `[GANTI: email dukungan]`

Kebijakan ini menjelaskan data apa yang dikumpulkan aplikasi **Warga Jaga Warga** ("WJW", "kami"), untuk apa dipakai, kepada siapa dibagikan, dan bagaimana Anda mengendalikannya. Kebijakan ini berlaku untuk aplikasi Android, iOS, dan PWA di alamat `[GANTI: URL utama]`.

---

## 1. Data yang kami kumpulkan

### 1.1 Yang Anda berikan saat mendaftar
- Nama, email, dan sandi (di-hash bcrypt; sandi asli tidak pernah disimpan).
- Nama lingkungan/komunitas, alamat, kota — bila Anda pembuat lingkungan.
- Bahasa pilihan (`id`, `en`, atau `su`).

### 1.2 Yang Anda tambahkan sendiri
- **Profil darurat** (opsional): golongan darah, alergi, riwayat penyakit ringkas, kontak keluarga. Disimpan **terenkripsi AES-256-GCM** di server dan hanya ditampilkan ke petugas Satpam/Admin komunitas Anda saat Anda menekan tombol panik.
- Laporan kejadian, foto bukti, pesan pada insiden, kunjungan buku tamu.
- Titik patroli (Satpam) dan area lingkungan (Admin).

### 1.3 Yang dikumpulkan otomatis oleh aplikasi
- **Lokasi (GPS)**: hanya saat Anda menekan tombol panik, saat Satpam menjalankan patroli aktif, atau saat Admin menggambar area. WJW tidak melacak lokasi Anda di latar belakang.
- Perangkat: `deviceId` acak yang dibuat aplikasi (bukan IMEI/MAC), versi aplikasi, model perangkat, versi OS.
- Log koneksi: alamat IP, waktu permintaan, endpoint API. Disimpan maksimal **30 hari** untuk keamanan.

### 1.4 Yang tidak kami kumpulkan
- Nomor telepon (kecuali Anda memasukkannya di kontak darurat).
- Daftar kontak, foto galeri, kalender, atau riwayat panggilan.
- Data pelacakan iklan, cookie pihak ketiga, atau analitik pengguna oleh vendor eksternal.

---

## 2. Dasar hukum & tujuan pemakaian

| Tujuan | Dasar |
|---|---|
| Otentikasi & menjalankan aplikasi | Pelaksanaan kontrak |
| Meneruskan alarm panik ke Satpam/Admin komunitas | Kepentingan sah (keselamatan) & persetujuan Anda saat mengaktifkan panik |
| Menampilkan profil darurat kepada penolong | Kepentingan vital (keselamatan jiwa) |
| Menyimpan laporan & buku tamu | Pelaksanaan kontrak |
| Melihat lokasi patroli | Persetujuan (Satpam masuk mode patroli aktif) |
| Menjawab tiket dukungan | Kepentingan sah |

---

## 3. Siapa yang bisa melihat data Anda

- **Anggota komunitas yang sama** melihat: nama, peran, laporan publik yang Anda kirim di lingkungan, dan (saat panik aktif) profil darurat Anda.
- **Admin komunitas** melihat semua di atas + status keanggotaan + isi laporan.
- **Superadmin WJW** melihat metadata lingkungan (nama, jumlah anggota, status pembayaran) dan tiket dukungan yang Anda kirim; tidak melihat isi laporan dan foto komunitas.
- **Pihak ketiga**: tidak ada. Kami tidak menjual dan tidak membagi data ke pengiklan/broker data.
- Kami hanya menyerahkan data kepada aparat penegak hukum bila ada perintah tertulis yang sah.

---

## 4. Layanan pihak ketiga yang WJW gunakan

| Layanan | Data yang mengalir | Tujuan |
|---|---|---|
| OpenStreetMap tiles | Alamat IP + koordinat area yang ditampilkan | Menampilkan peta |
| `[GANTI: penyedia hosting server]` (Fly.io) | Semua data aplikasi (di server yang Anda percayakan) | Hosting API |
| `[GANTI: penyedia email transaksional, mis. Resend]` — bila diaktifkan | Email Anda + isi notifikasi | Kirim email undangan/tagihan |
| Layanan push (VAPID Web Push) | Endpoint push perangkat Anda | Notifikasi alarm |

Tidak ada Google Analytics, tidak ada Firebase Analytics, tidak ada iklan.

---

## 5. Penyimpanan & penghapusan

- Data akun aktif disimpan selama akun Anda aktif.
- Log koneksi: **30 hari**.
- Rekaman patroli Satpam: **6 hari**, lalu dihapus otomatis.
- Data insiden panik: selama komunitas ada atau sampai Admin menghapusnya.
- Setelah Anda meminta hapus akun, data pribadi dihapus dalam **30 hari** kecuali yang wajib disimpan oleh hukum (mis. bukti transaksi 10 tahun sesuai UU KUP di Indonesia).

**Permintaan hapus akun**: kirim email ke `[GANTI: email dukungan]` dari alamat email akun Anda, atau buka menu **Setelan → Hapus akun** di aplikasi. Sesuai kebijakan Google Play Data deletion dan Apple App Store, kami menyediakan URL hapus akun web tanpa perlu masuk aplikasi: `[GANTI: URL /hapus-akun]`.

---

## 6. Hak Anda

Sesuai UU 27/2022 tentang Pelindungan Data Pribadi (PDP) dan GDPR bagi pengguna di UE:

- **Akses**: Anda bisa mengunduh salinan data Anda dari **Setelan → Ekspor data**.
- **Perbaikan**: ubah data profil kapan saja di aplikasi.
- **Hapus**: seperti butir 5.
- **Batasi pemrosesan**: nonaktifkan tombol panik, buku tamu, atau patroli di Setelan.
- **Portabilitas**: berkas JSON pada ekspor data.
- **Keberatan / cabut persetujuan**: dengan menghapus akun.

Untuk keluhan, Anda juga berhak mengadu ke Kementerian Kominfo (Indonesia) atau otoritas data lokal Anda.

---

## 7. Anak-anak

WJW ditujukan untuk pengguna berusia **13 tahun ke atas**. Kami tidak sengaja mengumpulkan data anak di bawah 13. Bila Anda mengetahui hal ini terjadi, laporkan ke `[GANTI: email dukungan]` dan data terkait akan dihapus.

---

## 8. Keamanan

- Sandi disimpan sebagai hash bcrypt (biaya ≥ 10).
- Snapshot medis dan blob SOS sensitif dienkripsi AES-256-GCM di server (`WJW_DATA_ENCRYPTION_KEY`).
- Seluruh komunikasi antara aplikasi dan server memakai TLS 1.2+.
- Token akses berbasis Bearer, disimpan di penyimpanan aman perangkat.

Tidak ada sistem yang 100% aman. Bila terjadi kebocoran, kami akan memberi tahu pengguna terdampak dan Kominfo dalam **72 jam** sesuai UU PDP.

---

## 9. Perubahan kebijakan

Bila kebijakan berubah, versi baru diterbitkan di halaman ini dan Anda diberitahu di dalam aplikasi 14 hari sebelum berlaku.

---

## 10. Kontak

`[GANTI: nama badan/perorangan]`
`[GANTI: alamat pos, WAJIB untuk PDP & Play Store]`
Email: `[GANTI: email dukungan]`
Petugas Perlindungan Data (bila ada): `[GANTI: email DPO]`

---

## English summary (non-binding)

For users outside Indonesia: this policy is written in Indonesian and controls in case of conflict. In short: WJW collects the account data you enter, emergency profile data (encrypted, only shown to your community's guards/admins when you press panic), incident reports, and GPS location **only** during active panic or patrols. No ads, no third-party trackers, no data selling. Contact `[GANTI: support email]` for data access or deletion requests. Full English translation on request.
