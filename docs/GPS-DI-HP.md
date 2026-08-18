# GPS tidak jalan di HP (ronda tidak bisa direkam)

## Gejala

Satpam membuka aplikasi di HP lewat Wi-Fi, misalnya
`http://192.168.1.5:5173`, lalu berdiri tepat di titik ronda — tetapi
tombol **Rekam ronda** tidak pernah berhasil. Kadang tidak ada
permintaan izin lokasi sama sekali.

## Sebabnya

Peramban hanya mengizinkan GPS pada **konteks aman**:

| Alamat | GPS |
|---|---|
| `https://apa-pun` | ✅ boleh |
| `http://localhost:5173` | ✅ boleh (dianggap aman) |
| `http://192.168.1.5:5173` | ❌ **diblokir** |

Ini aturan peramban, bukan kesalahan aplikasi atau HP. Chrome bahkan
tidak menampilkan permintaan izin — panggilan GPS langsung ditolak.
Karena itu menunggu, keluar-masuk aplikasi, atau mengaktifkan ulang
lokasi di HP tidak akan pernah menolong.

Aturan yang sama berlaku untuk **kamera** dan **notifikasi**, jadi
gejalanya sering muncul bersamaan.

## Jalan keluar cepat: `npm run dev:https`

Untuk menguji di lapangan hari ini, jalankan:

```
npm run dev:https
```

Skrip itu membuat sertifikat sendiri untuk alamat Wi-Fi komputer Anda,
lalu menjalankan aplikasi + API di atas HTTPS. Alamatnya dicetak di
layar, misalnya:

```
https://192.168.1.5:5173
```

Saat pertama dibuka, HP memperingatkan **"Not secure"** atau
**"Sambungan Anda tidak privat"**. Itu wajar: sertifikatnya Anda buat
sendiri, bukan dari lembaga resmi. Pilih **Advanced / Lanjutan** →
**Proceed / Lanjutkan**. Cukup sekali per HP.

Setelah itu GPS ronda berfungsi.

> Butuh OpenSSL. Di Windows, OpenSSL sudah ikut terpasang bersama Git —
> bila skripnya gagal, jalankan lewat **Git Bash**.

Berkas sertifikat disimpan di `.cert/` dan sudah masuk `.gitignore`.
Jangan pernah di-commit.

## Untuk pemakaian sungguhan

Sertifikat buatan sendiri tidak cocok dibagikan ke warga: setiap orang
akan melihat peringatan menakutkan, dan mengajari warga menekan
"Lanjutkan" pada peringatan keamanan adalah kebiasaan buruk.

Untuk dipakai warga sungguhan, aplikasi perlu:

1. **Domain** (mis. `wargajagawarga.app`)
2. **Sertifikat asli** — gratis lewat Let's Encrypt
3. **Server publik** yang menyajikan aplikasi + API

Tanpa itu, aplikasi hanya bisa dipakai di dalam satu Wi-Fi, dan PWA
tidak bisa dipasang ("Instal aplikasi" juga menuntut HTTPS).

## Kalau GPS tetap gagal padahal sudah HTTPS

Urutan yang perlu diperiksa:

1. **Izin lokasi ditolak** — di Chrome: ikon gembok di bilah alamat →
   Izin → Lokasi → Izinkan, lalu muat ulang.
2. **Lokasi mati di tingkat HP** — nyalakan GPS di setelan Android.
3. **Terlalu jauh dari titik** — aplikasi menampilkan jaraknya. Radius
   titik bisa diperlebar admin di menu Titik ronda.
4. **Sinyal GPS lemah di dalam bangunan** — akurasi buruk sudah diberi
   kelonggaran otomatis, tetapi di dalam gedung beton GPS bisa meleset
   puluhan meter. Coba di luar ruangan.

Admin selalu bisa mencatat ronda secara manual bila GPS benar-benar
tidak bisa dipakai.
