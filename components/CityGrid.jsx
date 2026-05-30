'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Spin } from 'antd'
import { EnvironmentOutlined } from '@ant-design/icons'
import { fuzzyMatch } from '@/utils/fuzzy'
import CityDetail from './CityDetail'

function cityInitial(name) {
  return String(name || '城').trim().slice(0, 1)
}

function provinceIndexLabel(name) {
  return String(name || '').trim().slice(0, 1) || '#'
}

function CityCard({ city, count, onClick }) {
  return (
    <div
      className="city-card"
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
    >
      <div className="city-card-initial">
        {cityInitial(city)}
      </div>
      <div className="city-card-body">
        <div className="city-card-title">{city}</div>
        <div className="city-card-meta">
          <EnvironmentOutlined />
          <span className="city-card-count">{count}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>条地址</span>
        </div>
      </div>
    </div>
  )
}

export default function CityGrid({ stats, loading, searchQuery }) {
  const [selected, setSelected] = useState(null)
  const [activeProvince, setActiveProvince] = useState('')
  const [showIndexBubble, setShowIndexBubble] = useState(false)
  const provinceRefs = useRef({})
  const indexRef = useRef(null)
  const indexBubbleTimer = useRef(null)
  const activeProvinceRef = useRef('')
  const isIndexDragging = useRef(false)

  // Build province → cities map
  const provinceMap = useMemo(() => {
    const map = {}
    for (const row of stats) {
      const prov = row.province || '其他'
      if (!map[prov]) map[prov] = []
      map[prov].push({ city: row.city, count: parseInt(row.count) })
    }
    return map
  }, [stats])

  const provinces = useMemo(() =>
    Object.keys(provinceMap).sort((a, b) => a === '其他' ? 1 : b === '其他' ? -1 : a.localeCompare(b, 'zh')),
    [provinceMap]
  )

  const visibleProvinces = useMemo(() =>
    provinces.filter(prov => {
      const cities = (provinceMap[prov] || []).filter(c => !searchQuery || fuzzyMatch(c.city, searchQuery))
      return cities.length > 0
    }),
    [provinceMap, provinces, searchQuery]
  )

  useEffect(() => {
    return () => window.clearTimeout(indexBubbleTimer.current)
  }, [])

  const hideIndexBubbleSoon = () => {
    window.clearTimeout(indexBubbleTimer.current)
    indexBubbleTimer.current = window.setTimeout(() => setShowIndexBubble(false), 520)
  }

  const scrollToProvince = (province, behavior = 'smooth', autoHide = true) => {
    const index = visibleProvinces.indexOf(province)
    if (index >= 0) indexRef.current?.style.setProperty('--active-index', index)
    activeProvinceRef.current = province
    setActiveProvince(province)
    setShowIndexBubble(true)
    if (autoHide) hideIndexBubbleSoon()
    provinceRefs.current[province]?.scrollIntoView({ behavior, block: 'start' })
  }

  const scrollByPointer = (event, behavior = 'auto') => {
    const rect = indexRef.current?.getBoundingClientRect()
    if (!rect || visibleProvinces.length === 0) return

    const ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 0.999)
    const index = Math.floor(ratio * visibleProvinces.length)
    const province = visibleProvinces[index]
    if (province && province !== activeProvinceRef.current) scrollToProvince(province, behavior, false)
  }

  const handleIndexPointerDown = (event) => {
    event.preventDefault()
    isIndexDragging.current = true
    window.clearTimeout(indexBubbleTimer.current)
    if (activeProvinceRef.current) setShowIndexBubble(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    scrollByPointer(event, 'auto')
  }

  const handleIndexPointerMove = (event) => {
    if (!isIndexDragging.current) return
    event.preventDefault()
    scrollByPointer(event, 'auto')
  }

  const handleIndexPointerUp = (event) => {
    isIndexDragging.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    hideIndexBubbleSoon()
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
  }

  if (stats.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>还没有数据</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8, maxWidth: 300, margin: '0 auto' }}>
          点击右上角「导入」上传 Excel 文件，<br />再点「AI 解析」自动整理城市地址
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="city-grid-wrap">
        {visibleProvinces.length > 1 && (
          <nav
            ref={indexRef}
            className="province-index"
            style={{ '--index-count': visibleProvinces.length }}
            aria-label="省份索引"
            onPointerDown={handleIndexPointerDown}
            onPointerMove={handleIndexPointerMove}
            onPointerUp={handleIndexPointerUp}
            onPointerCancel={handleIndexPointerUp}
          >
            <span className="province-index-thumb" aria-hidden="true" />
            {visibleProvinces.map(prov => (
              <span
                key={prov}
                className="province-index-item"
                title={prov}
              >
                {provinceIndexLabel(prov)}
              </span>
            ))}
          </nav>
        )}
        {showIndexBubble && activeProvince && (
          <div className="province-index-bubble" aria-hidden="true">
            {activeProvince}
          </div>
        )}

        {visibleProvinces.map(prov => {
          const cities = (provinceMap[prov] || []).filter(c => !searchQuery || fuzzyMatch(c.city, searchQuery))
          const totalInProv = cities.reduce((s, c) => s + c.count, 0)

          return (
            <div
              key={prov}
              ref={node => { provinceRefs.current[prov] = node }}
              className="province-section"
              style={{ marginBottom: 28 }}
            >
              <div className="province-heading">
                <span className="province-name">{prov}</span>
                <span style={{ fontSize: 11, color: 'var(--color-primary-light)', fontWeight: 600 }}>· {cities.length} 城市 · {totalInProv} 条</span>
                <div className="province-rule" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))', gap: 8 }}>
                {cities.map(({ city, count }, i) => (
                  <div key={city} style={{ animation: `fadeUp 0.3s ease ${i * 35}ms both` }}>
                    <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`}</style>
                    <CityCard city={city} count={count} onClick={() => setSelected({ city, province: prov })} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <CityDetail
        open={!!selected}
        city={selected?.city}
        province={selected?.province}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
