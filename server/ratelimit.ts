/**
 * Pembatasan laju sederhana, di dalam memori.
 *
 * Dipakai untuk endpoint yang bisa dipanggil siapa saja tanpa login:
 * masuk, mendaftar, dan memeriksa kode undangan. Selama aplikasi hanya
 * berjalan di Wi-Fi rumah hal ini nyaris tidak berisiko, tetapi begitu
 * servernya publik, /api/auth/login menjadi sasaran empuk percobaan
 * sandi beruntun — dan tiap pendaftaran palsu menambah pekerjaan admin
 * sungguhan.
 *
 * Sengaja membatasi per ALAMAT, bukan per akun. Mengunci akun setelah
 * sekian kali gagal terdengar lebih aman, padahal itu memberi penyerang
 * cara mudah membungkam warga: cukup salah-sandi berkali-kali atas nama
 * orang lain, dan orang itu terkunci dari aplikasi darurat.
 *
 * Penyimpanannya di memori: cukup untuk satu proses, hilang saat server
 * dijalankan ulang, dan tidak menambah ketergantungan baru. Bila nanti
 * berjalan di banyak proses, ini perlu pindah ke penyimpanan bersama.
 */

interface Jejak {
  /** Kapan jendela penghitungan ini dimulai. */
  mulai: number
  jumlah: number
}

const jejak = new Map<string, Jejak>()

/** Buang catatan yang jendelanya sudah lama lewat, agar peta tidak tumbuh terus. */
function bersihkan(now: number, windowMs: number) {
  if (jejak.size < 5000) return
  for (const [k, v] of jejak) {
    if (now - v.mulai > windowMs) jejak.delete(k)
  }
}

/**
 * Catat satu percobaan. Mengembalikan `true` bila masih boleh dilayani,
 * `false` bila jatahnya sudah habis.
 */
export function hitRateLimit(
  jenis: string,
  alamat: string,
  opts: { max: number; windowMs: number; now?: number },
): boolean {
  const now = opts.now ?? Date.now()
  const kunci = `${jenis}:${alamat}`
  const ada = jejak.get(kunci)

  if (!ada || now - ada.mulai >= opts.windowMs) {
    jejak.set(kunci, { mulai: now, jumlah: 1 })
    bersihkan(now, opts.windowMs)
    return true
  }

  ada.jumlah += 1
  return ada.jumlah <= opts.max
}

/** Hanya untuk pengujian. */
export function resetRateLimits() {
  jejak.clear()
}

/**
 * Batas yang berlaku, bisa disetel lewat .env.
 *
 * Angkanya sengaja longgar, karena satu RW berbagi SATU alamat publik.
 * Warga yang mendaftar bersama-sama seusai rapat lingkungan — persis
 * cara QR di pos satpam dipakai — datang dari alamat yang sama persis
 * seperti penyerang. Batas yang ketat akan menutup pintu bagi tetangga
 * sungguhan demi menghalangi sesuatu yang tetap tersaring oleh
 * persetujuan admin.
 *
 * Perlindungan sesungguhnya di sini bukan angka ini, melainkan bcrypt
 * (menebak sandi jadi lambat) dan keharusan disetujui admin. Batas ini
 * hanya mencegah pembanjiran mesin.
 */
export const BATAS = {
  login: {
    max: Number(process.env.WJW_RATE_LOGIN_MAX ?? 120),
    windowMs: 10 * 60_000,
  },
  register: {
    max: Number(process.env.WJW_RATE_REGISTER_MAX ?? 200),
    windowMs: 60 * 60_000,
  },
  // Asisten dapat memakai penyedia berbayar bila operator mengaktifkannya.
  // Batasi per anggota + alamat pada handler agar satu warga tidak menghabiskan
  // kuota seluruh tenant, tanpa menghukum warga lain di Wi-Fi yang sama.
  assistant: {
    max: Number(process.env.WJW_RATE_ASSISTANT_MAX ?? 30),
    windowMs: 60 * 60_000,
  },
}

/**
 * Alamat pemanggil, sebaik yang bisa diketahui.
 *
 * Di produksi aplikasi ini berada di belakang Nginx, jadi alamat soket
 * selalu 127.0.0.1 dan yang bermakna ada di X-Forwarded-For. Diambil
 * yang paling kiri: itu alamat asli klien.
 */
export function alamatKlien(headers: {
  get(name: string): string | null
}): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return headers.get('x-real-ip') ?? 'tidak-diketahui'
}
