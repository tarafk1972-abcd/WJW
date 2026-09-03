import type { Community, DBShape, Lang, Member, PatrolLog } from '../lib/types'
import { fmtDate, fmtTime, timeAgo, initials } from '../lib/format'
import { Icon } from './Icon'

/**
 * Ambang "aktif": aplikasi yang baru menyebut server dalam 3 menit terakhir.
 * Denyut klien berjalan tiap satu menit, sehingga ini memberi ruang untuk
 * kehilangan satu-dua denyut tanpa menandai petugas sebagai offline.
 */
export const ONLINE_MS = 3 * 60 * 1000

/** Berapa hari ke belakang rekam patroli ditampilkan. */
export const PATROL_DAYS = 6

interface Props {
  db: DBShape
  members: Member[]
  community: Community | null
  lang: Lang
}

interface DayGroup {
  /** Epoch ms awal hari (local midnight). */
  start: number
  label: string
  logs: PatrolLog[]
}

export function SecurityPanel({ db, members, community, lang }: Props) {
  if (!community) return null

  const satpam =
    members
      .filter((m) => m.role === 'satpam' && m.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name)) ?? []

  const now = Date.now()
  const active = satpam.filter(
    (m) => typeof m.lastSeenAt === 'number' && now - (m.lastSeenAt as number) <= ONLINE_MS,
  )

  // Ambang mulai: awal hari 6 hari yang lalu (hari ini ditambah 5 hari sebelum).
  const from = startOfDay(now - (PATROL_DAYS - 1) * 86_400_000)
  const logs = db.patrolLogs.filter((l) => l.at >= from)

  const days = groupByDay(logs, lang)

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? '—'
  const statusLabel = (s: PatrolLog['status']) =>
    s === 'ontime' ? 'Tepat waktu' : s === 'late' ? 'Terlambat' : 'Di luar jadwal'

  return (
    <div>
      {/* ---------- Satpam aktif ---------- */}
      <h4 className="strong" style={{ margin: '0 0 8px' }}>
        Satpam yang aplikasinya aktif
      </h4>
      {satpam.length === 0 ? (
        <div className="empty">
          <span className="em">🛡️</span>
          Belum ada satpam aktif di lingkungan ini.
        </div>
      ) : (
          <div className="card" style={{ padding: 0 }}>
            {satpam.map((m, i) => (
              <div
                key={m.id}
                className="item"
                style={{ borderBottom: i < satpam.length - 1 ? '1px solid var(--line-soft)' : 'none' }}
              >
              <div className="avatar">{initials(m.name)}</div>
              <div className="grow">
                <div className="strong truncate">{m.name}</div>
                <div className="tiny truncate">{m.house || m.phone}</div>
                <div className="tiny">
                  <PresenceLabel lastSeenAt={m.lastSeenAt} lang={lang} />
                </div>
              </div>
              <PresenceDot active={of(m, active)} lastSeenAt={m.lastSeenAt} lang={lang} />
            </div>
          ))}
        </div>
      )}

      {/* ---------- Rekap patroli 6 hari ---------- */}
      <h4 className="strong" style={{ margin: '18px 0 8px' }}>
        Rekam patroli ronda · {PATROL_DAYS} hari terakhir
      </h4>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="chip chip-info">
          <Icon name="flag" size={10} /> {logs.length} titik dicatat
        </span>
        <span className="chip chip-info">
          <Icon name="users" size={10} /> {countGuards(logs)} satpam
        </span>
        {days.slice(0, 3).map((d) => {
          const ontime = d.logs.filter((l) => l.status === 'ontime').length
          const late = d.logs.filter((l) => l.status === 'late').length
          return (
            <span key={d.start} className="chip">
              {d.label.split(' ')[0]}·{ontime}/{late}
            </span>
          )
        })}
      </div>

      {logs.length === 0 ? (
        <div className="empty">
          <span className="em">📋</span>
          Belum ada catatan patroli dalam 6 hari terakhir.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {days.map((d) => (
            <div key={d.start}>
              <div className="tiny strong" style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>
                {d.label}
              </div>
              {d.logs.map((l) => (
                <div
                  key={l.id}
                  className="item"
                  style={{ borderBottom: '1px solid var(--line-soft)', alignItems: 'center' }}
                >
                  <div className="grow">
                    <div className="strong truncate">{l.checkpointName || 'Titik ronda'}</div>
                    <div className="tiny truncate">
                      {nameOf(l.satpamId)} · {fmtTime(l.at, lang)}
                      {l.scheduleLabel ? ` · ${l.scheduleLabel}` : ''}
                    </div>
                  </div>
                  <span
                    className={`chip ${l.status === 'ontime' ? 'chip-brand' : l.status === 'late' ? 'chip-warn' : 'chip-info'}`}
                  >
                    {statusLabel(l.status)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="tiny" style={{ color: 'var(--text-3)', marginTop: 10 }}>
        Mulai dicatat sejak {fmtDate(from, lang)}. Titik ditandai satpam lewat tombol ronda di
        posisi yang sesuai; garis waktu tampil menurun dari yang terbaru.
      </div>
    </div>
  )
}

function of(member: Member, active: Member[]): boolean {
  return active.some((a) => a.id === member.id)
}

function PresenceDot({
  active,
  lastSeenAt,
  lang,
}: {
  active: boolean
  lastSeenAt?: number | null
  lang: Lang
}) {
  const colour = active ? 'var(--brand)' : 'var(--danger)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color: colour,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: colour,
          flex: 'none',
        }}
      />
      {active ? 'Aktif' : lastSeenAt ? `Terakhir ${timeAgo(lastSeenAt, lang)}` : 'Belum pernah'}
    </span>
  )
}

function PresenceLabel({ lastSeenAt, lang }: { lastSeenAt?: number | null; lang: Lang }) {
  if (typeof lastSeenAt === 'number')
    return <>Terhubung {timeAgo(lastSeenAt, lang)} yang lalu</>
  return 'Belum menunjukkan kehadiran'
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function groupByDay(logs: PatrolLog[], lang: Lang): DayGroup[] {
  const map = new Map<number, DayGroup>()
  for (const log of logs) {
    const start = startOfDay(log.at)
    const existing = map.get(start)
    if (existing) {
      existing.logs.push(log)
    } else {
      map.set(start, { start, label: fmtDate(start, lang), logs: [log] })
    }
  }
  return [...map.values()].sort((a, b) => b.start - a.start)
}

function countGuards(logs: PatrolLog[]): number {
  return new Set(logs.map((l) => l.satpamId)).size
}
