import { create } from 'zustand'

const defaultSettings = {
  apiBaseUrl: '',
  apiKey: '',
  hasApiKey: false,
  model: 'gpt-5.5',
  batchSize: 40,
  themeMode: 'light',
  protectionRadiusKm: 3,
  showProtection: true,
}

const LOCAL_PREFERENCE_KEYS = {
  themeMode: 'cityAddressTheme',
  protectionRadiusKm: 'cityAddressProtectionRadiusKm',
  showProtection: 'cityAddressShowProtection',
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && window.localStorage
}

function normalizeThemeMode(value) {
  return value === 'dark' || value === 'light' ? value : undefined
}

function normalizeProtectionRadius(value) {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.min(5, Math.max(1, Math.round(number)))
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

function readLocalPreferences() {
  if (!canUseLocalStorage()) return {}

  try {
    const preferences = {}
    const themeMode = normalizeThemeMode(window.localStorage.getItem(LOCAL_PREFERENCE_KEYS.themeMode))
    const protectionRadiusKm = normalizeProtectionRadius(window.localStorage.getItem(LOCAL_PREFERENCE_KEYS.protectionRadiusKm))
    const showProtection = normalizeBoolean(window.localStorage.getItem(LOCAL_PREFERENCE_KEYS.showProtection))

    if (themeMode) preferences.themeMode = themeMode
    if (protectionRadiusKm) preferences.protectionRadiusKm = protectionRadiusKm
    if (showProtection !== undefined) preferences.showProtection = showProtection

    return preferences
  } catch {
    return {}
  }
}

function writeLocalPreferences(patch) {
  if (!canUseLocalStorage()) return

  try {
    if ('themeMode' in patch) {
      window.localStorage.setItem(LOCAL_PREFERENCE_KEYS.themeMode, patch.themeMode)
    }
    if ('protectionRadiusKm' in patch) {
      window.localStorage.setItem(LOCAL_PREFERENCE_KEYS.protectionRadiusKm, String(patch.protectionRadiusKm))
    }
    if ('showProtection' in patch) {
      window.localStorage.setItem(LOCAL_PREFERENCE_KEYS.showProtection, String(patch.showProtection))
    }
  } catch {
    // localStorage may be blocked; in-memory settings still update.
  }
}

function normalizeLocalPreferencePatch(patch) {
  const next = {}

  if ('themeMode' in patch) {
    const themeMode = normalizeThemeMode(patch.themeMode)
    if (themeMode) next.themeMode = themeMode
  }
  if ('protectionRadiusKm' in patch) {
    const protectionRadiusKm = normalizeProtectionRadius(patch.protectionRadiusKm)
    if (protectionRadiusKm) next.protectionRadiusKm = protectionRadiusKm
  }
  if ('showProtection' in patch) {
    const showProtection = normalizeBoolean(patch.showProtection)
    if (showProtection !== undefined) next.showProtection = showProtection
  }

  return next
}

function applyLocalPreferences(settings) {
  return { ...defaultSettings, ...settings, ...readLocalPreferences() }
}

const useDataStore = create((set, get) => ({
  // ---- Settings (server DB, public fields only) ----
  settings: defaultSettings, // 初始值，客户端 hydrate 后更新
  settingsLoaded: false,

  async initSettings() {
    set({ settings: applyLocalPreferences(get().settings) })

    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '配置加载失败')
      set({ settings: applyLocalPreferences(data.settings), settingsLoaded: true })
    } catch {
      set({ settings: applyLocalPreferences(defaultSettings), settingsLoaded: true })
    }
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch }
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || '配置保存失败')
    const settings = applyLocalPreferences(data.settings)
    set({ settings })
    return settings
  },

  updateLocalSettings(patch) {
    const localPatch = normalizeLocalPreferencePatch(patch)
    if (Object.keys(localPatch).length === 0) return get().settings

    writeLocalPreferences(localPatch)
    const settings = { ...get().settings, ...localPatch }
    set({ settings })
    return settings
  },

  // ---- Raw rows (pre-AI, in-memory only) ----
  rawRows: [],
  setRawRows(rows) { set({ rawRows: rows }) },
  clearRawRows() { set({ rawRows: [] }) },

  // ---- City map (built from DB data, in-memory cache) ----
  // { province -> { city -> count } }
  cityStats: [],      // [{ province, city, count }]
  setCityStats(stats) { set({ cityStats: stats }) },

  // Detail rows for currently open city (lazy loaded)
  cityRows: [],
  setCityRows(rows) { set({ cityRows: rows }) },
}))

export default useDataStore
