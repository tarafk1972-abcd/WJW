/**
 * Menentukan siapa yang berada di dekat sebuah peringatan darurat.
 *
 * Posisi TIDAK dikirim berkala. Aplikasi hanya menanyakan lokasi ketika
 * ada peringatan darurat yang sedang berlangsung di lingkungan itu —
 * di luar keadaan darurat, server tidak pernah tahu warga ada di mana.
 *
 * Aturannya: satpam dan warga yang berada dalam radius tertentu dari HP
 * yang menekan tombol darurat ikut menerima notifikasi — di samping
 * keluarga, teman, dan pengurus yang memang selalu dikabari.
 *
 * Radius tidak tetap. Titik GPS di ponsel bisa meleset belasan meter,
 * apalagi di antara bangunan. Radius 15 m yang kaku akan melewatkan
 * tetangga sebelah hanya karena sinyalnya kurang bagus. Maka radiusnya
 * melebar mengikuti ketidakpastian GPS, dibatasi 15–70 meter:
 *
 *   - fix bagus  → mendekati 15 m, hanya yang benar-benar berdekatan
 *   - fix buruk  → melebar sampai 70 m, agar tidak ada yang terlewat
 *
 * Melebihi 70 m sengaja tidak dilakukan: memanggil orang yang terlalu
 * jauh membuat peringatan kehilangan artinya.
 */
import { distanceMeters, type LatLng } from './geo.js'

/** Batas bawah radius pemberitahuan (meter). */
export const NEAR_MIN_M = 15

/** Batas atas radius pemberitahuan (meter). */
export const NEAR_MAX_M = 70

/**
 * Berapa lama posisi terakhir masih dianggap mewakili keberadaan orang.
 *
 * Pendek, karena posisi hanya dikumpulkan saat ada darurat: titik yang
 * lebih tua dari ini berasal dari kejadian sebelumnya dan tidak lagi
 * mewakili keberadaan orangnya.
 */
export const FRESH_MS = 10 * 60 * 1000

/**
 * Radius yang dipakai untuk satu peringatan.
 *
 * Menggabungkan ketidakpastian kedua belah pihak: yang meminta tolong dan
 * yang hendak dipanggil.
 */
export function alertRadius(
  accuracyPelapor: number | null | undefined,
  accuracyPenerima: number | null | undefined = 0,
): number {
  const a = Number.isFinite(accuracyPelapor as number) ? (accuracyPelapor as number) : 0
  const b = Number.isFinite(accuracyPenerima as number)
    ? (accuracyPenerima as number)
    : 0
  const kasar = Math.max(0, a) + Math.max(0, b)
  return Math.min(NEAR_MAX_M, Math.max(NEAR_MIN_M, kasar))
}

export interface NearbyRow {
  id: string
  name: string
  phone: string
  role: string
  last_lat: number | null
  last_lng: number | null
  last_seen_at: number | null
  last_accuracy: number | null
  /** Letak rumah — dipakai bila posisi terkini tidak tersedia. */
  home_lat: number | null
  home_lng: number | null
  home_accuracy: number | null
}

export interface NearbyHit {
  member: NearbyRow
  /** Jarak dari titik darurat, dibulatkan ke meter. */
  meters: number
  /** Radius yang berlaku untuk orang ini. */
  radius: number
  /**
   * Dasar perhitungan jaraknya:
   *   'live' — posisi terkini, orangnya memang sedang di sana;
   *   'home' — letak rumah, orangnya BELUM TENTU sedang di rumah.
   */
  basis: 'live' | 'home'
}

/**
 * Saring anggota yang posisinya cukup baru dan berada dalam radius.
 *
 * @param at        Titik tempat tombol darurat ditekan.
 * @param accuracy  Ketidakpastian GPS pelapor, dalam meter.
 * @param rows      Calon penerima (satpam dan warga, tanpa si pelapor).
 * @param now       Waktu acuan, agar bisa diuji.
 */
export function nearbyMembers(
  at: LatLng | null,
  accuracy: number | null | undefined,
  rows: NearbyRow[],
  now = Date.now(),
): NearbyHit[] {
  // Tanpa titik lokasi tidak ada yang bisa dihitung. Jangan menebak:
  // pemanggilan berdasarkan tebakan lebih buruk daripada tidak sama sekali.
  if (!at) return []

  const hits: NearbyHit[] = []
  for (const m of rows) {
    /*
     * Utamakan posisi terkini; bila tidak ada, pakai letak rumah.
     *
     * Rumah adalah yang membuat warga tetap terpanggil walau aplikasinya
     * tertutup. Konsekuensinya harus diakui: orangnya belum tentu sedang
     * di rumah. Karena itu dasarnya ditandai, agar pesan yang dikirim
     * tidak mengaku tahu lebih banyak daripada yang sebenarnya.
     */
    const segar =
      m.last_lat !== null &&
      m.last_lng !== null &&
      !!m.last_seen_at &&
      now - m.last_seen_at <= FRESH_MS

    const basis: 'live' | 'home' = segar ? 'live' : 'home'
    const lat = segar ? m.last_lat : m.home_lat
    const lng = segar ? m.last_lng : m.home_lng
    const acc = segar ? m.last_accuracy : m.home_accuracy
    if (lat === null || lng === null) continue

    const radius = alertRadius(accuracy, acc)
    const meters = distanceMeters(at, { lat, lng })
    if (meters <= radius)
      hits.push({ member: m, meters: Math.round(meters), radius, basis })
  }

  /*
   * Yang terdekat lebih dulu. Bila jaraknya sama, yang posisinya terkini
   * didahulukan: kepastian bahwa orangnya benar-benar di sana lebih
   * berharga daripada tebakan berdasarkan letak rumah.
   */
  hits.sort((x, y) => x.meters - y.meters || (x.basis === 'live' ? -1 : 1))
  return hits
}
