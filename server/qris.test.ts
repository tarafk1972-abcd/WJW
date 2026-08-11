/**
 * Unggah gambar QRIS oleh superadmin.
 *
 * Gambar ini tampil di halaman Langganan setiap admin dan di email
 * tagihan, jadi hanya superadmin yang boleh menggantinya, dan isinya
 * harus benar-benar gambar — bukan berkas apa pun yang diberi nama .png.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-qris-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'super-secret'
  app = (await import('./index.js')).app
})

async function call(m: string, p: string, b?: unknown, t?: string) {
  const r = await app.fetch(
    new Request('http://x' + p, {
      method: m,
      headers: {
        'content-type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      body: b === undefined ? undefined : JSON.stringify(b),
    }),
  )
  const txt = await r.text()
  let body: unknown = null
  try {
    body = txt ? JSON.parse(txt) : null
  } catch {
    body = txt
  }
  return { status: r.status, body: body as Record<string, string> }
}

async function superToken() {
  const r = await call('POST', '/api/auth/login', {
    identifier: 'tarafk1972@gmail.com',
    password: 'super-secret',
  })
  return r.body.token as string
}

let seq = 0
async function makeAdmin() {
  seq += 1
  const r = await call('POST', '/api/auth/register', {
    name: `Admin${seq}`,
    phone: `0817${String(seq).padStart(9, '0')}`,
    email: `qris${seq}@x.id`,
    password: 'secret123',
    house: 'A1',
    mode: 'create',
    communityName: `RW QRIS ${seq}`,
  })
  return r.body.token as string
}

/** PNG 1×1 yang sah, lengkap dengan angka ajaibnya. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('unggah gambar QRIS', () => {
  it('menyimpan gambar lalu menyajikannya tanpa perlu login', async () => {
    const t = await superToken()
    const up = await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)
    expect(up.status).toBe(200)
    // URL-nya bertanda waktu agar gambar lama tidak tersisa di cache
    expect(up.body.imageUrl).toMatch(/^\/api\/qris\.png\?v=\d+$/)

    // Klien email tidak membawa token, jadi harus bisa diambil tanpa itu.
    const img = await app.fetch(new Request('http://x/api/qris.png'))
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('memakai gambar unggahan pada data langganan', async () => {
    const t = await superToken()
    await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)

    const admin = await makeAdmin()
    const r = await call('GET', '/api/billing', undefined, admin)
    expect(r.status).toBe(200)
    expect((r.body as unknown as { qris: { imageUrl: string } }).qris.imageUrl).toMatch(
      /^\/api\/qris\.png\?v=/,
    )
  })

  it('menolak admin biasa — hanya superadmin yang boleh mengganti', async () => {
    const admin = await makeAdmin()
    const r = await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, admin)
    expect(r.status).toBe(403)
  })

  it('menolak tanpa login', async () => {
    const r = await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX })
    expect(r.status).toBe(401)
  })

  it('menolak jenis berkas yang tidak didukung', async () => {
    const t = await superToken()
    const r = await call(
      'POST',
      '/api/qris',
      { mime: 'application/pdf', data: PNG_1PX },
      t,
    )
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('errQrisType')
  })

  it('menolak berkas yang mengaku PNG padahal bukan', async () => {
    const t = await superToken()
    const jahat = Buffer.from('<script>alert(1)</script>').toString('base64')
    const r = await call('POST', '/api/qris', { mime: 'image/png', data: jahat }, t)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('errQrisType')
  })

  it('menolak gambar yang terlalu besar', async () => {
    const t = await superToken()
    const besar = Buffer.alloc(1_200_000, 1).toString('base64')
    const r = await call('POST', '/api/qris', { mime: 'image/png', data: besar }, t)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('errQrisTooBig')
  })

  it('menghapus gambar dan kembali ke bawaan', async () => {
    const t = await superToken()
    await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)

    const del = await call('DELETE', '/api/qris', undefined, t)
    expect(del.status).toBe(200)

    const img = await app.fetch(new Request('http://x/api/qris.png'))
    expect(img.status).toBe(404)

    const admin = await makeAdmin()
    const r = await call('GET', '/api/billing', undefined, admin)
    // kembali ke nilai .env / bawaan
    expect((r.body as unknown as { qris: { imageUrl: string } }).qris.imageUrl).toBe(
      '/qris.png',
    )
  })

  it('admin biasa tidak bisa menghapus gambar', async () => {
    const t = await superToken()
    await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)

    const admin = await makeAdmin()
    expect((await call('DELETE', '/api/qris', undefined, admin)).status).toBe(403)

    // masih ada
    expect((await app.fetch(new Request('http://x/api/qris.png'))).status).toBe(200)
  })

  it('mengganti gambar memperbarui penanda waktu di URL', async () => {
    const t = await superToken()
    const a = await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)
    await new Promise((r) => setTimeout(r, 5))
    const b = await call('POST', '/api/qris', { mime: 'image/png', data: PNG_1PX }, t)
    expect(b.body.imageUrl).not.toBe(a.body.imageUrl)
  })
})

describe('nama pemilik QRIS', () => {
  it('superadmin bisa mengubahnya tanpa menyentuh .env', async () => {
    const t = await superToken()
    const r = await call(
      'POST',
      '/api/qris/owner',
      { name: 'FADLUL KHAIRA', phone: '(+62)81****781' },
      t,
    )
    expect(r.status).toBe(200)

    const admin = await makeAdmin()
    const b = await call('GET', '/api/billing', undefined, admin)
    const q = (b.body as unknown as { qris: { name: string; phone: string } }).qris
    expect(q.name).toBe('FADLUL KHAIRA')
    expect(q.phone).toBe('(+62)81****781')
  })

  it('menolak nama kosong', async () => {
    const t = await superToken()
    const r = await call('POST', '/api/qris/owner', { name: '  ', phone: '' }, t)
    expect(r.status).toBe(400)
  })

  it('admin biasa tidak boleh mengubahnya', async () => {
    const admin = await makeAdmin()
    const r = await call('POST', '/api/qris/owner', { name: 'Palsu' }, admin)
    expect(r.status).toBe(403)
  })
})
