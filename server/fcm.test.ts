import { generateKeyPairSync, createVerify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tes pengirim FCM.
 *
 * Tidak menyentuh Firebase sungguhan: `fetch` diganti tiruan, sehingga yang
 * diperiksa adalah hal-hal yang justru paling sering salah dan paling sulit
 * terlihat di lapangan — tanda tangan JWT, nama channel yang membawa suara
 * sirene, dan pembuangan token perangkat yang sudah mati.
 */

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const akun = {
  project_id: 'wjw-uji',
  client_email: 'robot@wjw-uji.iam.gserviceaccount.com',
  private_key: privateKey,
}

interface Panggilan {
  url: string
  init: RequestInit
}

let panggilan: Panggilan[] = []

/** Tiruan fetch: menukar token lalu menerima setiap pengiriman. */
function fetchTiruan(balasanKirim?: () => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const alamat = String(url)
    panggilan.push({ url: alamat, init: init ?? {} })
    if (alamat.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'token-uji', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return balasanKirim ? balasanKirim() : new Response('{}', { status: 200 })
  })
}

async function muatFcm(serviceAccount: string | null) {
  vi.resetModules()
  if (serviceAccount === null) vi.stubEnv('WJW_FCM_SERVICE_ACCOUNT', '')
  else vi.stubEnv('WJW_FCM_SERVICE_ACCOUNT', serviceAccount)
  return await import('./fcm.js')
}

beforeEach(() => {
  panggilan = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('FCM mati secara bawaan', () => {
  it('nonaktif tanpa service account, dan tidak menyentuh jaringan', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { fcmEnabled, sendFcm } = await muatFcm(null)
    expect(fcmEnabled).toBe(false)
    const hasil = await sendFcm(['token-a'], { title: 'x', body: 'y' })
    expect(hasil).toEqual({ sent: 0, failed: 0, invalid: [] })
    expect(f).not.toHaveBeenCalled()
  })

  it('tetap nonaktif bila JSON rusak — bukan melempar error saat server mulai', async () => {
    const { fcmEnabled } = await muatFcm('{bukan json}')
    expect(fcmEnabled).toBe(false)
  })

  it('menerima service account dalam bentuk base64', async () => {
    const { fcmEnabled } = await muatFcm(Buffer.from(JSON.stringify(akun)).toString('base64'))
    expect(fcmEnabled).toBe(true)
  })
})

describe('FCM aktif', () => {
  it('menandatangani JWT yang benar-benar bisa diverifikasi kunci publiknya', async () => {
    vi.stubGlobal('fetch', fetchTiruan())
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    await sendFcm(['token-a'], { title: 'Darurat', body: 'Tolong' })

    const tukar = panggilan.find((p) => p.url.includes('oauth2.googleapis.com'))
    expect(tukar).toBeDefined()
    const body = new URLSearchParams(String(tukar?.init.body))
    const assertion = body.get('assertion') ?? ''
    const [h, c, sig] = assertion.split('.')
    expect(h && c && sig).toBeTruthy()

    // Inilah yang membedakan "kelihatan benar" dengan "benar": tanda tangan
    // diverifikasi memakai kunci publik pasangannya.
    const v = createVerify('RSA-SHA256')
    v.update(`${h}.${c}`)
    const sah = v.verify(publicKey, Buffer.from(sig, 'base64url'))
    expect(sah).toBe(true)

    const klaim = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, string>
    expect(klaim.iss).toBe(akun.client_email)
    expect(klaim.aud).toBe('https://oauth2.googleapis.com/token')
    expect(klaim.scope).toContain('firebase.messaging')
  })

  it('mengirim ke proyek yang benar dan menyebut channel sirene saat darurat', async () => {
    vi.stubGlobal('fetch', fetchTiruan())
    const { sendFcm, SOS_CHANNEL_ID } = await muatFcm(JSON.stringify(akun))
    const hasil = await sendFcm(['token-a'], {
      title: 'SOS',
      body: 'Tetangga butuh bantuan',
      urgent: true,
      url: '/incidents/r1',
      tag: 'sos-r1',
    })

    expect(hasil.sent).toBe(1)
    const kirim = panggilan.find((p) => p.url.includes('fcm.googleapis.com'))
    expect(kirim).toBeDefined()
    expect(kirim?.url).toBe('https://fcm.googleapis.com/v1/projects/wjw-uji/messages:send')
    const kepala = (kirim?.init.headers ?? {}) as Record<string, string>
    expect(kepala.authorization).toBe('Bearer token-uji')

    const m = JSON.parse(String(kirim?.init.body)) as {
      message: {
        token: string
        android: { priority: string; notification: { channel_id?: string } }
        data: Record<string, string>
      }
    }
    expect(m.message.token).toBe('token-a')
    expect(m.message.android.priority).toBe('HIGH')
    // Tanpa channel_id ini, Android memakai suara notifikasi bawaan dan
    // seluruh pekerjaan sirene jadi sia-sia.
    expect(m.message.android.notification.channel_id).toBe(SOS_CHANNEL_ID)
    expect(m.message.data.urgent).toBe('1')
    expect(m.message.data.url).toBe('/incidents/r1')
  })

  it('tidak memakai channel sirene untuk kabar biasa', async () => {
    vi.stubGlobal('fetch', fetchTiruan())
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    await sendFcm(['token-a'], { title: 'Iuran', body: 'Tagihan baru' })
    const kirim = panggilan.find((p) => p.url.includes('fcm.googleapis.com'))
    const m = JSON.parse(String(kirim?.init.body)) as {
      message: { android: { priority: string; notification: { channel_id?: string } } }
    }
    expect(m.message.android.notification.channel_id).toBeUndefined()
    expect(m.message.android.priority).toBe('NORMAL')
  })

  it('menukar access token sekali saja untuk banyak perangkat', async () => {
    vi.stubGlobal('fetch', fetchTiruan())
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    await sendFcm(['a', 'b', 'c'], { title: 'x', body: 'y' })
    const tukar = panggilan.filter((p) => p.url.includes('oauth2.googleapis.com'))
    const kirim = panggilan.filter((p) => p.url.includes('fcm.googleapis.com'))
    expect(tukar).toHaveLength(1)
    expect(kirim).toHaveLength(3)
  })

  it('menandai token perangkat mati agar dibuang pemanggil', async () => {
    let ke = 0
    vi.stubGlobal(
      'fetch',
      fetchTiruan(() => {
        ke++
        // Perangkat pertama: aplikasi sudah dihapus warga.
        if (ke === 1)
          return new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), {
            status: 404,
          })
        return new Response('{}', { status: 200 })
      }),
    )
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    const hasil = await sendFcm(['mati', 'hidup'], { title: 'x', body: 'y' })
    expect(hasil.invalid).toEqual(['mati'])
    expect(hasil.sent).toBe(1)
    expect(hasil.failed).toBe(1)
  })

  it('kegagalan sementara tidak membuang token perangkat', async () => {
    vi.stubGlobal(
      'fetch',
      fetchTiruan(() => new Response('server sedang sibuk', { status: 503 })),
    )
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    const hasil = await sendFcm(['token-a'], { title: 'x', body: 'y' })
    expect(hasil.invalid).toEqual([])
    expect(hasil.failed).toBe(1)
  })

  it('tidak mengirim dua kali ke token yang sama', async () => {
    vi.stubGlobal('fetch', fetchTiruan())
    const { sendFcm } = await muatFcm(JSON.stringify(akun))
    await sendFcm(['sama', 'sama', ''], { title: 'x', body: 'y' })
    expect(panggilan.filter((p) => p.url.includes('fcm.googleapis.com'))).toHaveLength(1)
  })
})
