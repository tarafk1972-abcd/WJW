import type { Lang } from './types'
import { translate } from './i18n'

const LOCALE: Record<Lang, string> = { id: 'id-ID', en: 'en-GB', su: 'id-ID' }

export function fmtTime(ts: number, lang: Lang): string {
  return new Date(ts).toLocaleTimeString(LOCALE[lang], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDate(ts: number, lang: Lang): string {
  return new Date(ts).toLocaleDateString(LOCALE[lang], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtDateTime(ts: number, lang: Lang): string {
  return `${fmtDate(ts, lang)} · ${fmtTime(ts, lang)}`
}

export function timeAgo(ts: number, lang: Lang): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return translate(lang, 'justNow')
  if (min < 60) return translate(lang, 'agoMin', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return translate(lang, 'agoHour', { n: h })
  return translate(lang, 'agoDay', { n: Math.floor(h / 24) })
}

export function fmtMoney(n: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function fmtDuration(ms: number, lang: Lang): string {
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min} ${translate(lang, 'minutes')}`
  const h = Math.floor(min / 60)
  return `${h} ${translate(lang, 'hours')} ${min % 60} ${translate(lang, 'minutes')}`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}
