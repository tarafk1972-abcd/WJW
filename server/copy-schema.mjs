import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// TypeScript tidak menyalin aset SQL. Simpan schema di samping db.js agar
// `npm run build:server && npm start` bekerja juga di luar Docker.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'server', 'schema.sql')
const destination = resolve(root, 'build', 'server', 'schema.sql')
mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
console.log(`[build:server] copied ${source} -> ${destination}`)
