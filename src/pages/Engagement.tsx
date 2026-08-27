import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  hubApi,
  type HubItemDto,
  type HubKind,
  type HubOverviewDto,
} from '../lib/api'
import { apiMode } from '../lib/sync'
import { fmtDateTime, fmtMoney } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

type Tab = 'polls' | 'donations' | 'programs'

function asEpoch(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || !raw) return null
  const at = new Date(raw).getTime()
  return Number.isFinite(at) ? at : null
}

function progress(value: number, target: number) {
  if (!target) return 0
  return Math.min(100, Math.round((value / target) * 100))
}

function Deadline({ value }: { value: unknown }) {
  const { lang } = useApp()
  return typeof value === 'number' ? <span className="tiny">Tenggat {fmtDateTime(value, lang)}</span> : null
}

function Polls({ data, busy, onChanged }: { data: HubOverviewDto; busy: boolean; onChanged: () => Promise<void> }) {
  const { isAdmin } = useApp()
  const toast = useToast()
  const [newOptions, setNewOptions] = useState(['', ''])
  const [creating, setCreating] = useState(false)
  const polls = data.items.filter((item) => item.kind === 'poll')
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const closesAt = asEpoch(form.get('deadline'))
    if (!closesAt) { toast('Pilih tenggat voting.', 'info'); return }
    const choices = newOptions.map((choice) => choice.trim()).filter(Boolean)
    setCreating(true)
    try {
      await hubApi.create({ kind: 'poll', title: String(form.get('title') ?? ''), metadata: { choices, closesAt, anonymous: form.get('anonymous') === 'on' } })
      event.currentTarget.reset(); setNewOptions(['', '']); await onChanged(); toast('Voting diterbitkan.', 'ok')
    } catch { toast('Voting belum dapat diterbitkan. Pastikan 2–10 pilihan dan tenggat valid.', 'err') } finally { setCreating(false) }
  }
  return <>
    {isAdmin && <section className="card" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17 }}>Buat voting warga</h2><p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Satu warga hanya dapat memilih satu opsi. Hasil suara diperbarui real-time dan polling tertutup otomatis pada tenggat.</p><form onSubmit={(event) => void create(event)} style={{ marginTop: 10 }}><label><span className="label">Pertanyaan</span><input className="input" name="title" required maxLength={140} /></label><label><span className="label">Tenggat</span><input className="input" name="deadline" type="datetime-local" required /></label><div className="label">Pilihan (2–10)</div>{newOptions.map((option, index) => <div className="row" key={index} style={{ marginBottom: 7, gap: 7 }}><input className="input grow" required value={option} maxLength={80} placeholder={`Pilihan ${index + 1}`} onChange={(event) => setNewOptions((items) => items.map((item, position) => position === index ? event.target.value : item))} />{newOptions.length > 2 && <button className="icon-btn" type="button" aria-label="Hapus pilihan" onClick={() => setNewOptions((items) => items.filter((_, position) => position !== index))}><Icon name="x" size={15} /></button>}</div>)}{newOptions.length < 10 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewOptions((items) => [...items, ''])}><Icon name="plus" size={14} /> Tambah pilihan</button>}<label className="row" style={{ gap: 8, marginTop: 10 }}><input type="checkbox" name="anonymous" /><span className="tiny">Voting anonim — identitas pemilih tidak ditampilkan</span></label><button className="btn btn-primary" type="submit" disabled={busy || creating}><Icon name="send" size={16} /> Terbitkan voting</button></form></section>}
    {polls.length === 0 ? <div className="empty"><span className="em">🗳️</span>Belum ada voting.</div> : polls.map((poll) => {
      const choices = Array.isArray(poll.metadata.choices) ? poll.metadata.choices.filter((choice): choice is string => typeof choice === 'string') : []
      const votes = poll.summary.votes ?? {}
      const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0)
      const eligible = poll.summary.eligibleVoters ?? 0
      const participation = eligible ? Math.round((totalVotes / eligible) * 100) : 0
      const closed = poll.status === 'closed'
      return <section className="card" key={poll.id} style={{ marginBottom: 10 }}><div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}><div className="grow"><div className="strong">{poll.title}</div><div className="tiny"><Deadline value={poll.metadata.closesAt} />{poll.metadata.anonymous === true ? ' · Anonim' : ''}</div></div><span className={`chip ${closed ? 'chip-muted' : 'chip-ok'}`}>{closed ? 'Ditutup' : 'Aktif'}</span></div><div className="tiny" style={{ marginTop: 10 }}><b>{totalVotes}</b> suara dari {eligible} warga aktif · <b>{participation}%</b> partisipasi</div><div className="progress" aria-label={`${participation}% partisipasi`} style={{ marginTop: 5 }}><span style={{ width: `${participation}%` }} /></div><div style={{ marginTop: 10 }}>{choices.map((choice) => { const number = votes[choice] ?? 0; const percent = totalVotes ? Math.round((number / totalVotes) * 100) : 0; const mine = poll.myAction?.action === 'vote' && poll.myAction.value === choice; return <button key={choice} disabled={busy || closed || !!poll.myAction} className={`item ${mine ? 'item-selected' : ''}`} style={{ width: '100%', textAlign: 'left', padding: '9px 10px', marginBottom: 6 }} onClick={async () => { try { await hubApi.action(poll.id, 'vote', choice); await onChanged(); toast('Suara Anda tercatat.', 'ok') } catch { toast('Suara belum dapat dicatat.', 'err') } }}><div className="grow"><div className="strong" style={{ fontSize: 13 }}>{choice}{mine ? ' · pilihan Anda' : ''}</div><div className="tiny">{number} suara · {percent}%</div></div><span className="tiny">{closed ? '' : !poll.myAction ? 'Pilih' : ''}</span></button> })}</div>{poll.myAction && <div className="tiny" style={{ marginTop: 5 }}>Satu akun hanya dapat memilih satu kali.</div>}</section>
    })}
  </>
}

function DonationCard({ item, busy, onChanged }: { item: HubItemDto; busy: boolean; onChanged: () => Promise<void> }) {
  const { lang } = useApp()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const target = Number(item.metadata.targetAmount ?? 0)
  const collected = item.summary.contributedAmount ?? 0
  const pct = progress(collected, target)
  const closed = item.status === 'closed'
  return <section className="card" style={{ marginBottom: 10 }}><div className="row-between" style={{ alignItems: 'flex-start', gap: 8 }}><div className="grow"><div className="strong">{item.title}</div><Deadline value={item.metadata.deadline} /></div><span className={`chip ${closed ? 'chip-muted' : 'chip-ok'}`}>{closed ? 'Ditutup' : 'Aktif'}</span></div>{item.body && <p className="muted" style={{ marginTop: 7, fontSize: 13 }}>{item.body}</p>}<div className="row-between" style={{ marginTop: 10 }}><span className="strong">{fmtMoney(collected, lang)}</span><span className="tiny">dari {fmtMoney(target, lang)} · {pct}%</span></div><div className="progress" style={{ marginTop: 5 }}><span style={{ width: `${pct}%` }} /></div><div className="tiny" style={{ marginTop: 7 }}>{item.summary.contributors ?? 0} warga mencatat kontribusi.</div>{!closed && <form className="row" style={{ marginTop: 10, gap: 7 }} onSubmit={async (event) => { event.preventDefault(); const numeric = Number(amount); if (!Number.isInteger(numeric) || numeric <= 0) { toast('Masukkan nominal Rupiah yang valid.', 'info'); return } try { await hubApi.action(item.id, 'donation', numeric); setAmount(''); await onChanged(); toast('Kontribusi dicatat transparan.', 'ok') } catch { toast('Kontribusi belum dapat dicatat.', 'err') } }}><input className="input grow" inputMode="numeric" type="number" min={1} placeholder="Nominal kontribusi" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /><button className="btn btn-primary" type="submit" disabled={busy}><Icon name="heart" size={15} /> Catat</button></form>}</section>
}

function Donations({ data, busy, onChanged }: { data: HubOverviewDto; busy: boolean; onChanged: () => Promise<void> }) {
  const { isAdmin } = useApp()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const donations = data.items.filter((item) => item.kind === 'donation')
  const campaigns = data.items.filter((item) => item.kind === 'campaign')
  const create = async (event: FormEvent<HTMLFormElement>, kind: 'donation' | 'campaign') => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const deadline = asEpoch(form.get('deadline')); const target = Number(form.get('target'))
    if (!deadline || !Number.isInteger(target) || target <= 0) { toast('Target dan tenggat wajib diisi.', 'info'); return }
    setCreating(true)
    try { await hubApi.create({ kind, title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), metadata: kind === 'donation' ? { targetAmount: target, deadline, paymentInstructions: String(form.get('instructions') ?? '') } : { goal: target, deadline, unit: String(form.get('unit') ?? 'dukungan') } }); event.currentTarget.reset(); await onChanged(); toast(kind === 'donation' ? 'Donasi dibuka.' : 'Kampanye dibuka.', 'ok') } catch { toast('Program belum dapat dibuat.', 'err') } finally { setCreating(false) }
  }
  return <>
    {isAdmin && <section className="card" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17 }}>Buka donasi / kampanye</h2><div className="tabs" style={{ marginTop: 9 }}><button className="on" type="button">Donasi nominal</button></div><form onSubmit={(event) => void create(event, 'donation')} style={{ marginTop: 10 }}><label><span className="label">Judul</span><input name="title" className="input" maxLength={140} required /></label><div className="form-grid"><label><span className="label">Target (Rp)</span><input name="target" className="input" type="number" min={1000} required /></label><label><span className="label">Tenggat</span><input name="deadline" className="input" type="datetime-local" required /></label></div><label><span className="label">Keterangan</span><textarea name="body" className="input" rows={2} maxLength={2000} /></label><label><span className="label">Petunjuk kontribusi (opsional)</span><input name="instructions" className="input" maxLength={500} /></label><button type="submit" className="btn btn-primary" disabled={busy || creating}><Icon name="heart" size={16} /> Buka donasi</button></form><details style={{ marginTop: 12 }}><summary className="tiny strong">Buat kampanye dukungan (non-uang)</summary><form onSubmit={(event) => void create(event, 'campaign')} style={{ marginTop: 8 }}><label><span className="label">Judul</span><input name="title" className="input" maxLength={140} required /></label><div className="form-grid"><label><span className="label">Target dukungan</span><input name="target" className="input" type="number" min={1} required /></label><label><span className="label">Tenggat</span><input name="deadline" className="input" type="datetime-local" required /></label></div><label><span className="label">Satuan</span><input name="unit" className="input" defaultValue="dukungan" maxLength={40} /></label><label><span className="label">Keterangan</span><textarea name="body" className="input" rows={2} maxLength={2000} /></label><button type="submit" className="btn btn-ghost" disabled={busy || creating}>Buka kampanye</button></form></details></section>}
    {donations.length === 0 && campaigns.length === 0 ? <div className="empty"><span className="em">❤️</span>Belum ada program donasi atau kampanye.</div> : <>{donations.map((item) => <DonationCard key={item.id} item={item} busy={busy} onChanged={onChanged} />)}{campaigns.map((item) => { const goal = Number(item.metadata.goal ?? 0); const supporters = item.summary.supporters ?? 0; const pct = progress(supporters, goal); const closed = item.status === 'closed'; return <section className="card" key={item.id} style={{ marginBottom: 10 }}><div className="row-between"><div className="grow"><div className="strong">{item.title}</div><Deadline value={item.metadata.deadline} /></div><span className={`chip ${closed ? 'chip-muted' : 'chip-ok'}`}>{closed ? 'Ditutup' : 'Aktif'}</span></div><div className="tiny" style={{ marginTop: 9 }}>{supporters} dari {goal} {String(item.metadata.unit ?? 'dukungan')} · {pct}%</div><div className="progress" style={{ marginTop: 5 }}><span style={{ width: `${pct}%` }} /></div>{!closed && <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={busy || !!item.myAction} onClick={async () => { try { await hubApi.action(item.id, 'support'); await onChanged(); toast('Dukungan Anda tercatat.', 'ok') } catch { toast('Dukungan belum dapat dicatat.', 'err') } }}>{item.myAction ? 'Anda sudah mendukung' : 'Dukung kampanye'}</button>}</section> })}</>}
  </>
}

function Programs({ data, busy, onChanged }: { data: HubOverviewDto; busy: boolean; onChanged: () => Promise<void> }) {
  const { isAdmin, lang } = useApp()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const programs = data.items.filter((item) => item.kind === 'arisan' || item.kind === 'bereavement')
  const create = async (event: FormEvent<HTMLFormElement>, kind: HubKind) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const contribution = Number(form.get('contribution'))
    if (!Number.isInteger(contribution) || contribution < 1000) { toast('Masukkan nominal minimal Rp1.000.', 'info'); return }
    setCreating(true)
    try { await hubApi.create({ kind, title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), metadata: kind === 'arisan' ? { contribution, cadence: String(form.get('cadence') ?? 'Bulanan'), drawAt: asEpoch(form.get('drawAt')) } : { contribution, location: String(form.get('location') ?? ''), serviceAt: asEpoch(form.get('serviceAt')) } }); event.currentTarget.reset(); await onChanged(); toast('Program warga dibuat.', 'ok') } catch { toast('Program belum dapat dibuat.', 'err') } finally { setCreating(false) }
  }
  return <>
    {isAdmin && <section className="card" style={{ marginBottom: 14 }}><h2 style={{ fontSize: 17 }}>Buat program arisan / rukun kematian</h2><form onSubmit={(event) => void create(event, 'arisan')} style={{ marginTop: 10 }}><div className="label">Arisan</div><label><span className="label">Nama program</span><input name="title" className="input" required maxLength={140} placeholder="Arisan RW 05" /></label><div className="form-grid"><label><span className="label">Nominal (Rp)</span><input name="contribution" className="input" type="number" min={1000} required /></label><label><span className="label">Periode</span><input name="cadence" className="input" defaultValue="Bulanan" maxLength={50} /></label></div><label><span className="label">Jadwal undi (opsional)</span><input name="drawAt" className="input" type="datetime-local" /></label><button type="submit" className="btn btn-primary" disabled={busy || creating}>Buat arisan</button></form><details style={{ marginTop: 12 }}><summary className="tiny strong">Buat rukun kematian</summary><form onSubmit={(event) => void create(event, 'bereavement')} style={{ marginTop: 8 }}><label><span className="label">Nama program</span><input name="title" className="input" required maxLength={140} placeholder="Rukun Kematian RW 05" /></label><label><span className="label">Nominal kontribusi (Rp)</span><input name="contribution" className="input" type="number" min={1000} required /></label><label><span className="label">Lokasi / info (opsional)</span><input name="location" className="input" maxLength={160} /></label><button type="submit" className="btn btn-ghost" disabled={busy || creating}>Buat rukun kematian</button></form></details></section>}
    {programs.length === 0 ? <div className="empty"><span className="em">🤝</span>Belum ada program arisan atau rukun kematian.</div> : programs.map((item) => { const arisan = item.kind === 'arisan'; const closed = item.status === 'closed' || item.status === 'drawn'; const nominal = Number(item.metadata.contribution ?? 0); return <section className="card" key={item.id} style={{ marginBottom: 10 }}><div className="row-between" style={{ alignItems: 'flex-start' }}><div className="grow"><div className="strong">{item.title}</div><div className="tiny">{arisan ? `Arisan · ${String(item.metadata.cadence ?? 'Bulanan')}` : 'Rukun kematian'} · Nominal {fmtMoney(nominal, lang)}</div></div><span className={`chip ${closed ? 'chip-muted' : 'chip-info'}`}>{closed ? statusText(item.status) : 'Terbuka'}</span></div>{item.body && <p className="muted" style={{ fontSize: 13, marginTop: 7 }}>{item.body}</p>}<div className="tiny" style={{ marginTop: 9 }}><b>{item.summary.participants ?? 0}</b> peserta</div>{item.participants.length > 0 && <div className="card" style={{ marginTop: 8, padding: 9, background: 'var(--surface-2)' }}>{item.participants.map((participant) => <div className="tiny" key={participant.memberId}>• {participant.name}</div>)}</div>}{item.winnerName && <div className="banner banner-info" style={{ marginTop: 9 }}><Icon name="gift" size={15} /><span>Pemenang undian: <b>{item.winnerName}</b></span></div>}{!closed && <div className="btn-row" style={{ marginTop: 10 }}><button className="btn btn-ghost grow" disabled={busy || !!item.myAction} onClick={async () => { try { await hubApi.action(item.id, 'join'); await onChanged(); toast('Anda terdaftar sebagai peserta.', 'ok') } catch { toast('Pendaftaran belum dapat diproses.', 'err') } }}>{item.myAction ? 'Anda sudah bergabung' : 'Gabung program'}</button>{isAdmin && arisan && (item.summary.participants ?? 0) >= 2 && <button className="btn btn-primary" disabled={busy} onClick={async () => { try { await hubApi.drawArisan(item.id); await onChanged(); toast('Undian arisan diselesaikan di server.', 'ok') } catch { toast('Undian belum dapat dilakukan.', 'err') } }}>Undi</button>}</div>}</section> })}
  </>
}

function statusText(status: string) { return status.replaceAll('_', ' ') }

export default function Engagement() {
  const { db, reload } = useApp()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('polls')
  const [data, setData] = useState<HubOverviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!apiMode()) { setLoading(false); return }
    setLoading(true)
    try { setData(await hubApi.overview()) } catch { toast('Data partisipasi belum dapat dimuat dari server.', 'err') } finally { setLoading(false) }
  }, [toast])
  useEffect(() => { void load() }, [load, db])
  const changed = useCallback(async () => { setBusy(true); try { await reload(); await load() } finally { setBusy(false) } }, [load, reload])
  if (!apiMode()) return <div className="page"><div className="banner banner-warn"><Icon name="info" size={17} /><span>Voting dan program gotong royong memerlukan koneksi server agar satu suara per warga dan transparansi data terjaga.</span></div></div>
  return <div className="page"><div className="row-between" style={{ marginBottom: 12 }}><div><h2 style={{ fontSize: 20 }}>Gotong royong</h2><div className="sub">Voting, donasi, arisan, dan rukun kematian</div></div><button className="icon-btn" aria-label="Muat ulang" disabled={loading || busy} onClick={() => void load()}><Icon name="clock" size={17} /></button></div><div className="tabs" style={{ marginBottom: 14, overflowX: 'auto' }}>{([['polls', 'Voting'], ['donations', 'Donasi'], ['programs', 'Program warga']] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>{loading && !data ? <div className="empty"><span className="em">⏳</span>Memuat partisipasi warga…</div> : data && <>{tab === 'polls' && <Polls data={data} busy={busy} onChanged={changed} />}{tab === 'donations' && <Donations data={data} busy={busy} onChanged={changed} />}{tab === 'programs' && <Programs data={data} busy={busy} onChanged={changed} />}</>}</div>
}
