'use client'
import React, { useState, useEffect, useRef } from 'react'
import { Drawer, Input, Spin, Button } from 'antd'
import { SearchOutlined, EnvironmentOutlined, CloseOutlined } from '@ant-design/icons'
import { fuzzyFilter, renderHighlight } from '@/utils/fuzzy'
import { useBodyScrollLock } from '@/utils/useBodyScrollLock'
import { readableEventName, trackEvent } from '@/utils/analytics'
import CopyableAddress from './CopyableAddress'

export default function CityDetail({ city, province, open, onClose }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const touchStartRef = useRef(null)
  useBodyScrollLock(open)

  const handleClose = () => {
    setQ('')
    onClose?.()
  }

  useEffect(() => {
    if (!open || !city) return

    const controller = new AbortController()
    const { signal } = controller
    setLoading(true)
    setQ('')
    setRows([])

    fetch(`/api/addresses?city=${encodeURIComponent(city)}`, { signal })
      .then(response => response.json())
      .then(data => { if (!signal.aborted) setRows(data.rows || []) })
      .catch(() => { if (!signal.aborted) setRows([]) })
      .finally(() => { if (!signal.aborted) setLoading(false) })

    return () => controller.abort()
  }, [open, city])

  const filtered = fuzzyFilter(rows, q, ['address', 'district', 'industry', 'name', 'company'])

  useEffect(() => {
    const query = q.trim()
    if (!open || !query) return undefined

    const timer = window.setTimeout(() => {
      trackEvent(readableEventName('城市内搜索', query), {
        event_type: 'city_detail_search',
        city,
        province,
        query,
        result_count: filtered.length,
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [city, filtered.length, open, province, q])

  const handleTouchStart = (event) => {
    const touch = event.touches?.[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current
    const touch = event.changedTouches?.[0]
    touchStartRef.current = null
    if (!start || !touch) return

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const isLeftSwipe = dx < -42 && Math.abs(dy) < 80
    if (isLeftSwipe) {
      handleClose()
    }
  }

  return (
    <Drawer
      title={(
        <div className="city-detail-heading">
          <span className="city-detail-icon"><EnvironmentOutlined aria-hidden="true" /></span>
          <div className="city-detail-heading-text">
            <h2>{city}</h2>
            <p>{province}{!loading && ` · ${rows.length.toLocaleString('zh-CN')} 条地址`}</p>
          </div>
        </div>
      )}
      footer={<Button block onClick={handleClose}>关闭</Button>}
      placement="right" onClose={handleClose} open={open}
      closable={{ placement: 'end', 'aria-label': '关闭城市详情', closeIcon: <CloseOutlined /> }}
      rootClassName="city-detail-drawer"
      width="min(100%, 520px)"
    >
      <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="city-detail-search">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索此城市内的地址"
            aria-label="搜索此城市内的地址"
            value={q} onChange={e => setQ(e.target.value)} allowClear
          />
          {!loading && q && <p className="city-detail-match" role="status">找到 {filtered.length} 条地址</p>}
        </div>

        <div className="city-detail-results" aria-busy={loading}>
          {loading ? (
            <div className="state-panel" role="status" aria-label="正在加载地址"><Spin size="large" /></div>
          ) : filtered.length === 0 ? (
            <div className="state-panel state-panel-empty">
              <div className="state-panel-icon"><SearchOutlined /></div>
              <h3 className="state-panel-title">{q ? '未找到匹配地址' : '暂无地址'}</h3>
            </div>
          ) : (
            <ul className="address-list">
              {filtered.map((item, index) => (
                <li key={item.id ?? index} className="address-row">
                  <CopyableAddress address={item.address} className="copyable-address drawer-address">
                    {renderHighlight(item.address || '未填写地址', q, React)}
                  </CopyableAddress>
                  {(item.name || item.company) && (
                    <div className="address-row-region">{[item.name, item.company].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="address-row-meta">
                    {[item.district, item.industry, item.source, item.status].map((value, metaIndex) => value && (
                      <span className="address-meta-chip" key={metaIndex}>{value}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}
