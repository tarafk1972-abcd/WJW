export interface LatLng {
  lat: number
  lng: number
}

/** Jarak dua koordinat dalam meter (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng
    const yi = poly[i].lat
    const xj = poly[j].lng
    const yj = poly[j].lat
    const intersect =
      yi > p.lat !== yj > p.lat &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function minutesOfDay(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

export interface ScheduleLike {
  id: string
  label: string
  start_minute: number
  end_minute: number
  days: string
  /** Kosong = semua satpam; diisi = hanya satpam yang ditunjuk. */
  assigned_satpam_ids?: string
  grace_min: number
  active: number
}

function numberArray(raw: string): number[] | null {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 6)
      ? (value as number[])
      : null
  } catch {
    return null
  }
}

function stringArray(raw: string | undefined): string[] | null {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? (value as string[])
      : null
  } catch {
    return null
  }
}

/**
 * Jadwal yang berlaku pada waktu tertentu; menangani lintas tengah malam.
 * `satpamId` opsional agar admin tetap dapat melihat status semua jadwal,
 * sedangkan satpam hanya dapat memperoleh jadwal yang memang ditugaskan.
 */
export function activeSchedule(
  schedules: ScheduleLike[],
  at: number,
  satpamId?: string,
): { schedule: ScheduleLike; late: boolean } | null {
  const mins = minutesOfDay(at)
  const day = new Date(at).getDay()

  for (const sc of schedules) {
    if (!sc.active) continue
    const days = numberArray(sc.days)
    const assignees = stringArray(sc.assigned_satpam_ids)
    // Data jadwal rusak tidak boleh menjatuhkan endpoint patrol atau tiba-tiba
    // diterapkan kepada satpam yang salah.
    if (!days || !assignees) continue
    if (satpamId && assignees.length && !assignees.includes(satpamId)) continue

    const overnight = sc.end_minute <= sc.start_minute
    const end = overnight ? sc.end_minute + 1440 : sc.end_minute
    const afterMidnight = overnight && mins < sc.start_minute
    const nowMin = afterMidnight ? mins + 1440 : mins
    // Jam 01.00 Selasa untuk shift Senin 23.00–02.00 masih memakai hari
    // Senin, bukan hari kalender Selasa.
    const scheduleDay = afterMidnight ? (day + 6) % 7 : day
    if (days.length && !days.includes(scheduleDay)) continue

    if (nowMin >= sc.start_minute && nowMin <= end) {
      return { schedule: sc, late: nowMin > sc.start_minute + sc.grace_min }
    }
  }
  return null
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}
