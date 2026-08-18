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

  try {
    execFileSync(
      'openssl',
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
      '\n  [WJW] Gagal membuat sertifikat — OpenSSL tidak ditemukan.' +
        '\n        Di Windows, OpenSSL ikut terpasang bersama Git.' +
        '\n        Coba jalankan skrip ini dari "Git Bash".\n',
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
