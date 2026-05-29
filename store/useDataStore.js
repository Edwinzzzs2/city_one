import { create } from 'zustand'

const SETTINGS_KEY = 'cityAddressSettings_v2'

const defaultSettings = {
  apiBaseUrl: '',
  apiKey: '',
  model: 'gpt-5.5',
  batchSize: 40,
}

function loadSettings() {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings }
  } catch { return { ...defaultSettings } }
}

const useDataStore = create((set, get) => ({
  // ---- Settings (localStorage) ----
  settings: defaultSettings, // 初始值，客户端 hydrate 后更新

  initSettings() {
    set({ settings: loadSettings() })
  },

  updateSettings(patch) {
    const next = { ...get().settings, ...patch }
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    }
    set({ settings: next })
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
