import { describe, expect, it } from 'vitest'
import { activeSchedule, type ScheduleLike } from './geo.js'

function localAt(year: number, monthIndex: number, day: number, hour: number, minute = 0): number {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime()
}

const mondayNight: ScheduleLike = {
  id: 'sc_monday',
  label: 'Shift Senin malam',
  start_minute: 23 * 60,
  end_minute: 2 * 60,
  days: '[1]', // Senin
  assigned_satpam_ids: '["guard-a"]',
  grace_min: 10,
  active: 1,
}

describe('jadwal patroli server', () => {
  it('mengaitkan jam setelah tengah malam ke hari mulai shift dan ke satpam yang ditugaskan', () => {
    // 31 Agustus 2026 adalah Senin; pukul 01.00 berikutnya masih shift Senin.
    const at = localAt(2026, 8, 1, 1)
    expect(new Date(at).getDay()).toBe(2)

    expect(activeSchedule([mondayNight], at, 'guard-a')?.schedule.id).toBe('sc_monday')
    expect(activeSchedule([mondayNight], at, 'guard-b')).toBeNull()
    // Pengawas admin tidak diberi filter satpam; ia tetap dapat melihat shift aktif.
    expect(activeSchedule([mondayNight], at)?.schedule.id).toBe('sc_monday')
  })

  it('melewati data jadwal JSON yang rusak tanpa menjatuhkan pencatatan ronda', () => {
    const corrupt = { ...mondayNight, days: '{bukan-array' }
    expect(activeSchedule([corrupt], localAt(2026, 7, 31, 23, 30), 'guard-a')).toBeNull()
  })
})
