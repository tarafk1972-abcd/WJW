import type { IconName } from '../ui/Icon'
import type { Key } from './i18n'
import type { ReportCategory, Role } from './types'

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
  'other',
]

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
