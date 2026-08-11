CARA TERMUDAH: unggah lewat aplikasi.

  Masuk sebagai superadmin (tarafk1972@gmail.com)
  -> Konsol -> tab Pembayaran -> "Unggah gambar QRIS"

Gambarnya tersimpan di basis data, jadi ikut terbawa saat aplikasi
dipindah atau dibangun ulang, dan langsung tampil di halaman Langganan
semua admin serta pada email tagihan. Nama pemilik akun juga bisa diisi
di layar yang sama.

---

CARA LAMA (masih didukung): taruh berkas di folder ini dengan nama

    qris.png

Cara mendapatkannya:
  ShopeePay -> Terima Uang / QRIS -> simpan gambar QR.

Bila ingin memakai URL lain (mis. CDN), set di .env:
    WJW_QRIS_IMAGE_URL=https://domain-anda.com/qris.png

Agar QR tampil di email, WJW_APP_URL harus diisi alamat publik aplikasi,
karena klien email tidak bisa membuka URL relatif.

Yang diunggah lewat aplikasi selalu menang atas berkas ini.
