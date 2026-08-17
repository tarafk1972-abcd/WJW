/**
 * Service worker tidak boleh menyajikan kode aplikasi yang basi.
 *
 * Keluhan lapangan: setelah aplikasi diperbaiki dan dijalankan ulang,
 * layar warga MASIH menampilkan kalimat galat versi lama — bukti bahwa
 * yang berjalan di peramban bukan kode terbaru. Penyebabnya di sini:
 * berkas statis disajikan "cache-first", jadi salinan lama dipakai lebih
 * dulu dan versi baru hanya diambil diam-diam untuk kunjungan berikutnya.
 *
 * Untuk ikon dan font itu wajar. Untuk JavaScript yang MEMBAWA logika
 * aplikasi, akibatnya perbaikan tampak tidak pernah sampai — persis
 * gejala yang dilaporkan: kode undangan yang sah tetap ditolak dengan
 * pesan versi lama.
 *
 * Berkas ini menjalankan sw.js sungguhan, bukan mencocokkan teksnya.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Cache tiruan sederhana, cukup untuk perilaku yang diuji. */
function bikinCache(isi: Record<string, string>) {
  const simpanan = new Map(Object.entries(isi))
  return {
    simpanan,
    cache: {
      match: (req: { url: string }) =>
        Promise.resolve(
          simpanan.has(req.url) ? new Response(simpanan.get(req.url)) : undefined,
        ),
      put: (req: { url: string }, res: Response) =>
        res.text().then((t) => {
          simpanan.set(req.url, t)
        }),
      add: () => Promise.resolve(),
      addAll: () => Promise.resolve(),
    },
  }
}

/**
 * Muat sw.js di dalam lingkungan tiruan dan kembalikan handler fetch-nya.
 */
function muatSW(isiCache: Record<string, string>) {
  const { cache, simpanan } = bikinCache(isiCache)
  const pendengar: Record<string, (e: unknown) => void> = {}

  const self = {
    addEventListener: (nama: string, fn: (e: unknown) => void) => {
      pendengar[nama] = fn
    },
    location: { origin: 'https://wjw.test' },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() },
  }

  const caches = {
    open: () => Promise.resolve(cache),
    match: (req: unknown) =>
      cache.match(typeof req === 'string' ? { url: req } : (req as { url: string })),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
  }

  const kode = readFileSync('public/sw.js', 'utf8')
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'URL', kode)(
    self,
    caches,
    (...a: unknown[]) => (globalThis.fetch as (...x: unknown[]) => unknown)(...a),
    Response,
    URL,
  )

  return { pendengar, simpanan }
}

/** Jalankan handler fetch untuk satu permintaan, kembalikan isi jawabannya. */
async function minta(
  pendengar: Record<string, (e: unknown) => void>,
  url: string,
  destination: string,
) {
  let hasil: Promise<Response> | null = null
  const req = { url, method: 'GET', mode: 'no-cors', destination }
  pendengar.fetch({
    request: req,
    respondWith: (p: Promise<Response>) => {
      hasil = p
    },
  })
  if (!hasil) return null
  const res = await (hasil as Promise<Response>)
  return res ? await res.text() : null
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('kesegaran kode aplikasi', () => {
  it('menyajikan JavaScript terbaru, bukan salinan lama di cache', async () => {
    const url = 'https://wjw.test/assets/index-abc123.js'
    const { pendengar } = muatSW({ [url]: 'KODE_LAMA' })

    // Jaringan hidup dan punya versi baru.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('KODE_BARU', { status: 200 }),
    )

    const isi = await minta(pendengar, url, 'script')

    /*
     * Inilah bugnya: dulu jawabannya KODE_LAMA, sehingga perbaikan apa
     * pun tertahan setidaknya satu kunjungan — dan pengguna yang tidak
     * menutup tabnya bisa tertahan berhari-hari, melihat pesan galat
     * lama atas kode undangan yang sebenarnya sah.
     */
    expect(isi).toBe('KODE_BARU')
  })

  it('memakai salinan tersimpan bila jaringan mati', async () => {
    const url = 'https://wjw.test/assets/index-abc123.js'
    const { pendengar } = muatSW({ [url]: 'KODE_LAMA' })

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

    // Mendahulukan jaringan tidak boleh mengorbankan mode luring:
    // aplikasi darurat harus tetap terbuka tanpa sinyal.
    expect(await minta(pendengar, url, 'script')).toBe('KODE_LAMA')
  })

  it('ikon dan gambar tetap boleh dari cache dulu (hemat kuota)', async () => {
    const url = 'https://wjw.test/icon-192.png'
    const { pendengar } = muatSW({ [url]: 'IKON_TERSIMPAN' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('IKON_BARU'))

    expect(await minta(pendengar, url, 'image')).toBe('IKON_TERSIMPAN')
  })
})
