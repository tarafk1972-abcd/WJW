/**
 * Lapisan sinkronisasi antara UI dan API.
 *
 * Halaman tetap membaca dari cache lokal berbentuk `DBShape` (cepat, tanpa
 * menunggu jaringan), sementara setiap perubahan dikirim ke server. Setelah
 * server membalas, cache disegarkan dari sumber kebenaran di server.
 *
 * Pola ini membuat aplikasi tetap terasa instan, tetapi server yang
 * menentukan hasil akhir — termasuk penolakan izin.
 */
import { api, ApiError, getToken } from './api'
import { startRealtime, type RealtimeSignal } from './realtime'
import { loadDB, saveDB } from './db'
import type { DBShape } from './types'

/** Aktif bila pengguna sudah punya token — artinya memakai server. */
export function apiMode(): boolean {
  return !!getToken()
}

// Sinkronisasi digabung hanya untuk token yang sama. Jika pengguna berganti
// akun cepat pada perangkat bersama, respons tenant lama tidak boleh menimpa
// cache tenant baru atau membuat sync baru menunggu request lama.
let syncing: { token: string; promise: Promise<void> } | null = null
let lastError: string | null = null

/**
 * True hanya selama ada peringatan darurat yang berlangsung.
 * Dipakai untuk memutuskan kapan boleh menyentuh GPS — di luar itu,
 * lokasi warga tidak pernah diminta.
 */
let locationWanted = false

export function isLocationWanted(): boolean {
  return locationWanted
}

export function lastSyncError(): string | null {
  return lastError
}

/** Bentuk balasan /api/state, semuanya opsional agar tahan perubahan. */
interface StatePayload {
  /** Server sedang membutuhkan lokasi: ada darurat berlangsung. */
  locationWanted?: boolean
  me?: Record<string, unknown>
  community?: Record<string, unknown>
  communities?: Record<string, unknown>[]
  members?: Record<string, unknown>[]
  reports?: Record<string, unknown>[]
  managementResponsibilities?: Record<string, unknown>[]
  canAssignManagementResponsibilities?: boolean
  checkpoints?: Record<string, unknown>[]
  schedules?: Record<string, unknown>[]
  patrolLogs?: Record<string, unknown>[]
  invites?: Record<string, unknown>[]
  contacts?: Record<string, unknown>[]
  broadcasts?: Record<string, unknown>[]
  announcements?: Record<string, unknown>[]
  guests?: Record<string, unknown>[]
  audit?: Record<string, unknown>[]
}

/**
 * Tarik seluruh keadaan dari server ke cache lokal.
 * Aman dipanggil berulang; panggilan bersamaan digabung menjadi satu.
 */
export function syncState(): Promise<void> {
  const token = getToken()
  if (!token) {
    locationWanted = false
    lastError = null
    return Promise.resolve()
  }
  if (syncing?.token === token) return syncing.promise

  let task!: Promise<void>
  task = (async () => {
    try {
      const s = (await api.get('/state')) as StatePayload
      // Pengguna mungkin logout atau masuk ke tenant lain saat request lama
      // berjalan. Jangan pernah tulis respons tersebut ke perangkat baru.
      if (token !== getToken()) return

      const db = loadDB()
      const next: DBShape = {
        ...db,
        communities: (s.communities ??
          (s.community ? [s.community] : [])) as unknown as DBShape['communities'],
        members: (s.members ?? []) as unknown as DBShape['members'],
        reports: (s.reports ?? []) as unknown as DBShape['reports'],
        managementResponsibilities: (s.managementResponsibilities ?? []) as unknown as DBShape['managementResponsibilities'],
        canAssignManagementResponsibilities: s.canAssignManagementResponsibilities === true,
        checkpoints: (s.checkpoints ?? []) as unknown as DBShape['checkpoints'],
        schedules: (s.schedules ?? []) as unknown as DBShape['schedules'],
        patrolLogs: (s.patrolLogs ?? []) as unknown as DBShape['patrolLogs'],
        invites: (s.invites ?? []) as unknown as DBShape['invites'],
        contacts: (s.contacts ?? []) as unknown as DBShape['contacts'],
        broadcasts: (s.broadcasts ?? []) as unknown as DBShape['broadcasts'],
        announcements: (s.announcements ?? []) as unknown as DBShape['announcements'],
        guests: (s.guests ?? []) as unknown as DBShape['guests'],
        audit: (s.audit ?? db.audit) as unknown as DBShape['audit'],
      }

      // Pastikan diri sendiri selalu ada di daftar anggota, walau server
      // menyembunyikannya (mis. anggota yang masih menunggu persetujuan).
      if (s.me && !next.members.some((m) => m.id === (s.me as { id: string }).id)) {
        next.members = [...next.members, s.me as unknown as DBShape['members'][number]]
      }

      locationWanted = s.locationWanted === true

      // Simpan tanpa menghapus media lama: data server adalah kebenaran.
      saveDB(next)
      lastError = null
    } catch (e) {
      // Jangan biarkan kegagalan token/request lama menyalakan indikator
      // offline pada sesi yang sudah berganti.
      if (token === getToken()) lastError = e instanceof ApiError ? e.code : 'errOffline'
      // Gagal sinkron tidak boleh menjatuhkan aplikasi — UI boleh membaca
      // cache terakhir. Jalur SOS sendiri tetap wajib menunggu konfirmasi API
      // dan akan berkata belum terkirim bila koneksi gagal.
    } finally {
      if (syncing?.promise === task) syncing = null
    }
  })()
  syncing = { token, promise: task }
  return task
}

/**
 * Jalankan aksi tulis ke server lalu segarkan cache.
 * Kembalikan false bila gagal, agar pemanggil bisa menampilkan pesan.
 */
export async function mutate(fn: () => Promise<unknown>): Promise<boolean> {
  if (!apiMode()) return false
  try {
    await fn()
    await syncState()
    return true
  } catch (e) {
    lastError = e instanceof ApiError ? e.code : 'errOffline'
    // tetap segarkan agar UI kembali selaras dengan server
    await syncState()
    return false
  }
}

/**
 * Jalur real-time utama. Server hanya mengirim sinyal kecil, lalu klien
 * mengambil state lewat endpoint yang menerapkan tenant isolation/RBAC.
 * Tidak ada polling berkala sebagai mekanisme utama.
 */
export function startRealtimeSync(
  onUpdate?: () => void,
  /*
   * Jenis sinyal ikut diteruskan supaya pemanggil bisa membedakan darurat
   * dari perubahan biasa. Sebelumnya sinyalnya dibuang, sehingga tidak ada
   * cara membunyikan sirene hanya untuk SOS.
   */
  onSignal?: (signal: RealtimeSignal) => void,
): () => void {
  if (!apiMode()) return () => {}
  return startRealtime({
    onSignal: (signal) => {
      onSignal?.(signal)
      void syncState().then(onUpdate)
    },
  })
}

/**
 * Fallback lama untuk integrasi lokal yang belum mendukung streaming.
 * AppProvider produksi tidak memakainya; SSE di atas adalah jalur utama.
 */
export function startPolling(ms = 8000): () => void {
  if (!apiMode()) return () => {}
  void syncState()
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') void syncState()
  }, ms)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncState()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(id)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
