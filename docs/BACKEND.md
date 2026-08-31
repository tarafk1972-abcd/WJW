# Backend WJW

Server API + basis data yang membuat data benar-benar tersinkron antar HP,
dan notifikasi darurat sampai walau aplikasi tertutup.

## Menjalankan

```bash
npm install
cp .env.example .env      # lalu isi
npm run vapid             # hasilkan kunci push, tempel ke .env

# dua terminal:
npm run server            # API  → http://localhost:8787
npm run dev               # web  → http://localhost:5173
```

Vite meneruskan `/api/*` ke server, jadi browser cukup memanggil origin
yang sama — tidak perlu CORS saat pengembangan.

## Tiga masalah yang diselesaikan

### 1. Data kini keluar dari perangkat

Sebelumnya semua tersimpan di `localStorage`, sehingga peringatan panik
tidak pernah sampai ke HP satpam. Kini semua lewat SQLite di server.

Terbukti lewat tes: admin di sesi berbeda melihat pendaftar yang dibuat
perangkat lain, dan satpam melihat peringatan darurat milik warga lain.

### 2. Notifikasi push

Peringatan darurat memicu Web Push ke semua penerima yang punya akun —
berbunyi walau aplikasi tertutup. Notifikasi darurat memakai
`requireInteraction` dan pola getar panjang agar terasa di dalam saku.

Push dikirim untuk: peringatan panik, pendaftar baru, keputusan admin,
siaran, dan permintaan "butuh bantuan".

Kegagalan push tidak pernah menggagalkan penyimpanan peringatan.
Langganan mati (404/410) dibersihkan otomatis.

### 3. Sandi di-hash

Sandi disimpan sebagai hash bcrypt (10 putaran) dan **tidak pernah**
dikembalikan ke klien. Login memakai token sesi acak 32 byte yang
berlaku 30 hari dan bisa dicabut.

Login juga selalu membandingkan hash meski email tidak ditemukan,
sehingga waktu respons tidak membocorkan email mana yang terdaftar.

## Keamanan yang diterapkan

| Aturan | Cara kerja |
| --- | --- |
| Wajib login | Middleware `auth` pada seluruh endpoint privat |
| Wajib disetujui | Middleware `active` — anggota pending hanya melihat dirinya |
| Batas peran | Warga tidak bisa menyetujui, mengubah area, atau membuat undangan |
| Batas lingkungan | `sameCommunity()` mencegah admin RW A menyentuh RW B |
| Privasi medis/SOS | Dengan `WJW_DATA_ENCRYPTION_KEY`, snapshot serta blob SOS (foto/audio bukti, track, pesan, responders, penerima) terenkripsi AES-256-GCM dan plaintext lama yang valid dimigrasikan saat boot; detail SOS hanya untuk pelapor/penerima/satpam/admin tenant yang sama. Ini belum berarti seluruh kolom koordinat relasional terenkripsi. |
| Privasi kontak | Kontak pribadi satu anggota tidak terlihat anggota lain; cache warga hanya menerima nomor admin/satpam untuk koordinasi darurat |
| Buku tamu | Hanya admin/satpam; nomor KTP tidak dikirim ke cache/browser dan nilai baru dienkripsi saat disimpan |
| Laporan anonimus non-SOS | Hanya pelapor dan admin tenant yang menerima record/identitas; warga lain maupun satpam tidak menerima catatan atau lampiran yang dapat mengungkap pelapor |
| Kode undangan | Tetap wajib approval admin — hanya mengusulkan peran |
| Ronda | Jarak GPS diverifikasi **di server**, tidak bisa dipalsukan klien |
| Superadmin | Sandi dari environment; bila kosong dibuat acak, bukan bawaan |
| Kependudukan/KK | Alamat dinormalisasi; `households` menjamin tepat satu kepala keluarga per alamat dan iuran baru hanya boleh ditagihkan ke kepala aktif |
| Surat digital | Status `APPROVED` dan nomor surat diterbitkan atomik; endpoint PDF menolak semua status selain `APPROVED` |
| Aduan | Server memaksa `SUBMITTED → REVIEWING → IN_PROGRESS → RESOLVED → CLOSED`; catatan admin menjadi entri kronologis immutable |
| Voting & donasi | Server membatasi 2–10 opsi, satu suara per warga, tenggat/penutupan otomatis, serta nominal donasi; identitas vote anonim tidak dikirim ke klien |
| WJW Assistant | Query berizin hanya pada data tenant; riwayat pertanyaan/jawaban dienkripsi AES-256-GCM di produksi dan audit tidak menyimpan isi teks |
| Subdomain tenant | Dengan `WJW_BASE_DOMAIN`, token/login warga dipasangkan ke `<slug>.<domain>`; token tenant lain dan token Superadmin di subdomain ditolak |

## Lifecycle insiden SOS

`POST /api/alerts` menerima kategori, titik GPS opsional, akurasi, dan
`idempotencyKey`. Kunci yang sama dari pelapor yang sama selalu mengembalikan
insiden pertama sehingga retry jaringan tidak menggandakan alarm.

| Aksi | Endpoint | Status kanonis |
| --- | --- | --- |
| Alarm dibuat | `POST /api/alerts` | `NEW` |
| Saya menuju lokasi | `POST /api/alerts/:id/respond` | `ACKNOWLEDGED → RESPONDING` |
| Tiba | `POST /api/alerts/:id/status` | `ON_SITE` |
| Selesai | `POST /api/alerts/:id/status` | `RESOLVED` |
| Alarm palsu | `POST /api/alerts/:id/status` | `CANCELLED` |

Setiap transition memasukkan baris immutable ke `incident_timeline`, audit,
dan event SSE tenant. Endpoint lama `/ack` dan `/close` hanya alias kompatibilitas;
klien baru memakai `/respond` dan `/status`.

## Bagaimana UI tersambung

Semua halaman memakai klien bertipe di `src/lib/api.ts` (tidak membuat URL
`localhost` sendiri). Halaman darurat memakai cache lokal agar responsif;
modul administrasi yang datanya privat memuat DTO berizin langsung dari API.
Alurnya:

1. Halaman membaca cache lokal atau DTO API yang sudah bertipe.
2. Setiap perubahan dikirim ke server lewat `src/lib/api.ts`.
3. Server menerbitkan invalidasi kecil melalui `GET /api/events` (SSE),
   terikat pada community dari token.
4. `src/lib/realtime.ts` membuka SSE dengan `fetch` + header Authorization
   (bukan token di URL), lalu `src/lib/sync.ts` menarik ulang `/api/state`
   yang telah difilter RBAC.
5. Refresh saat browser kembali online/terlihat hanya pelengkap pemulihan,
   bukan mekanisme real-time utama.

Keuntungannya: layar tetap responsif, tetapi **server yang menentukan hasil
akhir** — termasuk menolak aksi yang tidak diizinkan dan menyaring data tenant.

### Masalah umum

**"Email/HP atau kata sandi salah" padahal merasa benar**
Akun disimpan di server, bukan di HP. Basis data yang baru dibuat masih
kosong — akun demo `budi@warga.id` dan sejenisnya hanya ada di mode lokal
(tombol "Isi data contoh"), bukan di server.

Lihat akun yang benar-benar ada:

```bash
npm run reset-password -- --list
```

Ganti sandi yang terlupa:

```bash
npm run reset-password -- budi@warga.id sandibaru123
```

Untuk superadmin, cukup set `WJW_SUPERADMIN_PASSWORD` di `.env` lalu
jalankan ulang server — sandinya diterapkan ulang otomatis.

**"Terjadi kesalahan" saat memeriksa kode undangan**
API belum jalan. Buka terminal kedua lalu `npm run server`. Aplikasi kini
menampilkan pesan "Server tidak aktif" alih-alih error umum.

**`vite: not found` atau `Cannot find package`**
`node_modules` hilang. Jalankan `npm install`.

### Mode luring

Cache lokal boleh dipakai agar layar terakhir tetap dapat dibaca, tetapi **SOS
tidak pernah dibuat lokal**. Bila server tidak terjangkau, layar menampilkan
"Darurat belum terkirim" dan tidak mengaku bantuan telah dihubungi. Gunakan
telepon/SMS/nomor darurat resmi sesuai SOP komunitas sebagai jalur cadangan.

Tidak ada antrean SOS otomatis: mengirim ulang alarm tanpa tindakan sadar warga
setelah koneksi kembali dapat menciptakan insiden yang sudah tidak relevan.

## Community OS: API dan aturan operasional

Fase administrasi dan partisipasi **tidak** menggunakan tabel `reports`.
`reports` tetap khusus insiden/SOS agar aduan rutin tidak terlihat sebagai
keadaan darurat dan data medis tetap pada batas yang lebih ketat.

| Kebutuhan | Endpoint utama | Penegakan server |
| --- | --- | --- |
| Kependudukan / KK | `GET /api/population`, `PUT /api/population/households/:id/head` | Satu `address_key` tenant = satu kepala; anggota tidak dapat keluar ke KK tenant lain |
| Iuran komunitas | `GET /api/dues`, `POST /api/dues/invoices/generate` | Hanya Admin 2 dan ID kepala keluarga aktif; terpisah dari `/api/billing` WJW |
| Surat | `POST /api/hub/items`, `POST /api/hub/letters/:id/decision`, `GET /api/hub/letters/:id/pdf` | Pemohon/admin saja; PDF `private, no-store`, hanya sesudah `APPROVED` |
| Aduan | `POST /api/hub/items`, `PATCH /api/hub/items/:id` | Pelapor dan pengurus; urutan state linear dan catatan tindak lanjut tersimpan sebagai komentar berjejak waktu |
| Pengumuman | `POST /api/announcements` | Target `all`, `rw`, `rt`, atau `block` dihitung dari data KK di server; SSE memicu refresh segera |
| Buku tamu | `POST /api/guests`, `POST /api/guests/:id/checkout` | Hanya admin/satpam; nomor identitas tak pernah dikirim kembali ke cache dan tersimpan terenkripsi di produksi |
| Voting / donasi / program | `/api/hub/items` dan `/actions` | Tenggat ditutup tiap menit di server (juga pada read/write); vote unik/immutable per warga; daftar peserta arisan/rukun transparan |
| Assistant | `POST /api/assistant`, `GET /api/assistant/history` | Tidak memanggil provider eksternal; hanya merangkum iuran, surat, tamu, ronda, voting, dan aduan sesuai peran |
| Superadmin | `GET /api/superadmin/overview`, `POST /api/superadmin/tenants`, `PUT /api/superadmin/tenants/:id/subscription` | Tenant + admin dibuat atomik, 14 hari trial, paket `FREE/COMMUNITY/PROFESSIONAL/ENTERPRISE`, suspend tanpa menghapus data |

### Surat PDF

PDF berisi kop lingkungan, nomor urut per tenant, jenis/keperluan surat,
data pemohon, catatan keputusan, tanggal persetujuan dan blok persetujuan
pengurus. Blok itu adalah persetujuan digital internal WJW; bila RT/RW
membutuhkan tanda tangan elektronik tersertifikasi, gunakan proses/sertifikat
yang diwajibkan instansi setempat—aplikasi tidak boleh mengklaim sertifikat
yang tidak dimilikinya.

### Kebijakan tier WJW

Status/tier langganan **tidak pernah** mengunci jalur SOS. Keselamatan warga
tetap lebih penting daripada penagihan. Semua tenant baru menerima trial 14
hari dan server hanya menerima salah satu tier berikut:

| Tier | Kebijakan rilis ini |
| --- | --- |
| `FREE` | SOS, data warga inti, surat/aduan, pengumuman, voting, donasi, arisan, dan Assistant sesuai hak peran |
| `COMMUNITY` | Kemampuan inti yang sama, untuk kontrak pengelolaan komunitas |
| `PROFESSIONAL` | Kemampuan inti yang sama, untuk kontrak operasional profesional |
| `ENTERPRISE` | Kemampuan inti serta permintaan custom domain/white-label setelah DNS/TLS operator selesai |

Ini disengaja: tidak ada pengurangan keselamatan atau pemisahan data karena
paket. Server memvalidasi nama tier pada provisioning/perubahan subscription,
dan menolak konfigurasi **baru** custom-domain atau white-label dari tier selain
`ENTERPRISE` (`tier_required`). Aktivasi pembayaran platform tetap hanya lewat
verifikasi manual Superadmin; mengubah tier bukan bukti pembayaran.

### Tenant subdomain di Fly.io

1. Siapkan domain apex, contoh `wargajagawarga.app`, pada Fly.io.
2. Tambahkan DNS wildcard `*.wargajagawarga.app` sesuai arahan Fly dan
   pastikan sertifikat/TLS wildcard atau domain tiap tenant telah aktif.
3. Set `WJW_BASE_DOMAIN=wargajagawarga.app` sebagai secret/runtime env.
4. Buat tenant dari Konsol Superadmin dan gunakan slug yang diberikan;
   warga masuk di `https://<slug>.wargajagawarga.app`.
5. Gunakan apex untuk Konsol Superadmin. Jangan menaruh token di query URL.

Tanpa wildcard DNS/TLS dan `WJW_BASE_DOMAIN`, host Fly default tetap dapat
melayani aplikasi, tetapi mekanisme isolasi login berbasis subdomain tidak
aktif. Jangan mengiklankan subdomain tenant sebagai aktif sebelum langkah
tersebut selesai.

### Langganan WJW bukan iuran warga

`dues_invoices` adalah iuran/pengelolaan lingkungan dan hanya Admin 2 yang
menerbitkan atau memverifikasinya. Tabel `invoices` adalah langganan tenant
kepada platform WJW. Klaim QRIS hanya memindahkan invoice platform ke
`awaiting_verification`; **hanya Superadmin** yang dapat menandai lunas.
Tidak ada webhook atau aktivasi pembayaran otomatis.

## Struktur

```
server/
  schema.sql      skema SQLite
  db.ts           koneksi, hash sandi, sesi, tipe baris
  crypto.ts       AES-256-GCM untuk snapshot/profil darurat
  incidents.ts    state machine dan timeline immutable SOS
  events.ts       broker invalidasi SSE per tenant
  geo.ts          jarak haversine, poligon, jadwal lintas tengah malam
  push.ts         Web Push + pembersihan langganan mati
  index.ts        seluruh endpoint API
  api.test.ts     28 tes
  push.test.ts    4 tes
src/lib/
  api.ts          klien HTTP (token, error, offline)
  pushClient.ts   pendaftaran push di browser
public/sw.js      service worker notifikasi
```

## Catatan penerapan

- Ganti `WJW_SUPERADMIN_PASSWORD` sebelum dipakai sungguhan.
- Wajib HTTPS di produksi — push, kamera, mikrofon, dan GPS memerlukannya.
- Untuk Fly.io, ikuti [FLY-IO.md](FLY-IO.md): database berada di `/data` volume
  tunggal dan harus dibackup dengan SQLite backup API, bukan salin file live.
- Phase 1 sengaja satu Machine karena SQLite dan broker SSE in-memory. Sebelum
  scale-out, migrasikan ke PostgreSQL + broker event bersama.

## Yang masih perlu sebelum live

1. Uji lapangan di lingkungan sungguhan (malam hari, sinyal jelek)
2. Cadangan SMS/WhatsApp bila internet mati
3. Batas kirim (rate limit) untuk mencegah penyalahgunaan
4. Kebijakan privasi (UU PDP No. 27/2022 — lokasi & data kesehatan)
5. SOP pencocokan mutasi QRIS manual oleh Superadmin (jangan aktifkan verifikasi otomatis tanpa keputusan produk/keamanan baru)
