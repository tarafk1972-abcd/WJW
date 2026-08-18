/**
 * Jalankan aplikasi lewat HTTPS di jaringan Wi-Fi setempat.
 *
 * Kenapa perlu: peramban hanya mengizinkan GPS (dan kamera, dan
 * notifikasi) pada "konteks aman" — https:// atau localhost. Membuka
 * aplikasi dari HP lewat http://192.168.x.x membuat GPS diblokir diam-
 * diam, sehingga satpam tidak bisa merekam titik ronda sama sekali.
 *
 * Skrip ini membuat sertifikat sendiri (self-signed) untuk alamat LAN
 * komputer ini, lalu menjalankan Vite dan API di atasnya. Sertifikatnya
 * tidak dikenal peramban, jadi HP akan menampilkan peringatan sekali —
 * itu wajar untuk jaringan sendiri, dan tinggal dipilih "Lanjutkan".
 *
 * Untuk pemakaian sungguhan oleh warga, tetap perlu domain + sertifikat
 * asli. Ini jalan pintas untuk menguji di lapangan hari ini.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const DIR = join(process.cwd(), '.cert')
const KEY = join(DIR, 'dev-key.pem')
const CRT = join(DIR, 'dev-cert.pem')

/** Alamat IPv4 LAN pertama yang bukan localhost. */
function alamatLan() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address
    }
  }
  return '127.0.0.1'
}

/**
 * Cari OpenSSL yang bisa dipakai.
 *
 * Di Windows, OpenSSL ikut terpasang bersama Git for Windows — tetapi
 * hanya terdaftar di PATH milik Git Bash, bukan Command Prompt. Padahal
 * seluruh panduan proyek ini memakai Command Prompt. Menyerah di titik
 * ini berarti menolak menjalankan program yang sebenarnya sudah ada di
 * komputer pengguna, hanya karena letaknya tidak dicari.
 */
function cariOpenssl() {
  const kandidat = [
    'openssl', // Linux, macOS, Git Bash — PATH sudah benar
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
  ]
  for (const exe of kandidat) {
    try {
      execFileSync(exe, ['version'], { stdio: 'ignore' })
      return exe
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null
}

const ip = alamatLan()

if (!existsSync(KEY) || !existsSync(CRT)) {
  mkdirSync(DIR, { recursive: true })

  /*
   * subjectAltName wajib memuat alamat IP-nya. Tanpa itu Chrome menolak
   * sertifikat sebelum sempat menawarkan "Lanjutkan", dan halamannya
   * tidak bisa dibuka sama sekali.
   */
  const conf = join(DIR, 'openssl.cnf')
  writeFileSync(
    conf,
    `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = ${ip}
[ext]
subjectAltName = IP:${ip}, IP:127.0.0.1, DNS:localhost
`,
  )

  const openssl = cariOpenssl()
  if (!openssl) {
    console.error(
      '\n  [WJW] OpenSSL tidak ditemukan.' +
        '\n        Biasanya sudah ikut terpasang bersama Git for Windows.' +
        '\n        Pasang Git dari https://git-scm.com/download/win' +
        '\n        lalu jalankan lagi perintah ini.\n',
    )
    process.exit(1)
  }

  try {
    execFileSync(
      openssl,
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', KEY, '-out', CRT,
        '-days', '365', '-config', conf,
      ],
      { stdio: 'ignore' },
    )
    console.log(`  [WJW] Sertifikat dibuat untuk ${ip} (berlaku 365 hari).`)
  } catch {
    console.error(
      '\n  [WJW] Gagal membuat sertifikat, padahal OpenSSL ditemukan di:' +
        `\n        ${openssl}` +
        '\n        Kirimkan pesan galat di atas bila perlu bantuan.\n',
    )
    process.exit(1)
  }
}

console.log(`
  [WJW] Alamat untuk HP (satu Wi-Fi dengan komputer ini):

        https://${ip}:5173

        Peramban akan memperingatkan "Not secure" karena sertifikatnya
        dibuat sendiri. Pilih Lanjutkan / Advanced -> Proceed. Itu hanya
        perlu sekali per HP, dan setelah itu GPS ronda berfungsi.
`)

const env = { ...process.env, WJW_HTTPS: '1' }
const opsi = { stdio: 'inherit', shell: process.platform === 'win32', env }

const api = spawn('npm', ['run', 'server'], opsi)
const web = spawn('npm', ['run', 'dev'], opsi)

const tutup = () => {
  api.kill()
  web.kill()
  process.exit(0)
}
process.on('SIGINT', tutup)
process.on('SIGTERM', tutup)
web.on('exit', tutup)
api.on('exit', tutup)
