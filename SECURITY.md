# Kebijakan Keamanan

Warga Jaga Warga menyimpan data yang sensitif bagi keselamatan penggunanya:
lokasi, profil medis darurat, dan peringatan SOS. Karena itu laporan kerentanan
ditangani serius dan **tidak melalui issue publik**.

## Melaporkan kerentanan

Kirim email ke **tarafk1972@gmail.com** dengan subjek `[WJW Security]`.

Mohon sertakan bila memungkinkan:

- langkah reproduksi (perintah/permintaan yang cukup agar kami bisa mengulang);
- dampak nyata (data siapa yang bisa dilihat/diubah/dihapus oleh siapa);
- lingkungan pengujian (browser, perangkat, dan build/tanggal aplikasi).

Balasan pertama diusahakan dalam **7 hari**. Bila setelah 14 hari tidak ada
tanggapan, kirimkan pengingat ke alamat yang sama. Setelah perbaikan rilis,
kami dengan senang hati menyebut pelapor (bila ia mau) dalam catatan rilis.

Jangan mengungkapkan detail kerentanan ke publik sebelum perbaikan tersedia.

## Yang paling kami hargai untuk dilaporkan

- Paparan atau perubahan data **lintas-lingkungan** (lintas-tenant) tanpa otorisasi;
- Pintasan yang melewati **persetujuan admin**, **verifikasi pembayaran**, atau
  **state machine insiden** (`NEW → … → RESOLVED`);
- Kebocoran **token sesi**, kredensial, atau berkas `.env`/kunci yang telanjur
  masuk repositori;
- XSS/CSRF yang berdampak pada akun warga, satpam, admin, atau superadminnya.

## Versi yang didukung

Hanya **commit terbaru branch `main`**. Tidak ada lini rilis lama yang dirawat;
pengguna self-hosted diminta mengikuti `main`.

## Alur setelah laporan diterima

1. Konfirmasi penerimaan ke pelapor.
2. Reproduksi & penilaian dampak; penanggulangan sementara bila perlu.
3. Perbaikan + tes regresi; rilis.
4. Kabar ke pelapor, lalu (sukarela dan terkoordinasi) pengungkapan publik.

Terima kasih telah membantu menjaga keselamatan warga.
