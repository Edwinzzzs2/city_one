'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { App, Segmented } from 'antd'
import {
  SearchOutlined, DownOutlined, CloseCircleFilled, MoonOutlined, SunOutlined,
  UnorderedListOutlined, EnvironmentOutlined, LogoutOutlined,
  SettingOutlined, UserOutlined,
} from '@ant-design/icons'
import AppTheme from '@/components/AppTheme'
import useDataStore from '@/store/useDataStore'
import CityGrid from '@/components/CityGrid'
import SearchResults from '@/components/SearchResults'
import MapView from '@/components/MapView'
import { readableEventName, trackEvent } from '@/utils/analytics'

const PULL_REFRESH_TRIGGER = 68
const PULL_REFRESH_MAX = 96
const PULL_REFRESH_IGNORED_SELECTOR = '.ant-modal-root,.ant-drawer,.ant-select-dropdown,.map-stage,.map-search-panel,.amap-container'

function MainApp({ themeMode, onToggleTheme, user, onLogout }) {
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
  const searchInputRef = useRef(null)
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
  }, [message])

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

    setSearchLoading(true)
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
  const totalRows = stats.reduce((sum, row) => sum + (Number(row.count) || 0), 0)
  const themeLabel = themeMode === 'dark' ? '切换浅色模式' : '切换深色模式'
  const showAccount = !user.isGuest

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
          <span className="pull-refresh-spinner" aria-hidden="true" />
          <span>{pullRefresh.refreshing ? '刷新中' : pullRefresh.distance >= PULL_REFRESH_TRIGGER ? '松开刷新' : '下拉刷新'}</span>
        </div>
      )}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-block">
            <img className="brand-icon" src="/icon-folded-map-192.png" width="36" height="36" alt="" />
            <span>校区地址</span>
          </div>

          <div className="header-search" role="search" aria-label="搜索校区">
            <SearchOutlined className="header-search-icon" aria-hidden="true" />
            <input
              type="search"
              ref={searchInputRef}
              aria-label={searchMode === 'city' ? '搜索城市' : '按关键词搜索地址'}
              placeholder={searchMode === 'city' ? '搜索城市' : '搜索地址、机构或电话'}
              value={searchQ}
              onChange={event => setSearchQ(event.target.value)}
            />
            {searchQ && (
              <button
                type="button"
                className="clear-search"
                aria-label="清除搜索"
                onClick={() => {
                  setSearchQ('')
                  searchInputRef.current?.focus({ preventScroll: true })
                }}
              >
                <CloseCircleFilled />
              </button>
            )}
            <div className="header-search-mode">
              <select
                value={searchMode}
                onChange={event => setSearchMode(event.target.value)}
                aria-label="搜索范围"
              >
                <option value="city">城市</option>
                <option value="keyword">关键词</option>
              </select>
              <DownOutlined aria-hidden="true" />
            </div>
          </div>

          <div className="header-actions">
            <Segmented
              className="view-switch"
              aria-label="浏览视图"
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
                { value: 'list', icon: <UnorderedListOutlined />, label: '列表' },
                { value: 'map', icon: <EnvironmentOutlined />, label: '地图' },
              ]}
            />

            <button className="toolbar-icon" type="button" aria-label={themeLabel} title={themeLabel} onClick={onToggleTheme}>
              {themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            </button>

            {user.isAdmin && (
              <a className="toolbar-icon" href="/console" aria-label="管理控制台" title="管理控制台">
                <SettingOutlined />
              </a>
            )}

            {showAccount && (
              <div className="header-account">
                <div className="account-chip" title={user.username}>
                  <UserOutlined />
                  <span>{user.username}</span>
                </div>
                <button className="toolbar-icon" type="button" aria-label="退出登录" title="退出登录" onClick={onLogout}>
                  <LogoutOutlined />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {viewMode === 'list' && !searchTerm && (
          <section className="overview-panel" aria-labelledby="overview-title">
            <div className="overview-copy">
              <h1 id="overview-title">校区地址台账</h1>
              <p>按城市查找校区地址、联系人与地图位置。</p>
              <dl className="overview-stats" aria-busy={statsLoading}>
                <div>
                  <dt>覆盖城市</dt>
                  <dd>{statsLoading ? '—' : totalCities.toLocaleString('zh-CN')}</dd>
                </div>
                <div>
                  <dt>地址记录</dt>
                  <dd>{statsLoading ? '—' : totalRows.toLocaleString('zh-CN')}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}
        {viewMode === 'map' ? (
          <MapView
            searchQuery={searchTerm}
            searchMode={searchMode}
            themeMode={themeMode}
            canEditAddresses={user.isAdmin === true && !user.isGuest}
          />
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

  useEffect(() => {
    initSettings()
  }, [initSettings])

  useEffect(() => {
    async function loadUser() {
      try {
        const configResponse = await fetch('/api/public-config', { cache: 'no-store' })
        const config = await configResponse.json()
        const authEnabled = config?.authEnabled === true
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeMode === 'dark' ? '#1b1d22' : '#f5f5f7')
  }, [themeMode])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  if (authLoading || !user) {
    return <div className="auth-loading" role="status"><span aria-hidden="true" />正在进入地址台账</div>
  }

  return (
    <AppTheme mode={themeMode}>
      <App message={{ top: 80 }}>
        <MainApp
          themeMode={themeMode}
          onToggleTheme={() => updateLocalSettings({ themeMode: themeMode === 'dark' ? 'light' : 'dark' })}
          user={user}
          onLogout={logout}
        />
      </App>
    </AppTheme>
  )
}
