'use client'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ConfigProvider, theme, Button, Input, Badge, Tooltip, Space, App, Tag } from 'antd'
import { UploadOutlined, RobotOutlined, SettingOutlined, SearchOutlined, DeleteOutlined, DatabaseOutlined } from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { parseExcelFile } from '@/utils/excelParser'
import CityGrid from '@/components/CityGrid'
import AiParseModal from '@/components/AiParseModal'
import SettingsModal from '@/components/SettingsModal'

function MainApp() {
  const { message } = App.useApp()
  const { rawRows, setRawRows, settings, initSettings } = useDataStore()

  const [searchQ, setSearchQ] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [dbOk, setDbOk] = useState(null) // null=checking true=ok false=error
  const fileRef = useRef()

  // 初始化客户端 settings
  useEffect(() => { initSettings() }, [])

  // 加载城市统计
  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/addresses')
      const data = await res.json()
      if (data.ok) {
        setStats(data.rows || [])
        setDbOk(true)
      } else {
        setDbOk(false)
        message.error('数据库连接失败：' + data.error)
      }
    } catch (e) {
      setDbOk(false)
      message.error('无法连接数据库：' + e.message)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

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

  const handleClear = async () => {
    if (!window.confirm('确定清空数据库中所有地址数据吗？')) return
    try {
      const res = await fetch('/api/addresses', { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) { message.success('已清空数据库'); loadStats() }
      else message.error(data.error)
    } catch (e) { message.error(e.message) }
  }

  const totalCities = new Set(stats.map(r => r.city).filter(Boolean)).size
  const totalRows = stats.reduce((s, r) => s + parseInt(r.count || 0), 0)

  return (
    <div style={{ minHeight: '100dvh', position: 'relative', zIndex: 1 }}>
      {/* ===== HEADER ===== */}
      <header style={{ position: 'sticky', top: 0, zIndex: 200, background: 'rgba(11,13,20,0.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--color-border)', padding: '0 16px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, height: 62 }}>

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6c63ff,#00d2ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, boxShadow: '0 3px 10px rgba(108,99,255,0.4)' }}>
              🏙️
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.1, background: 'linear-gradient(90deg,#8b85ff,#00d2ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                城市地址
              </div>
              {totalRows > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <DatabaseOutlined style={{ fontSize: 9 }} />
                  {totalCities} 城市 · {totalRows} 条
                  {dbOk === true && <span style={{ color: '#5eeba8' }}>● 已连接</span>}
                  {dbOk === false && <span style={{ color: '#ff9b9b' }}>● 连接失败</span>}
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input
              prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
              placeholder="搜索城市..."
              value={searchQ} onChange={e => setSearchQ(e.target.value)}
              allowClear disabled={stats.length === 0} style={{ height: 36 }}
            />
          </div>

          {/* Actions */}
          <Space size={6} style={{ flexShrink: 0 }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

            <Tooltip title="导入 Excel / CSV">
              <Button type="primary" icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()} style={{ height: 36 }}>
                导入
              </Button>
            </Tooltip>

            {rawRows.length > 0 && (
              <Tooltip title={`${rawRows.length} 条待 AI 解析`}>
                <Badge count={rawRows.length} size="small">
                  <Button icon={<RobotOutlined />} onClick={() => setAiOpen(true)}
                    style={{ height: 36, borderColor: 'rgba(108,99,255,0.5)', color: 'var(--color-primary-light)', background: 'rgba(108,99,255,0.1)' }}>
                    AI 解析
                  </Button>
                </Badge>
              </Tooltip>
            )}

            {totalRows > 0 && (
              <Tooltip title="清空数据库">
                <Button icon={<DeleteOutlined />} onClick={handleClear} danger style={{ height: 36, background: 'transparent', color: '#ff9b9b', borderColor: 'rgba(255,107,107,0.25)' }} />
              </Tooltip>
            )}

            <Tooltip title="AI 配置">
              <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ height: 36 }} />
            </Tooltip>
          </Space>
        </div>
      </header>

      {/* ===== MAIN ===== */}
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 0' }}>
        <CityGrid stats={stats} loading={statsLoading} searchQuery={searchQ.trim()} />
      </main>

      <AiParseModal open={aiOpen} onClose={() => setAiOpen(false)} onImported={loadStats} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default function Page() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6c63ff',
          colorBgBase: '#0b0d14',
          colorBgContainer: '#161928',
          colorBgElevated: '#1e2235',
          colorBorder: 'rgba(255,255,255,0.07)',
          borderRadius: 10,
          fontFamily: "'Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif",
          colorText: '#f0f2ff',
          colorTextSecondary: 'rgba(240,242,255,0.6)',
          colorTextTertiary: 'rgba(240,242,255,0.35)',
        },
        components: { Button: { borderRadius: 50 }, Input: { borderRadius: 50 } }
      }}
    >
      <App>
        <MainApp />
      </App>
    </ConfigProvider>
  )
}
