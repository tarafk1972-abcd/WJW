/**
 * Tarik versi terbaru dari GitHub, dengan aman.
 *
 * Kenapa perlu skrip sendiri: `git pull` gagal setiap kali ada berkas
 * yang tersentuh di komputer sendiri, dengan pesan
 *
 *     error: Your local changes ... would be overwritten by merge
 *     Aborting
 *
 * Kata "Aborting" itu mudah terlewat, dan yang terjadi berikutnya buruk:
 * pengguna mengira sudah memperbarui, padahal TIDAK ADA satu berkas pun
 * yang berubah — lalu melaporkan bug yang sebenarnya sudah diperbaiki.
 * Itu sudah terjadi dua kali di sini, keduanya memakan waktu berjam-jam
 * untuk didiagnosis dari jauh.
 *
 * Penyebabnya hampir selalu sama: `npm install` menyentuh package.json
 * atau package-lock.json. Perubahan seperti itu tidak perlu disimpan.
 *
 * Skrip ini menyimpan dulu apa pun yang berubah (git stash, bisa
 * dikembalikan), menarik versi terbaru, lalu memberi tahu dengan jelas
 * hasilnya. Tidak ada yang dihapus permanen.
 */
import { execSync } from 'node:child_process'

const BRANCH = 'arena/019fad5f-wjw'

const jalan = (cmd, diam = false) =>
  execSync(cmd, { encoding: 'utf8', stdio: diam ? 'pipe' : 'inherit' })

const baca = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return ''
  }
}

try {
  jalan('git --version', true)
} catch {
  console.error(
    '\n  [WJW] Git belum terpasang.' +
      '\n        Pasang dari https://git-scm.com/download/win' +
      '\n        lalu TUTUP dan BUKA LAGI Command Prompt.\n',
  )
  process.exit(1)
}

const sebelum = baca('git rev-parse --short HEAD')
const kotor = baca('git status --porcelain')

if (kotor) {
  console.log('\n  [WJW] Ada perubahan lokal. Disimpan dulu (bisa dikembalikan):')
  for (const baris of kotor.split('\n')) console.log('        ' + baris)
  // Disimpan, bukan dibuang: kalau ternyata itu pekerjaan penting,
  // masih bisa diambil lagi dengan `git stash pop`.
  jalan(`git stash push -u -m "wjw-update ${new Date().toISOString()}"`)
  console.log('        (kembalikan dengan: git stash pop)\n')
}

console.log(`  [WJW] Menarik versi terbaru dari ${BRANCH} ...\n`)
jalan(`git fetch origin ${BRANCH}`)
jalan(`git merge --ff-only origin/${BRANCH}`)

const sesudah = baca('git rev-parse --short HEAD')

if (sebelum === sesudah) {
  console.log('\n  [WJW] Sudah versi terbaru — tidak ada yang berubah.\n')
} else {
  console.log(`\n  [WJW] Diperbarui: ${sebelum} -> ${sesudah}`)
  console.log('        Perubahan yang masuk:\n')
  jalan(`git log --oneline ${sebelum}..${sesudah}`)
  console.log('\n  [WJW] Memasang paket ...\n')
  /*
   * Kegagalan npm tidak boleh tampil sebagai jejak tumpukan Node.
   * Bagian yang penting — kodenya sudah terbarui — sudah selesai di
   * atas, dan menakut-nakuti dengan tumpukan galat membuat orang
   * mengira seluruh pembaruannya gagal.
   */
  let npmOk = true
  try {
    jalan('npm install')
  } catch {
    npmOk = false
  }

  if (npmOk) {
    console.log(
      '\n  [WJW] Selesai. Jalankan:  npm run dev:all' +
        '\n        Lalu cek angka "v..." di halaman depan — kalau berubah,' +
        '\n        berarti versi barunya sudah aktif.\n',
    )
  } else {
    console.log(
      '\n  [WJW] Kode sudah terbarui, tetapi `npm install` gagal.' +
        '\n        Coba jalankan sendiri:  npm install' +
        '\n        Bila macet di better-sqlite3, jalankan:' +
        '\n          npm install --ignore-scripts\n',
    )
  }
}
