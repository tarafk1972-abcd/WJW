import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  announcementApi,
  hubApi,
  populationApi,
  type HouseholdDto,
  type HubItemDto,
  type HubOverviewDto,
  type PopulationDto,
} from '../lib/api'
import { apiMode } from '../lib/sync'
import { fmtDateTime, timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

/** Administrasi warga yang dibuat untuk layar HP; data mutlak tetap dari API tenant. */
type Tab = 'population' | 'letters' | 'complaints' | 'announcements'

const LETTER_TYPES = [
  'Surat Pengantar',
  'Surat Domisili',
  'Surat Keterangan',
  'Surat Keterangan Usaha',
  'Lainnya',
]

const complaintNext: Record<string, string | undefined> = {
  SUBMITTED: 'REVIEWING',
  REVIEWING: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: 'CLOSED',
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ')
}

function DateLine({ at }: { at: number }) {
  const { lang } = useApp()
  return <span className="tiny">{timeAgo(at, lang)}</span>
}

function PopulationPanel({
  data,
  busy,
  onChanged,
}: {
  data: PopulationDto
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const saveArea = async (event: FormEvent<HTMLFormElement>, household: HouseholdDto) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await populationApi.setAudience(household.id, {
        rw: String(form.get('rw') ?? ''),
        rt: String(form.get('rt') ?? ''),
        block: String(form.get('block') ?? ''),
      })
      await onChanged()
      toast('Wilayah RT/RW/blok diperbarui.', 'ok')
    } catch {
      toast('Wilayah KK belum dapat diperbarui.', 'err')
    }
  }

  const updateMember = async (event: FormEvent<HTMLFormElement>, memberId: string) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await populationApi.updateMember(memberId, {
        relationship: String(form.get('relationship') ?? ''),
        birthDate: String(form.get('birthDate') ?? '') || null,
      })
      await onChanged()
      toast('Data anggota keluarga diperbarui.', 'ok')
    } catch {
      toast('Data anggota belum dapat diperbarui.', 'err')
    }
  }

  return (
    <>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n">{data.summary.households}</div><div className="l">KK</div></div>
        <div className="stat"><div className="n">{data.summary.residents}</div><div className="l">Warga aktif</div></div>
        <div className="stat"><div className="n">{data.summary.adults}</div><div className="l">Dewasa</div></div>
        <div className="stat"><div className="n">{data.summary.children}</div><div className="l">Anak</div></div>
      </div>
      {data.summary.ageUnknown > 0 && (
        <div className="banner banner-info" style={{ marginBottom: 12 }}>
          <Icon name="info" size={16} />
          <span>{data.summary.ageUnknown} warga belum memiliki tanggal lahir, sehingga belum masuk hitungan dewasa/anak.</span>
        </div>
      )}
      {data.households.length === 0 ? (
        <div className="empty"><span className="em">🏠</span>Data KK belum tersedia.</div>
      ) : data.households.map((household) => (
        <section key={household.id} className="card" style={{ marginBottom: 12 }}>
          <div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}>
            <div className="grow">
              <div className="strong">{household.address}</div>
              <div className="tiny" style={{ marginTop: 4 }}>
                Kepala keluarga: <b>{household.headName}</b>
                {(household.rw || household.rt || household.block) && ` · RW ${household.rw || '-'} / RT ${household.rt || '-'}${household.block ? ` · Blok ${household.block}` : ''}`}
              </div>
            </div>
            <span className="chip chip-info">{household.members.length} anggota</span>
          </div>

          <div style={{ marginTop: 10 }}>
            {household.members.map((member) => (
              <div key={member.id} className="item" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="item-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="user" size={17} /></div>
                <div className="grow">
                  <div className="strong">{member.name}</div>
                  <div className="tiny">{member.relationship} · {member.ageGroup === 'adult' ? 'Dewasa' : member.ageGroup === 'child' ? 'Anak' : 'Usia belum diisi'}</div>
                </div>
              </div>
            ))}
          </div>

          {data.canManage && (
            <details style={{ marginTop: 12 }}>
              <summary className="tiny strong">Kelola KK ini</summary>
              <div style={{ marginTop: 10 }}>
                <label className="label">Kepala keluarga / penerima iuran</label>
                <select
                  className="input"
                  aria-label={`Kepala keluarga ${household.address}`}
                  value={household.headMemberId}
                  disabled={busy}
                  onChange={async (event) => {
                    try {
                      await populationApi.setHead(household.id, event.target.value)
                      await onChanged()
                      toast('Kepala keluarga dan penerima iuran diperbarui.', 'ok')
                    } catch {
                      toast('Kepala keluarga belum dapat diperbarui.', 'err')
                    }
                  }}
                >
                  {household.members.filter((member) => member.status === 'active').map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
                <form onSubmit={(event) => void saveArea(event, household)} style={{ marginTop: 10 }}>
                  <div className="form-grid">
                    <label><span className="label">RW</span><input name="rw" className="input" defaultValue={household.rw} maxLength={30} /></label>
                    <label><span className="label">RT</span><input name="rt" className="input" defaultValue={household.rt} maxLength={30} /></label>
                    <label><span className="label">Blok</span><input name="block" className="input" defaultValue={household.block} maxLength={30} /></label>
                  </div>
                  <button className="btn btn-sm btn-ghost" type="submit" disabled={busy}><Icon name="check" size={14} /> Simpan wilayah</button>
                </form>
                {household.members.map((member) => (
                  <form key={member.id} onSubmit={(event) => void updateMember(event, member.id)} className="card" style={{ marginTop: 9, padding: 10, background: 'var(--surface-2)' }}>
                    <div className="strong" style={{ fontSize: 13 }}>{member.name}</div>
                    <div className="form-grid" style={{ marginTop: 7 }}>
                      <label><span className="label">Hubungan</span><input name="relationship" className="input" defaultValue={member.relationship} maxLength={60} /></label>
                      <label><span className="label">Tanggal lahir</span><input name="birthDate" className="input" type="date" defaultValue={member.birthDate ?? ''} /></label>
                    </div>
                    <button type="submit" className="btn btn-sm btn-ghost" disabled={busy}>Simpan anggota</button>
                  </form>
                ))}
              </div>
            </details>
          )}
        </section>
      ))}
      <div className="tiny" style={{ padding: '3px 5px 12px' }}>
        Satu alamat hanya memiliki satu kepala keluarga. Hanya kepala keluarga aktif yang dapat diterbitkan tagihan iuran lingkungan.
      </div>
    </>
  )
}

function LetterPanel({ items, isAdmin, busy, onChanged }: { items: HubItemDto[]; isAdmin: boolean; busy: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    try {
      const letterType = String(form.get('letterType') ?? '')
      await hubApi.create({
        kind: 'letter',
        title: letterType,
        body: String(form.get('detail') ?? ''),
        metadata: { letterType, purpose: String(form.get('purpose') ?? '') },
      })
      event.currentTarget.reset()
      await onChanged()
      toast('Permohonan surat dikirim ke pengurus.', 'ok')
    } catch {
      toast('Permohonan surat belum dapat dikirim.', 'err')
    } finally { setSubmitting(false) }
  }

  const decide = async (item: HubItemDto, approve: boolean) => {
    try {
      await hubApi.decideLetter(item.id, { approve, note: decisionNote[item.id] || '' })
      await onChanged()
      toast(approve ? 'Surat disetujui. PDF resmi kini tersedia.' : 'Permohonan surat ditolak.', approve ? 'ok' : 'info')
    } catch { toast('Keputusan surat belum dapat disimpan.', 'err') }
  }

  const download = async (item: HubItemDto) => {
    try {
      const blob = await hubApi.downloadLetter(item.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'surat-wjw.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast('PDF belum tersedia. Pastikan surat sudah disetujui.', 'err') }
  }

  return <>
    <section className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 17 }}>Ajukan surat digital</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>PDF resmi baru dapat diunduh setelah pengurus menyetujui permohonan.</p>
      <form onSubmit={(event) => void submit(event)} style={{ marginTop: 11 }}>
        <label><span className="label">Jenis surat</span><select className="input" name="letterType" required>{LETTER_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label><span className="label">Keperluan</span><input className="input" name="purpose" maxLength={300} required placeholder="Contoh: pengajuan administrasi sekolah" /></label>
        <label><span className="label">Keterangan tambahan (opsional)</span><textarea className="input" name="detail" maxLength={700} rows={3} /></label>
        <button type="submit" className="btn btn-primary" disabled={busy || submitting}><Icon name="send" size={16} /> Kirim permohonan</button>
      </form>
    </section>
    {items.length === 0 ? <div className="empty"><span className="em">📄</span>Belum ada permohonan surat.</div> : items.map((item) => {
      const meta = item.metadata
      const isPending = ['SUBMITTED', 'REVIEWING'].includes(item.status)
      return <section className="card" key={item.id} style={{ marginBottom: 10 }}>
        <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}><div className="grow"><div className="strong">{String(meta.letterType ?? item.title)}</div><div className="tiny">{String(meta.purpose ?? '-')} · <DateLine at={item.updatedAt} /></div></div><span className={`chip ${item.status === 'APPROVED' ? 'chip-ok' : item.status === 'REJECTED' ? 'chip-danger' : 'chip-warn'}`}>{statusLabel(item.status)}</span></div>
        {item.body && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{item.body}</p>}
        {typeof meta.decisionNote === 'string' && meta.decisionNote && <div className="banner banner-info" style={{ marginTop: 9 }}><Icon name="info" size={15} /><span>Catatan pengurus: {meta.decisionNote}</span></div>}
        {item.status === 'APPROVED' && <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => void download(item)} disabled={busy}><Icon name="clipboard" size={16} /> Unduh PDF resmi</button>}
        {isAdmin && isPending && <div style={{ marginTop: 10 }}><label><span className="label">Catatan keputusan (opsional)</span><textarea rows={2} className="input" maxLength={500} value={decisionNote[item.id] ?? ''} onChange={(event) => setDecisionNote((notes) => ({ ...notes, [item.id]: event.target.value }))} /></label><div className="btn-row"><button className="btn btn-primary grow" disabled={busy} onClick={() => void decide(item, true)}><Icon name="check" size={15} /> Setujui</button><button className="btn btn-ghost grow" disabled={busy} onClick={() => void decide(item, false)}><Icon name="x" size={15} /> Tolak</button></div></div>}
      </section>
    })}
  </>
}

function ComplaintPanel({ items, isAdmin, busy, onChanged }: { items: HubItemDto[]; isAdmin: boolean; busy: boolean; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    try {
      await hubApi.create({ kind: 'complaint', title: String(form.get('title') ?? ''), body: String(form.get('description') ?? ''), metadata: { category: String(form.get('category') ?? ''), priority: String(form.get('priority') ?? '') } })
      event.currentTarget.reset()
      await onChanged()
      toast('Aduan dikirim dan hanya terlihat oleh Anda serta pengurus.', 'ok')
    } catch { toast('Aduan belum dapat dikirim.', 'err') } finally { setSubmitting(false) }
  }
  const advance = async (item: HubItemDto) => {
    const next = complaintNext[item.status]
    if (!next) return
    try {
      await hubApi.status(item.id, next, notes[item.id] || '')
      await onChanged()
      toast(`Status aduan menjadi ${statusLabel(next)}.`, 'ok')
    } catch { toast('Status aduan belum dapat diubah.', 'err') }
  }
  return <>
    <section className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ fontSize: 17 }}>Buat aduan lingkungan</h2>
      <form onSubmit={(event) => void submit(event)} style={{ marginTop: 11 }}>
        <div className="form-grid"><label><span className="label">Kategori</span><select name="category" className="input" required><option>Kebersihan</option><option>Fasilitas</option><option>Keamanan</option><option>Jalan & lampu</option><option>Lainnya</option></select></label><label><span className="label">Prioritas</span><select name="priority" className="input" defaultValue="NORMAL"><option value="LOW">Rendah</option><option value="NORMAL">Normal</option><option value="HIGH">Tinggi</option><option value="URGENT">Mendesak</option></select></label></div>
        <label><span className="label">Judul singkat</span><input className="input" name="title" maxLength={140} required /></label>
        <label><span className="label">Uraian</span><textarea className="input" name="description" rows={4} maxLength={2000} required /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || submitting}><Icon name="send" size={16} /> Kirim aduan</button>
      </form>
    </section>
    {items.length === 0 ? <div className="empty"><span className="em">🛠️</span>Belum ada aduan.</div> : items.map((item) => <section className="card" key={item.id} style={{ marginBottom: 10 }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}><div className="grow"><div className="strong">{item.title}</div><div className="tiny">{String(item.metadata.category ?? 'Aduan')} · Prioritas {String(item.metadata.priority ?? 'NORMAL')} · <DateLine at={item.updatedAt} /></div></div><span className={`chip ${['RESOLVED', 'CLOSED'].includes(item.status) ? 'chip-ok' : 'chip-warn'}`}>{statusLabel(item.status)}</span></div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{item.body}</p>
      {item.comments.length > 0 && <div style={{ marginTop: 9 }}>{item.comments.map((comment) => <div className="tiny" key={comment.id} style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}><b>{comment.name}:</b> {comment.body}</div>)}</div>}
      {isAdmin && complaintNext[item.status] && <div style={{ marginTop: 10 }}><label><span className="label">Catatan tindak lanjut (opsional)</span><textarea rows={2} className="input" value={notes[item.id] ?? ''} maxLength={1000} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button className="btn btn-ghost" disabled={busy} onClick={() => void advance(item)}>Lanjutkan ke {statusLabel(complaintNext[item.status]!)}</button></div>}
    </section>)}
  </>
}

function AnnouncementPanel({ busy, onChanged }: { busy: boolean; onChanged: () => Promise<void> }) {
  const { db, community, isAdmin, lang } = useApp()
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const announcements = useMemo(() => db.announcements.filter((item) => item.communityId === community?.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt), [db.announcements, community?.id])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const scope = String(form.get('targetScope') ?? 'all') as 'all' | 'rw' | 'rt' | 'block'
    setSubmitting(true)
    try {
      await announcementApi.create({ title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), category: String(form.get('category') ?? ''), targetScope: scope, targetValue: String(form.get('targetValue') ?? ''), pinned: form.get('pinned') === 'on' })
      event.currentTarget.reset()
      await onChanged()
      toast('Pengumuman diterbitkan kepada target yang dipilih.', 'ok')
    } catch { toast('Pengumuman belum dapat diterbitkan.', 'err') } finally { setSubmitting(false) }
  }
  return <>
    {isAdmin && <section className="card" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17 }}>Terbitkan pengumuman</h2><p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Target RT/RW/blok dicocokkan server dari data KK, bukan dari pilihan di ponsel warga.</p><form style={{ marginTop: 10 }} onSubmit={(event) => void submit(event)}><div className="form-grid"><label><span className="label">Kategori</span><input className="input" name="category" defaultValue="Umum" maxLength={50} required /></label><label><span className="label">Target</span><select name="targetScope" className="input"><option value="all">Semua warga</option><option value="rw">RW tertentu</option><option value="rt">RT tertentu</option><option value="block">Blok tertentu</option></select></label></div><label><span className="label">Nilai target (isi untuk RW/RT/Blok)</span><input className="input" name="targetValue" maxLength={30} placeholder="Contoh: 05 atau C" /></label><label><span className="label">Judul</span><input className="input" name="title" maxLength={140} required /></label><label><span className="label">Isi</span><textarea className="input" name="body" rows={3} maxLength={2000} /></label><label className="row" style={{ gap: 8 }}><input type="checkbox" name="pinned" /> <span className="tiny">Sematkan di urutan atas</span></label><button className="btn btn-primary" type="submit" disabled={busy || submitting}><Icon name="megaphone" size={16} /> Terbitkan</button></form></section>}
    {announcements.length === 0 ? <div className="empty"><span className="em">📢</span>Belum ada pengumuman untuk Anda.</div> : announcements.map((item) => <article className="card" key={item.id} style={{ marginBottom: 10 }}><div className="row-between" style={{ alignItems: 'flex-start' }}><div><div className="row" style={{ gap: 6 }}><span className="strong">{item.title}</span>{item.pinned && <span className="chip chip-info">📌</span>}</div><div className="tiny" style={{ marginTop: 4 }}>{item.category} · {item.targetScope === 'all' ? 'Semua warga' : `${item.targetScope.toUpperCase()} ${item.targetValue}`}</div></div>{isAdmin && <button className="icon-btn" aria-label="Hapus pengumuman" disabled={busy} onClick={async () => { try { await announcementApi.remove(item.id); await onChanged(); toast('Pengumuman dihapus.', 'ok') } catch { toast('Pengumuman belum dapat dihapus.', 'err') } }}><Icon name="trash" size={15} /></button>}</div>{item.body && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{item.body}</p>}<div className="tiny" style={{ marginTop: 7 }}>{fmtDateTime(item.createdAt, lang)}</div></article>)}
  </>
}

export default function Community() {
  const { db, isAdmin, reload } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('population')
  const [population, setPopulation] = useState<PopulationDto | null>(null)
  const [hub, setHub] = useState<HubOverviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!apiMode()) { setLoading(false); return }
    setLoading(true)
    try {
      const [nextPopulation, nextHub] = await Promise.all([populationApi.fetch(), hubApi.overview()])
      setPopulation(nextPopulation)
      setHub(nextHub)
    } catch { toast('Data administrasi belum dapat dimuat dari server.', 'err') }
    finally { setLoading(false) }
  }, [toast])

  useEffect(() => { void load() }, [load, db])
  const changed = useCallback(async () => {
    setBusy(true)
    try { await reload(); await load() } finally { setBusy(false) }
  }, [load, reload])

  if (!apiMode()) return <div className="page"><div className="banner banner-warn"><Icon name="info" size={17} /><span>Administrasi komunitas memerlukan koneksi ke server WJW agar data KK dan dokumen resmi tersimpan aman.</span></div><button className="btn btn-ghost" onClick={() => nav('/app/feed')}>Kembali ke beranda</button></div>

  const items = hub?.items ?? []
  const letters = items.filter((item) => item.kind === 'letter')
  const complaints = items.filter((item) => item.kind === 'complaint')
  return <div className="page">
    <div className="row-between" style={{ marginBottom: 12 }}><div><h2 style={{ fontSize: 20 }}>Kelola warga</h2><div className="sub">KK, surat, aduan, dan pengumuman</div></div><button className="icon-btn" aria-label="Muat ulang" onClick={() => void load()} disabled={loading || busy}><Icon name="clock" size={17} /></button></div>
    <div className="tabs" style={{ marginBottom: 14, overflowX: 'auto' }}>{([['population', 'Kependudukan'], ['letters', 'Surat'], ['complaints', 'Aduan'], ['announcements', 'Pengumuman']] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}{key === 'complaints' && isAdmin && complaints.filter((item) => !['RESOLVED', 'CLOSED'].includes(item.status)).length ? ` (${complaints.filter((item) => !['RESOLVED', 'CLOSED'].includes(item.status)).length})` : ''}</button>)}</div>
    {loading && !population && !hub ? <div className="empty"><span className="em">⏳</span>Memuat data lingkungan…</div> : <>
      {tab === 'population' && population && <PopulationPanel data={population} busy={busy} onChanged={changed} />}
      {tab === 'letters' && <LetterPanel items={letters} isAdmin={isAdmin} busy={busy} onChanged={changed} />}
      {tab === 'complaints' && <ComplaintPanel items={complaints} isAdmin={isAdmin} busy={busy} onChanged={changed} />}
      {tab === 'announcements' && <AnnouncementPanel busy={busy} onChanged={changed} />}
    </>}
  </div>
}
