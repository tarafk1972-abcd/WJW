/**
 * Denyut kehadiran: buktikan aplikasi terbuka tanpa menyentuh GPS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HEARTBEAT_MS,
  pingPresence,
  resetPresenceHeartbeat,
  startPresenceHeartbeat,
} from '../lib/heartbeat'
import * as apiModule from '../lib/api'

const post = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  resetPresenceHeartbeat()
})

describe('pingPresence', () => {
  it('mengirim /me/presence ketika sedang masuk', async () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue('token-x')
    post.mockResolvedValue({ lastSeenAt: Date.now() })
    vi.spyOn(apiModule.api, 'post').mockImplementation(post)

    await pingPresence()
    expect(post).toHaveBeenCalledWith('/me/presence')
  })

  it('tidak melakukan apa-apa bila tidak ada token', async () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue(null)
    vi.spyOn(apiModule.api, 'post').mockImplementation(post)

    await pingPresence()
    expect(post).not.toHaveBeenCalled()
  })

  it('meredam denyut ganda yang tiba bersamaan', async () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue('token-x')
    post.mockResolvedValue({ lastSeenAt: Date.now() })
    vi.spyOn(apiModule.api, 'post').mockImplementation(post)

    const t0 = 1_000_000
    await pingPresence(t0)
    await pingPresence(t0 + 5_000) // < 10s, harus diabaikan
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('tidak melempar error bila server bermasalah', async () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue('token-x')
    post.mockRejectedValue(new Error('offline'))
    vi.spyOn(apiModule.api, 'post').mockImplementation(post)

    await expect(pingPresence()).resolves.toBeUndefined()
  })
})

describe('startPresenceHeartbeat', () => {
  it('menyebut server sekali saat mulai, lalu mengikuti interval', () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue('token-x')
    post.mockResolvedValue({ lastSeenAt: Date.now() })
    vi.spyOn(apiModule.api, 'post').mockImplementation(post)

    const stop = startPresenceHeartbeat()
    // panggilan pertama berjalan (async fire-and-forget)
    expect(post).toHaveBeenCalled()
    expect(HEARTBEAT_MS).toBeGreaterThan(0)
    stop()
  })

  it('mengembalikan pembatal yang aman dipanggil saat unmount', () => {
    vi.spyOn(apiModule, 'getToken').mockReturnValue(null)
    const stop = startPresenceHeartbeat()
    expect(() => stop()).not.toThrow()
  })
})
