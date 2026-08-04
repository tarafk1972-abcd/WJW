import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { LatLng } from '../lib/types'

export interface MapMarker {
  id: string
  pos: LatLng
  emoji: string
  color: string
  popup?: React.ReactNode
}

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
}) {
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

  return (
    <div className={className}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
          maxZoom={20}
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

        {onMapClick && <ClickCatcher onClick={onMapClick} />}
        {fitArea && area.length >= 2 && <FitArea area={area} />}
        {recenterKey !== undefined && (
          <Recenter key={recenterKey} center={center} zoom={zoom} />
        )}
      </MapContainer>
    </div>
  )
}
