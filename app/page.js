'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ConfigProvider, theme, Button, Input, Tooltip, Space, App, Segmented } from 'antd'
import {
  SearchOutlined, DatabaseOutlined, MoonOutlined, SunOutlined,
  UnorderedListOutlined, EnvironmentOutlined, LogoutOutlined,
  CrownOutlined, UserOutlined,
} from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import CityGrid from '@/components/CityGrid'
import SearchResults from '@/components/SearchResults'
import MapView from '@/components/MapView'
import { readableEventName, trackEvent } from '@/utils/analytics'

const PULL_REFRESH_TRIGGER = 68
const PULL_REFRESH_MAX = 96
const PULL_REFRESH_IGNORED_SELECTOR = '.ant-modal-root,.ant-drawer,.ant-select-dropdown,.map-stage,.map-search-panel,.amap-container'

function MainApp({ themeMode, onToggleTheme, user, onLogout, authEnabled }) {
  const { message } = App.useApp()

  const [searchQ, setSearchQ] = useState('')
  const [searchMode, setSearchMode] = useState('city')
  const [viewMode, setViewMode] = useState('list')
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [pullRefresh, setPullRefresh] = useState({ distance: 0, refreshing: false })
  const shellRef = useRef(null)
  const pullStartY = useRef(0)
  const pullTracking = useRef(false)
  const searchTerm = searchQ.trim()

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
      const rows = data.rows || []
      setSearchResults(rows)
      trackEvent(readableEventName('搜索地址', term), {
        event_type: 'address_search',
        mode,
        query: term,
        query_length: term.length,
        result_count: rows.length,
      })
    } catch (e) {
      if (e.name !== 'AbortError') {
        setSearchResults([])
        trackEvent(readableEventName('搜索失败', term), {
          event_type: 'address_search_error',
          mode,
          query: term,
          query_length: term.length,
        })
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
              <img src="/icon-192.png" alt="" aria-hidden="true" />
            </div>
            <div>
              <div className="brand-title">
                校区地址
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
                placeholder={searchMode === 'city' ? '输入城市名...' : '查地址 / 机构 / 电话...'}
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
              onChange={(mode) => {
                setViewMode(mode)
                trackEvent(readableEventName('点击', mode === 'map' ? '切换地图' : '切换列表'), {
                  event_type: 'operation_click',
                  operation: 'view_mode_change',
                  mode,
                })
              }}
              options={[
                { value: 'list', icon: <UnorderedListOutlined />, label: <span className="view-switch-label">列表</span> },
                { value: 'map', icon: <EnvironmentOutlined />, label: <span className="view-switch-label">地图</span> },
              ]}
            />

            <Tooltip title={themeMode === 'dark' ? '切换浅色模式' : '切换深色模式'}>
              <Button
                icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={() => onToggleTheme()}
                style={{ height: 36 }}
              />
            </Tooltip>

            {authEnabled && !user?.isGuest && (
              <>
                <div className="account-chip" title={user?.isAdmin ? '管理员账号' : '普通账号'}>
                  {user?.isAdmin ? <CrownOutlined /> : <UserOutlined />}
                  <span>{user?.username}</span>
                </div>

                <Tooltip title="退出登录">
                  <Button icon={<LogoutOutlined />} onClick={onLogout} style={{ height: 36 }} />
                </Tooltip>
              </>
            )}
          </Space>
        </div>
      </header>

      {/* ===== MAIN ===== */}
      <main className="app-main">
        {viewMode === 'list' && !searchTerm && (
          <section className="overview-panel" aria-label="数据概览">
            <div className="overview-copy">
              <span className="overview-kicker">Address Ledger</span>
              <h1>校区地址台账</h1>
              <p>按城市查看校区地址、联系人与坐标状态，管理员可在控制台集中导入和维护数据。</p>
            </div>
            <div className="overview-stats overview-stats--compact" aria-label="当前数据统计">
              <div className="overview-stat">
                <span>{totalCities}</span>
                <strong>覆盖城市</strong>
              </div>
              <div className="overview-stat">
                <span>{totalRows}</span>
                <strong>地址记录</strong>
              </div>
            </div>
          </section>
        )}
        {viewMode === 'map' ? (
          <MapView searchQuery={searchTerm} searchMode={searchMode} themeMode={themeMode} />
        ) : searchTerm ? (
          <SearchResults query={searchTerm} rows={searchResults} loading={searchLoading} />
        ) : (
          <CityGrid stats={stats} loading={statsLoading} searchQuery="" />
        )}
      </main>

    </div>
  )
}

export default function Page() {
  const { settings, initSettings, updateLocalSettings } = useDataStore()
  const themeMode = settings.themeMode || 'light'
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authEnabled, setAuthEnabled] = useState(false)

  useEffect(() => {
    initSettings()
  }, [initSettings])

  useEffect(() => {
    async function loadUser() {
      try {
        const configResponse = await fetch('/api/public-config', { cache: 'no-store' })
        const config = await configResponse.json()
        const authEnabled = config?.authEnabled === true
        setAuthEnabled(authEnabled)
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))

        if (response.ok && data.authenticated) {
          setUser(data.user)
          return
        }
        if (!authEnabled) {
          setUser({ username: 'guest', isAdmin: false, isGuest: true })
          return
        }
        window.location.href = '/login'
      } catch {
        window.location.href = '/login'
      } finally {
        setAuthLoading(false)
      }
    }

    loadUser()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.documentElement.style.colorScheme = themeMode
  }, [themeMode])

  const isDark = themeMode === 'dark'

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  if (authLoading || !user) {
    return <div className="auth-loading"><span /><p>正在进入地址台账</p></div>
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#72c8b8' : '#0f6f62',
          colorBgBase: isDark ? '#101714' : '#f5f7f1',
          colorBgContainer: isDark ? '#18231f' : '#fbfcf8',
          colorBgElevated: isDark ? '#1e2a25' : '#fbfcf8',
          colorBorder: isDark ? 'rgba(177,194,173,0.22)' : '#d9e0d5',
          borderRadius: 8,
          fontFamily: "'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
          colorText: isDark ? '#edf4ee' : '#18211d',
          colorTextSecondary: isDark ? '#bdcbbf' : '#4c5d53',
          colorTextTertiary: isDark ? '#879589' : '#748078',
        },
        components: {
          Button: { borderRadius: 8 },
          Input: { borderRadius: 8 },
          Modal: { borderRadiusLG: 8 },
          Drawer: { borderRadiusLG: 0 },
        }
      }}
    >
      <App message={{ top: 88 }}>
        <MainApp
          themeMode={themeMode}
          onToggleTheme={() => updateLocalSettings({ themeMode: themeMode === 'dark' ? 'light' : 'dark' })}
          user={user}
          onLogout={logout}
          authEnabled={authEnabled}
        />
      </App>
    </ConfigProvider>
  )
}
