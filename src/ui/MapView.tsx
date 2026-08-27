import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { translate } from '../lib/i18n'
import type { Lang, LatLng } from '../lib/types'
import { Icon } from './Icon'

export interface MapMarker {
  id: string
  pos: LatLng
  emoji: string
  color: string
  popup?: React.ReactNode
}

type MyLocation = LatLng & { accuracy: number }

export function pinIcon(emoji: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<div class="pin-marker" style="width:30px;height:30px;background:${color}"><span>${emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  })
}

function ClickCatcher({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom())
  }, [center.lat, center.lng, zoom, map])
  return null
}

function FitArea({ area }: { area: LatLng[] }) {
  const map = useMap()
  useEffect(() => {
    if (area.length < 2) return
    const b = L.latLngBounds(area.map((p) => [p.lat, p.lng] as [number, number]))
    map.fitBounds(b, { padding: [28, 28], maxZoom: 17 })
  }, [area, map])
  return null
}

/** Moves only after the person explicitly presses the location control. */
function FocusMyLocation({
  location,
  request,
}: {
  location: MyLocation | null
  request: number
}) {
  const map = useMap()
  useEffect(() => {
    if (!location || request === 0) return
    // A fixed neighbourhood-level zoom makes the surrounding streets visible,
    // even when the user came from a highly zoomed-in incident marker.
    map.flyTo([location.lat, location.lng], 17, { animate: true, duration: 0.55 })
  }, [location, request, map])
  return null
}

function locationErrorText(error: unknown, lang: Lang) {
  const code = typeof error === 'object' && error ? (error as { code?: number }).code : undefined
  if (code === 1) return translate(lang, 'locationPermissionDenied')
  if (code === 2) return translate(lang, 'locationCurrentlyUnavailable')
  if (code === 3) return translate(lang, 'locationRequestTimeout')
  return translate(lang, 'locationRequestFailed')
}

export function MapView({
  center,
  zoom = 16,
  area = [],
  areaColor = '#2ec27e',
  markers = [],
  draftPoints,
  onMapClick,
  track,
  className = 'map-box',
  fitArea = false,
  recenterKey,
  showMyLocation = false,
  language = 'id',
}: {
  center: LatLng
  zoom?: number
  area?: LatLng[]
  areaColor?: string
  markers?: MapMarker[]
  draftPoints?: LatLng[]
  onMapClick?: (p: LatLng) => void
  track?: LatLng[]
  className?: string
  fitArea?: boolean
  recenterKey?: number
  /** Enables an on-demand, local-only browser GPS control. */
  showMyLocation?: boolean
  language?: Lang
}) {
  const [myLocation, setMyLocation] = useState<MyLocation | null>(null)
  const [locationRequest, setLocationRequest] = useState(0)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const requestId = useRef(0)

  // Invalidate a pending browser callback when this map goes away. The browser
  // location is intentionally never persisted or sent to the WJW API here.
  useEffect(() => {
    return () => {
      requestId.current += 1
    }
  }, [])

  const areaLL = useMemo(
    () => area.map((p) => [p.lat, p.lng] as [number, number]),
    [area],
  )
  const draftLL = useMemo(
    () => (draftPoints ?? []).map((p) => [p.lat, p.lng] as [number, number]),
    [draftPoints],
  )
  const trackLL = useMemo(
    () => (track ?? []).map((p) => [p.lat, p.lng] as [number, number]),
    [track],
  )

  const locateMe = useCallback(() => {
    const currentRequest = ++requestId.current
    setLocationError(null)

    // The Geolocation API is only called as a direct result of this button
    // press. There is no watchPosition/background tracking on the map.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setLocationError(translate(language, 'geoInsecure'))
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError(translate(language, 'geoUnsupported'))
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId.current !== currentRequest) return
        setLocating(false)

        const { latitude: lat, longitude: lng, accuracy } = position.coords
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          setLocationError(translate(language, 'locationRequestFailed'))
          return
        }

        setMyLocation({
          lat,
          lng,
          accuracy: Number.isFinite(accuracy) ? Math.max(0, accuracy) : 0,
        })
        setLocationRequest((value) => value + 1)
      },
      (error) => {
        if (requestId.current !== currentRequest) return
        setLocating(false)
        setLocationError(locationErrorText(error, language))
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    )
  }, [language])

  const controlLabel = locating
    ? translate(language, 'locatingMyLocation')
    : translate(language, 'myLocation')

  return (
    <div className={className}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl
      >
        {/* OpenStreetMap public tiles do not need an API key. CARTO's public
            endpoint can return an “API key required” tile in preview/browser
            environments, leaving the map visually blank. */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          referrerPolicy="strict-origin-when-cross-origin"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {areaLL.length >= 3 && (
          <Polygon
            positions={areaLL}
            pathOptions={{
              color: areaColor,
              weight: 2.5,
              fillColor: areaColor,
              fillOpacity: 0.12,
            }}
          />
        )}

        {draftLL.length > 0 && (
          <>
            {draftLL.length >= 3 ? (
              <Polygon
                positions={draftLL}
                pathOptions={{
                  color: '#ffb545',
                  weight: 2.5,
                  dashArray: '6 6',
                  fillColor: '#ffb545',
                  fillOpacity: 0.1,
                }}
              />
            ) : (
              <Polyline
                positions={draftLL}
                pathOptions={{ color: '#ffb545', weight: 2.5, dashArray: '6 6' }}
              />
            )}
            {(draftPoints ?? []).map((p, i) => (
              <Marker
                key={`d${i}`}
                position={[p.lat, p.lng]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="width:14px;height:14px;border-radius:50%;background:#ffb545;border:2.5px solid #1a2130;box-shadow:0 0 0 1.5px #ffb545"></div>`,
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                })}
              />
            ))}
          </>
        )}

        {trackLL.length > 1 && (
          <Polyline
            positions={trackLL}
            pathOptions={{ color: '#58a6ff', weight: 3, opacity: 0.85 }}
          />
        )}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.pos.lat, m.pos.lng]}
            icon={pinIcon(m.emoji, m.color)}
          >
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}

        {myLocation && (
          <>
            <Circle
              center={[myLocation.lat, myLocation.lng]}
              radius={Math.max(myLocation.accuracy, 8)}
              pathOptions={{ color: '#58a6ff', weight: 1.5, fillColor: '#58a6ff', fillOpacity: 0.13 }}
            />
            <CircleMarker
              center={[myLocation.lat, myLocation.lng]}
              radius={7}
              pathOptions={{ color: '#ffffff', weight: 2.5, fillColor: '#2678d9', fillOpacity: 1 }}
            />
            <FocusMyLocation location={myLocation} request={locationRequest} />
          </>
        )}

        {onMapClick && <ClickCatcher onClick={onMapClick} />}
        {fitArea && area.length >= 2 && <FitArea area={area} />}
        {recenterKey !== undefined && (
          <Recenter key={recenterKey} center={center} zoom={zoom} />
        )}
      </MapContainer>

      {showMyLocation && (
        <div className="map-location-ui">
          <button
            type="button"
            className="map-location-control"
            onClick={locateMe}
            disabled={locating}
            aria-label={controlLabel}
            title={controlLabel}
          >
            <Icon name="crosshair" size={17} stroke={2.2} />
            <span>{controlLabel}</span>
          </button>
          {locationError && (
            <div className="map-location-error" role="status" aria-live="polite">
              {locationError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
