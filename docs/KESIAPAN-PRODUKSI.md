# Kesiapan Produksi — Warga Jaga Warga

Penilaian jujur per 28 Agustus 2026.

## Kesimpulan singkat

**Belum layak dijanjikan sebagai pengganti layanan darurat sungguhan.**
Phase 1 kini memiliki alur teknis server-confirmed dari tahan tombol sampai
responder/timeline, tetapi keselamatan manusia masih bergantung pada operator,
koneksi, perangkat, uji lapangan, dan kepatuhan hukum.

Build dan suite otomatis harus dijalankan pada setiap rilis (`npm run build`,
`npm test`); jangan mengandalkan angka tes historis sebagai bukti kesiapan.

---

## Deployment Phase 1 di Fly.io

`Dockerfile`, `fly.toml`, health check `/api/health`, persistent volume
`/data`, dan panduan backup tersedia di [FLY-IO.md](FLY-IO.md). Konfigurasi
mempertahankan satu Machine selalu hidup untuk menghindari cold start SOS.

Ini bukan HA multi-region: satu volume SQLite dan broker SSE in-memory adalah
batas sadar Phase 1. Volume Fly bukan backup; operator wajib menjalankan backup
enkripsi di luar Fly dan latihan restore.

---

## Tiga penghalang lama — sudah selesai

Ketiganya dulu menjadi alasan utama aplikasi ini belum boleh dipakai.

| Dulu | Sekarang |
|---|---|
| Data hanya di `localStorage`, tidak sampai ke HP lain | Server Hono + SQLite; peringatan, pendaftaran, ronda, dan langganan tersimpan terpusat |
| Peringatan tidak berbunyi bila aplikasi tertutup | Web Push + service worker tersedia, tetapi delivery tetap best effort dan harus diuji per perangkat |
| Sandi disimpan apa adanya | bcrypt, tidak pernah dikirim balik ke klien |
| Alarm bisa tergandakan / status bebas diubah | Idempotency key, state machine server, audit dan timeline immutable |
| Pembaruan antar-HP mengandalkan polling | SSE terautentikasi per tenant; klien mengambil ulang state RBAC-filtered |

Yang juga sudah tersambung ke server: status peringatan, utas pesan
insiden, foto bukti, letak rumah warga, dan gambar QRIS. Saat
`WJW_DATA_ENCRYPTION_KEY` tersedia, snapshot/profil medis dan blob SOS sensitif
(foto/audio bukti, jejak lokasi, pesan, responders, serta daftar penerima)
dienkripsi AES-256-GCM; record SOS JSON lama yang valid dimigrasikan saat boot.
Startup produksi gagal bila secret kuncinya tidak ada.

---

## Yang masih menghalangi pemakaian nyata

### 1. Belum pernah diuji di lapangan

Semua pengujian sejauh ini otomatis, di satu mesin. Belum ada satu pun
percobaan dengan satpam dan warga sungguhan, di lingkungan sungguhan,
dengan sinyal yang naik-turun.

Ini yang paling menentukan, dan tidak bisa digantikan oleh tes.

### 2. Tidak ada jalur cadangan saat internet mati

Bila jaringan padam, peringatan **tidak boleh diklaim terkirim** dan aplikasi
secara eksplisit memberi tahu warga bahwa SOS belum sampai server. Ini lebih
aman daripada membuat laporan lokal palsu, tetapi tetap berarti layanan perlu
SOP cadangan nyata: telepon, SMS, HT/pos satpam, atau WhatsApp yang dikelola
komunitas.

### 3. Kepatuhan UU PDP No. 27/2022

Aplikasi menyimpan data lokasi dan kesehatan (golongan darah, alergi,
riwayat penyakit). Perlu kebijakan privasi tertulis dan persetujuan yang
tercatat — bukan sekadar tombol di Pengaturan.

### 4. Enkripsi at-rest belum mencakup seluruh lokasi operasional

Enkripsi aplikasi kini menutup blob SOS yang paling kaya isi: snapshot,
foto/audio bukti, track, pesan, responders, dan daftar penerima. Namun ini
**bukan enkripsi penuh basis data**. Kolom relasional yang masih plaintext
mencakup setidaknya `reports.at_lat/at_lng`, `members.last_lat/last_lng`,
`members.home_lat/home_lng`, alamat rumah, dan koordinat log ronda. Kolom ini
masih diperlukan oleh implementasi saat ini untuk memilih warga terdekat atau
operasi lapangan cepat.

Keputusan saat ini adalah **tidak** mengenkripsi kolom itu secara tambal-sulam:
melakukannya tanpa indeks kandidat spasial yang aman akan memaksa server
mendekripsi semua warga tenant setiap ada SOS, mengorbankan hitungan detik yang
justru dibutuhkan pada darurat dan tidak memenuhi target skala. Sebelum mengaku
perlindungan at-rest menyeluruh, diperlukan migrasi privasi tersendiri yang
mencakup blob koordinat presisi terenkripsi, indeks sel kasar/tenant-scoped atau
PostGIS untuk memilih kandidat tanpa membuka semua titik, TTL posisi terbaru,
retensi/penghapusan bukti, migrasi dual-read teruji, dan prosedur rotasi kunci.

### 5. Pembatasan laju — sudah ada, tetapi sederhana

Login dan pendaftaran kini dibatasi per alamat IP (`server/ratelimit.ts`).
Batasnya sengaja longgar, karena satu RW berbagi satu alamat publik:
membatasi terlalu ketat akan mengunci tetangga sungguhan yang mendaftar
bersama-sama seusai rapat lingkungan.

Yang perlu diketahui tentang batas ini:

- penghitungnya di memori, jadi hilang saat server dijalankan ulang, dan
  tidak berlaku bila nanti berjalan di banyak proses;
- ia mencegah pembanjiran mesin, bukan serangan yang sabar dan pelan;
- perlindungan sesungguhnya atas sandi tetap bcrypt, dan atas
  pendaftaran palsu tetap persetujuan admin.

Bisa disetel lewat `.env`: `WJW_RATE_LOGIN_MAX`, `WJW_RATE_REGISTER_MAX`.

### 6. Perubahan luring rutin bukan antrean terjamin

Cache layar dapat bertahan di perangkat, tetapi perubahan rutin belum memiliki
outbox/transaksi sinkronisasi penuh. Khusus SOS, ini sengaja **bukan** antrean:
insiden harus dibalas server pada saat warga memicunya, atau UI menyatakan belum
terkirim. Jangan membangun fungsi finansial/administrasi kritis di atas cache
luring sebelum outbox, konflik, dan auditnya dirancang.

---

## Berbagi posisi untuk memanggil warga terdekat

Lokasi **hanya diambil saat ada peringatan darurat berlangsung**. Di luar
itu aplikasi tidak menyentuh GPS sama sekali, sehingga posisi warga tidak
pernah terkumpul pada hari-hari biasa.

Alurnya:

1. Seorang warga menekan tombol darurat.
2. Server menandai lingkungan itu sedang darurat.
3. Aplikasi warga lain melihat tanda itu pada sinkronisasi berikutnya,
   mengambil **satu** titik lokasi, lalu mengirimkannya.
4. Server memanggil yang terdekat, dan melupakan titiknya setelah
   10 menit.

Pembatas lain:

- satu titik per anggota, menimpa yang sebelumnya — bukan riwayat;
- paling cepat satu kiriman per menit;
- warga bisa mematikannya lewat **Pengaturan → Privasi**, dan titiknya
  langsung dihapus dari server;
- posisi tidak pernah dikirim ke sesama warga — hanya dipakai server
  untuk memutuskan siapa yang dikabari.

### Letak rumah — agar aplikasi tertutup tetap terhitung

Selain posisi terkini, setiap warga punya **satu titik letak rumah**.
Bila saat darurat tidak ada posisi terkini (aplikasinya tertutup),
jaraknya dihitung dari rumah itu. Dengan begitu warga tetap terpanggil
sebagai tetangga terdekat.

Titik rumah dicatat **sekali saja, saat mendaftar** — warga biasanya
sedang di rumahnya ketika itu.

Bila titiknya meleset (mis. GPS buruk waktu mendaftar), warga
memperbaikinya lewat **Pengaturan → Privasi → Letak rumah → Tandai di
sini**. Titik yang ditandai sendiri tidak akan tergeser oleh pencatatan
otomatis.

Rumah tidak berpindah, jadi satu titik cukup: tidak ada pembacaan ulang
berkala dan tidak ada pelacakan pergerakan sama sekali.

### Batas teknis yang tidak bisa diatasi

**Aplikasi tidak bisa mengambil lokasi saat benar-benar tertutup.**
Permintaan semula adalah mengirim posisi pukul 03.00 walau aplikasi
tertutup. Itu tidak mungkin di aplikasi web: `navigator.geolocation`
hanya ada pada `Navigator` (jendela peramban), sedangkan service worker
memakai `WorkerNavigator` yang tidak punya properti itu sama sekali.
Tidak ada jalan memutarnya — bukan soal izin, melainkan API-nya memang
tidak tersedia di sana.

Karena itu dipakai letak rumah: hasilnya sama untuk tujuan Anda —
warga dengan aplikasi tertutup tetap terhitung sebagai tetangga terdekat
— tanpa bergantung pada kemampuan yang tidak dimiliki peramban.

Konsekuensi yang harus disadari: bila jarak dihitung dari rumah, orangnya
**belum tentu sedang berada di sana**. Notifikasinya karena itu berbunyi
"… m dari rumah Anda", bukan "… m dari Anda".

Untuk benar-benar mengambil lokasi saat aplikasi tertutup, satu-satunya
jalan adalah aplikasi Android/iOS asli — bukan PWA.

### Belum dikerjakan

- **Persetujuan tertulis (UU PDP No. 27/2022).** Lokasi termasuk data
  pribadi. Tombol di Pengaturan belum memadai sebagai persetujuan yang
  tercatat.
- **Bawaannya aktif.** Perlu diputuskan apakah sebaiknya sebaliknya.
- **Belum ada penghapusan berkala** atas titik kedaluwarsa; saat ini
  hanya diabaikan, bukan dihapus dari basis data.

## Utas insiden

Balasan pada sebuah peringatan kini tersimpan di server lewat
`POST /api/alerts/:id/messages`, sehingga terlihat oleh pelapor dan para
penanggap, dan tidak hilang bila data perangkat dibersihkan. Peserta lain
juga menerima notifikasi setiap ada pesan baru.

Yang boleh menulis: pelapor, penerima peringatan, satpam, dan pengurus —
sama seperti yang boleh menutup peringatan. Anggota lingkungan lain
ditolak.

Status peringatan juga tersimpan di server: "Saya menuju lokasi" menulis
lewat `/api/alerts/:id/respond`; status `ON_SITE`, `RESOLVED`, dan
`CANCELLED` lewat `/api/alerts/:id/status`. Endpoint `/ack` dan `/close`
dipertahankan hanya untuk aplikasi lama.

**Foto bukti** juga sudah tersimpan di server lewat
`POST /api/alerts/:id/attachments`, dengan izin yang sama. Gambar
dikecilkan di klien (sisi terpanjang 720 px), tetapi batasnya ditegakkan
di server karena klien bisa diubah siapa saja:

- hanya JPEG, PNG, atau WebP — berkas lain ditolak;
- maksimal 600 KB per lampiran;
- maksimal 12 lampiran per laporan.

Yang masih perlu diperhatikan:

- **Gambar disimpan sebagai data URL di dalam basis data**, bukan sebagai
  berkas terpisah. Sederhana dan cukup untuk skala satu RW, tetapi bila
  jumlah laporan tumbuh besar sebaiknya dipindah ke penyimpanan berkas
  atau object storage.
- **Belum ada penyuntingan atau penghapusan** pesan maupun lampiran yang
  sudah terkirim.
- Utas dibatasi 500 pesan; yang terlama dibuang saat penuh.
