import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanicGrid, HOLD_MS } from '../ui/PanicGrid'
import { Countdown } from '../ui/Countdown'
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

/** Mengendalikan clock/rAF tanpa meninggalkan update React di luar `act()`. */
function mockHoldClock() {
  vi.useFakeTimers()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb: FrameRequestCallback) => setTimeout(() => cb(now), 16) as unknown as number,
  )
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) =>
    clearTimeout(id as unknown as NodeJS.Timeout),
  )
  return {
    async advance(ms: number) {
      now += ms
      await act(async () => {
        await vi.advanceTimersByTimeAsync(64)
      })
    },
    async dispatch(target: Element, event: string) {
      await act(async () => {
        target.dispatchEvent(new Event(event, { bubbles: true }))
      })
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  invalidateCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PanicGrid hold-to-activate', () => {
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
    const clock = mockHoldClock()
    const onTrigger = vi.fn()
    render(wrap(<PanicGrid onTrigger={onTrigger} />))
    const tile = screen.getByRole('button', { name: 'Kebakaran' })

    await clock.dispatch(tile, 'pointerdown')
    await clock.advance(HOLD_MS + 50)

    expect(onTrigger).toHaveBeenCalledWith('fire')
  })

  it('aborts when the finger lifts before the hold completes', async () => {
    const clock = mockHoldClock()
    const onTrigger = vi.fn()
    render(wrap(<PanicGrid onTrigger={onTrigger} />))
    const tile = screen.getByRole('button', { name: 'Darurat medis' })

    await clock.dispatch(tile, 'pointerdown')
    await clock.advance(HOLD_MS / 3)
    await clock.dispatch(tile, 'pointerup')
    await clock.advance(HOLD_MS)

    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('Countdown jendela pembatalan', () => {
  it('tidak pernah mengirim setelah warga membatalkan dalam lima detik', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(wrap(<Countdown seconds={5} label="Darurat medis" onDone={onDone} onCancel={onCancel} />))

    await act(async () => {
      screen.getByRole('button', { name: /Batalkan/i }).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('Countdown jendela pembatalan', () => {
  it('tidak pernah mengirim setelah warga membatalkan dalam lima detik', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(wrap(<Countdown seconds={5} label="Darurat medis" onDone={onDone} onCancel={onCancel} />))

    screen.getByRole('button', { name: /Batalkan/i }).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await vi.advanceTimersByTimeAsync(6000)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('BigSOS one-button behaviour', () => {
  it('does not fire on a quick tap', async () => {
    const { BigSOS } = await import('../ui/BigSOS')
    const onTrigger = vi.fn()
    const user = userEvent.setup()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    await user.click(screen.getByRole('button', { name: 'DARURAT' }))
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('fires after a full 1.5-second hold', async () => {
    const { BigSOS, SOS_HOLD_MS } = await import('../ui/BigSOS')
    const clock = mockHoldClock()
    const onTrigger = vi.fn()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    const button = screen.getByRole('button', { name: 'DARURAT' })

    await clock.dispatch(button, 'pointerdown')
    await clock.advance(SOS_HOLD_MS + 50)

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('never fires if the finger lifts early', async () => {
    const { BigSOS, SOS_HOLD_MS } = await import('../ui/BigSOS')
    const clock = mockHoldClock()
    const onTrigger = vi.fn()
    render(wrap(<BigSOS onTrigger={onTrigger} />))
    const button = screen.getByRole('button', { name: 'DARURAT' })

    await clock.dispatch(button, 'pointerdown')
    await clock.advance(SOS_HOLD_MS / 2)
    await clock.dispatch(button, 'pointerup')
    await clock.advance(SOS_HOLD_MS * 2)

    expect(onTrigger).not.toHaveBeenCalled()
  })
})
