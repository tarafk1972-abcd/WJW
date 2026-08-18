/**
 * Reset sandi seorang anggota dari baris perintah.
 *
 * Dipakai saat sandi terlupa atau akun superadmin terkunci karena log
 * berisi sandi acak sudah hilang.
 *
 *   npm run reset-password -- <email-atau-hp> <sandi-baru>
 *   npm run reset-password -- --list
 */
import { db, hashPassword } from './db.js'

const args = process.argv.slice(2)

if (args[0] === '--list' || args.length === 0) {
  const rows = db
    .prepare('SELECT email, phone, name, role, status FROM members ORDER BY role')
    .all() as {
    email: string
    phone: string
    name: string
    role: string
    status: string
  }[]

  if (rows.length === 0) {
    console.log('\nBelum ada akun di basis data.\n')
  } else {
    console.log('\nAkun terdaftar:\n')
    for (const r of rows) {
      console.log(
        `  ${r.email.padEnd(28)} ${r.phone.padEnd(16)} ${r.role.padEnd(11)} ${r.status}  ${r.name}`,
      )
    }
    console.log('')
  }
  if (args.length === 0) {
    console.log('Pakai: npm run reset-password -- <email-atau-hp> <sandi-baru>\n')
  }
  process.exit(0)
}

const [identifier, password] = args

if (!identifier || !password) {
  console.error('\nPakai: npm run reset-password -- <email-atau-hp> <sandi-baru>\n')
  process.exit(1)
}

if (password.length < 6) {
  console.error('\nSandi minimal 6 karakter.\n')
  process.exit(1)
}

const q = identifier.trim().toLowerCase().replace(/\s|-/g, '')
const member = db
  .prepare('SELECT id, name, email, role FROM members WHERE lower(email)=? OR phone=?')
  .get(q, q) as { id: string; name: string; email: string; role: string } | undefined

if (!member) {
  console.error(`\nAkun "${identifier}" tidak ditemukan.`)
  console.error('Lihat daftar akun: npm run reset-password -- --list\n')
  process.exit(1)
}

db.prepare('UPDATE members SET password_hash = ? WHERE id = ?').run(
  hashPassword(password),
  member.id,
)

// Cabut sesi lama agar perangkat lain ikut logout.
const removed = db.prepare('DELETE FROM sessions WHERE member_id = ?').run(member.id)

console.log(`\nSandi diperbarui untuk ${member.name} <${member.email}> (${member.role}).`)
if (removed.changes > 0) {
  console.log(`${removed.changes} sesi lama dicabut — perangkat lain perlu masuk ulang.`)
}
console.log('')
