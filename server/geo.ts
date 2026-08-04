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
  grace_min: number
  active: number
}

/** Jadwal yang berlaku pada waktu tertentu; menangani lintas tengah malam. */
export function activeSchedule(
  schedules: ScheduleLike[],
  at: number,
): { schedule: ScheduleLike; late: boolean } | null {
  const mins = minutesOfDay(at)
  const day = new Date(at).getDay()

  for (const sc of schedules) {
    if (!sc.active) continue
    const days: number[] = JSON.parse(sc.days || '[]')
    if (days.length && !days.includes(day)) continue

    const overnight = sc.end_minute <= sc.start_minute
    const end = overnight ? sc.end_minute + 1440 : sc.end_minute
    const nowMin = overnight && mins < sc.start_minute ? mins + 1440 : mins

    if (nowMin >= sc.start_minute && nowMin <= end) {
      return { schedule: sc, late: nowMin > sc.start_minute + sc.grace_min }
    }
  }
  return null
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}
