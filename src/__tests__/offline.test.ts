import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, setToken } from '../lib/api'

describe('deteksi server tidak terjangkau', () => {
  beforeEach(() => {
    localStorage.clear()
    setToken(null)
  })

  it('fetch gagal total -> status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'))
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'errOffline', status: 0 })
    vi.restoreAllMocks()
  })

  // Kasus nyata: web hidup tapi API mati, proxy Vite membalas 502.
  it('proxy membalas 502 saat API mati -> harus dianggap offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 502, statusText: 'Bad Gateway' }),
    )
    let err: unknown
    try {
      await api.get('/invites/TJEJUJ')
    } catch (e) {
      err = e
    }
    vi.restoreAllMocks()
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })

  it('503 dan 504 juga dianggap offline', async () => {
    for (const code of [503, 504]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: code }))
      let err: unknown
      try {
        await api.get('/x')
      } catch (e) {
        err = e
      }
      vi.restoreAllMocks()
      expect((err as ApiError).status).toBe(0)
    }
  })

  it('404 tetap error sungguhan, bukan offline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'errInvite' }), { status: 404 }),
    )
    let err: unknown
    try {
      await api.get('/invites/NOPE')
    } catch (e) {
      err = e
    }
    vi.restoreAllMocks()
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).code).toBe('errInvite')
  })
})

describe('alur kode undangan saat server mati', () => {
  beforeEach(() => {
    localStorage.clear()
    setToken(null)
  })

  it('kode lokal yang sah tetap diterima walau proxy membalas 502', async () => {
    const { invalidateCache, register, createInvite, lookupInvite } = await import('../lib/db')
    invalidateCache()

    // buat lingkungan + undangan di penyimpanan lokal
    const f = register({
      name: 'Budi', phone: '081200000001', email: 'b@x.id', password: 'secret1',
      house: 'C12', language: 'id', mode: 'create', communityName: 'RW 05',
    })
    if (!f.ok) throw new Error('setup')
    const inv = createInvite(f.member.id, f.community.id, 'warga')

    // server mati -> proxy 502
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }))

    // yang dilakukan halaman: coba server, gagal offline, lalu pakai lokal
    let offline = false
    try {
      await api.get(`/invites/${inv.code}`)
    } catch (e) {
      offline = e instanceof ApiError && e.status === 0
    }
    vi.restoreAllMocks()

    expect(offline).toBe(true)
    const local = lookupInvite(inv.code)
    expect(local.ok).toBe(true)
  })
})
