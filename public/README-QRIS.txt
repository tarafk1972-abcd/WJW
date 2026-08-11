Letakkan gambar QRIS ShopeePay Anda di folder ini dengan nama:

    qris.png

Gambar itu akan tampil di halaman Langganan dan di email tagihan.

Cara mendapatkannya:
  ShopeePay → Terima Uang / QRIS → simpan gambar QR.

Bila ingin memakai URL lain (mis. CDN), set di .env:
    WJW_QRIS_IMAGE_URL=https://domain-anda.com/qris.png

Agar QR tampil di email, WJW_APP_URL harus diisi alamat publik aplikasi,
karena klien email tidak bisa membuka URL relatif.
