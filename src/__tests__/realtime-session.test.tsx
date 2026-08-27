import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realtime = vi.hoisted(() => {
  const stop = vi.fn()
  return {
    stop,
    startRealtimeSync: vi.fn(() => stop),
    syncState: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('../lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sync')>()
  return {
    ...actual,
    startRealtimeSync: realtime.startRealtimeSync,
    syncState: realtime.syncState,
  }
})

import { expireSession, setToken } from '../lib/api'
import { getSessionId, invalidateCache, setSession } from '../lib/db'
import { AppProvider } from '../lib/store'

describe('sesi real-time', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    vi.clearAllMocks()
    realtime.startRealtimeSync.mockImplementation(() => realtime.stop)
    realtime.syncState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    setToken(null)
    localStorage.clear()
    invalidateCache()
  })

  it('membuka SSE segera setelah token disimpan pasca-login, tanpa menunggu reload', async () => {
    const view = render(
      <AppProvider>
        <div>siap</div>
      </AppProvider>,
    )

    await act(async () => {
      setToken('token-baru')
    })

    await waitFor(() => expect(realtime.startRealtimeSync).toHaveBeenCalledTimes(1))
    expect(realtime.syncState).toHaveBeenCalled()

    view.unmount()
    expect(realtime.stop).toHaveBeenCalledTimes(1)
  })

  it('membuang sesi/cache ketika server menyatakan token kedaluwarsa', async () => {
    render(
      <AppProvider>
        <div>siap</div>
      </AppProvider>,
    )
    await act(async () => {
      setSession('warga-lama')
      localStorage.setItem('wjw.db.v1', '{"reports":[{"id":"sos-rahasia"}]}')
      setToken('token-lama')
    })

    await act(async () => {
      expireSession()
    })

    await waitFor(() => expect(getSessionId()).toBeNull())
    expect(localStorage.getItem('wjw.db.v1')).toBeNull()
  })
})
