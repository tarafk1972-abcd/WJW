import '@testing-library/react'

// jsdom has no geolocation / vibrate / clipboard
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: {
    getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) =>
      err(new Error('unavailable')),
  },
})
Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true })

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 90000 })
