# Memasang WJW di HP Android

Aplikasi ini bisa dipasang ke layar utama tanpa Play Store dan tanpa APK.
Setelah terpasang, tampilannya sama seperti aplikasi biasa: ada ikonnya
sendiri, tanpa bilah alamat peramban.

---

## Syarat yang harus dipenuhi lebih dulu

Menu "Instal aplikasi" **tidak akan muncul** bila salah satu ini belum
terpenuhi. Chrome tidak memberi pesan galat apa pun — menunya hanya
tidak ada, dan itu yang paling membingungkan.

| Syarat | Keterangan |
|---|---|
| **HTTPS** | Wajib. `http://` biasa ditolak, kecuali `localhost` di komputer yang sama |
| Alamat bisa dibuka dari HP | `localhost` di laptop **tidak** bisa dibuka dari HP |
| Memakai **Chrome** | Bukan peramban bawaan HP |

Bagian aplikasinya sendiri — manifest, ikon, dan service worker — sudah
disiapkan dan tidak perlu Anda urus.

---

## Kalau aplikasi belum ada di internet

Untuk mencoba dari HP yang sedang menumpang Wi-Fi yang sama dengan
laptop:

```
npm run dev:all
```

Perhatikan baris **Network** yang muncul, misalnya:

```
➜  Network: http://192.168.1.7:5173/
```

Buka alamat itu di Chrome HP.

> Dengan cara ini aplikasi **bisa dipakai**, tetapi **tidak bisa
> dipasang** — alamatnya `http://`, bukan `https://`. Untuk memasang,
> aplikasinya perlu berada di alamat HTTPS sungguhan.

---

## Cara memasang

1. Buka alamat aplikasi (yang **https://**) di **Chrome** pada HP
2. Tunggu halamannya termuat penuh
3. Ketuk tombol **⋮** di kanan atas
4. Pilih **Instal aplikasi**, atau **Tambahkan ke Layar utama**
5. Ketuk **Instal** pada kotak yang muncul

Ikon WJW akan muncul di layar utama.

Sering kali Chrome juga memunculkan sendiri tawaran "Instal aplikasi" di
bagian bawah layar setelah beberapa saat.

---

## Kalau menunya tidak muncul

Periksa berurutan:

**1. Sudah HTTPS?** Lihat alamat di Chrome. Bila diawali `http://` atau
berupa angka seperti `192.168.1.7`, pemasangan memang tidak akan
ditawarkan.

**2. Sudah pernah terpasang?** Bila iya, menunya berubah menjadi
"Buka aplikasi". Cek laci aplikasi HP Anda.

**3. Coba muat ulang.** Service worker perlu aktif lebih dulu. Tarik
layar ke bawah untuk memuat ulang, tunggu beberapa detik, lalu buka
menu ⋮ lagi.

**4. Bersihkan data situs.** Bila sebelumnya pernah dibuka saat aplikasi
belum siap, Chrome bisa mengingat keadaan lama:
Chrome → ⋮ → Setelan → Setelan situs → Data tersimpan → cari alamatnya →
Hapus.

**5. Pastikan memakai Chrome**, bukan peramban bawaan Samsung/Xiaomi.

---

## Setelah terpasang

Yang berjalan seperti aplikasi biasa:

- ikon sendiri di layar utama, tanpa bilah alamat;
- izin **lokasi** dan **notifikasi** diminta sekali, lalu diingat;
- notifikasi darurat tetap berbunyi walau aplikasi tertutup;
- tetap bisa dibuka saat sinyal hilang, meski datanya tidak termuat.

Yang perlu diketahui:

- **Data tetap datang dari server.** Bila server mati, aplikasi terbuka
  tetapi isinya kosong.
- **Pembaruan otomatis.** Setelah kode di server diperbarui, aplikasi
  ikut terbarui saat dibuka berikutnya — tidak perlu memasang ulang.

---

## Untuk iPhone

Chrome di iOS tidak punya menu itu. Gunakan **Safari**:

Safari → tombol **Bagikan** (kotak dengan panah ke atas) →
**Tambahkan ke Layar Utama**.

Perlu diketahui: notifikasi push di iOS hanya bekerja pada iOS 16.4 ke
atas, dan hanya setelah aplikasi dipasang ke layar utama.

---

## Kapan perlu APK?

Pemasangan PWA sudah cukup untuk uji coba di lapangan maupun pemakaian
sehari-hari di satu RW.

APK baru diperlukan bila Anda hendak menyebarkannya lewat Google Play
atau membagikan berkas pemasangan secara langsung. Caranya ada di
[BUAT-APK.md](BUAT-APK.md).
