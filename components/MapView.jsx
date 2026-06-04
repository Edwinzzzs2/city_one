'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, App, Button, Checkbox, Empty, Input, List, Space, Spin, Tag, Tooltip, Typography,
} from 'antd'
import {
  AimOutlined, CloseOutlined, CompassOutlined, EnvironmentOutlined,
  ReloadOutlined, SaveOutlined, SyncOutlined,
} from '@ant-design/icons'

const { Text } = Typography
const PROTECTION_RADIUS = 1000
const DEFAULT_CENTER = [116.397428, 39.90923]
const GEOCODE_BATCH_SIZE = 10
const GEOCODE_DELAY_MS = 450
let amapLoadPromise = null

function loadAmap({ key, securityCode }) {
  if (typeof window === 'undefined') return Promise.reject(new Error('地图只能在浏览器中加载'))
  if (!key || !securityCode) return Promise.reject(new Error('缺少高德地图 JS Key 或安全密钥'))

  window._AMapSecurityConfig = { securityJsCode: securityCode }
  if (amapLoadPromise) return amapLoadPromise

  amapLoadPromise = new Promise((resolve, reject) => {
    const runLoader = () => {
      window.AMapLoader
        .load({
          key,
          version: '2.0',
          plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.GeometryUtil'],
        })
        .then(resolve)
        .catch(reject)
    }

    if (window.AMapLoader) {
      runLoader()
      return
    }

    const existing = document.getElementById('amap-loader-script')
    if (existing) {
      existing.addEventListener('load', runLoader, { once: true })
      existing.addEventListener('error', () => reject(new Error('高德地图 Loader 加载失败')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = 'amap-loader-script'
    script.src = 'https://webapi.amap.com/loader.js'
    script.async = true
    script.onload = runLoader
    script.onerror = () => reject(new Error('高德地图 Loader 加载失败'))
    document.head.appendChild(script)
  }).catch((error) => {
    amapLoadPromise = null
    throw error
  })

  return amapLoadPromise
}

function formatDistance(distance) {
  if (!Number.isFinite(distance)) return '-'
  if (distance >= 1000) return `${(distance / 1000).toFixed(distance >= 10000 ? 1 : 2)} 公里`
  return `${Math.round(distance)} 米`
}

function formatPointName(point) {
  return point?.name || point?.company || point?.address || `门店 #${point?.id || ''}`
}

function fullRegion(point) {
  return [point?.province, point?.city, point?.district].filter(Boolean).join(' / ') || '未填写区域'
}

function fullAddressPayload(row = {}) {
  return {
    province: row.province,
    city: row.city,
    district: row.district,
    address: row.address,
  }
}

function searchTextForRow(row = {}) {
  return [row.province, row.city, row.district, row.address, row.name || row.company]
    .filter(Boolean)
    .join('')
}

function canAutoLocate(row = {}) {
  return Boolean(row.address || row.district || row.city || row.province)
}

function isValidCoordinate(lng, lat) {
  return Number.isFinite(lng) && Number.isFinite(lat)
}

function isBlankCoordinate(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function hasLocation(row = {}) {
  if (isBlankCoordinate(row.lng) || isBlankCoordinate(row.lat)) return false
  return isValidCoordinate(Number(row.lng), Number(row.lat))
}

function isManualLocation(row = {}) {
  return String(row.geocode_status || '').startsWith('manual')
}

function normalizePoint(row) {
  if (isBlankCoordinate(row.lng) || isBlankCoordinate(row.lat)) {
    return { ...row, lng: null, lat: null }
  }
  const lng = Number(row.lng)
  const lat = Number(row.lat)
  if (!isValidCoordinate(lng, lat)) return { ...row, lng: null, lat: null }
  return { ...row, lng, lat }
}

function haversineDistance(a, b) {
  const toRad = (value) => value * Math.PI / 180
  const radius = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

function findNearest(point, points, AMap) {
  if (!point || points.length === 0) return null

  return points.reduce((best, store) => {
    const distance = AMap?.GeometryUtil?.distance
      ? AMap.GeometryUtil.distance([point.lng, point.lat], [store.lng, store.lat])
      : haversineDistance(point, store)

    if (!best || distance < best.distance) {
      return { point: store, distance }
    }
    return best
  }, null)
}

function markerContent(type) {
  return `<div class="map-marker map-marker-${type}"></div>`
}

function markerLabelContent(type, badge, point = {}) {
  const name = formatPointName(point)
  const region = fullRegion(point)
  const address = point.formattedAddress || point.address || '-'

  return `
    <div class="map-point-label map-point-label-${type}">
      <em>${escapeHtml(badge)}</em>
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(region)}</span>
      <small>${escapeHtml(address)}</small>
    </div>
  `
}

function distanceLabelContent(distance, conflict) {
  return `<div class="map-distance-label ${conflict ? 'is-conflict' : 'is-safe'}">${escapeHtml(formatDistance(distance))}</div>`
}

const MapSearchPanel = React.memo(function MapSearchPanel({
  selectedPoint,
  searchText,
  loading,
  results,
  onSearch,
  onClear,
  onSelect,
}) {
  const [inputValue, setInputValue] = useState(searchText || '')

  useEffect(() => {
    setInputValue(searchText || '')
  }, [searchText])

  const handleChange = useCallback((event) => {
    const value = event.target.value
    setInputValue(value)
    if (!value.trim()) onClear()
  }, [onClear])

  const handleSearch = useCallback((value) => {
    onSearch(String(value ?? inputValue).trim())
  }, [inputValue, onSearch])

  return (
    <div className="map-search-panel">
      <Input.Search
        value={inputValue}
        onChange={handleChange}
        onSearch={handleSearch}
        loading={loading}
        enterButton={selectedPoint ? '搜索定点' : '搜索校验'}
        placeholder={selectedPoint ? '搜索地址，给当前门店重新定点' : '搜索地址，查看最近门店距离'}
        allowClear
      />
      {results.length > 0 && (
        <div className="map-search-results">
          {results.map((poi, index) => (
            <button
              type="button"
              key={`${poi.id || poi.name}-${index}`}
              className="map-search-result"
              onClick={() => onSelect(poi)}
            >
              <span>{poi.name}</span>
              <small>{[poi.province, poi.city, poi.district, poi.address].filter(Boolean).join(' ') || poi.type}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function markerInfoContent(point = {}) {
  const rows = [
    ['区域', fullRegion(point)],
    ['地址', point.address],
    ['公司', point.company],
    ['电话', point.phone],
    ['状态', point.status],
    ['来源', isManualLocation(point) ? '手动打点' : point.geocode_status || '自动/导入'],
  ].filter(([, value]) => value)

  return `
    <div class="map-info-window">
      <div class="map-info-title">${escapeHtml(formatPointName(point))}</div>
      ${rows.map(([label, value]) => `
        <div class="map-info-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join('')}
      ${hasLocation(point) ? `
        <div class="map-info-coord">${Number(point.lng).toFixed(6)}, ${Number(point.lat).toFixed(6)}</div>
      ` : ''}
    </div>
  `
}

export default function MapView({ searchQuery = '', searchMode = 'city', themeMode = 'light' }) {
  const { message } = App.useApp()
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const amapRef = useRef(null)
  const infoWindowRef = useRef(null)
  const selectedPointRef = useRef(null)
  const storeOverlaysRef = useRef([])
  const analysisOverlaysRef = useRef([])

  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState('')
  const [points, setPoints] = useState([])
  const [listRows, setListRows] = useState([])
  const [summary, setSummary] = useState({ total: 0, located: 0, missing: 0, manual: 0, limited: false, listLimited: false })
  const [pointsLoading, setPointsLoading] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [listMode, setListMode] = useState('located')
  const [showProtection, setShowProtection] = useState(true)
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [manualPoint, setManualPoint] = useState(null)
  const [mapSearchText, setMapSearchText] = useState('')
  const [mapSearchLoading, setMapSearchLoading] = useState(false)
  const [mapSearchResults, setMapSearchResults] = useState([])
  const [newPoint, setNewPoint] = useState(null)
  const [nearest, setNearest] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [autoGeocodingId, setAutoGeocodingId] = useState(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeProgress, setGeocodeProgress] = useState(null)

  const amapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY || ''
  const amapSecurityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || ''
  const activeCheckPoint = manualPoint || newPoint
  const isManualDraft = Boolean(manualPoint && selectedPoint)
  const isConflict = nearest?.distance <= PROTECTION_RADIUS

  useEffect(() => {
    selectedPointRef.current = selectedPoint
  }, [selectedPoint])

  const selectPoint = useCallback((row, { keepDraft = false } = {}) => {
    const point = normalizePoint(row)
    setSelectedPoint(point)
    if (!keepDraft) setManualPoint(null)
    setNewPoint(null)
    setMapSearchResults([])

    const map = mapRef.current
    if (map && hasLocation(point)) {
      map.panTo([point.lng, point.lat])
    }
  }, [])

  const loadPoints = useCallback(async () => {
    setPointsLoading(true)
    try {
      const params = new URLSearchParams({ map: '1', list: listMode })
      if (searchQuery) {
        params.set(searchMode === 'city' ? 'city' : 'q', searchQuery)
      }
      const response = await fetch(`/api/addresses?${params.toString()}`)
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || '地图点位加载失败')

      setPoints((data.mapRows || []).map(normalizePoint).filter(hasLocation))
      setListRows((data.rows || []).map(normalizePoint))
      setSummary(data.summary || { total: 0, located: 0, missing: 0, manual: 0, limited: false, listLimited: false })
    } catch (e) {
      setPoints([])
      setListRows([])
      message.error(e.message)
    } finally {
      setPointsLoading(false)
    }
  }, [listMode, message, searchMode, searchQuery])

  const clearOverlays = useCallback((ref) => {
    const map = mapRef.current
    if (map && ref.current.length > 0) {
      map.remove(ref.current)
    }
    ref.current = []
  }, [])

  useEffect(() => {
    let disposed = false

    async function initMap() {
      setMapLoading(true)
      setMapError('')
      setMapReady(false)
      try {
        const AMap = await loadAmap({ key: amapKey, securityCode: amapSecurityCode })
        if (disposed || !mapNodeRef.current) return

        amapRef.current = AMap
        infoWindowRef.current = new AMap.InfoWindow({
          isCustom: true,
          closeWhenClickMap: true,
          offset: new AMap.Pixel(16, -18),
        })
        const map = new AMap.Map(mapNodeRef.current, {
          center: DEFAULT_CENTER,
          zoom: 11,
          resizeEnable: true,
          mapStyle: themeMode === 'dark' ? 'amap://styles/darkblue' : 'amap://styles/normal',
        })
        map.addControl(new AMap.Scale())
        map.addControl(new AMap.ToolBar({ position: { top: '16px', right: '16px' } }))
        map.on('click', (event) => {
          const lng = event.lnglat?.getLng ? event.lnglat.getLng() : event.lnglat?.lng
          const lat = event.lnglat?.getLat ? event.lnglat.getLat() : event.lnglat?.lat
          if (!isValidCoordinate(lng, lat)) return

          const currentSelected = selectedPointRef.current
          if (currentSelected) {
            setManualPoint({ lng, lat, address: '地图定点' })
            setNewPoint(null)
            setMapSearchResults([])
            message.info('已选择定点位置，保存后会写入该门店')
            return
          }

          setNewPoint({ lng, lat, address: '地图选点' })
          setMapSearchResults([])
        })

        mapRef.current = map
        setMapReady(true)
      } catch (e) {
        setMapError(e.message)
      } finally {
        if (!disposed) setMapLoading(false)
      }
    }

    initMap()

    return () => {
      disposed = true
      clearOverlays(storeOverlaysRef)
      clearOverlays(analysisOverlaysRef)
      mapRef.current?.destroy()
      mapRef.current = null
      amapRef.current = null
      infoWindowRef.current = null
    }
  }, [amapKey, amapSecurityCode, clearOverlays, message])

  useEffect(() => {
    const map = mapRef.current
    if (map) {
      map.setMapStyle(themeMode === 'dark' ? 'amap://styles/darkblue' : 'amap://styles/normal')
    }
  }, [themeMode])

  useEffect(() => {
    loadPoints()
  }, [loadPoints])

  const nearestCandidates = useMemo(() => {
    if (isManualDraft && selectedPoint) {
      return points.filter(point => point.id !== selectedPoint.id)
    }
    return points
  }, [isManualDraft, points, selectedPoint])

  useEffect(() => {
    setNearest(findNearest(activeCheckPoint, nearestCandidates, amapRef.current))
  }, [activeCheckPoint, nearestCandidates])

  useEffect(() => {
    const map = mapRef.current
    if (mapReady && map && selectedPoint && hasLocation(selectedPoint)) {
      map.panTo([selectedPoint.lng, selectedPoint.lat])
    }
  }, [mapReady, selectedPoint])

  const bindMarkerInfo = useCallback((marker, point) => {
    marker.on('mouseover', () => {
      const map = mapRef.current
      const infoWindow = infoWindowRef.current
      if (!map || !infoWindow || !point) return
      const lng = Number(point.lng)
      const lat = Number(point.lat)
      if (!isValidCoordinate(lng, lat)) return
      infoWindow.setContent(markerInfoContent(point))
      infoWindow.open(map, [lng, lat])
    })
    marker.on('mouseout', () => {
      infoWindowRef.current?.close()
    })
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const AMap = amapRef.current
    if (!mapReady || !map || !AMap) return

    clearOverlays(storeOverlaysRef)
    if (points.length === 0) return

    const overlays = []
    const markers = points.map((point) => {
      const marker = new AMap.Marker({
        position: [point.lng, point.lat],
        title: formatPointName(point),
        offset: new AMap.Pixel(-8, -8),
        content: markerContent(selectedPoint?.id === point.id ? 'selected' : isManualLocation(point) ? 'manual' : 'store'),
        zIndex: selectedPoint?.id === point.id ? 130 : 80,
      })
      marker.on('click', () => selectPoint(point))
      bindMarkerInfo(marker, point)
      overlays.push(marker)

      if (showProtection && points.length <= 500) {
        overlays.push(new AMap.Circle({
          center: [point.lng, point.lat],
          radius: PROTECTION_RADIUS,
          strokeColor: selectedPoint?.id === point.id ? '#f59e0b' : isManualLocation(point) ? '#7c3aed' : '#2563eb',
          strokeOpacity: selectedPoint?.id === point.id ? 0.48 : 0.18,
          strokeWeight: selectedPoint?.id === point.id ? 2 : 1,
          fillColor: selectedPoint?.id === point.id ? '#f59e0b' : isManualLocation(point) ? '#7c3aed' : '#2563eb',
          fillOpacity: selectedPoint?.id === point.id ? 0.06 : 0.035,
          zIndex: selectedPoint?.id === point.id ? 40 : 20,
        }))
      }

      return marker
    })

    map.add(overlays)
    storeOverlaysRef.current = overlays
    if (!selectedPoint && markers.length > 0) {
      map.setFitView(markers, false, [58, 40, 40, 40])
    }
  }, [bindMarkerInfo, clearOverlays, mapReady, points, selectPoint, selectedPoint, showProtection])

  useEffect(() => {
    const map = mapRef.current
    const AMap = amapRef.current
    if (!mapReady || !map || !AMap) return

    clearOverlays(analysisOverlaysRef)
    const overlays = []

    if (activeCheckPoint) {
      const activeMarker = new AMap.Marker({
        position: [activeCheckPoint.lng, activeCheckPoint.lat],
        title: isManualDraft ? '门店定点' : '新点位',
        offset: new AMap.Pixel(-10, -10),
        content: markerContent(isManualDraft ? 'draft' : isConflict ? 'danger' : 'new'),
        zIndex: 170,
      })
      bindMarkerInfo(activeMarker, {
        ...selectedPoint,
        ...activeCheckPoint,
        name: isManualDraft ? formatPointName(selectedPoint) : activeCheckPoint.address,
        address: activeCheckPoint.formattedAddress || activeCheckPoint.address,
        geocode_status: isManualDraft ? 'manual_preview' : 'new_preview',
      })
      overlays.push(activeMarker)
      overlays.push(new AMap.Marker({
        position: [activeCheckPoint.lng, activeCheckPoint.lat],
        content: markerLabelContent(
          isManualDraft ? 'draft' : isConflict ? 'danger' : 'new',
          isManualDraft ? '待定点' : '搜索点',
          {
            ...selectedPoint,
            ...activeCheckPoint,
            name: isManualDraft ? formatPointName(selectedPoint) : activeCheckPoint.address,
            address: activeCheckPoint.address,
            formattedAddress: activeCheckPoint.formattedAddress,
          },
        ),
        offset: new AMap.Pixel(0, 0),
        zIndex: 190,
      }))
    }

    if (activeCheckPoint && nearest?.point) {
      const nearestMarker = new AMap.Marker({
        position: [nearest.point.lng, nearest.point.lat],
        title: formatPointName(nearest.point),
        offset: new AMap.Pixel(-10, -10),
        content: markerContent('nearest'),
        zIndex: 150,
      })
      bindMarkerInfo(nearestMarker, nearest.point)
      overlays.push(nearestMarker)
      overlays.push(new AMap.Marker({
        position: [nearest.point.lng, nearest.point.lat],
        content: markerLabelContent('nearest', '最近门店', nearest.point),
        offset: new AMap.Pixel(0, 0),
        zIndex: 175,
      }))
      overlays.push(new AMap.Circle({
        center: [nearest.point.lng, nearest.point.lat],
        radius: PROTECTION_RADIUS,
        strokeColor: isConflict ? '#dc2626' : '#16a34a',
        strokeOpacity: 0.78,
        strokeWeight: 2,
        fillColor: isConflict ? '#dc2626' : '#16a34a',
        fillOpacity: 0.08,
        zIndex: 60,
      }))
      overlays.push(new AMap.Polyline({
        path: [[activeCheckPoint.lng, activeCheckPoint.lat], [nearest.point.lng, nearest.point.lat]],
        strokeColor: isConflict ? '#dc2626' : '#16a34a',
        strokeOpacity: 0.82,
        strokeWeight: 3,
        strokeStyle: 'dashed',
        zIndex: 120,
      }))
      overlays.push(new AMap.Marker({
        position: [
          (activeCheckPoint.lng + nearest.point.lng) / 2,
          (activeCheckPoint.lat + nearest.point.lat) / 2,
        ],
        content: distanceLabelContent(nearest.distance, isConflict),
        offset: new AMap.Pixel(0, 0),
        zIndex: 180,
      }))
    }

    if (overlays.length === 0) return
    map.add(overlays)
    analysisOverlaysRef.current = overlays
    if (activeCheckPoint) {
      map.setFitView(overlays, false, [90, 90, 90, 90])
    }
  }, [activeCheckPoint, bindMarkerInfo, clearOverlays, isConflict, isManualDraft, mapReady, nearest, selectedPoint])

  const saveLocation = useCallback(async (row, point, options = {}) => {
    if (!row?.id || !point) return null
    setSavingId(row.id)
    try {
      const response = await fetch('/api/addresses/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          lng: point.lng,
          lat: point.lat,
          geocodeStatus: options.status || 'manual',
          geocodeLevel: options.level || null,
          geocodeAddress: options.address || point.formattedAddress || null,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || '坐标保存失败')

      const saved = normalizePoint(data.row)
      setSelectedPoint(saved)
      setManualPoint(null)
      await loadPoints()
      message.success('坐标已保存')
      return saved
    } catch (e) {
      message.error(e.message)
      return null
    } finally {
      setSavingId(null)
    }
  }, [loadPoints, message])

  const handleAutoLocateRow = useCallback(async (row) => {
    if (!canAutoLocate(row)) {
      message.warning('这条记录缺少可定位的地址信息')
      return
    }

    setAutoGeocodingId(row.id)
    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullAddressPayload(row)),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || '自动定位失败')

      await saveLocation(row, {
        lng: data.point.lng,
        lat: data.point.lat,
        formattedAddress: data.point.formattedAddress,
      }, {
        status: 'manual_geocode',
        level: data.point.level,
        address: data.point.formattedAddress,
      })
    } catch (e) {
      message.error(e.message)
    } finally {
      setAutoGeocodingId(null)
    }
  }, [message, saveLocation])

  const useMapSearchPoi = useCallback((poi) => {
    const searchLabel = poi.name || [poi.province, poi.city, poi.district, poi.address].filter(Boolean).join('')
    const point = {
      lng: poi.lng,
      lat: poi.lat,
      name: poi.name,
      province: poi.province,
      city: poi.city,
      district: poi.district,
      address: poi.name,
      formattedAddress: [poi.province, poi.city, poi.district, poi.address].filter(Boolean).join(''),
      poi,
    }
    setMapSearchText(searchLabel)
    setMapSearchResults([])

    const map = mapRef.current
    if (map) {
      map.setZoomAndCenter(16, [poi.lng, poi.lat])
    }

    if (selectedPoint) {
      setManualPoint(point)
      setNewPoint(null)
      message.success('已定位为待保存点，可继续点地图微调')
      return
    }

    setManualPoint(null)
    setNewPoint(point)
    message.success('已作为新点进行校验')
  }, [message, selectedPoint])

  const clearMapSearchState = useCallback(() => {
    setMapSearchText('')
    setMapSearchResults([])
    setNewPoint(null)
    setManualPoint(null)
  }, [])

  const cancelSelectedPoint = useCallback(() => {
    const draftPoint = manualPoint
    setSelectedPoint(null)
    setManualPoint(null)
    setMapSearchResults([])
    if (draftPoint) {
      setNewPoint(draftPoint)
    }
  }, [manualPoint])

  const handleMapSearch = useCallback(async (value) => {
    const keywords = String(value ?? '').trim()
    if (!keywords) {
      message.warning('请输入地图搜索关键词')
      return
    }

    setMapSearchText(keywords)
    setMapSearchLoading(true)
    try {
      const response = await fetch('/api/place-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords,
          city: selectedPoint?.city || (searchMode === 'city' ? searchQuery : ''),
          offset: 10,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || '地图搜索失败')

      const results = data.pois || []
      setMapSearchResults(results)
      if (results.length === 0) {
        message.warning('没有找到地图候选点')
        return
      }
    } catch (e) {
      setMapSearchResults([])
      message.error(e.message)
    } finally {
      setMapSearchLoading(false)
    }
  }, [message, searchMode, searchQuery, selectedPoint])

  const handleGeocodeMissing = useCallback(async () => {
    setGeocoding(true)
    setGeocodeProgress({ updated: 0, failed: 0, remaining: summary.missing })

    let totalUpdated = 0
    let totalFailed = 0
    let lastRemaining = summary.missing

    try {
      for (let i = 0; i < 100; i++) {
        const response = await fetch('/api/addresses/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: GEOCODE_BATCH_SIZE, delayMs: GEOCODE_DELAY_MS }),
        })
        const data = await response.json()
        if (!response.ok || !data.ok) throw new Error(data.error || '补齐坐标失败')

        totalUpdated += data.updated || 0
        totalFailed += data.failed || 0
        lastRemaining = data.remaining || 0
        setGeocodeProgress({ updated: totalUpdated, failed: totalFailed, remaining: lastRemaining })

        if (data.rateLimited) {
          message.warning('高德接口触发限流，已暂停补齐。稍等一会儿再点补齐坐标即可继续。')
          break
        }
        if (!data.requested || lastRemaining <= 0) break
      }

      await loadPoints()
      if (totalUpdated > 0) {
        message.success(`已补齐 ${totalUpdated} 个点位`)
      } else {
        message.info('没有可补齐的点位')
      }
    } catch (e) {
      message.error(e.message)
    } finally {
      setGeocoding(false)
    }
  }, [loadPoints, message, summary.missing])

  return (
    <section className="map-view">
      <aside className="map-side">
        <div className="map-side-section">
          <div className="map-side-title">
            <CompassOutlined />
            <span>地图校验</span>
          </div>
          <div className="map-stat-row">
            <button
              type="button"
              className={`map-stat-card ${listMode === 'located' ? 'is-active' : ''}`}
              onClick={() => setListMode('located')}
            >
              <strong>{summary.located}</strong>
              <span>已落点</span>
            </button>
            <button
              type="button"
              className={`map-stat-card ${listMode === 'missing' ? 'is-active' : ''}`}
              onClick={() => setListMode('missing')}
            >
              <strong>{summary.missing}</strong>
              <span>待补坐标</span>
            </button>
            <button
              type="button"
              className={`map-stat-card ${listMode === 'manual' ? 'is-active' : ''}`}
              onClick={() => setListMode('manual')}
            >
              <strong>{summary.manual}</strong>
              <span>手动打点</span>
            </button>
            <div className="map-stat-card">
              <strong>{points.length}</strong>
              <span>地图显示</span>
            </div>
          </div>
          {summary.limited && (
            <Alert type="warning" showIcon message="点位较多，当前最多显示 20000 条" style={{ marginTop: 10 }} />
          )}
        </div>

        <div className="map-side-section">
          <Space size={8} wrap className="map-action-row">
            <Button icon={<ReloadOutlined />} onClick={loadPoints} loading={pointsLoading}>
              刷新点位
            </Button>
            <Button
              icon={<SyncOutlined />}
              onClick={handleGeocodeMissing}
              loading={geocoding}
              disabled={summary.missing === 0}
            >
              补齐坐标
            </Button>
          </Space>
          {geocodeProgress && geocoding && (
            <Text className="map-help-text">
              已补齐 {geocodeProgress.updated} 个，失败 {geocodeProgress.failed} 个，剩余 {geocodeProgress.remaining} 个
            </Text>
          )}
        </div>

        <div className="map-side-section map-list-section">
          <div className="map-list-head">
            <span>{listMode === 'missing' ? '待补坐标' : listMode === 'manual' ? '手动打点' : '已落点'}</span>
            <Checkbox checked={showProtection} onChange={event => setShowProtection(event.target.checked)}>
              1公里圈
            </Checkbox>
          </div>
          {summary.listLimited && (
            <Text className="map-help-text">当前列表最多显示 1000 条，可以搜索缩小范围。</Text>
          )}
          {pointsLoading ? (
            <div className="map-list-loading"><Spin /></div>
          ) : listRows.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={listMode === 'missing' ? '暂无待补坐标' : listMode === 'manual' ? '暂无手动打点' : '暂无可显示点位'}
            />
          ) : (
            <List
              className="map-point-list"
              dataSource={listRows}
              renderItem={point => (
                <List.Item
                  className={selectedPoint?.id === point.id ? 'is-active' : ''}
                  onClick={() => selectPoint(point)}
                >
                  <div className="map-point-line">
                    <EnvironmentOutlined />
                    <div className="map-point-body">
                      <div className="map-point-name">{formatPointName(point)}</div>
                      <div className="map-point-meta">{fullRegion(point)}</div>
                      {point.address && <div className="map-point-address">{point.address}</div>}
                      {isManualLocation(point) && (
                        <Tag color="purple" style={{ marginTop: 6 }}>手动打点</Tag>
                      )}
                      {!hasLocation(point) && point.geocode_status && (
                        <Tag color="orange" style={{ marginTop: 6 }}>{point.geocode_status}</Tag>
                      )}
                      <div className="map-row-actions" onClick={event => event.stopPropagation()}>
                        <Button
                          size="small"
                          icon={<SyncOutlined />}
                          loading={autoGeocodingId === point.id || savingId === point.id}
                          disabled={!canAutoLocate(point)}
                          onClick={() => handleAutoLocateRow(point)}
                        >
                          {hasLocation(point) ? '重定位' : '自动定位'}
                        </Button>
                        <Button
                          size="small"
                          icon={<AimOutlined />}
                          type={selectedPoint?.id === point.id ? 'primary' : 'default'}
                          onClick={() => {
                            selectPoint(point)
                            setMapSearchText(searchTextForRow(point))
                            message.info('可以在地图搜索候选点，或直接点击地图后保存定点')
                          }}
                        >
                          定点
                        </Button>
                      </div>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </aside>

      <div className="map-stage">
        <div ref={mapNodeRef} className="map-canvas" />
        <MapSearchPanel
          selectedPoint={selectedPoint}
          searchText={mapSearchText}
          loading={mapSearchLoading}
          results={mapSearchResults}
          onSearch={handleMapSearch}
          onClear={clearMapSearchState}
          onSelect={useMapSearchPoi}
        />
        {(mapLoading || pointsLoading) && (
          <div className="map-loading">
            <Spin />
            <span>{mapLoading ? '地图加载中' : '点位加载中'}</span>
          </div>
        )}
        {mapError && (
          <div className="map-error">
            <Alert
              type="error"
              showIcon
              message="地图加载失败"
              description={mapError}
            />
          </div>
        )}
        <Tooltip title={selectedPoint ? '当前会为选中门店定点' : '点击地图可放置新点'}>
          <div className="map-radius-badge">
            <AimOutlined />
            <span>保护半径 1 公里</span>
          </div>
        </Tooltip>
        {selectedPoint && (
          <div className="map-save-bar">
            <span className="map-save-title">{formatPointName(selectedPoint)}</span>
            {manualPoint && <Tag color="purple">待保存</Tag>}
            <Button
              size="small"
              icon={<SaveOutlined />}
              type="primary"
              disabled={!manualPoint}
              loading={savingId === selectedPoint.id}
              onClick={() => saveLocation(selectedPoint, manualPoint, { status: 'manual_map' })}
            >
              保存
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={cancelSelectedPoint}>
              取消
            </Button>
          </div>
        )}
        {!selectedPoint && activeCheckPoint && (
          <button type="button" className="map-clear-point" onClick={clearMapSearchState}>
            <CloseOutlined />
            <span>清除搜索点</span>
          </button>
        )}
      </div>
    </section>
  )
}
