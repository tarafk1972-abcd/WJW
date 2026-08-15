/**
 * Alur lengkap: warga melapor posisi, lalu seseorang menekan tombol
 * darurat — siapa yang ikut dipanggil?
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (r: Request) => Response | Promise<Response> }

const PUSAT = { lat: -6.9829, lng: 107.5197 }
const utara = (m: number) => ({ lat: PUSAT.lat + m / 111_320, lng: PUSAT.lng })

beforeAll(async () => {
  process.env.WJW_DB = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'wjw-near-')), 't.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'sa'
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
  const x = await r.text()
  return { status: r.status, body: x ? JSON.parse(x) : null }
}

let seq = 0
async function anggota(cid: string | null, nama: string) {
  seq += 1
  const r = await call('POST', '/api/auth/register', {
    name: nama,
    phone: `08155${String(seq).padStart(7, '0')}`,
    email: `near${seq}@x.id`,
    password: 'rahasia123',
    house: `Blok ${seq}`,
    mode: cid ? 'join' : 'create',
    communityId: cid ?? undefined,
    communityName: cid ? undefined : 'RW Radius',
  })
  return {
    token: r.body.token as string,
    id: r.body.member.id as string,
    communityId: r.body.member.communityId as string,
  }
}

describe('peringatan darurat memanggil orang terdekat', () => {
  it('warga di sebelah ikut dipanggil, yang jauh tidak', async () => {
    const pelapor = await anggota(null, 'Pelapor')
    const cid = pelapor.communityId
    const { db } = await import('./db.js')

    const dekat = await anggota(cid, 'Tetangga Dekat')
    const jauh = await anggota(cid, 'Tetangga Jauh')
    // Setujui keduanya agar berstatus aktif.
    for (const m of [dekat, jauh])
      db.prepare("UPDATE members SET status='active' WHERE id=?").run(m.id)

    // Keduanya melaporkan posisi.
    await call('POST', '/api/me/location', { ...utara(10), accuracy: 5 }, dekat.token)
    await call('POST', '/api/me/location', { ...utara(300), accuracy: 5 }, jauh.token)

    const r = await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      pelapor.token,
    )
    expect(r.status).toBe(201)

    const penerima = r.body.report.recipients as { memberId: string; kind: string }[]
    const ids = penerima.map((p) => p.memberId)
    expect(ids).toContain(dekat.id)
    expect(ids).not.toContain(jauh.id)

    // Yang dipanggil karena dekat diberi tahu jaraknya.
    const entri = penerima.find((p) => p.memberId === dekat.id) as unknown as {
      meters: number
      kind: string
    }
    expect(entri.kind).toBe('neighbour')
    expect(entri.meters).toBeLessThanOrEqual(15)
  })

  it('satpam tetap dipanggil walau jauh dan tanpa lapor posisi', async () => {
    const pelapor = await anggota(null, 'Pelapor2')
    const cid = pelapor.communityId
    const { db } = await import('./db.js')

    const satpam = await anggota(cid, 'Satpam Pos')
    db.prepare("UPDATE members SET status='active', role='satpam' WHERE id=?").run(
      satpam.id,
    )

    const r = await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      pelapor.token,
    )
    const ids = (r.body.report.recipients as { memberId: string }[]).map(
      (p) => p.memberId,
    )
    // Satpam selalu masuk daftar; radius hanya MENAMBAH penerima.
    expect(ids).toContain(satpam.id)
  })

  it('tidak memanggil orang dari lingkungan lain sekalipun berdekatan', async () => {
    const a = await anggota(null, 'Warga RW A')
    const b = await anggota(null, 'Warga RW B')
    const { db } = await import('./db.js')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(b.id)

    // Persis di titik yang sama, tetapi beda lingkungan.
    await call('POST', '/api/me/location', { ...PUSAT, accuracy: 5 }, b.token)

    const r = await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      a.token,
    )
    const ids = (r.body.report.recipients as { memberId: string }[]).map(
      (p) => p.memberId,
    )
    expect(ids).not.toContain(b.id)
  })

  it('menolak koordinat yang tidak masuk akal', async () => {
    const m = await anggota(null, 'Uji Koordinat')
    const r = await call('POST', '/api/me/location', { lat: 999, lng: 0 }, m.token)
    expect(r.status).toBe(400)
  })

  it('menghapus posisi bila warga mematikannya', async () => {
    const m = await anggota(null, 'Uji Hapus')
    await call('POST', '/api/me/location', { ...PUSAT, accuracy: 5 }, m.token)
    await call('DELETE', '/api/me/location', undefined, m.token)

    const { db } = await import('./db.js')
    const row = db.prepare('SELECT last_lat FROM members WHERE id=?').get(m.id) as {
      last_lat: number | null
    }
    expect(row.last_lat).toBeNull()
  })

  it('hanya menyimpan satu titik, bukan riwayat perjalanan', async () => {
    const m = await anggota(null, 'Uji Riwayat')
    await call('POST', '/api/me/location', { ...utara(0), accuracy: 5 }, m.token)
    await call('POST', '/api/me/location', { ...utara(50), accuracy: 5 }, m.token)
    await call('POST', '/api/me/location', { ...utara(100), accuracy: 5 }, m.token)

    const { db } = await import('./db.js')
    const row = db
      .prepare('SELECT last_lat FROM members WHERE id=?')
      .get(m.id) as { last_lat: number }
    // Titik terakhir menimpa yang sebelumnya.
    expect(row.last_lat).toBeCloseTo(utara(100).lat, 6)
  })
})

/**
 * Server hanya meminta lokasi selama ada darurat berlangsung.
 * Inilah yang membuat GPS warga tidak tersentuh di hari-hari biasa.
 */
describe('kapan lokasi diminta', () => {
  it('tidak diminta ketika tidak ada darurat', async () => {
    const m = await anggota(null, 'Warga Tenang')
    const st = await call('GET', '/api/state', undefined, m.token)
    expect(st.body.locationWanted).toBe(false)
  })

  it('diminta selama ada peringatan yang masih terbuka', async () => {
    const pelapor = await anggota(null, 'Pelapor Wanted')
    const { db } = await import('./db.js')
    const lain = await anggota(pelapor.communityId, 'Tetangga Wanted')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(lain.id)

    await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      pelapor.token,
    )

    const st = await call('GET', '/api/state', undefined, lain.token)
    expect(st.body.locationWanted).toBe(true)
  })

  it('berhenti diminta setelah peringatan ditutup', async () => {
    const pelapor = await anggota(null, 'Pelapor Tutup')
    const r = await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      pelapor.token,
    )
    const id = r.body.report.id as string

    await call('POST', `/api/alerts/${id}/close`, {}, pelapor.token)

    const st = await call('GET', '/api/state', undefined, pelapor.token)
    expect(st.body.locationWanted).toBe(false)
  })

  it('tidak meminta lokasi karena darurat di lingkungan lain', async () => {
    const a = await anggota(null, 'RW Satu')
    const b = await anggota(null, 'RW Dua')
    await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      a.token,
    )
    const st = await call('GET', '/api/state', undefined, b.token)
    expect(st.body.locationWanted).toBe(false)
  })
})

/**
 * Inti permintaan: warga yang aplikasinya TERTUTUP tetap terhitung
 * sebagai tetangga terdekat, berkat letak rumah yang dicatat sekali.
 */
describe('letak rumah', () => {
  it('warga tanpa posisi terkini tetap dipanggil lewat rumahnya', async () => {
    const pelapor = await anggota(null, 'Pelapor Rumah')
    const { db } = await import('./db.js')
    const tetangga = await anggota(pelapor.communityId, 'Tetangga Tidur')
    db.prepare("UPDATE members SET status='active' WHERE id=?").run(tetangga.id)

    // Saat mendaftar, rumahnya tercatat.
    await call(
      'POST',
      '/api/me/home',
      { ...utara(12), accuracy: 8, source: 'register' },
      tetangga.token,
    )
    // Aplikasinya lalu ditutup: tidak ada posisi terkini sama sekali.
    const row = db
      .prepare('SELECT last_lat FROM members WHERE id=?')
      .get(tetangga.id) as { last_lat: number | null }
    expect(row.last_lat).toBeNull()

    const r = await call(
      'POST',
      '/api/alerts',
      { category: 'other', at: PUSAT, accuracy: 5 },
      pelapor.token,
    )
    const penerima = r.body.report.recipients as {
      memberId: string
      basis?: string
    }[]
    const entri = penerima.find((p) => p.memberId === tetangga.id)
    expect(entri).toBeTruthy()
    expect(entri!.basis).toBe('home')
  })

  it('titik malam menggantikan titik pendaftaran yang kurang tepat', async () => {
    const m = await anggota(null, 'Uji Malam')
    const { db } = await import('./db.js')

    await call(
      'POST',
      '/api/me/home',
      { ...utara(30), accuracy: 60, source: 'register' },
      m.token,
    )
    await call(
      'POST',
      '/api/me/home',
      { ...utara(10), accuracy: 8, source: 'night' },
      m.token,
    )

    const row = db
      .prepare('SELECT home_accuracy, home_source FROM members WHERE id=?')
      .get(m.id) as { home_accuracy: number; home_source: string }
    expect(row.home_source).toBe('night')
    expect(row.home_accuracy).toBe(8)
  })

  it('titik yang ditandai warga sendiri tidak tergeser pembacaan otomatis', async () => {
    const m = await anggota(null, 'Uji Manual')
    const { db } = await import('./db.js')

    await call(
      'POST',
      '/api/me/home',
      { ...utara(5), accuracy: 4, source: 'manual' },
      m.token,
    )
    await call(
      'POST',
      '/api/me/home',
      { ...utara(90), accuracy: 3, source: 'night' },
      m.token,
    )

    const row = db
      .prepare('SELECT home_source FROM members WHERE id=?')
      .get(m.id) as { home_source: string }
    expect(row.home_source).toBe('manual')
  })

  it('warga bisa menghapus letak rumahnya', async () => {
    const m = await anggota(null, 'Uji Hapus Rumah')
    const { db } = await import('./db.js')
    await call('POST', '/api/me/home', { ...PUSAT, accuracy: 5 }, m.token)
    await call('DELETE', '/api/me/home', undefined, m.token)

    const row = db.prepare('SELECT home_lat FROM members WHERE id=?').get(m.id) as {
      home_lat: number | null
    }
    expect(row.home_lat).toBeNull()
  })

  it('menolak koordinat rumah yang tidak masuk akal', async () => {
    const m = await anggota(null, 'Uji Koordinat Rumah')
    const r = await call('POST', '/api/me/home', { lat: 999, lng: 0 }, m.token)
    expect(r.status).toBe(400)
  })
})
