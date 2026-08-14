# Memperbarui aplikasi di komputer Windows

Folder di komputer Anda (`D:\Program\WJW4\WJW`) adalah salinan terpisah
dari yang ada di GitHub. Perubahan yang dikerjakan lewat Arena masuk ke
GitHub lebih dulu, jadi folder Anda perlu ditarik agar ikut terbarui.

Kalau muncul pesan:

```
'git' is not recognized as an internal or external command
```

artinya **Git belum terpasang**. Pilih salah satu cara di bawah.

---

## Cara 1 — Pasang Git (disarankan)

Sekali pasang, seterusnya memperbarui cukup dua baris perintah.

### Memasang

Buka **Command Prompt**, lalu:

```
winget install --id Git.Git -e --source winget
```

Bila `winget` tidak tersedia, unduh pemasangnya dari
<https://git-scm.com/download/win> lalu jalankan (klik **Next** terus
sampai selesai; pengaturan bawaannya sudah benar).

**Tutup Command Prompt lalu buka lagi.** Ini wajib — jendela yang lama
belum mengenal perintah `git`. Uji dengan:

```
git --version
```

### Memperbarui

```
cd /d D:\Program\WJW4\WJW
git fetch origin arena/019fad5f-wjw
git status
```

Perhatikan hasil `git status`:

- **"nothing to commit, working tree clean"** → aman, lanjutkan.
- Ada daftar berkas → Anda punya perubahan yang belum tersimpan.
  Simpan dulu supaya tidak hilang:

  ```
  git stash
  ```

Baru kemudian:

```
git reset --hard origin/arena/019fad5f-wjw
npm install
```

> `git reset --hard` **menghapus perubahan lokal yang belum di-commit.**
> Karena itu periksa `git status` lebih dulu.

---

## Cara 2 — Unduh ZIP (tanpa memasang apa pun)

Cocok untuk sekali jalan, tetapi harus diulang penuh setiap kali ada
pembaruan, dan Anda tidak bisa mengirim perubahan kembali ke GitHub.

1. Buka <https://github.com/tarafk1972-abcd/WJW> — pastikan sudah login,
   karena repositori ini privat.
2. Klik tombol pemilih cabang (bertuliskan `main`), pilih
   **`arena/019fad5f-wjw`**.
3. Klik tombol hijau **Code** → **Download ZIP**.
4. Ekstrak isinya. **Ganti nama folder lama Anda dulu** (misalnya jadi
   `WJW-lama`) supaya tidak tertimpa dan masih bisa dilihat bila perlu.
5. Masuk ke folder hasil ekstrak, lalu:

   ```
   npm install
   ```

Berkas `.env` **tidak ikut** di dalam ZIP (memang sengaja, isinya
rahasia). Salin `.env` dari folder lama Anda ke folder yang baru.

---

## Menjalankan aplikasi

Cara termudah — satu perintah, keduanya jalan:

```
cd /d D:\Program\WJW4\WJW
npm run dev:all
```

Atau **dua jendela Command Prompt** terpisah:

Jendela 1 — API:

```
cd /d D:\Program\WJW4\WJW
npm run server
```

Jendela 2 — tampilan web:

```
cd /d D:\Program\WJW4\WJW
npm run dev
```

Lalu buka <http://localhost:5173>.

> Jangan menyalin komentar seperti `# Terminal 1` ke dalam Command
> Prompt. Berbeda dengan Linux, Windows tidak menganggapnya catatan
> melainkan ikut dijalankan, sehingga muncul galat.

---

## Memastikan versinya sudah yang terbaru

Buka **Langganan** (`#/app/billing`) sebagai admin. Setelah pembaruan
berhasil, halaman itu harus:

- **tidak** punya pilihan "Metode pembayaran",
- **tidak** punya kolom isian nomor referensi,
- **tidak** menyebut "bukti transfer" atau "Riwayat pembayaran",
- menampilkan tombol **Buat tagihan**, lalu QRIS ShopeePay berikut nomor
  referensi yang dibuat sistem.

Bila salah satu dari yang lama masih terlihat, tekan **Ctrl+Shift+R**
di browser untuk memuat ulang tanpa cache.

Untuk memastikan versi lewat perintah (bila memakai Cara 1):

```
git log --oneline -1
```

Harus menampilkan `71664ac` atau yang lebih baru.
