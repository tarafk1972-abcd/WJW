# App Review Notes & Akun Demo (iOS & Android)

Kedua toko meminta reviewer bisa membuka & memakai aplikasi tanpa nomor telepon lokal, kartu kredit, atau bukti tinggal di Indonesia. Sertakan **catatan review + akun demo** berikut.

---

## Akun demo (sudah ada di seed data repo)

| Peran | Email | Sandi |
|---|---|---|
| Superadmin | `tarafk1972@gmail.com` | `superadmin` |
| Admin | `budi@warga.id` | `warga123` |
| Satpam | `joko@warga.id` | `warga123` |
| Warga | `dewi@warga.id` | `warga123` |

**PENTING sebelum submit:**

1. **Jangan kirim `tarafk1972@gmail.com` ke reviewer** — itu superadmin sungguhan Anda. Buat akun terpisah:
   - Email: `reviewer-apple@[GANTI: domain]` (dan `reviewer-play@...`)
   - Sandi: `[GANTI: sandi kuat, catat di tools review]`
   - Role: Admin di komunitas demo `RW 05 Griya Soreang`.

2. Pastikan seed data (`Isi data contoh` di layar Landing) sudah terisi di **server produksi**, tidak hanya localStorage. Ini penting karena reviewer akan uji dari perangkat mereka.

3. Bila di build sudah ada tombol **"Isi data contoh"** di layar awal, tulis di catatan review "Tap 'Isi data contoh' on the landing page to populate demo neighbourhood".

---

## Notes untuk App Review (App Store Connect)

Salin ke **App Review Information → Notes**:

```
Warga Jaga Warga (WJW) is a community-safety app for Indonesian neighbourhoods (RT/RW). It is not connected to 110/112 or any emergency service. All alerts flow to a private community network.

HOW TO TEST
1. Open the app. On the Landing screen, tap "Isi data contoh" (Fill demo data) to seed a demo neighbourhood.
2. Login with:
   Email: reviewer-apple@[GANTI: domain]
   Password: [GANTI]
   (This account has Admin role in the demo neighbourhood.)
3. To test the panic button:
   a. Bottom tab → "Panik".
   b. Long-press "Darurat Medis" for 1.5 seconds. A radial progress will fill.
   c. A 5-second cancel window appears — let it count down.
   d. The app requests GPS permission (please Allow).
   e. Incident is created; you will see a red banner and can tap "Saya menuju lokasi".
4. To test reporting: bottom tab → "Lapor" → pick a category → submit.
5. To test the visitor log & patrol as Satpam, log out and sign in as:
   Email: joko@warga.id
   Password: warga123

SUBSCRIPTIONS
This app offers subscriptions verified manually by the operator (bank transfer / QRIS). There is no in-app purchase flow inside the app — users upload a bank slip which the operator verifies. This is consistent with App Store Guideline 3.1.3(b) for services outside the app.

CONTENT MODERATION
User-generated content (reports, messages, photos) is visible only within a single neighbourhood community. Admins can hide or delete content, and any user can file a support ticket to remove content within 24 hours.

CONTACT
[GANTI: nama] · [GANTI: telepon] · [GANTI: email]
```

---

## Notes untuk Play Console (App content → App access)

Play tidak punya kolom review notes bebas seperti Apple, tetapi ada **App access**. Isi:

- **All functionality is available without restrictions?** → **No**
- Instruksi:
  ```
  The app requires an account. Test with:
    Email: reviewer-play@[GANTI: domain]
    Password: [GANTI]
    Role: Admin of the demo neighbourhood "RW 05 Griya Soreang"

  On the Landing screen, tap "Isi data contoh" first to seed the demo neighbourhood
  if the reviewer opens a fresh install.

  The app is NOT connected to 110/112 emergency services — it is a
  community network only.
  ```

---

## Bila reviewer melaporkan "unable to sign in"

Kemungkinan penyebab & yang harus dicek:
1. Server API produksi mati atau CORS memblokir origin `capacitor://localhost` — cek `WJW_CORS_ORIGINS` di Fly.io.
2. Seed data belum ada di server produksi — jalankan seed script sebelum submit.
3. Akun reviewer tidak dibuat sebagai "active" — pastikan bukan `pending`.
4. Rate limit brute-force diaktifkan agresif — sementara naikkan limit atau whitelist IP Apple review network (`17.0.0.0/8`).
