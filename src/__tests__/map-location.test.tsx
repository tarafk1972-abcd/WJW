import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const map = vi.hoisted(() => ({ flyTo: vi.fn() }))

/* MapView's behaviour is tested without Leaflet's DOM/layout implementation.
   The test focuses on the privacy boundary and the coordinates given to it. */
vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(),
    latLngBounds: vi.fn(),
  },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="leaflet-map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Polygon: () => null,
  Polyline: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Circle: ({ center, radius }: { center: [number, number]; radius: number }) => (
    <div data-testid="location-accuracy" data-center={center.join(',')} data-radius={radius} />
  ),
  CircleMarker: ({ center }: { center: [number, number] }) => (
    <div data-testid="location-dot" data-center={center.join(',')} />
  ),
  useMap: () => map,
  useMapEvents: () => undefined,
}))

import { MapView } from '../ui/MapView'

const CENTER = { lat: -6.9147, lng: 107.6098 }
const DEVICE_LOCATION = { lat: -6.9172, lng: 107.6191 }

function installGeo(getCurrentPosition: Geolocation['getCurrentPosition']) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  })
}

describe('kontrol Lokasi saya pada peta', () => {
  beforeEach(() => {
    map.flyTo.mockReset()
  })

  it('tidak meminta GPS sebelum warga menekan tombolnya', () => {
    const getCurrentPosition = vi.fn()
    installGeo(getCurrentPosition)

    render(<MapView center={CENTER} showMyLocation />)

    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Lokasi saya' })).toBeTruthy()
  })

  it('memusatkan peta di GPS setelah warga meminta lokasi dan menandai titiknya', async () => {
    const getCurrentPosition = vi.fn(
      (ok: PositionCallback, _fail?: PositionErrorCallback, _options?: PositionOptions) =>
        ok({
          coords: {
            latitude: DEVICE_LOCATION.lat,
            longitude: DEVICE_LOCATION.lng,
            accuracy: 18,
          },
        } as GeolocationPosition),
    )
    installGeo(getCurrentPosition)

    render(<MapView center={CENTER} showMyLocation />)
    fireEvent.click(screen.getByRole('button', { name: 'Lokasi saya' }))

    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000,
    })
    await waitFor(() =>
      expect(map.flyTo).toHaveBeenCalledWith(
        [DEVICE_LOCATION.lat, DEVICE_LOCATION.lng],
        17,
        expect.objectContaining({ animate: true }),
      ),
    )
    expect(screen.getByTestId('location-accuracy').getAttribute('data-center')).toBe(
      `${DEVICE_LOCATION.lat},${DEVICE_LOCATION.lng}`,
    )
    expect(screen.getByTestId('location-accuracy').getAttribute('data-radius')).toBe('18')
    expect(screen.getByTestId('location-dot').getAttribute('data-center')).toBe(
      `${DEVICE_LOCATION.lat},${DEVICE_LOCATION.lng}`,
    )
  })

  it('menjelaskan bila izin GPS ditolak, tanpa memindahkan peta', async () => {
    const getCurrentPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback) =>
      fail?.({ code: 1 } as GeolocationPositionError),
    )
    installGeo(getCurrentPosition)

    render(<MapView center={CENTER} showMyLocation />)
    fireEvent.click(screen.getByRole('button', { name: 'Lokasi saya' }))

    expect((await screen.findByRole('status')).textContent).toContain(
      'Izin lokasi ditolak. Izinkan lokasi di browser lalu coba lagi.',
    )
    expect(map.flyTo).not.toHaveBeenCalled()
  })
})
