import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PanicGrid, HOLD_MS } from '../ui/PanicGrid'
import { AppProvider } from '../lib/store'
import { ToastProvider } from '../ui/Toast'
import { invalidateCache } from '../lib/db'

function wrap(ui: React.ReactNode) {
  return (
    <AppProvider>
      <ToastProvider>{ui}</ToastProvider>
    </AppProvider>
  )
}

describe('PanicGrid hold-to-activate', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
  })

  it('renders one tile per panic type in Indonesian', () => {
    render(wrap(<PanicGrid onTrigger={() => {}} />))
    expect(screen.getByText(/Tekan & tahan untuk melaporkan darurat/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Darurat medis' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kebakaran' })).toBeTruthy()
  })

  it('does NOT fire on a quick tap (guards against accidental alerts)', async () => {
    const onTrigger = vi.fn()
    const user = userEvent.setup()
    render(wrap(<PanicGrid onTrigger={onTrigger} />))
    await user.click(screen.getByRole('button', { name: 'Kebakaran' }))
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires with the held type once the hold completes', async () => {
    vi.useFakeTimers()
    let now = 0
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => now)
    // drive rAF manually so we control the clock
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        return setTimeout(() => cb(now), 16) as unknown as number
      })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    )
    const onTrigger = vi.fn()
    render(wrap(<PanicGrid onTrigger={onTrigger} />))
    const tile = screen.getByRole('button', { name: 'Kebakaran' })

    tile.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    now += HOLD_MS + 50
    await vi.advanceTimersByTimeAsync(64)

    expect(onTrigger).toHaveBeenCalledWith('fire')

    raf.mockRestore()
    perf.mockRestore()
    vi.useRealTimers()
  })

  it('aborts when the finger lifts before the hold completes', async () => {
    vi.useFakeTimers()
    let now = 0
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        return setTimeout(() => cb(now), 16) as unknown as number
      })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    )
    const onTrigger = vi.fn()
    render(wrap(<PanicGrid onTrigger={onTrigger} />))
    const tile = screen.getByRole('button', { name: 'Darurat medis' })

    tile.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    now += HOLD_MS / 3
    await vi.advanceTimersByTimeAsync(32)
    tile.dispatchEvent(new Event('pointerup', { bubbles: true }))
    now += HOLD_MS
    await vi.advanceTimersByTimeAsync(200)

    expect(onTrigger).not.toHaveBeenCalled()

    raf.mockRestore()
    perf.mockRestore()
    vi.useRealTimers()
  })
})

describe('BigSOS one-button behaviour', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
  })

  it('does not fire on a quick tap', async () => {
    const { BigSOS } = await import('../ui/BigSOS')
    const onTrigger = vi.fn()
    const user = userEvent.setup()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    await user.click(screen.getByRole('button', { name: 'DARURAT' }))
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires after a full 2-second hold', async () => {
    const { BigSOS, SOS_HOLD_MS } = await import('../ui/BigSOS')
    vi.useFakeTimers()
    let now = 0
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)

    const onTrigger = vi.fn()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    const btn = screen.getByRole('button', { name: 'DARURAT' })

    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    now += SOS_HOLD_MS + 50
    await vi.advanceTimersByTimeAsync(64)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    raf.mockRestore()
    perf.mockRestore()
    vi.useRealTimers()
  })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    )
  it('never fires if the finger lifts early', async () => {
    const { BigSOS, SOS_HOLD_MS } = await import('../ui/BigSOS')
    vi.useFakeTimers()
    let now = 0
    const perf = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number)

    const onTrigger = vi.fn()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    const btn = screen.getByRole('button', { name: 'DARURAT' })

    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    now += SOS_HOLD_MS / 2
    await vi.advanceTimersByTimeAsync(32)
    btn.dispatchEvent(new Event('pointerup', { bubbles: true }))
    now += SOS_HOLD_MS * 2
    await vi.advanceTimersByTimeAsync(300)

    expect(onTrigger).not.toHaveBeenCalled()

    raf.mockRestore()
    perf.mockRestore()
    vi.useRealTimers()
  })
})
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    )
