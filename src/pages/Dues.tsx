import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ApiError,
  duesApi,
  type DuesInvoiceDto,
  type DuesInvoiceStatus,
  type DuesMethod,
  type DuesSettingsDto,
  type DuesSummaryDto,
} from '../lib/api'
import { fmtDate, fmtMoney } from '../lib/format'
import { apiMode } from '../lib/sync'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

type DuesData = {
  settings: DuesSettingsDto | null
  summary: DuesSummaryDto
  canManage: boolean
  invoices: DuesInvoiceDto[]
  members: { id: string; name: string; house: string }[]
}

const emptySummary: DuesSummaryDto = {
  billed: 0,
  paid: 0,
  outstanding: 0,
  invoices: 0,
  paidInvoices: 0,
  awaitingVerification: 0,
  overdue: 0,
  waived: 0,
  paidCash: 0,
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function statusView(status: DuesInvoiceStatus): { label: string; chip: string } {
  switch (status) {
    case 'paid':
      return { label: 'Lunas', chip: 'chip-brand' }
    case 'awaiting_verification':
      return { label: 'Menunggu verifikasi', chip: 'chip-info' }
    case 'overdue':
      return { label: 'Terlambat', chip: 'chip-danger' }
    case 'waived':
      return { label: 'Dibebaskan', chip: 'chip-muted' }
    default:
      return { label: 'Belum bayar', chip: 'chip-warn' }
  }
}

/** Label cara bayar; kosong tidak ditampilkan agar kartu tidak ramai. */
function methodLabel(method: DuesMethod): string {
  if (method === 'cash') return 'Tunai'
  if (method === 'transfer') return 'Transfer'
  return ''
}

function apiMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Terjadi gangguan. Silakan coba lagi.'
  if (error.code === 'forbidden') return 'Anda tidak memiliki wewenang untuk tindakan ini.'
  if (error.code === 'dues_not_configured') return 'Atur nominal iuran terlebih dahulu.'
  if (error.code === 'invalid_dues_state') return 'Status tagihan sudah berubah. Muat ulang data.'
  if (error.code === 'invalid_period') return 'Periode tagihan tidak valid.'
  if (error.code === 'no_members') return 'Pilih minimal satu penerima tagihan.'
  if (error.code === 'dues_waive_reason_required') return 'Tulis alasan pembebasan minimal 3 huruf.'
  if (error.code === 'invalid_member') return 'Ada penerima yang bukan anggota aktif tenant ini.'
  return 'Terjadi gangguan. Silakan coba lagi.'
}

/**
 * Iuran operasional warga. Berbeda dari halaman Billing yang khusus
 * langganan SaaS tenant ke WJW; data dan hak aksesnya dipisahkan di API.
 */
export default function Dues() {
  const { me, community, lang, db } = useApp()
  const nav = useNavigate()
  const toast = useToast()
  const [data, setData] = useState<DuesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [claiming, setClaiming] = useState<DuesInvoiceDto | null>(null)
  const [verifying, setVerifying] = useState<DuesInvoiceDto | null>(null)
  const [busy, setBusy] = useState(false)

  const [label, setLabel] = useState('Iuran Pengelolaan Lingkungan')
  const [amount, setAmount] = useState('150000')
  const [dueDay, setDueDay] = useState('10')
  const [instructions, setInstructions] = useState('')
  const [period, setPeriod] = useState(currentPeriod)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [paymentNote, setPaymentNote] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  const [cashing, setCashing] = useState<DuesInvoiceDto | null>(null)
  const [cashNote, setCashNote] = useState('')
  const [waiving, setWaiving] = useState<DuesInvoiceDto | null>(null)
  const [waiveNote, setWaiveNote] = useState('')

  const load = useCallback(async () => {
    if (!apiMode()) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setData(await duesApi.fetch())
    } catch (error) {
      setData(null)
      toast(apiMessage(error), 'err')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load, db])

  const settings = data?.settings ?? null
  const summary = data?.summary ?? emptySummary
  const invoices = data?.invoices ?? []
  const members = data?.members ?? []
  const collectionRate = summary.billed > 0 ? Math.round((summary.paid / summary.billed) * 100) : 0

  const openSettings = () => {
    setLabel(settings?.label ?? 'Iuran Pengelolaan Lingkungan')
    setAmount(String(settings?.amount ?? 150000))
    setDueDay(String(settings?.dueDay ?? 10))
    setInstructions(settings?.paymentInstructions ?? '')
    setSettingsOpen(true)
  }

  const openGenerate = () => {
    setPeriod(currentPeriod())
    setSelectedMembers([])
    setGenerateOpen(true)
  }

  // Daftar penerima kecil dan hanya dipakai untuk fallback tampilan admin.
  // Hindari cache hook yang mudah menjadi stale setelah penyegaran server.
  const residentName = new Map(members.map((member) => [member.id, member]))

  if (!me || !community) return null

  const saveSettings = async () => {
    const nominal = Number(amount.replace(/[^0-9]/g, ''))
    const jatuhTempo = Number(dueDay)
    if (!label.trim() || !Number.isInteger(nominal) || nominal < 1000 || !Number.isInteger(jatuhTempo)) {
      toast('Isi nama, nominal, dan tanggal jatuh tempo dengan benar.', 'err')
      return
    }
    setBusy(true)
    try {
      await duesApi.saveSettings({
        label: label.trim(),
        amount: nominal,
        dueDay: jatuhTempo,
        paymentInstructions: instructions.trim(),
      })
      setSettingsOpen(false)
      toast('Pengaturan iuran disimpan.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      toast('Gunakan periode YYYY-MM, misalnya 2026-09.', 'err')
      return
    }
    if (!selectedMembers.length) {
      toast('Pilih minimal satu penerima tagihan.', 'err')
      return
    }
    setBusy(true)
    try {
      const result = await duesApi.generate(period, selectedMembers)
      setGenerateOpen(false)
      toast(
        result.created
          ? `${result.created} tagihan diterbitkan${result.existing ? ` · ${result.existing} sudah ada` : ''}.`
          : 'Semua tagihan periode ini sudah ada.',
      )
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const claim = async () => {
    if (!claiming) return
    setBusy(true)
    try {
      await duesApi.claim(claiming.id, paymentNote.trim())
      setClaiming(null)
      setPaymentNote('')
      toast('Pengajuan pembayaran dikirim ke Admin 2 untuk diverifikasi.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const verify = async (approve: boolean) => {
    if (!verifying) return
    setBusy(true)
    try {
      await duesApi.verify(verifying.id, approve, verifyNote.trim())
      setVerifying(null)
      setVerifyNote('')
      toast(approve ? 'Pembayaran ditandai lunas.' : 'Pengajuan dikembalikan ke warga.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const markCash = async () => {
    if (!cashing) return
    setBusy(true)
    try {
      await duesApi.cash(cashing.id, cashNote.trim())
      setCashing(null)
      setCashNote('')
      toast('Pembayaran tunai dicatat.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const waive = async () => {
    if (!waiving) return
    setBusy(true)
    try {
      await duesApi.waive(waiving.id, waiveNote.trim())
      setWaiving(null)
      setWaiveNote('')
      toast('Tagihan dibebaskan.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  const restore = async (invoice: DuesInvoiceDto) => {
    setBusy(true)
    try {
      await duesApi.restore(invoice.id)
      toast('Pembebasan dibatalkan; tagihan berlaku lagi.')
      await load()
    } catch (error) {
      toast(apiMessage(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav(-1)} aria-label="Kembali">
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Iuran lingkungan</h2>
          <div className="tiny">Kas operasional {community.name}</div>
        </div>
        {data?.canManage && <span className="chip chip-brand">Admin 2</span>}
      </div>

      {!apiMode() ? (
        <div className="banner banner-warn">
          <Icon name="info" size={17} />
          <span>Iuran memakai data server agar status pembayaran tidak keliru. Hubungkan ke server untuk melanjutkan.</span>
        </div>
      ) : loading && !data ? (
        <div className="empty">
          <span className="em">⏳</span>
          Memuat iuran…
        </div>
      ) : !data ? (
        <div className="empty">
          <span className="em">⚠️</span>
          Data iuran belum dapat dimuat.
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--surface))' }}>
            <div className="row-between">
              <div>
                <div className="tiny">{settings?.label ?? 'Iuran belum diatur'}</div>
                <div style={{ fontSize: 23, fontWeight: 850, marginTop: 3 }}>
                  {settings ? fmtMoney(settings.amount, lang) : '—'}
                </div>
                <div className="muted" style={{ marginTop: 3 }}>
                  {settings ? `Jatuh tempo setiap tanggal ${settings.dueDay}` : 'Admin 2 perlu mengatur nominal dan jatuh tempo.'}
                </div>
              </div>
              <Icon name="credit" size={30} color="var(--brand)" />
            </div>
            {settings?.paymentInstructions && (
              <div className="tiny" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
                {settings.paymentInstructions}
              </div>
            )}
          </div>

          {data.canManage ? (
            <>
              <div className="stat-grid" style={{ marginTop: 12 }}>
                <div className="stat">
                  <div className="n">{fmtMoney(summary.billed, lang)}</div>
                  <div className="l">Total tagihan</div>
                </div>
                <div className="stat">
                  <div className="n" style={{ color: 'var(--brand)' }}>{fmtMoney(summary.paid, lang)}</div>
                  <div className="l">Terkumpul · {collectionRate}%</div>
                </div>
                <div className="stat">
                  <div className="n" style={{ color: summary.outstanding ? 'var(--warn)' : 'var(--brand)' }}>
                    {fmtMoney(summary.outstanding, lang)}
                  </div>
                  <div className="l">Belum lunas</div>
                </div>
              </div>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn btn-ghost grow" onClick={openSettings}>
                  <Icon name="settings" size={15} /> Atur iuran
                </button>
                <button className="btn btn-primary grow" onClick={openGenerate} disabled={!settings}>
                  <Icon name="plus" size={16} /> Terbitkan tagihan
                </button>
              </div>

              {summary.awaitingVerification > 0 && (
                <div className="banner banner-warn" style={{ marginTop: 12 }}>
                  <Icon name="info" size={17} />
                  <span>{summary.awaitingVerification} pembayaran menunggu verifikasi Admin 2.</span>
                </div>
              )}

              {/* Pemisahan tunai vs rekening: yang tunai ada di tangan pengurus,
                  bukan di rekening kas. Menyamakan keduanya membuat selisih kas
                  baru ketahuan saat rapat. */}
              {(summary.paidCash > 0 || summary.waived > 0) && (
                <div className="tiny" style={{ marginTop: 10 }}>
                  {summary.paidCash > 0 && <>Diterima tunai: {fmtMoney(summary.paidCash, lang)}</>}
                  {summary.paidCash > 0 && summary.waived > 0 && ' · '}
                  {summary.waived > 0 && <>{summary.waived} tagihan dibebaskan</>}
                </div>
              )}
            </>
          ) : (
            <div className="banner banner-info" style={{ marginTop: 12 }}>
              <Icon name="info" size={17} />
              <span>Rincian pembayaran warga lain hanya dapat dilihat oleh Admin 2 yang ditugaskan.</span>
            </div>
          )}

          <div className="section-title">
            {data.canManage ? 'Daftar tagihan' : 'Tagihan saya'}
            <span className="chip">{invoices.length}</span>
          </div>
          {invoices.length === 0 ? (
            <div className="empty">
              <span className="em">🧾</span>
              {data.canManage ? 'Belum ada tagihan yang diterbitkan.' : 'Belum ada tagihan untuk akun Anda.'}
            </div>
          ) : (
            invoices.map((invoice) => {
              const status = statusView(invoice.status)
              const member = residentName.get(invoice.memberId)
              return (
                <div key={invoice.id} className="item" style={{ alignItems: 'flex-start' }}>
                  <div className="item-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                    <Icon name="credit" size={18} />
                  </div>
                  <div className="grow">
                    <div className="row-between" style={{ gap: 8 }}>
                      <span className="strong truncate">{invoice.label}</span>
                      <span className={`chip ${status.chip}`}>{status.label}</span>
                    </div>
                    {data.canManage && (
                      <div className="tiny truncate">
                        {invoice.memberName ?? member?.name ?? 'Anggota'}
                        {(invoice.memberHouse ?? member?.house) ? ` · ${invoice.memberHouse ?? member?.house}` : ''}
                      </div>
                    )}
                    <div className="tiny">
                      {invoice.period} · jatuh tempo {fmtDate(invoice.dueAt, lang)} · {invoice.reference}
                      {methodLabel(invoice.method) ? ` · ${methodLabel(invoice.method)}` : ''}
                    </div>
                    {invoice.paymentNote && data.canManage && (
                      <div className="tiny" style={{ marginTop: 4 }}>Catatan warga: {invoice.paymentNote}</div>
                    )}
                    {invoice.verifierNote && (
                      <div className="tiny" style={{ marginTop: 4 }}>Catatan verifikasi: {invoice.verifierNote}</div>
                    )}
                    <div className="strong" style={{ marginTop: 5 }}>{fmtMoney(invoice.amount, lang)}</div>
                    {!data.canManage && (invoice.status === 'unpaid' || invoice.status === 'overdue') && (
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setPaymentNote('')
                          setClaiming(invoice)
                        }}
                      >
                        Saya sudah bayar
                      </button>
                    )}
                    {data.canManage && invoice.status === 'awaiting_verification' && (
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setVerifyNote('')
                          setVerifying(invoice)
                        }}
                      >
                        Verifikasi pembayaran
                      </button>
                    )}
                    {/* Tunai & pembebasan tersedia selama tagihan belum lunas,
                        termasuk saat menunggu verifikasi: warga bisa saja
                        akhirnya membayar langsung ke pengurus. */}
                    {data.canManage && invoice.status !== 'paid' && invoice.status !== 'waived' && (
                      <div className="btn-row" style={{ marginTop: 8 }}>
                        <button
                          className="btn btn-sm btn-ghost grow"
                          disabled={busy}
                          onClick={() => {
                            setCashNote('')
                            setCashing(invoice)
                          }}
                        >
                          <Icon name="check" size={14} /> Terima tunai
                        </button>
                        <button
                          className="btn btn-sm btn-ghost grow"
                          disabled={busy}
                          onClick={() => {
                            setWaiveNote('')
                            setWaiving(invoice)
                          }}
                        >
                          Bebaskan
                        </button>
                      </div>
                    )}
                    {data.canManage && invoice.status === 'waived' && (
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ marginTop: 8 }}
                        disabled={busy}
                        onClick={() => void restore(invoice)}
                      >
                        Batalkan pembebasan
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}

      <Sheet open={settingsOpen} onClose={() => !busy && setSettingsOpen(false)} title="Atur iuran lingkungan" subtitle="Khusus Admin 2">
        <label className="field">
          <span>Nama iuran</span>
          <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label className="field">
          <span>Nominal per tagihan (Rp)</span>
          <input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="field">
          <span>Tanggal jatuh tempo setiap bulan</span>
          <select className="select" value={dueDay} onChange={(event) => setDueDay(event.target.value)}>
            {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Instruksi pembayaran</span>
          <textarea className="textarea" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Contoh: Transfer ke rekening kas lingkungan lalu tulis nomor referensi." />
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={() => void saveSettings()}>
          <Icon name="check" size={16} /> Simpan pengaturan
        </button>
      </Sheet>

      <Sheet open={generateOpen} onClose={() => !busy && setGenerateOpen(false)} title="Terbitkan tagihan" subtitle="Pilih penerima secara sadar; satu tagihan per akun untuk satu periode.">
        <label className="field">
          <span>Periode</span>
          <input className="input" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="2026-09" inputMode="numeric" />
        </label>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="strong">Penerima ({selectedMembers.length})</span>
          <button
            className="link-btn tiny"
            onClick={() => setSelectedMembers(selectedMembers.length === members.length ? [] : members.map((member) => member.id))}
          >
            {selectedMembers.length === members.length ? 'Kosongkan semua' : 'Pilih semua'}
          </button>
        </div>
        <div className="col" style={{ gap: 7, maxHeight: '40vh', overflowY: 'auto', marginBottom: 14 }}>
          {members.map((member) => (
            <label key={member.id} className="item" style={{ cursor: 'pointer', padding: '9px 10px' }}>
              <input
                type="checkbox"
                checked={selectedMembers.includes(member.id)}
                onChange={() => setSelectedMembers((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}
              />
              <span className="grow" style={{ marginLeft: 8 }}>
                <span className="strong">{member.name}</span>
                <span className="tiny" style={{ display: 'block' }}>{member.house}</span>
              </span>
            </label>
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy || !settings} onClick={() => void generate()}>
          <Icon name="send" size={16} /> Terbitkan tagihan
        </button>
      </Sheet>

      <Sheet open={!!claiming} onClose={() => !busy && setClaiming(null)} title="Ajukan pembayaran" subtitle={claiming ? `${claiming.label} · ${fmtMoney(claiming.amount, lang)}` : ''}>
        {settings?.paymentInstructions && <div className="banner banner-info" style={{ whiteSpace: 'pre-wrap' }}>{settings.paymentInstructions}</div>}
        <label className="field">
          <span>Catatan pembayaran (opsional)</span>
          <textarea className="textarea" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Contoh: Transfer 10 Sep pukul 09.12, bank/akun pengirim…" />
        </label>
        <p className="tiny">Status akan menjadi “Menunggu verifikasi”; jangan anggap lunas sebelum Admin 2 menyetujui.</p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void claim()}>
          <Icon name="send" size={16} /> Kirim pengajuan
        </button>
      </Sheet>

      <Sheet open={!!verifying} onClose={() => !busy && setVerifying(null)} title="Verifikasi pembayaran" subtitle={verifying?.memberName ?? ''}>
        {verifying && (
          <div className="card card-tight" style={{ marginBottom: 12 }}>
            <div className="strong">{fmtMoney(verifying.amount, lang)}</div>
            <div className="tiny">{verifying.reference}</div>
            {verifying.paymentNote && <div className="tiny" style={{ marginTop: 6 }}>Catatan warga: {verifying.paymentNote}</div>}
          </div>
        )}
        <label className="field">
          <span>Catatan Admin 2 (opsional)</span>
          <textarea className="textarea" value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} placeholder="Nomor referensi sudah sesuai." />
        </label>
        <div className="btn-row">
          <button className="btn btn-ghost grow" disabled={busy} onClick={() => void verify(false)}>Kembalikan</button>
          <button className="btn btn-primary grow" disabled={busy} onClick={() => void verify(true)}>
            <Icon name="check" size={16} /> Tandai lunas
          </button>
        </div>
      </Sheet>

      <Sheet
        open={!!cashing}
        onClose={() => !busy && setCashing(null)}
        title="Terima pembayaran tunai"
        subtitle={cashing ? `${cashing.reference} · ${fmtMoney(cashing.amount, lang)}` : ''}
      >
        <p className="tiny" style={{ marginBottom: 12 }}>
          Gunakan ini bila warga menyerahkan uang langsung kepada pengurus. Tagihan
          langsung berstatus lunas tanpa verifikasi, dan nama Anda tercatat sebagai
          penerimanya.
        </p>
        <label className="field">
          <span>Catatan penerimaan (opsional)</span>
          <textarea
            className="textarea"
            value={cashNote}
            onChange={(event) => setCashNote(event.target.value)}
            placeholder="Contoh: diterima Ketua RT di pos ronda."
          />
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={() => void markCash()}>
          <Icon name="check" size={16} /> Tandai lunas tunai
        </button>
      </Sheet>

      <Sheet
        open={!!waiving}
        onClose={() => !busy && setWaiving(null)}
        title="Bebaskan tagihan"
        subtitle={waiving ? `${waiving.reference} · ${fmtMoney(waiving.amount, lang)}` : ''}
      >
        <p className="tiny" style={{ marginBottom: 12 }}>
          Tagihan tidak dihapus, hanya dinyatakan tidak perlu dibayar. Nominalnya
          dikeluarkan dari tunggakan maupun target kas, dan alasannya tersimpan
          untuk dipertanggungjawabkan.
        </p>
        <label className="field">
          <span>Alasan pembebasan</span>
          <textarea
            className="textarea"
            value={waiveNote}
            onChange={(event) => setWaiveNote(event.target.value)}
            placeholder="Contoh: rumah kosong sejak Juli, atau keputusan rapat warga 12 Agustus."
          />
        </label>
        <button className="btn btn-primary" disabled={busy || waiveNote.trim().length < 3} onClick={() => void waive()}>
          <Icon name="check" size={16} /> Bebaskan tagihan ini
        </button>
      </Sheet>
    </div>
  )
}
