import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertApi, setToken } from '../lib/api'

describe('batas waktu konfirmasi API', () => {
  beforeEach(() => {
    localStorage.clear()
    setToken('token-uji')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setToken(null)
  })

  it('mengakhiri request SOS yang menggantung agar UI dapat menawarkan retry idempoten', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    )

    const pending = alertApi.raise('medical', null, null, 'retry-key-aman-001')
    // Pasang rejection handler sebelum clock virtual melewati timeout agar
    // Vitest tidak menganggap penolakan sengaja dibiarkan tak tertangani.
    const rejected = expect(pending).rejects.toMatchObject({ code: 'errOffline', status: 0 })
    await vi.advanceTimersByTimeAsync(12_000)

    await rejected
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/alerts',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    )
  })
})
