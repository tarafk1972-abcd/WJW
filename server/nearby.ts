/**
 * Menentukan siapa yang berada di dekat sebuah peringatan darurat.
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
 * Lebih lama dari ini, orangnya besar kemungkinan sudah pindah tempat;
 * memanggilnya sebagai "tetangga terdekat" hanya akan menyesatkan.
 */
export const FRESH_MS = 15 * 60 * 1000

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
}

export interface NearbyHit {
  member: NearbyRow
  /** Jarak dari titik darurat, dibulatkan ke meter. */
  meters: number
  /** Radius yang berlaku untuk orang ini. */
  radius: number
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
    if (m.last_lat === null || m.last_lng === null || !m.last_seen_at) continue
    if (now - m.last_seen_at > FRESH_MS) continue

    const radius = alertRadius(accuracy, m.last_accuracy)
    const meters = distanceMeters(at, { lat: m.last_lat, lng: m.last_lng })
    if (meters <= radius) hits.push({ member: m, meters: Math.round(meters), radius })
  }

  // Yang terdekat lebih dulu — merekalah yang paling cepat bisa menolong.
  hits.sort((x, y) => x.meters - y.meters)
  return hits
}
