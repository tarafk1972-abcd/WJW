/**
 * GPS mati diam-diam saat aplikasi dibuka lewat alamat http:// biasa.
 *
 * Keluhan lapangan: satpam membuka aplikasi di HP lewat Wi-Fi
 * (http://192.168.1.5:5173), lalu di titik ronda tombolnya tidak pernah
 * bisa merekam — tanpa penjelasan apa pun.
 *
 * Sebabnya bukan GPS HP dan bukan izin yang salah tekan: peramban
 * MEMBLOKIR navigator.geolocation pada halaman yang bukan "konteks
 * aman". Hanya https:// dan localhost yang dianggap aman; alamat LAN
 * seperti 192.168.x.x lewat http tidak. Chrome bahkan tidak menampilkan
 * permintaan izin — panggilannya langsung gagal.
 *
 * Yang paling merugikan: aplikasi lama memperlakukan kegagalan itu sama
 * seperti "GPS sedang tidak dapat sinyal", sehingga satpam disuruh
 * mencoba lagi selamanya untuk keadaan yang tidak akan pernah berubah
 * dengan mencoba lagi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFix, locationBlockedReason } from '../lib/capture'

/** Palsukan status konteks aman + ada/tidaknya API geolokasi. */
function aturLingkungan(opts: { secure: boolean; adaApi?: boolean }) {
  Object.defineProperty(globalThis, 'isSecureContext', {
    value: opts.secure,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'geolocation', {
    value:
      opts.adaApi === false
        ? undefined
        : {
            getCurrentPosition: (
              _ok: PositionCallback,
              err?: PositionErrorCallback,
            ) => {
              // Persis perilaku Chrome di origin tidak aman: langsung
              // ditolak, tanpa pernah menanyakan izin.
              err?.({ code: 1, message: 'Only secure origins are allowed' } as
                GeolocationPositionError)
            },
          },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('mengenali sebab GPS terblokir', () => {
  it('menyebut alamat tidak aman sebagai sebabnya, bukan sekadar gagal', () => {
    aturLingkungan({ secure: false })
    /*
     * Tanpa ini, satu-satunya informasi yang sampai ke satpam adalah
     * "lokasi tidak tersedia" — yang menyesatkan, karena mencoba lagi
     * tidak akan pernah menolong.
     */
    expect(locationBlockedReason()).toBe('insecure')
  })

  it('tidak menyalahkan alamat bila halamannya memang aman', () => {
    aturLingkungan({ secure: true })
    expect(locationBlockedReason()).toBeNull()
  })

  it('membedakan peramban yang memang tidak punya GPS', () => {
    aturLingkungan({ secure: true, adaApi: false })
    expect(locationBlockedReason()).toBe('unsupported')
  })
})

describe('getFix di halaman tidak aman', () => {
  it('tetap null (tidak melempar), agar layar lain tidak ikut rusak', async () => {
    aturLingkungan({ secure: false })
    await expect(getFix(50)).resolves.toBeNull()
  })

  it('melepas jalur SOS bila WebView tidak pernah membalas GPS', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    })
    const fix = getFix(50)
    await vi.advanceTimersByTimeAsync(151)
    await expect(fix).resolves.toBeNull()
    vi.useRealTimers()
  })
})
