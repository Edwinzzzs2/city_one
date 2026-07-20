import { getAISettings } from '@/lib/db'

const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo'
const AMAP_PLACE_TEXT_URL = 'https://restapi.amap.com/v3/place/text'
const AMAP_SEARCH_TIMEOUT_MS = 7000
const AMAP_SEARCH_MAX_ATTEMPTS = 2
const AMAP_SEARCH_RETRY_DELAY_MS = 300
const RETRYABLE_NETWORK_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EAI_AGAIN',
])

function cleanPart(value) {
  return String(value || '').trim()
}

function collectErrorCodes(error, codes = new Set()) {
  if (!error || typeof error !== 'object') return codes
  if (error.code) codes.add(error.code)
  collectErrorCodes(error.cause, codes)
  if (Array.isArray(error.errors)) {
    error.errors.forEach(item => collectErrorCodes(item, codes))
  }
  return codes
}

function isRetryableNetworkError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true
  return [...collectErrorCodes(error)].some(code => RETRYABLE_NETWORK_CODES.has(code))
}

function isTimeoutError(error) {
  if (error?.name === 'TimeoutError') return true
  const codes = collectErrorCodes(error)
  return codes.has('UND_ERR_CONNECT_TIMEOUT') || codes.has('ETIMEDOUT')
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchPlaceSearch(url) {
  for (let attempt = 1; attempt <= AMAP_SEARCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(AMAP_SEARCH_TIMEOUT_MS),
      })
    } catch (error) {
      const canRetry = isRetryableNetworkError(error) && attempt < AMAP_SEARCH_MAX_ATTEMPTS
      if (canRetry) {
        await wait(AMAP_SEARCH_RETRY_DELAY_MS)
        continue
      }

      if (isTimeoutError(error)) {
        const timeoutError = new Error('地图服务连接超时，请稍后重试')
        timeoutError.code = 'AMAP_CONNECT_TIMEOUT'
        timeoutError.cause = error
        throw timeoutError
      }
      throw error
    }
  }
}

export async function getAmapWebServiceKey() {
  const settings = await getAISettings()
  return cleanPart(settings.amapWebServiceKey)
}

export function buildFullAddress(row = {}) {
  const address = cleanPart(row.address || row.fullAddress)
  const district = cleanPart(row.district)
  const city = cleanPart(row.city)
  const province = cleanPart(row.province)

  if (!province && !city && !district) return address

  const prefix = [province, city, district].filter(Boolean).join('')
  if (!address) return prefix
  if (address.includes(prefix) || prefix.includes(address)) return address

  return `${prefix}${address}`
}

function parseLocation(location) {
  const [lngText, latText] = String(location || '').split(',')
  const lng = Number(lngText)
  const lat = Number(latText)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error('高德返回的经纬度无效')
  }
  return { lng, lat }
}

function normalizePoi(poi) {
  if (!poi?.location) return null
  const { lng, lat } = parseLocation(poi.location)
  return {
    id: poi.id || '',
    name: poi.name || '',
    type: poi.type || '',
    address: Array.isArray(poi.address) ? poi.address.join('') : poi.address || '',
    province: poi.pname || '',
    city: poi.cityname || '',
    district: poi.adname || '',
    lng,
    lat,
  }
}

export async function geocodeAddress(input = {}) {
  const key = await getAmapWebServiceKey()
  if (!key) throw new Error('缺少 AMAP_WEB_SERVICE_KEY')

  const address = buildFullAddress(input)
  if (!address) throw new Error('地址为空')

  const params = new URLSearchParams({
    key,
    address,
    output: 'JSON',
  })

  const city = cleanPart(input.city)
  if (city) params.set('city', city)

  const response = await fetch(`${AMAP_GEOCODE_URL}?${params.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`高德地理编码请求失败：HTTP ${response.status}`)
  }

  const data = await response.json()
  if (data.status !== '1') {
    throw new Error(data.info || '高德地理编码失败')
  }

  const geocode = data.geocodes?.[0]
  if (!geocode?.location) {
    throw new Error('高德未找到匹配地址')
  }

  const { lng, lat } = parseLocation(geocode.location)
  return {
    lng,
    lat,
    level: geocode.level || '',
    adcode: geocode.adcode || '',
    formattedAddress: geocode.formatted_address || address,
  }
}

export async function searchPlaces(input = {}) {
  const key = await getAmapWebServiceKey()
  if (!key) throw new Error('缺少 AMAP_WEB_SERVICE_KEY')

  const keywords = cleanPart(input.keywords || input.q)
  if (!keywords) throw new Error('搜索关键词为空')

  const params = new URLSearchParams({
    key,
    keywords,
    output: 'JSON',
    offset: String(Math.max(1, Math.min(Number(input.offset || 10), 25))),
    page: String(Math.max(1, Number(input.page || 1))),
    extensions: 'base',
    citylimit: 'false',
  })

  const city = cleanPart(input.city)
  if (city) params.set('city', city)

  const response = await fetchPlaceSearch(`${AMAP_PLACE_TEXT_URL}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`高德地点搜索请求失败：HTTP ${response.status}`)
  }

  const data = await response.json()
  if (data.status !== '1') {
    throw new Error(data.info || '高德地点搜索失败')
  }

  return {
    count: Number(data.count || 0),
    pois: (data.pois || []).map(normalizePoi).filter(Boolean),
  }
}
