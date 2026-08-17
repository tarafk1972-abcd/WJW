import type { IconName } from '../ui/Icon'
import type { Key } from './i18n'
import type { PanicType, ReportCategory, Role, Severity } from './types'

/** Visual + i18n metadata for report categories (shared by list, map and detail views). */
export const CATEGORY_META: Record<
  ReportCategory | 'sos',
  { key: Key; icon: IconName; color: string; bg: string; emoji: string }
> = {
  sos: { key: 'sos', icon: 'alert', color: '#fff', bg: 'var(--danger)', emoji: '🚨' },
  theft: { key: 'catTheft', icon: 'lock', color: 'var(--warn)', bg: 'var(--warn-soft)', emoji: '🔓' },
  suspicious: { key: 'catSuspicious', icon: 'eye', color: 'var(--purple)', bg: 'rgba(163,113,247,.16)', emoji: '👁️' },
  fire: { key: 'catFire', icon: 'fire', color: 'var(--danger)', bg: 'var(--danger-soft)', emoji: '🔥' },
  medical: { key: 'catMedical', icon: 'heart', color: '#ff7ba6', bg: 'rgba(255,123,166,.16)', emoji: '🚑' },
  accident: { key: 'catAccident', icon: 'car', color: 'var(--warn)', bg: 'var(--warn-soft)', emoji: '💥' },
  flood: { key: 'catFlood', icon: 'water', color: 'var(--info)', bg: 'var(--info-soft)', emoji: '🌊' },
  fight: { key: 'catFight', icon: 'flag', color: '#ff9d5c', bg: 'rgba(255,157,92,.16)', emoji: '⚠️' },
  drugs: { key: 'catDrugs', icon: 'flask', color: '#c084fc', bg: 'rgba(192,132,252,.16)', emoji: '💊' },
  vandalism: { key: 'catVandalism', icon: 'hammer', color: '#f0a35e', bg: 'rgba(240,163,94,.16)', emoji: '🔨' },
  missing: { key: 'catMissing', icon: 'search', color: '#5eead4', bg: 'rgba(94,234,212,.16)', emoji: '🔎' },
  other: { key: 'catOther', icon: 'info', color: 'var(--text-2)', bg: 'var(--surface-2)', emoji: '📍' },
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  'theft',
  'suspicious',
  'fire',
  'medical',
  'accident',
  'flood',
  'fight',
  'drugs',
  'vandalism',
  'missing',
  'other',
]

/**
 * Categories offered on tips (intel that is not an active emergency).
 */
export const TIP_CATEGORIES: ReportCategory[] = [
  'suspicious',
  'drugs',
  'vandalism',
  'missing',
  'theft',
  'other',
]

/**
 * Big hold-to-send panic tiles on the home screen, SaferWatch style.
 * Kept short on purpose — under stress people need few, obvious choices.
 */
export const PANIC_TYPES: PanicType[] = [
  'theft',
  'fight',
  'medical',
  'fire',
  'flood',
  'other',
]

export const SEVERITY_META: Record<
  Severity,
  { key: Key; icon: IconName; color: string; bg: string; banner: string }
> = {
  info: {
    key: 'sevInfo',
    icon: 'info',
    color: 'var(--info)',
    bg: 'var(--info-soft)',
    banner: 'banner-info',
  },
  warning: {
    key: 'sevWarning',
    icon: 'alert',
    color: 'var(--warn)',
    bg: 'var(--warn-soft)',
    banner: 'banner-warn',
  },
  critical: {
    key: 'sevCritical',
    icon: 'siren',
    color: 'var(--danger)',
    bg: 'var(--danger-soft)',
    banner: 'banner-danger',
  },
}

export const ASSIGNABLE_ROLES: Exclude<Role, 'superadmin'>[] = [
  'warga',
  'satpam',
  'admin',
]

export function roleKey(r: Role): Key {
  return r === 'admin'
    ? 'roleAdmin'
    : r === 'satpam'
      ? 'roleSatpam'
      : r === 'superadmin'
        ? 'roleSuperadmin'
        : 'roleWarga'
}

export function roleChip(r: Role): string {
  return r === 'admin' || r === 'superadmin'
    ? 'chip-purple'
    : r === 'satpam'
      ? 'chip-info'
      : 'chip-brand'
}

export function statusChip(status: 'open' | 'ack' | 'resolved'): string {
  return status === 'resolved'
    ? 'chip-brand'
    : status === 'ack'
      ? 'chip-info'
      : 'chip-danger'
}

export function statusKey(status: 'open' | 'ack' | 'resolved'): Key {
  return status === 'resolved'
    ? 'statusResolved'
    : status === 'ack'
      ? 'statusAck'
      : 'statusOpen'
}

/**
 * Penanda kapan berkas ini dibangun, mis. "18 Agt 18:52".
 *
 * Dicetak kecil di halaman depan. Gunanya satu: menjawab "apakah yang
 * saya lihat ini versi terbaru?" tanpa membuka DevTools. Bila angka ini
 * tidak berubah setelah aplikasi dijalankan ulang, yang tampil memang
 * salinan lama — dan pencarian penyebab dimulai dari situ, bukan dari
 * kode fiturnya.
 */
export const BUILD_STAMP: string =
  typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'
