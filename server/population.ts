import { db, now, uid, type MemberRow } from './db.js'

/** Data minimal kependudukan—tidak menyimpan NIK, foto KTP, atau data sensitif lain. */
export interface HouseholdMemberView {
  id: string
  name: string
  relationship: string
  birthDate: string | null
  ageGroup: 'adult' | 'child' | 'unknown'
  role: string
  status: string
}

export interface HouseholdView {
  id: string
  address: string
  rt: string
  rw: string
  block: string
  headMemberId: string
  headName: string
  members: HouseholdMemberView[]
}

export interface PopulationView {
  households: HouseholdView[]
  summary: {
    households: number
    residents: number
    adults: number
    children: number
    ageUnknown: number
    pending: number
  }
  canManage: boolean
}

type HouseholdRow = {
  id: string
  community_id: string
  address_key: string
  address: string
  head_member_id: string
  rt: string
  rw: string
  block: string
  created_at: number
  updated_at: number
}

type PopulationMemberRow = {
  household_id: string
  member_id: string
  relationship: string
  birth_date: string | null
  name: string
  role: string
  status: string
}

export class PopulationError extends Error {
  readonly code: 'not_found' | 'forbidden' | 'invalid_population_input' | 'invalid_household_head'

  constructor(code: 'not_found' | 'forbidden' | 'invalid_population_input' | 'invalid_household_head') {
    super(code)
    this.code = code
    this.name = 'PopulationError'
  }
}

/** Alamat dibandingkan tanpa perbedaan kapital, tanda baca dan spasi ganda. */
export function addressKey(address: string): string {
  return address
    .toLocaleLowerCase('id-ID')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function canManage(me: MemberRow): boolean {
  return me.role === 'admin' || me.role === 'superadmin'
}

function validBirthDate(value: unknown): string | null | undefined {
  // `undefined` berarti field tidak ikut diubah. `null`/string kosong adalah
  // permintaan eksplisit untuk menghapus tanggal lahir.
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const at = Date.UTC(year, month - 1, day)
  const d = new Date(at)
  if (
    year < 1900 ||
    year > new Date().getUTCFullYear() ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    return undefined
  return value
}

function ageGroup(birthDate: string | null): HouseholdMemberView['ageGroup'] {
  if (!birthDate) return 'unknown'
  const [year, month, day] = birthDate.split('-').map(Number)
  const nowDate = new Date()
  let age = nowDate.getUTCFullYear() - year
  if (
    nowDate.getUTCMonth() + 1 < month ||
    (nowDate.getUTCMonth() + 1 === month && nowDate.getUTCDate() < day)
  )
    age -= 1
  return age >= 18 ? 'adult' : 'child'
}

/**
 * Pastikan seorang anggota berada dalam tepat satu KK. Untuk alamat yang
 * sudah dikenal, anggota baru selalu masuk KK tersebut dan tidak dapat diam-
 * diam menjadi kepala keluarga kedua. Untuk alamat baru, ia menjadi kepala
 * sementara sampai admin memilih kepala lain.
 */
export function ensureHouseholdForMember(input: {
  communityId: string
  memberId: string
  address: string
  createdAt?: number
}): string {
  const key = addressKey(input.address) || `tanpa-alamat-${input.memberId}`
  const existing = db
    .prepare('SELECT * FROM households WHERE community_id=? AND address_key=?')
    .get(input.communityId, key) as HouseholdRow | undefined
  const at = input.createdAt ?? now()
  let householdId: string
  if (existing) {
    householdId = existing.id
  } else {
    householdId = uid('kk_')
    db.prepare(
      `INSERT INTO households
       (id,community_id,address_key,address,head_member_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(householdId, input.communityId, key, input.address.trim() || 'Alamat belum diisi', input.memberId, at, at)
  }
  db.prepare(
    `INSERT INTO household_members (household_id,member_id,relationship,joined_at)
     VALUES (?,?,?,?) ON CONFLICT(member_id) DO NOTHING`,
  ).run(householdId, input.memberId, existing ? 'Anggota keluarga' : 'Kepala keluarga', at)
  return householdId
}

/** Migrasi aman untuk komunitas yang sudah ada sebelum modul KK diperkenalkan. */
export function ensurePopulationHouseholds(): void {
  const members = db
    .prepare(
      `SELECT id,community_id,house,created_at,status FROM members
       WHERE community_id IS NOT NULL ORDER BY community_id, status='active' DESC, created_at ASC`,
    )
    .all() as { id: string; community_id: string; house: string; created_at: number; status: string }[]
  const repair = db.transaction(() => {
    for (const member of members) {
      ensureHouseholdForMember({
        communityId: member.community_id,
        memberId: member.id,
        address: member.house,
        createdAt: member.created_at,
      })
    }
    // Bila kepala lama sudah tidak aktif sedangkan ada anggota aktif, pilih
    // anggota aktif paling awal. Ini menjaga iuran tidak tertuju ke akun
    // pending/rejected yang tidak dapat mengajukan pembayaran.
    const households = db.prepare('SELECT * FROM households').all() as HouseholdRow[]
    for (const household of households) {
      const head = db
        .prepare('SELECT status FROM members WHERE id=? AND community_id=?')
        .get(household.head_member_id, household.community_id) as { status: string } | undefined
      if (head?.status === 'active') continue
      const replacement = db
        .prepare(
          `SELECT m.id FROM household_members hm JOIN members m ON m.id=hm.member_id
           WHERE hm.household_id=? AND m.community_id=? AND m.status='active'
           ORDER BY m.created_at ASC LIMIT 1`,
        )
        .get(household.id, household.community_id) as { id: string } | undefined
      if (replacement) {
        db.prepare('UPDATE households SET head_member_id=?, updated_at=? WHERE id=?').run(
          replacement.id,
          now(),
          household.id,
        )
        db.prepare('UPDATE household_members SET relationship=? WHERE household_id=? AND member_id=?').run(
          'Kepala keluarga',
          household.id,
          replacement.id,
        )
      }
    }
  })
  repair()
}

function rowsForCommunity(communityId: string): { households: HouseholdRow[]; members: PopulationMemberRow[] } {
  ensurePopulationHouseholds()
  const households = db
    .prepare('SELECT * FROM households WHERE community_id=? ORDER BY block, rw, rt, address')
    .all(communityId) as HouseholdRow[]
  if (!households.length) return { households, members: [] }
  const members = db
    .prepare(
      `SELECT hm.household_id,hm.member_id,hm.relationship,hm.birth_date,m.name,m.role,m.status
       FROM household_members hm JOIN members m ON m.id=hm.member_id
       WHERE m.community_id=? ORDER BY m.status='active' DESC,m.name`,
    )
    .all(communityId) as PopulationMemberRow[]
  return { households, members }
}

export function populationOverview(me: MemberRow): PopulationView {
  if (!me.community_id) throw new PopulationError('forbidden')
  const { households, members } = rowsForCommunity(me.community_id)
  const ownHouseholdId = members.find((member) => member.member_id === me.id)?.household_id
  const isManager = canManage(me)
  const visibleHouseholds = isManager
    ? households
    : households.filter((household) => household.id === ownHouseholdId)
  const activeCommunityMembers = members.filter((member) => member.status === 'active')
  const activeHouseholdIds = new Set(activeCommunityMembers.map((member) => member.household_id))
  const groups = activeCommunityMembers.map((member) => ageGroup(member.birth_date))

  return {
    households: visibleHouseholds.map((household) => {
      const items = members.filter((member) => member.household_id === household.id)
      const head = items.find((member) => member.member_id === household.head_member_id)
      return {
        id: household.id,
        address: household.address,
        rt: household.rt,
        rw: household.rw,
        block: household.block,
        headMemberId: household.head_member_id,
        headName: head?.name ?? 'Belum ditetapkan',
        members: items.map((member) => ({
          id: member.member_id,
          name: member.name,
          relationship:
            member.member_id === household.head_member_id ? 'Kepala keluarga' : member.relationship,
          birthDate: isManager || member.member_id === me.id ? member.birth_date : null,
          ageGroup: ageGroup(member.birth_date),
          role: member.role,
          status: member.status,
        })),
      }
    }),
    // Statistik agregat boleh dibaca warga; daftar KK tetangga tidak ikut.
    summary: {
      // Pendaftar pending tetap dapat dilihat pengurus di daftar, tetapi belum
      // dihitung sebagai KK/residen resmi pada statistik komunitas.
      households: activeHouseholdIds.size,
      residents: activeCommunityMembers.length,
      adults: groups.filter((group) => group === 'adult').length,
      children: groups.filter((group) => group === 'child').length,
      ageUnknown: groups.filter((group) => group === 'unknown').length,
      pending: members.filter((member) => member.status === 'pending').length,
    },
    canManage: isManager,
  }
}

export function listBillableHouseholdHeads(communityId: string): { id: string; name: string; house: string }[] {
  ensurePopulationHouseholds()
  return db
    .prepare(
      `SELECT m.id,m.name,h.address AS house
       FROM households h JOIN members m ON m.id=h.head_member_id
       WHERE h.community_id=? AND m.status='active' AND m.role IN ('warga','satpam','admin')
       ORDER BY h.block,h.rw,h.rt,h.address,m.name`,
    )
    .all(communityId) as { id: string; name: string; house: string }[]
}

export function setHouseholdHead(me: MemberRow, householdId: string, memberId: unknown): HouseholdView {
  if (!me.community_id || !canManage(me)) throw new PopulationError('forbidden')
  if (typeof memberId !== 'string') throw new PopulationError('invalid_population_input')
  const household = db
    .prepare('SELECT * FROM households WHERE id=? AND community_id=?')
    .get(householdId, me.community_id) as HouseholdRow | undefined
  if (!household) throw new PopulationError('not_found')
  const candidate = db
    .prepare(
      `SELECT m.id FROM household_members hm JOIN members m ON m.id=hm.member_id
       WHERE hm.household_id=? AND hm.member_id=? AND m.community_id=? AND m.status='active'`,
    )
    .get(householdId, memberId, me.community_id) as { id: string } | undefined
  if (!candidate) throw new PopulationError('invalid_household_head')

  // UNIQUE(community_id, head_member_id) memastikan satu orang tidak menjadi
  // kepala dari dua alamat; anggota memang hanya boleh ada pada satu KK juga.
  const at = now()
  const moveHead = db.transaction(() => {
    if (candidate.id === household.head_member_id) return
    db.prepare('UPDATE households SET head_member_id=?, updated_at=? WHERE id=? AND community_id=?').run(
      candidate.id,
      at,
      householdId,
      me.community_id,
    )
    // `head_member_id` adalah sumber kebenaran, tetapi label relasi juga
    // dirapikan supaya ekspor/audit tabel mentah tidak terlihat punya dua KK.
    db.prepare('UPDATE household_members SET relationship=? WHERE household_id=? AND member_id=?').run(
      'Anggota keluarga',
      householdId,
      household.head_member_id,
    )
    db.prepare('UPDATE household_members SET relationship=? WHERE household_id=? AND member_id=?').run(
      'Kepala keluarga',
      householdId,
      candidate.id,
    )
    // Tagihan terbuka ikut kepala keluarga baru. Riwayat yang sudah dibayar
    // atau sedang diverifikasi tetap melekat pada pembayar lama untuk audit.
    const openInvoices = db
      .prepare(
        "SELECT id,period FROM dues_invoices WHERE community_id=? AND member_id=? AND status IN ('unpaid','overdue')",
      )
      .all(me.community_id, household.head_member_id) as { id: string; period: string }[]
    for (const invoice of openInvoices) {
      const duplicate = db
        .prepare('SELECT id FROM dues_invoices WHERE community_id=? AND member_id=? AND period=?')
        .get(me.community_id, candidate.id, invoice.period) as { id: string } | undefined
      if (duplicate) {
        // Keduanya belum dibayar; pertahankan tagihan milik kepala baru saja.
        db.prepare('DELETE FROM dues_invoices WHERE id=?').run(invoice.id)
      } else {
        db.prepare('UPDATE dues_invoices SET member_id=? WHERE id=?').run(candidate.id, invoice.id)
      }
    }
  })
  moveHead()
  const view = populationOverview(me).households.find((item) => item.id === householdId)
  if (!view) throw new PopulationError('not_found')
  return view
}

export function updatePopulationMember(
  me: MemberRow,
  memberId: string,
  input: { relationship?: unknown; birthDate?: unknown },
): void {
  if (!me.community_id || !canManage(me)) throw new PopulationError('forbidden')
  const row = db
    .prepare(
      `SELECT hm.household_id FROM household_members hm JOIN members m ON m.id=hm.member_id
       WHERE hm.member_id=? AND m.community_id=?`,
    )
    .get(memberId, me.community_id) as { household_id: string } | undefined
  if (!row) throw new PopulationError('not_found')
  const relation = input.relationship === undefined ? undefined : String(input.relationship).replaceAll('\u0000', '').trim().slice(0, 60)
  const birthDate = validBirthDate(input.birthDate)
  if (
    (input.relationship !== undefined && !relation) ||
    (input.birthDate !== undefined && birthDate === undefined)
  )
    throw new PopulationError('invalid_population_input')
  if (relation !== undefined)
    db.prepare('UPDATE household_members SET relationship=? WHERE member_id=?').run(relation, memberId)
  if (birthDate !== undefined)
    db.prepare('UPDATE household_members SET birth_date=? WHERE member_id=?').run(birthDate, memberId)
}

export function updateHouseholdArea(
  me: MemberRow,
  householdId: string,
  input: { rt?: unknown; rw?: unknown; block?: unknown },
): void {
  if (!me.community_id || !canManage(me)) throw new PopulationError('forbidden')
  const clean = (value: unknown) => (typeof value === 'string' ? value.replaceAll('\u0000', '').trim().slice(0, 30) : '')
  const result = db
    .prepare('UPDATE households SET rt=?,rw=?,block=?,updated_at=? WHERE id=? AND community_id=?')
    .run(clean(input.rt), clean(input.rw), clean(input.block), now(), householdId, me.community_id)
  if (result.changes !== 1) throw new PopulationError('not_found')
}

/** Cocokkan target pengumuman tanpa membaca nomor HP/email warga. */
export function memberMatchesAudience(
  communityId: string,
  memberId: string,
  target: 'all' | 'rw' | 'rt' | 'block',
  targetValue: string,
): boolean {
  if (target === 'all') return true
  const row = db
    .prepare(
      `SELECT h.rt,h.rw,h.block FROM household_members hm
       JOIN households h ON h.id=hm.household_id
       WHERE h.community_id=? AND hm.member_id=?`,
    )
    .get(communityId, memberId) as { rt: string; rw: string; block: string } | undefined
  if (!row) return false
  const actual = target === 'rw' ? row.rw : target === 'rt' ? row.rt : row.block
  return actual.trim().toLocaleLowerCase('id-ID') === targetValue.trim().toLocaleLowerCase('id-ID')
}
