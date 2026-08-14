/**
 * Jalankan API dan web sekaligus dengan satu perintah.
 *
 * Menjalankan keduanya di dua jendela terminal terpisah mudah terlupa,
 * dan bila API tidak hidup, aplikasi tetap terbuka tetapi setiap
 * permintaan gagal dengan ECONNREFUSED 127.0.0.1:8787 — layar tampak
 * "kosong" tanpa sebab yang jelas.
 *
 * Sengaja tanpa dependensi tambahan (dulu memakai `concurrently`, yang
 * ternyata tidak pernah ikut terpasang sehingga perintahnya selalu gagal).
 */
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'

const API_PORT = Number(process.env.PORT ?? 8787)
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173)

/** Warna hanya bila keluarannya memang terminal. */
const tty = process.stdout.isTTY
const paint = (code, s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s)

const children = []
let stopping = false

/** Jalankan satu perintah npm, dengan setiap barisnya diberi label. */
function run(name, args, colour) {
  const label = paint(colour, `[${name}]`)
  const child = spawn(process.execPath, [npmCli(), 'run', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  const prefix = (stream) => {
    let sisa = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      const baris = (sisa + chunk).split('\n')
      sisa = baris.pop() ?? ''
      for (const b of baris) console.log(`${label} ${b}`)
    })
  }
  prefix(child.stdout)
  prefix(child.stderr)

  child.on('exit', (code) => {
    if (stopping) return
    console.log(`${label} berhenti (kode ${code ?? 0}).`)
    // Satu mati, keduanya dihentikan: setengah jalan hanya membingungkan.
    stopAll(code ?? 0)
  })

  children.push(child)
  return child
}

/** Lokasi npm-cli.js, agar jalan di Windows maupun Linux tanpa shell. */
function npmCli() {
  const exec = process.env.npm_execpath
  if (exec && exec.endsWith('.js')) return exec
  throw new Error('Jalankan lewat npm: `npm run dev:all`')
}

function stopAll(code) {
  if (stopping) return
  stopping = true
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

/** Cek apakah sebuah port sudah dipakai. */
function portTerpakai(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port })
    sock.on('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
    setTimeout(() => {
      sock.destroy()
      resolve(false)
    }, 800)
  })
}

const apiHidup = await portTerpakai(API_PORT)
const webHidup = await portTerpakai(WEB_PORT)

if (apiHidup && webHidup) {
  console.log(`Port ${API_PORT} dan ${WEB_PORT} sudah dipakai — keduanya tampaknya`)
  console.log('sudah berjalan. Tutup dulu bila ingin menjalankannya dari sini.')
  process.exit(1)
}

if (!apiHidup) run('api', ['server'], '36')
else console.log(`[api] sudah berjalan di :${API_PORT}, dilewati.`)

if (!webHidup) run('web', ['dev'], '32')
else console.log(`[web] sudah berjalan di :${WEB_PORT}, dilewati.`)

console.log('')
console.log(`API  : http://localhost:${API_PORT}`)
console.log(`Web  : http://localhost:${WEB_PORT}`)
console.log('Tekan Ctrl+C untuk menghentikan keduanya.')
console.log('')
