'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ConfigProvider, theme, Button, Input, Badge, Tooltip, Space, App, Segmented } from 'antd'
import {
  UploadOutlined, RobotOutlined, SettingOutlined, SearchOutlined, DatabaseOutlined,
  MoonOutlined, SunOutlined, UnorderedListOutlined, EnvironmentOutlined,
} from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { parseExcelFile } from '@/utils/excelParser'
import CityGrid from '@/components/CityGrid'
import AiParseModal from '@/components/AiParseModal'
import SettingsModal from '@/components/SettingsModal'
import SearchResults from '@/components/SearchResults'
import MapView from '@/components/MapView'

const PULL_REFRESH_TRIGGER = 68
const PULL_REFRESH_MAX = 96
const PULL_REFRESH_IGNORED_SELECTOR = '.ant-modal-root,.ant-drawer,.ant-select-dropdown,.map-stage,.map-search-panel,.amap-container'

function MainApp({ themeMode, onToggleTheme }) {
  const { message } = App.useApp()
  const { rawRows, setRawRows, settings, initSettings } = useDataStore()

  const [searchQ, setSearchQ] = useState('')
  const [searchMode, setSearchMode] = useState('city')
  const [viewMode, setViewMode] = useState('list')
  const [aiOpen, setAiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [pullRefresh, setPullRefresh] = useState({ distance: 0, refreshing: false })
  const fileRef = useRef()
  const shellRef = useRef(null)
  const pullStartY = useRef(0)
  const pullTracking = useRef(false)
  const searchTerm = searchQ.trim()

  // 初始化客户端 settings
  useEffect(() => { initSettings() }, [])

  // 加载城市统计
  const loadStats = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatsLoading(true)
    try {
      const res = await fetch('/api/addresses')
      const data = await res.json()
      if (data.ok) {
        setStats(data.rows || [])
      } else {
        message.error('数据库连接失败：' + data.error)
      }
    } catch (e) {
      message.error('无法连接数据库：' + e.message)
    } finally {
      if (!silent) setStatsLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const fetchSearchResults = useCallback(async (term, mode, signal) => {
    setSearchLoading(true)
    try {
      const searchParam = mode === 'city' ? 'city' : 'q'
      const res = await fetch(`/api/addresses?${searchParam}=${encodeURIComponent(term)}`, {
        signal,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '搜索失败')
      setSearchResults(data.rows || [])
    } catch (e) {
      if (e.name !== 'AbortError') {
        setSearchResults([])
        message.error('搜索失败：' + e.message)
      }
    } finally {
      if (!signal?.aborted) setSearchLoading(false)
    }
  }, [message])

  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetchSearchResults(searchTerm, searchMode, controller.signal)
    }, 260)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fetchSearchResults, searchTerm, searchMode])

  // 导入文件
  const handleFile = useCallback(async (file) => {
    setImporting(true)
    try {
      const raw = await parseExcelFile(file)
      if (raw.length === 0) { message.error('未识别到有效数据，请检查表格格式'); return }
      setRawRows(raw)
      message.success(`已读取 ${raw.length} 条，请点击「AI 解析」`)
      setAiOpen(true)
    } catch (e) {
      message.error('文件解析失败：' + e.message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [setRawRows, message])

  const refreshPageData = useCallback(async () => {
    setPullRefresh({ distance: 58, refreshing: true })
    try {
      await loadStats({ silent: true })
      if (searchTerm) {
        const controller = new AbortController()
        await fetchSearchResults(searchTerm, searchMode, controller.signal)
      }
    } finally {
      window.setTimeout(() => setPullRefresh({ distance: 0, refreshing: false }), 220)
    }
  }, [fetchSearchResults, loadStats, searchMode, searchTerm])

  const handlePullStart = useCallback((event) => {
    if (document.body.classList.contains('is-scroll-locked')) return
    if (event.target?.closest?.(PULL_REFRESH_IGNORED_SELECTOR)) return
    const scrollTop = shellRef.current?.scrollTop || 0
    if (scrollTop > 0 || pullRefresh.refreshing || event.touches.length !== 1) return
    pullStartY.current = event.touches[0].clientY
    pullTracking.current = true
  }, [pullRefresh.refreshing])

  const handlePullMove = useCallback((event) => {
    if (!pullTracking.current || pullRefresh.refreshing) return
    const delta = event.touches[0].clientY - pullStartY.current
    const scrollTop = shellRef.current?.scrollTop || 0
    if (delta <= 0 || scrollTop > 0) {
      setPullRefresh(prev => prev.distance ? { ...prev, distance: 0 } : prev)
      return
    }

    const distance = Math.min(PULL_REFRESH_MAX, Math.round(delta * 0.55))
    if (distance > 8) event.preventDefault()
    setPullRefresh(prev => prev.distance === distance ? prev : { ...prev, distance })
  }, [pullRefresh.refreshing])

  const handlePullEnd = useCallback(() => {
    if (!pullTracking.current) return
    pullTracking.current = false

    if (pullRefresh.distance >= PULL_REFRESH_TRIGGER) {
      refreshPageData()
      return
    }
    setPullRefresh(prev => ({ ...prev, distance: 0 }))
  }, [pullRefresh.distance, refreshPageData])

  const totalCities = new Set(stats.map(r => r.city).filter(Boolean)).size
  const totalRows = stats.reduce((s, r) => s + parseInt(r.count || 0), 0)

  return (
    <div
      ref={shellRef}
      className={`app-shell app-shell--${viewMode}`}
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
      onTouchCancel={handlePullEnd}
    >
      {(pullRefresh.refreshing || pullRefresh.distance > 0) && (
        <div
          className={`pull-refresh${pullRefresh.refreshing ? ' is-refreshing' : ''}${pullRefresh.distance >= PULL_REFRESH_TRIGGER ? ' is-ready' : ''}`}
          style={{ '--pull-distance': `${pullRefresh.refreshing ? 58 : pullRefresh.distance}px` }}
        >
          <span className="pull-refresh-spinner" />
          <span>{pullRefresh.refreshing ? '刷新中' : pullRefresh.distance >= PULL_REFRESH_TRIGGER ? '松开刷新' : '下拉刷新'}</span>
        </div>
      )}
      {/* ===== HEADER ===== */}
      <header className="app-header">
        <div className="app-header-inner">

          {/* Logo */}
          <div className="brand-block">
            <div className="brand-icon">
              <DatabaseOutlined />
            </div>
            <div>
              <div className="brand-title">
                城市地址
              </div>
              {totalRows > 0 && (
                <div className="brand-meta">
                  <DatabaseOutlined style={{ fontSize: 9 }} />
                  {totalCities} 城市 · {totalRows} 条
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="header-search">
            <div className="header-search-combo">
              <Input
                prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
                placeholder={searchMode === 'city' ? '搜索城市名称...' : '搜索地址、机构、电话...'}
                value={searchQ} onChange={e => setSearchQ(e.target.value)}
                allowClear disabled={stats.length === 0} style={{ height: 36 }}
              />
              <select
                className="header-search-mode"
                value={searchMode}
                onChange={e => setSearchMode(e.target.value)}
                aria-label="搜索类型"
              >
                <option value="city">城市</option>
                <option value="keyword">关键字</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <Space size={6} className="header-actions">
            <Segmented
              className="view-switch"
              size="small"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'list', icon: <UnorderedListOutlined />, label: <span className="view-switch-label">列表</span> },
                { value: 'map', icon: <EnvironmentOutlined />, label: <span className="view-switch-label">地图</span> },
              ]}
            />

            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

            <Tooltip title="导入 Excel / CSV">
              <Button type="primary" icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()} style={{ height: 36 }}>
                <span className="action-label">导入</span>
              </Button>
            </Tooltip>

            {rawRows.length > 0 && (
              <Tooltip title={`${rawRows.length} 条待 AI 解析`}>
                <Badge count={rawRows.length} size="small">
                  <Button icon={<RobotOutlined />} onClick={() => setAiOpen(true)}
                    style={{ height: 36, borderColor: 'color-mix(in srgb,var(--color-primary) 42%,var(--color-border))', color: 'var(--color-primary-light)', background: 'color-mix(in srgb,var(--color-primary) 10%,var(--color-surface))' }}>
                    <span className="action-label">AI 解析</span>
                  </Button>
                </Badge>
              </Tooltip>
            )}

            <Tooltip title={themeMode === 'dark' ? '切换浅色模式' : '切换深色模式'}>
              <Button
                icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={onToggleTheme}
                style={{ height: 36 }}
              />
            </Tooltip>

            <Tooltip title="AI 配置">
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ height: 36 }} />
            </Tooltip>
          </Space>
        </div>
      </header>

      {/* ===== MAIN ===== */}
      <main className="app-main">
        {viewMode === 'map' ? (
          <MapView searchQuery={searchTerm} searchMode={searchMode} themeMode={themeMode} />
        ) : searchTerm ? (
          <SearchResults query={searchTerm} rows={searchResults} loading={searchLoading} />
        ) : (
          <CityGrid stats={stats} loading={statsLoading} searchQuery="" />
        )}
      </main>

      <AiParseModal open={aiOpen} onClose={() => setAiOpen(false)} onImported={loadStats} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default function Page() {
  const [themeMode, setThemeMode] = useState('light')

  useEffect(() => {
    const saved = window.localStorage.getItem('cityAddressTheme')
    setThemeMode(saved || 'light')
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.documentElement.style.colorScheme = themeMode
    window.localStorage.setItem('cityAddressTheme', themeMode)
  }, [themeMode])

  const isDark = themeMode === 'dark'

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorBgBase: isDark ? '#0f172a' : '#f7f8fb',
          colorBgContainer: isDark ? '#182033' : '#ffffff',
          colorBgElevated: isDark ? '#202a40' : '#ffffff',
          colorBorder: isDark ? 'rgba(148,163,184,0.22)' : '#d9e0ea',
          borderRadius: 8,
          fontFamily: "'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif",
          colorText: isDark ? '#e5e7eb' : '#111827',
          colorTextSecondary: isDark ? '#a7b0c0' : '#4b5563',
          colorTextTertiary: isDark ? '#717b8f' : '#7b8794',
        },
        components: {
          Button: { borderRadius: 8 },
          Input: { borderRadius: 8 },
          Modal: { borderRadiusLG: 10 },
          Drawer: { borderRadiusLG: 0 },
        }
      }}
    >
      <App message={{ top: 88 }}>
        <MainApp
          themeMode={themeMode}
          onToggleTheme={() => setThemeMode(mode => mode === 'dark' ? 'light' : 'dark')}
        />
      </App>
    </ConfigProvider>
  )
}
