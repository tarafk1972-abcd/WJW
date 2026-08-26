import { randomBytes } from 'node:crypto'

/**
 * Event kecil yang memberi tahu klien untuk mengambil state terbaru.
 *
 * Payload sengaja tidak memuat profil medis, isi chat, atau koordinat. Data
 * sensitif selalu diambil lagi melalui /api/state yang menerapkan RBAC dan
 * isolasi tenant. Pada deployment Fly Phase 1 aplikasi berjalan satu mesin
 * karena SQLite memakai satu volume; untuk skala horizontal ganti modul ini
 * dengan Redis/NATS sebelum menambah mesin.
 */
export type RealtimeEventType =
  | 'state.changed'
  | 'incident.created'
  | 'incident.updated'
  | 'incident.message'
  | 'incident.evidence'
  | 'broadcast.updated'
  | 'management.updated'
  | 'community.map.updated'
  | 'patrol.checkpoint.updated'
  | 'patrol.schedule.updated'
  | 'patrol.log.created'
  | 'dues.updated'

export interface RealtimeEvent {
  id: string
  communityId: string
  type: RealtimeEventType
  entityId?: string
  at: number
}

type Listener = (event: RealtimeEvent) => void

const listeners = new Map<string, Set<Listener>>()

/** Berlangganan event untuk satu tenant/community saja. */
export function subscribeCommunity(communityId: string, listener: Listener): () => void {
  let group = listeners.get(communityId)
  if (!group) {
    group = new Set()
    listeners.set(communityId, group)
  }
  group.add(listener)

  return () => {
    group?.delete(listener)
    if (group && group.size === 0) listeners.delete(communityId)
  }
}

/** Terbitkan sinyal invalidasi state kepada klien tenant yang sedang terhubung. */
export function publishCommunityEvent(
  communityId: string | null | undefined,
  type: RealtimeEventType = 'state.changed',
  entityId?: string,
): void {
  if (!communityId) return
  const event: RealtimeEvent = {
    id: randomBytes(9).toString('base64url'),
    communityId,
    type,
    entityId,
    at: Date.now(),
  }

  // Salin dulu agar listener yang menutup koneksi saat menerima event tidak
  // mengubah Set yang sedang diiterasi.
  for (const listener of [...(listeners.get(communityId) ?? [])]) {
    try {
      listener(event)
    } catch {
      // Koneksi seorang klien tidak boleh memengaruhi notifikasi klien lain.
    }
  }
}

/** Hanya untuk tes unit; tidak dipakai oleh aplikasi. */
export function resetRealtimeListeners(): void {
  listeners.clear()
}
