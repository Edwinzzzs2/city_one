'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, App, Button, Checkbox, Empty, Input, List, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd'
import {
  AimOutlined, CloseOutlined, CompassOutlined, EnvironmentOutlined,
  ReloadOutlined, SaveOutlined, SearchOutlined, SyncOutlined,
} from '@ant-design/icons'
import { readableEventName, trackEvent } from '@/utils/analytics'
import useDataStore from '@/store/useDataStore'

const { Text } = Typography
const PROTECTION_RADIUS_OPTIONS = [1, 2, 3, 4, 5]
const DEFAULT_CENTER = [116.397428, 39.90923]
const GEOCODE_BATCH_SIZE = 10
const GEOCODE_DELAY_MS = 450
const MAP_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const MAP_SEARCH_COOLDOWN_MS = 1200
const MAP_SEARCH_CACHE_MAX_ENTRIES = 30
const MAP_SEARCH_RETRY_MIN_DELAY_MS = 500
const MAP_SEARCH_RETRY_MAX_DELAY_MS = 1500
const MAP_SEARCH_RETRY_MESSAGE_KEY = 'amap-search-retry'
const AMAP_SEARCH_RETRY_CODES = new Set([
  '10004', // ACCESS_TOO_FREQUENT
  '10014', // QPS_HAS_EXCEEDED_THE_LIMIT
  '10015', // GATEWAY_TIMEOUT
  '10016', // SERVER_IS_BUSY
  '10019', // CQPS_HAS_EXCEEDED_THE_LIMIT
  '10020', // CKQPS_HAS_EXCEEDED_THE_LIMIT
  '10021', // CUQPS_HAS_EXCEEDED_THE_LIMIT
])
const MOBILE_MEDIA_QUERY = '(max-width: 720px)'
const MAP_COLORS = {
  store: '#0f6f62',
  manual: '#b65e3f',
  selected: '#b58419',
  safe: '#2f9361',
  danger: '#bf3f35',
}
let amapLoadPromise = null

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia?.(MOBILE_MEDIA_QUERY).matches
}

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
          plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.GeometryUtil', 'AMap.PlaceSearch'],
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

function amapText(value) {
  if (Array.isArray(value)) return value.join('')
  return value === undefined || value === null ? '' : String(value)
}

function amapLocationNumber(location, key, index) {
  if (Array.isArray(location)) return Number(location[index])
  const getter = key === 'lng' ? location?.getLng : location?.getLat
  if (typeof getter === 'function') return Number(getter.call(location))
  return Number(location?.[key])
}

function normalizeAmapSearchPoi(poi) {
  const lng = amapLocationNumber(poi?.location, 'lng', 0)
  const lat = amapLocationNumber(poi?.location, 'lat', 1)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

  return {
    id: amapText(poi?.id),
    name: amapText(poi?.name),
    type: amapText(poi?.type),
    address: amapText(poi?.address),
    province: amapText(poi?.pname || poi?.province),
    city: amapText(poi?.cityname || poi?.city),
    district: amapText(poi?.adname || poi?.district),
    lng,
    lat,
  }
}

function searchPlacesInBrowser(AMap, { keywords, city }) {
  return new Promise((resolve, reject) => {
    const runSearch = () => {
      const placeSearch = new AMap.PlaceSearch({
        city: city || '全国',
        citylimit: false,
        pageSize: 10,
        pageIndex: 1,
        extensions: 'base',
      })
      placeSearch.search(keywords, (status, result) => {
        if (status === 'complete') {
          const pois = (result?.poiList?.pois || []).map(normalizeAmapSearchPoi).filter(Boolean)
          resolve(pois)
          return
        }
        if (status === 'no_data') {
          resolve([])
          return
        }

        const error = new Error(result?.info || result?.message || '高德地点搜索失败，请稍后重试')
        error.code = amapText(result?.infocode || status || 'AMAP_SEARCH_ERROR')
        reject(error)
      })
    }

    if (AMap?.PlaceSearch) runSearch()
    else AMap.plugin('AMap.PlaceSearch', runSearch)
  })
}

function isRetryableAmapSearchError(error) {
  const code = amapText(error?.code).trim()
  if (AMAP_SEARCH_RETRY_CODES.has(code)) return true

  const detail = `${code} ${amapText(error?.message)}`
  return /(qps|too frequent|fetch failed|network|timeout|server is busy|访问频繁|请求频繁|网络|超时|服务繁忙)/i.test(detail)
}

function randomMapSearchRetryDelay() {
  return Math.round(
    MAP_SEARCH_RETRY_MIN_DELAY_MS
      + Math.random() * (MAP_SEARCH_RETRY_MAX_DELAY_MS - MAP_SEARCH_RETRY_MIN_DELAY_MS),
  )
}

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function reportMapSearchLog(payload) {
  fetch('/api/place-search/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined)
}

function reportAmapUsage(service) {
  fetch('/api/amap-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service }),
    keepalive: true,
  }).catch(() => undefined)
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
  const status = String(row.geocode_status || '')
  return status === 'manual_map' || status === 'manual'
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

export default function MapView({ searchQuery = '', searchMode = 'city', themeMode = 'light', isAdmin = false }) {
  const { message } = App.useApp()
  const { settings, updateLocalSettings } = useDataStore()
  const mapNodeRef = useRef(null)
  const mapRef = useRef(null)
  const amapRef = useRef(null)
  const infoWindowRef = useRef(null)
  const storeOverlaysRef = useRef([])
  const analysisOverlaysRef = useRef([])
  const mapSearchCacheRef = useRef(new Map())
  const lastMapSearchAtRef = useRef(0)
  const mapSearchInFlightRef = useRef(false)

  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState('')
  const [points, setPoints] = useState([])
  const [listRows, setListRows] = useState([])
  const [summary, setSummary] = useState({ total: 0, located: 0, missing: 0, manual: 0, limited: false, listLimited: false })
  const [pointsLoading, setPointsLoading] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [listMode, setListMode] = useState('located')
  const [listFilterText, setListFilterText] = useState('')
  const [protectionRadiusKm, setProtectionRadiusKm] = useState(settings.protectionRadiusKm || 3)
  const [showProtection, setShowProtection] = useState(settings.showProtection ?? true)
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [manualPoint, setManualPoint] = useState(null)
  const [mapSearchText, setMapSearchText] = useState('')
  const [mapSearchLoading, setMapSearchLoading] = useState(false)
  const [mapSearchResults, setMapSearchResults] = useState([])
  const [newPoint, setNewPoint] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [autoGeocodingId, setAutoGeocodingId] = useState(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeProgress, setGeocodeProgress] = useState(null)

  const amapKey = settings.amapJsKey || ''
  const amapSecurityCode = settings.amapSecurityCode || ''
  const protectionRadiusMeters = protectionRadiusKm * 1000
  const activeCheckPoint = manualPoint || newPoint
  const isManualDraft = Boolean(manualPoint && selectedPoint)
  const filteredListRows = useMemo(() => {
    const keyword = listFilterText.trim().toLowerCase()
    if (!keyword) return listRows
    return listRows.filter(row => searchTextForRow(row).toLowerCase().includes(keyword))
  }, [listFilterText, listRows])

  useEffect(() => {
    setProtectionRadiusKm(settings.protectionRadiusKm || 3)
  }, [settings.protectionRadiusKm])

  useEffect(() => {
    setShowProtection(settings.showProtection ?? true)
  }, [settings.showProtection])

  const handleProtectionRadiusChange = useCallback((value) => {
    if (!isAdmin) return
    setProtectionRadiusKm(value)
    updateLocalSettings({ protectionRadiusKm: value })
    trackEvent(readableEventName('调整保护半径', `${value} 公里`), {
      event_type: 'map_preference_change',
      preference: 'protection_radius_km',
      value,
    })
  }, [isAdmin, updateLocalSettings])

  const handleShowProtectionChange = useCallback((event) => {
    if (!isAdmin) return
    const checked = event.target.checked
    setShowProtection(checked)
    updateLocalSettings({ showProtection: checked })
    trackEvent(readableEventName('切换保护圈', checked ? '显示' : '隐藏'), {
      event_type: 'map_preference_change',
      preference: 'show_protection',
      value: checked,
    })
  }, [isAdmin, updateLocalSettings])

  useEffect(() => {
    const query = listFilterText.trim()
    if (!query) return undefined

    const timer = window.setTimeout(() => {
      trackEvent(readableEventName('筛选门店', query), {
        event_type: 'map_list_filter',
        query,
        mode: listMode,
        result_count: filteredListRows.length,
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [filteredListRows.length, listFilterText, listMode])

  const selectPoint = useCallback((row, { keepDraft = false } = {}) => {
    const point = normalizePoint(row)
    if (!isAdmin) {
      setSelectedPoint(null)
      setManualPoint(null)
      setNewPoint(null)
      setMapSearchResults([])
      const map = mapRef.current
      if (map && hasLocation(point)) map.panTo([point.lng, point.lat])
      return
    }
    setSelectedPoint(point)
    if (!keepDraft) setManualPoint(null)
    setNewPoint(null)
    setMapSearchResults([])

    const map = mapRef.current
    if (map && hasLocation(point)) {
      map.panTo([point.lng, point.lat])
    }
  }, [isAdmin])

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
          animateEnable: !isMobileViewport(),
          mapStyle: themeMode === 'dark' ? 'amap://styles/darkblue' : 'amap://styles/normal',
        })
        map.addControl(new AMap.Scale())
        map.addControl(new AMap.ToolBar({ position: { top: '16px', right: '16px' } }))

        mapRef.current = map
        setMapReady(true)
        reportAmapUsage('map_init')
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
  }, [amapKey, amapSecurityCode, clearOverlays])

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

  const nearest = useMemo(() => {
    if (isManualDraft) return null
    return findNearest(activeCheckPoint, nearestCandidates, amapRef.current)
  }, [activeCheckPoint, isManualDraft, nearestCandidates])
  const isConflict = nearest?.distance <= protectionRadiusMeters

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
        content: markerContent(selectedPoint?.id === point.id ? 'selected' : 'store'),
        zIndex: selectedPoint?.id === point.id ? 130 : 80,
      })
      marker.on('click', () => {
        selectPoint(point)
        trackEvent(readableEventName('点击地图标记', formatPointName(point)), {
          event_type: 'operation_click',
          operation: 'map_marker_select',
          city: point.city,
          has_location: hasLocation(point),
        })
      })
      bindMarkerInfo(marker, point)
      overlays.push(marker)

      if (showProtection && points.length <= 500) {
        const pointColor = selectedPoint?.id === point.id
          ? MAP_COLORS.selected
          : MAP_COLORS.store
        overlays.push(new AMap.Circle({
          center: [point.lng, point.lat],
          radius: protectionRadiusMeters,
          strokeColor: pointColor,
          strokeOpacity: selectedPoint?.id === point.id ? 0.48 : 0.18,
          strokeWeight: selectedPoint?.id === point.id ? 2 : 1,
          fillColor: pointColor,
          fillOpacity: selectedPoint?.id === point.id ? 0.06 : 0.035,
          zIndex: selectedPoint?.id === point.id ? 40 : 20,
        }))
      }

      return marker
    })

    map.add(overlays)
    storeOverlaysRef.current = overlays
    if (!selectedPoint && markers.length > 0) {
      map.setFitView(markers, isMobileViewport(), [58, 40, 40, 40])
    }
  }, [bindMarkerInfo, clearOverlays, mapReady, points, protectionRadiusMeters, selectPoint, selectedPoint, showProtection])

  useEffect(() => {
    const map = mapRef.current
    const AMap = amapRef.current
    if (!mapReady || !map || !AMap) return

    clearOverlays(analysisOverlaysRef)
    const overlays = []
    const fitTargets = []
    let fitFrame = null

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
      fitTargets.push(activeMarker)
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
      fitTargets.push(nearestMarker)
      overlays.push(new AMap.Marker({
        position: [nearest.point.lng, nearest.point.lat],
        content: markerLabelContent('nearest', '最近门店', nearest.point),
        offset: new AMap.Pixel(0, 0),
        zIndex: 175,
      }))
      overlays.push(new AMap.Circle({
        center: [nearest.point.lng, nearest.point.lat],
        radius: protectionRadiusMeters,
        strokeColor: isConflict ? MAP_COLORS.danger : MAP_COLORS.safe,
        strokeOpacity: 0.78,
        strokeWeight: 2,
        fillColor: isConflict ? MAP_COLORS.danger : MAP_COLORS.safe,
        fillOpacity: 0.08,
        zIndex: 60,
      }))
      overlays.push(new AMap.Polyline({
        path: [[activeCheckPoint.lng, activeCheckPoint.lat], [nearest.point.lng, nearest.point.lat]],
        strokeColor: isConflict ? MAP_COLORS.danger : MAP_COLORS.safe,
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
    if (activeCheckPoint && nearest?.point && fitTargets.length > 1) {
      fitFrame = window.requestAnimationFrame(() => {
        map.setFitView(fitTargets, true, [180, 90, 140, 90], 16)
      })
    }

    return () => {
      if (fitFrame) window.cancelAnimationFrame(fitFrame)
    }
  }, [activeCheckPoint, bindMarkerInfo, clearOverlays, isConflict, isManualDraft, mapReady, nearest, protectionRadiusMeters, selectedPoint])

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
          geocodeStatus: options.status || 'manual_map',
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
      trackEvent(readableEventName('保存定位', formatPointName(row)), {
        event_type: 'location_save',
        status: options.status || 'manual_map',
        city: row.city,
        had_location: hasLocation(row),
        saved_address: options.address || point.formattedAddress || point.address,
        lng: point.lng,
        lat: point.lat,
      })
      message.success('坐标已保存')
      return saved
    } catch (e) {
      trackEvent(readableEventName('保存定位失败', formatPointName(row)), {
        event_type: 'location_save_error',
        status: options.status || 'manual_map',
        city: row?.city,
        had_location: hasLocation(row),
        saved_address: options.address || point?.formattedAddress || point?.address,
      })
      message.error(e.message)
      return null
    } finally {
      setSavingId(null)
    }
  }, [loadPoints, message])

  const handleAutoLocateRow = useCallback(async (row) => {
    if (!isAdmin) return
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
        status: 'auto_geocode',
        level: data.point.level,
        address: data.point.formattedAddress,
      })
      trackEvent(readableEventName('自动定位完成', formatPointName(row)), {
        event_type: 'location_auto_geocode',
        city: row.city,
        level: data.point.level,
      })
    } catch (e) {
      trackEvent(readableEventName('自动定位失败', formatPointName(row)), {
        event_type: 'location_auto_geocode_error',
        city: row.city,
      })
      message.error(e.message)
    } finally {
      setAutoGeocodingId(null)
    }
  }, [isAdmin, message, saveLocation])

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

    if (selectedPoint) {
      setManualPoint(point)
      setNewPoint(null)
      trackEvent(readableEventName('选择定点候选', poi.name || poi.address), {
        event_type: 'map_poi_select',
        context: 'relocate',
        city: selectedPoint.city,
        query: mapSearchText,
        poi_name: poi.name,
        poi_address: [poi.province, poi.city, poi.district, poi.address].filter(Boolean).join(''),
        poi_city: poi.city,
      })
      message.success('已定位为待保存点，保存后会写入该门店')
      return
    }

    setManualPoint(null)
    setNewPoint(point)
    trackEvent(readableEventName('选择搜索候选', poi.name || poi.address), {
      event_type: 'map_poi_select',
      context: 'distance_check',
      query: mapSearchText,
      poi_name: poi.name,
      poi_address: [poi.province, poi.city, poi.district, poi.address].filter(Boolean).join(''),
      poi_city: poi.city,
    })
    message.success('已作为搜索点进行距离校验')
  }, [mapSearchText, message, selectedPoint])

  const clearMapSearchState = useCallback(() => {
    setMapSearchText('')
    setMapSearchResults([])
    setNewPoint(null)
    setManualPoint(null)
    trackEvent(readableEventName('点击', '清除搜索点'), {
      event_type: 'operation_click',
      operation: 'map_search_clear',
      had_selected_store: Boolean(selectedPoint),
    })
  }, [selectedPoint])

  const cancelSelectedPoint = useCallback(() => {
    const draftPoint = manualPoint
    setSelectedPoint(null)
    setManualPoint(null)
    setMapSearchResults([])
    trackEvent(readableEventName('取消定点', formatPointName(selectedPoint)), {
      event_type: 'location_relocate_cancel',
      city: selectedPoint?.city,
      had_draft: Boolean(draftPoint),
    })
    if (draftPoint) {
      setNewPoint(draftPoint)
    }
  }, [manualPoint, selectedPoint])

  const handleMapSearch = useCallback(async (value) => {
    const keywords = String(value ?? '').trim()
    if (!keywords) {
      message.warning('请输入地图搜索关键词')
      return
    }

    if (mapSearchInFlightRef.current) {
      message.info('搜索正在进行，请稍候')
      return
    }

    const now = Date.now()
    if (now - lastMapSearchAtRef.current < MAP_SEARCH_COOLDOWN_MS) {
      message.warning('搜索太频繁，请稍后再试')
      return
    }
    lastMapSearchAtRef.current = now

    const city = selectedPoint?.city || (searchMode === 'city' ? searchQuery : '')
    const cacheKey = `${city}\n${keywords}`.toLowerCase()
    const cached = mapSearchCacheRef.current.get(cacheKey)

    setMapSearchText(keywords)
    mapSearchInFlightRef.current = true
    setMapSearchLoading(true)
    const startedAt = Date.now()
    let attempts = 0
    try {
      const cacheHit = cached && Date.now() - cached.createdAt < MAP_SEARCH_CACHE_TTL_MS
      const AMap = amapRef.current || await loadAmap({ key: amapKey, securityCode: amapSecurityCode })
      let results = cached?.results || []
      if (!cacheHit) {
        attempts = 1
        try {
          results = await searchPlacesInBrowser(AMap, { keywords, city })
        } catch (error) {
          if (!isRetryableAmapSearchError(error)) throw error

          attempts = 2
          const retryDelay = randomMapSearchRetryDelay()
          message.open({
            key: MAP_SEARCH_RETRY_MESSAGE_KEY,
            type: 'loading',
            content: '当前请求较多，正在自动重试…',
            duration: 0,
          })
          await waitFor(retryDelay)
          try {
            results = await searchPlacesInBrowser(AMap, { keywords, city })
          } finally {
            message.destroy(MAP_SEARCH_RETRY_MESSAGE_KEY)
          }
        }
      }

      if (!cacheHit) {
        if (mapSearchCacheRef.current.size >= MAP_SEARCH_CACHE_MAX_ENTRIES) {
          const oldestKey = mapSearchCacheRef.current.keys().next().value
          mapSearchCacheRef.current.delete(oldestKey)
        }
        mapSearchCacheRef.current.set(cacheKey, { createdAt: Date.now(), results })
        reportMapSearchLog({
          keywords,
          city,
          status: 'success',
          resultCount: results.length,
          durationMs: Date.now() - startedAt,
          attempts,
        })
      }

      setMapSearchResults(results)
      trackEvent(readableEventName(selectedPoint ? '定点搜索' : '地图搜索', keywords), {
        event_type: 'map_search',
        context: selectedPoint ? 'relocate' : 'distance_check',
        query: keywords,
        query_length: keywords.length,
        result_count: results.length,
        city_scope: city,
        cache_hit: Boolean(cacheHit),
      })
      if (results.length === 0) {
        message.warning('没有找到地图候选点')
        return
      }
    } catch (e) {
      setMapSearchResults([])
      reportMapSearchLog({
        keywords,
        city,
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorMessage: e?.message || '高德地点搜索失败',
        errorCode: e?.code || e?.name || 'AMAP_SEARCH_ERROR',
        attempts: Math.max(attempts, 1),
      })
      trackEvent(readableEventName(selectedPoint ? '定点搜索失败' : '地图搜索失败', keywords), {
        event_type: 'map_search_error',
        context: selectedPoint ? 'relocate' : 'distance_check',
        query: keywords,
        query_length: keywords.length,
      })
      message.error(e.message)
    } finally {
      message.destroy(MAP_SEARCH_RETRY_MESSAGE_KEY)
      mapSearchInFlightRef.current = false
      setMapSearchLoading(false)
    }
  }, [amapKey, amapSecurityCode, message, searchMode, searchQuery, selectedPoint])

  const searchSelectedPointAddress = useCallback(() => {
    if (!selectedPoint) return
    const keyword = searchTextForRow(selectedPoint)
    setMapSearchText(keyword)
    handleMapSearch(keyword)
  }, [handleMapSearch, selectedPoint])

  const handleGeocodeMissing = useCallback(async () => {
    if (!isAdmin) return
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
      trackEvent(readableEventName('补齐坐标完成', `${totalUpdated} 个`), {
        event_type: 'location_batch_geocode',
        updated: totalUpdated,
        failed: totalFailed,
        remaining: lastRemaining,
      })
      if (totalUpdated > 0) {
        message.success(`已补齐 ${totalUpdated} 个点位`)
      } else {
        message.info('没有可补齐的点位')
      }
    } catch (e) {
      trackEvent(readableEventName('补齐坐标失败', `${summary.missing} 个待补`), {
        event_type: 'location_batch_geocode_error',
        missing: summary.missing,
      })
      message.error(e.message)
    } finally {
      setGeocoding(false)
    }
  }, [isAdmin, loadPoints, message, summary.missing])

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
              onClick={() => {
                setListMode('located')
                setListFilterText('')
                trackEvent(readableEventName('点击', '查看已落点'), {
                  event_type: 'operation_click',
                  operation: 'map_list_mode',
                  mode: 'located',
                })
              }}
            >
              <strong>{summary.located}</strong>
              <span>已落点</span>
            </button>
            <button
              type="button"
              className={`map-stat-card ${listMode === 'missing' ? 'is-active' : ''}`}
              onClick={() => {
                setListMode('missing')
                setListFilterText('')
                trackEvent(readableEventName('点击', '查看待补坐标'), {
                  event_type: 'operation_click',
                  operation: 'map_list_mode',
                  mode: 'missing',
                })
              }}
            >
              <strong>{summary.missing}</strong>
              <span>待补坐标</span>
            </button>
            <button
              type="button"
              className={`map-stat-card ${listMode === 'manual' ? 'is-active' : ''}`}
              onClick={() => {
                setListMode('manual')
                setListFilterText('')
                trackEvent(readableEventName('点击', '查看手动打点'), {
                  event_type: 'operation_click',
                  operation: 'map_list_mode',
                  mode: 'manual',
                })
              }}
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
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                trackEvent(readableEventName('点击', '刷新点位'), {
                  event_type: 'operation_click',
                  operation: 'map_refresh_points',
                })
                loadPoints()
              }}
              loading={pointsLoading}
            >
              刷新点位
            </Button>
            <Button
              icon={<SyncOutlined />}
              onClick={() => {
                trackEvent(readableEventName('点击', '补齐坐标'), {
                  event_type: 'operation_click',
                  operation: 'map_batch_geocode',
                  missing: summary.missing,
                })
                handleGeocodeMissing()
              }}
              loading={geocoding}
              disabled={!isAdmin || summary.missing === 0}
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
            <Checkbox checked={showProtection} onChange={handleShowProtectionChange} disabled={!isAdmin}>
              {protectionRadiusKm}公里圈
            </Checkbox>
          </div>
          <Input
            className="map-list-filter"
            prefix={<SearchOutlined />}
            value={listFilterText}
            onChange={event => setListFilterText(event.target.value)}
            allowClear
            placeholder="搜索门店名、省市区或地址"
          />
          {summary.listLimited && (
            <Text className="map-help-text">当前列表最多显示 1000 条，可以搜索缩小范围。</Text>
          )}
          {pointsLoading ? (
            <div className="map-list-loading"><Spin /></div>
          ) : filteredListRows.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={listFilterText ? '没有匹配的点位' : listMode === 'missing' ? '暂无待补坐标' : listMode === 'manual' ? '暂无手动打点' : '暂无可显示点位'}
            />
          ) : (
            <List
              className="map-point-list"
              dataSource={filteredListRows}
              renderItem={point => (
                <List.Item
                  className={selectedPoint?.id === point.id ? 'is-active' : ''}
                  onClick={() => {
                    selectPoint(point)
                    trackEvent(readableEventName('点击门店', formatPointName(point)), {
                      event_type: 'operation_click',
                      operation: 'map_store_select',
                      city: point.city,
                      has_location: hasLocation(point),
                    })
                  }}
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
                          disabled={!isAdmin || !canAutoLocate(point)}
                          onClick={() => {
                            trackEvent(readableEventName('点击', hasLocation(point) ? '重定位' : '自动定位'), {
                              event_type: 'operation_click',
                              operation: hasLocation(point) ? 'location_auto_relocate' : 'location_auto_locate',
                              city: point.city,
                            })
                            handleAutoLocateRow(point)
                          }}
                        >
                          {hasLocation(point) ? '重定位' : '自动定位'}
                        </Button>
                        <Button
                          size="small"
                          icon={<AimOutlined />}
                          type={selectedPoint?.id === point.id ? 'primary' : 'default'}
                          disabled={!isAdmin}
                          onClick={() => {
                            selectPoint(point)
                            const keyword = searchTextForRow(point)
                            setMapSearchText(keyword)
                            handleMapSearch(keyword)
                            trackEvent(readableEventName('开始定点', formatPointName(point)), {
                              event_type: 'location_relocate_start',
                              city: point.city,
                              had_location: hasLocation(point),
                            })
                            trackEvent(readableEventName('点击', '定点'), {
                              event_type: 'operation_click',
                              operation: 'location_relocate_start',
                              city: point.city,
                              had_location: hasLocation(point),
                            })
                            message.info('请在地图搜索框选择候选点，保存后会写入该门店坐标')
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
          selectedPoint={isAdmin ? selectedPoint : null}
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
        <Tooltip title={selectedPoint ? '通过搜索候选点为选中门店定点' : '通过搜索地址查看最近门店距离'}>
          <div className="map-radius-badge">
            <AimOutlined />
            <span>保护半径</span>
            <Select
              size="small"
              value={protectionRadiusKm}
              onChange={handleProtectionRadiusChange}
              disabled={!isAdmin}
              popupMatchSelectWidth={false}
              options={PROTECTION_RADIUS_OPTIONS.map(value => ({
                value,
                label: `${value} 公里`,
              }))}
            />
          </div>
        </Tooltip>
        {isAdmin && selectedPoint && (
          <div className="map-save-bar">
            <div className="map-save-info">
              <div className="map-save-title">
                {formatPointName(selectedPoint)}
                {manualPoint && <Tag color="purple">待保存</Tag>}
              </div>
              <div className="map-save-meta">{fullRegion(selectedPoint)}</div>
              {selectedPoint.address && <div className="map-save-address">{selectedPoint.address}</div>}
            </div>
            <div className="map-save-actions">
              <Button
                size="small"
                icon={<SearchOutlined />}
                onClick={() => {
                  trackEvent(readableEventName('点击', '搜当前地址'), {
                    event_type: 'operation_click',
                    operation: 'location_search_selected_address',
                    city: selectedPoint.city,
                  })
                  searchSelectedPointAddress()
                }}
              >
                搜地址
              </Button>
              <Button
                size="small"
                icon={<SaveOutlined />}
                type="primary"
                disabled={!manualPoint}
                loading={savingId === selectedPoint.id}
                onClick={() => {
                  trackEvent(readableEventName('点击', '保存定位'), {
                    event_type: 'operation_click',
                    operation: 'location_save',
                    city: selectedPoint.city,
                    has_new_point: Boolean(manualPoint),
                  })
                  saveLocation(selectedPoint, manualPoint, { status: 'manual_map' })
                }}
              >
                保存
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => {
                  trackEvent(readableEventName('点击', '取消定点'), {
                    event_type: 'operation_click',
                    operation: 'location_relocate_cancel',
                    city: selectedPoint.city,
                  })
                  cancelSelectedPoint()
                }}
              >
                取消
              </Button>
            </div>
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
