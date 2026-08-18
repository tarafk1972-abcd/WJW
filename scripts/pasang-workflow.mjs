/**
 * Salin berkas workflow APK ke tempat yang dibaca GitHub.
 *
 * Kenapa perlu langkah ini sama sekali: GitHub menolak token robot
 * membuat atau mengubah berkas di `.github/workflows/`. Itu aturan
 * keamanan GitHub, bukan sesuatu yang bisa dilewati dari sini — kalau
 * bisa, sebuah robot yang dibajak dapat menjalankan apa pun atas nama
 * pemilik repositori. Jadi berkasnya disimpan di `docs/workflow/` dan
 * hanya Anda yang bisa memindahkannya.
 *
 * Skrip ini melakukan penyalinan itu, lalu mencetak persis perintah
 * berikutnya. Aman dijalankan berulang.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SUMBER = join(ROOT, 'docs', 'workflow', 'apk.yml')
const TUJUAN = join(ROOT, '.github', 'workflows', 'apk.yml')

if (!existsSync(SUMBER)) {
  console.error(`\n  [WJW] Tidak menemukan ${SUMBER}\n`)
  process.exit(1)
}

mkdirSync(dirname(TUJUAN), { recursive: true })

/*
 * Buang kotak "berkas ini perlu dipindahkan" dari salinannya: begitu
 * berada di .github/workflows/ pesan itu tidak berlaku lagi, dan
 * petunjuk yang sudah kedaluwarsa lebih membingungkan daripada tidak
 * ada petunjuk.
 */
const isi = readFileSync(SUMBER, 'utf8')
const mulai = isi.indexOf('name: Build APK')
const kepala = `# Membangun APK Android di GitHub Actions.
#
# Mesin GitHub sudah punya JDK dan Android SDK, jadi APK bisa dibuat
# tanpa memasang apa pun di komputer Anda.
#
# Cara memakai: tab Actions -> "Build APK" -> Run workflow.
# Hasilnya diunduh dari bagian Artifacts di halaman jalannya workflow.
#
# Berkas asalnya: docs/workflow/apk.yml

`

if (mulai === -1) copyFileSync(SUMBER, TUJUAN)
else writeFileSync(TUJUAN, kepala + isi.slice(mulai))

console.log(`
  [WJW] Workflow dipasang di .github/workflows/apk.yml

  Kirimkan ke GitHub:

      git add .github/workflows/apk.yml
      git commit -m "Pasang workflow build APK"
      git push origin arena/019fad5f-wjw

  Lalu di GitHub:

      Actions  ->  Build APK  ->  Run workflow

  Isi "api_base" dengan alamat HTTPS server Anda, misalnya
  https://wargajagawarga.my.id  (wajib https, bukan localhost).

  Selesai membangun (± 10-15 menit), APK ada di bagian Artifacts.
`)
