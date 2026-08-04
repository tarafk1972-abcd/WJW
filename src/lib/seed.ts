import {
  DAY,
  addAnnouncement,
  addContact,
  addIncidentMessage,
  respondSafety,
  respondToReport,
  saveEmergencyProfile,
  sendBroadcast,
  addGuest,
  addReport,
  createInvite,
  decideMember,
  loadDB,
  openTicket,
  register,
  saveArea,
  saveDB,
  setSession,
  startPatrol,
  addPatrolPoint,
  endPatrol,
} from './db'
import type { LatLng } from './types'

const CENTER = { lat: -6.9829, lng: 107.5197 } // Soreang, Kab. Bandung

const AREA: LatLng[] = [
  { lat: -6.9795, lng: 107.5155 },
  { lat: -6.9793, lng: 107.5242 },
  { lat: -6.9865, lng: 107.5249 },
  { lat: -6.9871, lng: 107.5152 },
]

/**
 * Populates a realistic demo neighbourhood. Only runs on an empty database.
 * Returns the admin id so the caller can sign in as them.
 */
export function seedDemo(): string | null {
  const db = loadDB()
  if (db.communities.length) return null

  const admin = register({
    name: 'Budi Santoso',
    phone: '081234567890',
    email: 'budi@warga.id',
    password: 'warga123',
    house: 'Blok C No. 12',
    language: 'id',
    mode: 'create',
    communityName: 'RW 05 Griya Soreang',
    communityAddress: 'Jl. Raya Soreang No. 1',
    city: 'Kab. Bandung',
    center: CENTER,
  })
  if (!admin.ok) return null

  const cid = admin.community.id
  const aid = admin.member.id

  saveArea(aid, cid, AREA)

  const people: {
    name: string
    phone: string
    email: string
    house: string
    role: 'warga' | 'satpam' | 'admin'
    approve: boolean
  }[] = [
    { name: 'Siti Aminah', phone: '081298765432', email: 'siti@warga.id', house: 'Blok A No. 3', role: 'admin', approve: true },
    { name: 'Pak Joko', phone: '081377788899', email: 'joko@warga.id', house: 'Pos Satpam', role: 'satpam', approve: true },
    { name: 'Pak Rahmat', phone: '081355566677', email: 'rahmat@warga.id', house: 'Pos Satpam', role: 'satpam', approve: true },
    { name: 'Dewi Lestari', phone: '081211223344', email: 'dewi@warga.id', house: 'Blok B No. 7', role: 'warga', approve: true },
    { name: 'Agus Priyanto', phone: '081255667788', email: 'agus@warga.id', house: 'Blok D No. 21', role: 'warga', approve: true },
    { name: 'Rina Marlina', phone: '081299001122', email: 'rina@warga.id', house: 'Blok A No. 9', role: 'warga', approve: false },
    { name: 'Hendra Wijaya', phone: '081244556677', email: 'hendra@warga.id', house: 'Blok E No. 2', role: 'warga', approve: false },
  ]

  const ids: Record<string, string> = {}
  for (const p of people) {
    const r = register({
      name: p.name,
      phone: p.phone,
      email: p.email,
      password: 'warga123',
      house: p.house,
      language: 'id',
      mode: 'join',
      communityId: cid,
    })
    if (!r.ok) continue
    ids[p.name] = r.member.id
    if (p.approve) decideMember(aid, r.member.id, 'accept', p.role)
  }

  // registration writes a session for each new member — restore the admin's
  setSession(aid)

  createInvite(aid, cid, 'admin')
  createInvite(aid, cid, 'satpam')

  addAnnouncement({
    communityId: cid,
    authorId: aid,
    title: 'Ronda malam mulai pukul 22.00',
    body: 'Mohon warga Blok A dan B yang terjadwal hadir di pos satpam tepat waktu.',
    pinned: true,
  })
  addAnnouncement({
    communityId: cid,
    authorId: ids['Siti Aminah'] ?? aid,
    title: 'Kerja bakti Minggu pagi',
    body: 'Kerja bakti membersihkan saluran air, mulai pukul 07.00 di lapangan.',
    pinned: false,
  })

  addReport({
    communityId: cid,
    authorId: ids['Dewi Lestari'] ?? aid,
    kind: 'incident',
    category: 'suspicious',
    note: 'Ada dua orang tidak dikenal berkeliling sejak sore.',
    at: { lat: -6.9812, lng: 107.5187 },
    address: 'Depan Blok B',
  })
  addReport({
    communityId: cid,
    authorId: ids['Agus Priyanto'] ?? aid,
    kind: 'incident',
    category: 'theft',
    note: 'Helm hilang dari teras rumah.',
    at: { lat: -6.9841, lng: 107.5211 },
    address: 'Blok D No. 21',
  })
  const flood = addReport({
    communityId: cid,
    authorId: aid,
    kind: 'incident',
    category: 'flood',
    note: 'Genangan air setinggi 20 cm di jalan utama.',
    at: { lat: -6.9829, lng: 107.5163 },
    address: 'Jalan utama',
  })

  // an anonymous tip, SaferWatch style
  addReport({
    communityId: cid,
    authorId: ids['Dewi Lestari'] ?? aid,
    kind: 'tip',
    category: 'drugs',
    note: 'Sering ada transaksi mencurigakan di gang belakang saat larut malam.',
    at: { lat: -6.9856, lng: 107.5196 },
    address: 'Gang belakang Blok D',
    anonymous: true,
  })

  // a live panic alert with responders and a running conversation
  const sos = addReport({
    communityId: cid,
    authorId: ids['Rina Marlina'] ?? ids['Agus Priyanto'] ?? aid,
    kind: 'sos',
    category: 'medical',
    note: 'Darurat medis',
    at: { lat: -6.9822, lng: 107.5218 },
    address: 'Blok A No. 9',
  })
  respondToReport(ids['Pak Joko'] ?? aid, sos.id)
  addIncidentMessage(sos.id, ids['Pak Joko'] ?? aid, 'Saya sudah di lokasi, ambulans dalam perjalanan.')

  respondToReport(ids['Pak Rahmat'] ?? aid, flood.id)

  addGuest({
    communityId: cid,
    name: 'Kurir JNE',
    purpose: 'Antar paket',
    host: 'Blok C No. 12',
    plate: 'D 1234 ABC',
    idCard: '327xxxx',
    recordedBy: ids['Pak Joko'] ?? aid,
  })
  addGuest({
    communityId: cid,
    name: 'Ahmad Fauzi',
    purpose: 'Kunjungan keluarga',
    host: 'Blok A No. 3',
    plate: 'D 5678 XYZ',
    idCard: '327yyyy',
    recordedBy: ids['Pak Joko'] ?? aid,
  })

  const patrol = startPatrol(cid, ids['Pak Joko'] ?? aid)
  ;[
    { lat: -6.9799, lng: 107.5162, note: 'Pos 1 aman' },
    { lat: -6.9815, lng: 107.5205, note: 'Pos 2 aman' },
    { lat: -6.9848, lng: 107.5228, note: 'Lampu jalan mati' },
    { lat: -6.9862, lng: 107.5171, note: 'Pos 4 aman' },
  ].forEach((p) => addPatrolPoint(patrol.id, p))
  endPatrol(patrol.id)

  // Budi's personal safety network (family + trusted friends)
  addContact({
    ownerId: aid,
    communityId: cid,
    name: 'Siti Aminah (Istri)',
    phone: '081298765432',
    kind: 'family',
    verified: true,
    memberId: ids['Siti Aminah'] ?? null,
  })
  addContact({
    ownerId: aid,
    communityId: cid,
    name: 'Eko Prasetyo (Kakak)',
    phone: '081234000111',
    kind: 'family',
    verified: true,
    memberId: null,
  })
  addContact({
    ownerId: aid,
    communityId: cid,
    name: 'Dewi Lestari',
    phone: '081211223344',
    kind: 'friend',
    verified: true,
    memberId: ids['Dewi Lestari'] ?? null,
  })
  // community volunteers, verified by the admin
  addContact({
    ownerId: null,
    communityId: cid,
    name: 'Tim Relawan RW 05',
    phone: '081277788899',
    kind: 'volunteer',
    verified: true,
    memberId: null,
  })
  addContact({
    ownerId: null,
    communityId: cid,
    name: 'Yanto (calon relawan)',
    phone: '081266655544',
    kind: 'volunteer',
    verified: false,
    memberId: null,
  })

  saveEmergencyProfile(aid, {
    bloodType: 'O',
    allergies: 'Penisilin',
    conditions: 'Hipertensi',
    contactName: 'Siti Aminah',
    contactPhone: '081298765432',
    notes: 'Rutin minum obat tekanan darah.',
  })

  const bc = sendBroadcast({
    communityId: cid,
    authorId: aid,
    severity: 'warning',
    title: 'Genangan air di jalan utama',
    body: 'Hujan deras menyebabkan genangan setinggi 20 cm di jalan utama.',
    instruction: 'Hindari jalan utama, gunakan jalur Blok B.',
    requireSafetyCheck: true,
  })
  respondSafety(bc.id, ids['Dewi Lestari'] ?? aid, 'safe')
  respondSafety(bc.id, ids['Agus Priyanto'] ?? aid, 'safe')

  openTicket(
    cid,
    aid,
    'Cara menambah satpam kedua',
    'Halo CS, bagaimana cara mengundang satpam tambahan ke aplikasi?',
  )

  // backdate a little so timestamps look natural
  const fresh = loadDB()
  const now = Date.now()
  fresh.reports.forEach((r, i) => (r.createdAt = now - (i + 1) * 3600_000))
  fresh.announcements.forEach((a, i) => (a.createdAt = now - (i + 1) * 7200_000))
  fresh.guests.forEach((g, i) => (g.checkIn = now - (i + 1) * 5400_000))
  const c = fresh.communities[0]
  c.createdAt = now - 3 * DAY
  c.trialEndsAt = now + 11 * DAY // 3 days into the 14-day trial
  saveDB(fresh)
  setSession(aid)

  return aid
}
