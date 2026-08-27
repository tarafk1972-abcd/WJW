import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { assistantApi } from '../lib/api'
import { apiMode } from '../lib/sync'
import { timeAgo } from '../lib/format'
import { useApp } from '../lib/store'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'

type History = { id: string; question: string; answer: string; source: string; createdAt: number }

/** Asisten lokal berbasis data tenant; sengaja bukan chat umum/penyedia eksternal. */
export default function AssistantPage() {
  const { lang } = useApp()
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ text: string; source: string; suggestions: { label: string; path: string }[] } | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!apiMode()) return
    try { setHistory((await assistantApi.history()).entries) } catch { /* riwayat privat bersifat tambahan */ }
  }, [])
  useEffect(() => { void loadHistory() }, [loadHistory])

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (question.trim().length < 3) { toast('Tulis pertanyaan minimal 3 karakter.', 'info'); return }
    setLoading(true)
    try {
      const result = await assistantApi.ask(question)
      setAnswer({ text: result.answer, source: result.source, suggestions: result.suggestions })
      setQuestion('')
      await loadHistory()
    } catch { toast('Asisten belum dapat menjawab saat ini.', 'err') } finally { setLoading(false) }
  }

  if (!apiMode()) return <div className="page"><div className="banner banner-warn"><Icon name="info" size={17} /><span>WJW Assistant memerlukan koneksi aman ke server tenant untuk membaca data yang Anda berhak akses.</span></div></div>
  return <div className="page">
    <div className="row" style={{ gap: 10, marginBottom: 10 }}><div className="item-icon" style={{ background: 'var(--purple-soft, rgba(163,113,247,.15))', color: 'var(--purple)' }}><Icon name="headset" size={20} /></div><div><h2 style={{ fontSize: 20 }}>WJW Assistant</h2><div className="sub">Jawaban hanya dari data lingkungan Anda</div></div></div>
    <div className="banner banner-info" style={{ marginBottom: 14 }}><Icon name="lock" size={16} /><span>Jangan tulis sandi, NIK, data medis, lokasi presisi, atau detail SOS. Riwayat pertanyaan Anda disimpan privat dan terenkripsi.</span></div>
    <section className="card"><form onSubmit={(event) => void ask(event)}><label><span className="label">Tanyakan data iuran, surat, aduan, voting, tamu, atau ronda</span><textarea className="input" rows={3} maxLength={700} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Contoh: bagaimana status surat saya?" /></label><button type="submit" className="btn btn-primary" disabled={loading}><Icon name="send" size={16} /> {loading ? 'Mencari data…' : 'Tanyakan'}</button></form></section>
    {answer && <section className="card" style={{ marginTop: 12 }}><div className="tiny">Sumber data: {answer.source === 'none' ? 'tidak ada data yang cocok' : answer.source}</div><p style={{ lineHeight: 1.55, marginTop: 7 }}>{answer.text}</p>{answer.suggestions.length > 0 && <div className="btn-row" style={{ marginTop: 10 }}>{answer.suggestions.map((suggestion) => <a key={suggestion.path} className="btn btn-ghost" href={`#${suggestion.path}`}>{suggestion.label}</a>)}</div>}</section>}
    <div className="section-title">Riwayat privat Anda</div>
    {history.length === 0 ? <div className="empty"><span className="em">💬</span>Belum ada pertanyaan tersimpan.</div> : history.map((entry) => <article className="card" key={entry.id} style={{ marginBottom: 9 }}><div className="strong" style={{ fontSize: 13 }}>Anda: {entry.question}</div><p className="muted" style={{ marginTop: 6, fontSize: 13 }}>{entry.answer}</p><div className="tiny" style={{ marginTop: 6 }}>{timeAgo(entry.createdAt, lang)}</div></article>)}
  </div>
}
