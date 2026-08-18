/**
 * Memanggil warga di sekitar lokasi darurat.
 *
 * Radius bergerak antara 15 dan 70 meter: melebar mengikuti ketidakpastian
 * GPS, karena titik yang meleset belasan meter tidak boleh membuat
 * tetangga sebelah terlewat — tetapi tidak pernah melampaui 70 m, karena
 * memanggil orang yang terlalu jauh membuat peringatan kehilangan artinya.
 */
import { describe, expect, it } from 'vitest'
import {
  FRESH_MS,
  NEAR_MAX_M,
  NEAR_MIN_M,
  alertRadius,
  nearbyMembers,
  type NearbyRow,
} from './nearby.js'

/** Titik acuan di Soreang. */
const PUSAT = { lat: -6.9829, lng: 107.5197 }

/** Geser sejauh kira-kira n meter ke utara. */
function utara(meter: number) {
  return { lat: PUSAT.lat + meter / 111_320, lng: PUSAT.lng }
}

const SEKARANG = 1_700_000_000_000

function warga(over: Partial<NearbyRow> = {}): NearbyRow {
  return {
    id: 'm1',
    name: 'Warga',
    phone: '0811',
    role: 'warga',
    last_lat: PUSAT.lat,
    last_lng: PUSAT.lng,
    last_seen_at: SEKARANG,
    last_accuracy: 0,
    home_lat: null,
    home_lng: null,
    home_accuracy: null,
    ...over,
  }
}

describe('alertRadius', () => {
  it('tidak pernah lebih sempit dari 15 meter', () => {
    expect(alertRadius(0, 0)).toBe(NEAR_MIN_M)
    expect(alertRadius(null, null)).toBe(NEAR_MIN_M)
  })

  it('melebar mengikuti ketidakpastian GPS', () => {
    // 20 m + 15 m ketidakpastian = 35 m, masih di bawah batas atas.
    expect(alertRadius(20, 15)).toBe(35)
  })

  it('tidak pernah melampaui 70 meter', () => {
    expect(alertRadius(500, 500)).toBe(NEAR_MAX_M)
    expect(alertRadius(120, 0)).toBe(NEAR_MAX_M)
  })

  it('mengabaikan nilai akurasi yang tidak masuk akal', () => {
    expect(alertRadius(-50, -50)).toBe(NEAR_MIN_M)
    expect(alertRadius(Number.NaN, undefined)).toBe(NEAR_MIN_M)
  })
})

describe('nearbyMembers', () => {
  it('memanggil warga yang berada tepat di sebelah', () => {
    const hits = nearbyMembers(PUSAT, 0, [warga({ last_lat: utara(10).lat })], SEKARANG)
    expect(hits).toHaveLength(1)
    expect(hits[0].meters).toBeLessThanOrEqual(NEAR_MIN_M)
  })

  it('tidak memanggil yang berada di luar radius', () => {
    // 40 m dengan GPS akurat: radius tetap 15 m, jadi terlalu jauh.
    const hits = nearbyMembers(PUSAT, 0, [warga({ last_lat: utara(40).lat })], SEKARANG)
    expect(hits).toHaveLength(0)
  })

  it('memanggil yang 40 m ketika GPS sedang buruk', () => {
    // Ketidakpastian 50 m melebarkan radius, jadi tetangga itu ikut.
    const hits = nearbyMembers(PUSAT, 50, [warga({ last_lat: utara(40).lat })], SEKARANG)
    expect(hits).toHaveLength(1)
  })

  it('tetap tidak memanggil yang jauh melampaui batas atas', () => {
    // 200 m: sekalipun GPS sangat buruk, radius berhenti di 70 m.
    const hits = nearbyMembers(
      PUSAT,
      9999,
      [warga({ last_lat: utara(200).lat })],
      SEKARANG,
    )
    expect(hits).toHaveLength(0)
  })

  it('mengabaikan posisi yang sudah basi', () => {
    const basi = warga({ last_seen_at: SEKARANG - FRESH_MS - 1 })
    expect(nearbyMembers(PUSAT, 0, [basi], SEKARANG)).toHaveLength(0)
  })

  it('mengabaikan anggota yang belum pernah melaporkan posisi', () => {
    const tanpa = warga({ last_lat: null, last_lng: null, last_seen_at: null })
    expect(nearbyMembers(PUSAT, 0, [tanpa], SEKARANG)).toHaveLength(0)
  })

  it('tidak memanggil siapa pun bila lokasi darurat tidak diketahui', () => {
    // Menebak lebih buruk daripada tidak memanggil sama sekali.
    expect(nearbyMembers(null, 0, [warga()], SEKARANG)).toHaveLength(0)
  })

  it('mengurutkan yang paling dekat lebih dulu', () => {
    const hits = nearbyMembers(
      PUSAT,
      60,
      [
        warga({ id: 'jauh', last_lat: utara(50).lat }),
        warga({ id: 'dekat', last_lat: utara(5).lat }),
        warga({ id: 'sedang', last_lat: utara(25).lat }),
      ],
      SEKARANG,
    )
    expect(hits.map((h) => h.member.id)).toEqual(['dekat', 'sedang', 'jauh'])
  })

  it('menyertakan satpam maupun warga biasa', () => {
    const hits = nearbyMembers(
      PUSAT,
      0,
      [
        warga({ id: 'satpam1', role: 'satpam', last_lat: utara(8).lat }),
        warga({ id: 'warga1', role: 'warga', last_lat: utara(9).lat }),
      ],
      SEKARANG,
    )
    expect(hits.map((h) => h.member.role).sort()).toEqual(['satpam', 'warga'])
  })
})

/**
 * Letak rumah sebagai cadangan.
 *
 * Inilah yang membuat warga tetap terpanggil ketika aplikasinya tertutup:
 * tanpa posisi terkini, jaraknya dihitung dari rumahnya.
 */
describe('cadangan letak rumah', () => {
  it('memanggil warga berdasarkan rumahnya walau tanpa posisi terkini', () => {
    const tertutup = warga({
      last_lat: null,
      last_lng: null,
      last_seen_at: null,
      home_lat: utara(10).lat,
      home_lng: utara(10).lng,
      home_accuracy: 0,
    })
    const hits = nearbyMembers(PUSAT, 0, [tertutup], SEKARANG)
    expect(hits).toHaveLength(1)
    expect(hits[0].basis).toBe('home')
  })

  it('memakai rumah ketika posisi terkini sudah basi', () => {
    const basi = warga({
      last_lat: utara(500).lat,
      last_seen_at: SEKARANG - FRESH_MS - 1,
      home_lat: utara(10).lat,
      home_lng: utara(10).lng,
      home_accuracy: 0,
    })
    const hits = nearbyMembers(PUSAT, 0, [basi], SEKARANG)
    expect(hits).toHaveLength(1)
    // Jaraknya dihitung dari rumah, bukan dari titik basi yang jauh itu.
    expect(hits[0].basis).toBe('home')
    expect(hits[0].meters).toBeLessThanOrEqual(15)
  })

  it('mengutamakan posisi terkini daripada rumah', () => {
    // Rumahnya dekat, tetapi orangnya sedang jauh: jangan dipanggil.
    const sedangPergi = warga({
      last_lat: utara(400).lat,
      last_seen_at: SEKARANG,
      home_lat: PUSAT.lat,
      home_lng: PUSAT.lng,
      home_accuracy: 0,
    })
    expect(nearbyMembers(PUSAT, 0, [sedangPergi], SEKARANG)).toHaveLength(0)
  })

  it('tidak memanggil siapa pun yang rumahnya jauh', () => {
    const jauh = warga({
      last_lat: null,
      last_lng: null,
      last_seen_at: null,
      home_lat: utara(300).lat,
      home_lng: utara(300).lng,
      home_accuracy: 0,
    })
    expect(nearbyMembers(PUSAT, 0, [jauh], SEKARANG)).toHaveLength(0)
  })

  it('melewati anggota yang tidak punya rumah maupun posisi', () => {
    const kosong = warga({ last_lat: null, last_lng: null, last_seen_at: null })
    expect(nearbyMembers(PUSAT, 0, [kosong], SEKARANG)).toHaveLength(0)
  })

  it('pada jarak sama, yang posisinya terkini didahulukan', () => {
    const hits = nearbyMembers(
      PUSAT,
      0,
      [
        warga({
          id: 'rumah',
          last_lat: null,
          last_lng: null,
          last_seen_at: null,
          home_lat: utara(10).lat,
          home_lng: utara(10).lng,
          home_accuracy: 0,
        }),
        warga({ id: 'hadir', last_lat: utara(10).lat }),
      ],
      SEKARANG,
    )
    expect(hits.map((h) => h.member.id)).toEqual(['hadir', 'rumah'])
  })
})
