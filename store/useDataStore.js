import { create } from 'zustand'

const defaultSettings = {
  apiBaseUrl: '',
  apiKey: '',
  hasApiKey: false,
  model: 'gpt-5.5',
  batchSize: 40,
}

const useDataStore = create((set, get) => ({
  // ---- Settings (server DB, public fields only) ----
  settings: defaultSettings, // 初始值，客户端 hydrate 后更新

  async initSettings() {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '配置加载失败')
      set({ settings: { ...defaultSettings, ...data.settings } })
    } catch {
      set({ settings: { ...defaultSettings } })
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
    set({ settings: { ...defaultSettings, ...data.settings } })
    return data.settings
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
