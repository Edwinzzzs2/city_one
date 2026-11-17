'use client'
import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Spin } from 'antd'
import { DatabaseOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { fuzzyMatch } from '@/utils/fuzzy'
import { readableEventName, trackEvent } from '@/utils/analytics'
import CityDetail from './CityDetail'

function cityInitial(name) {
  return String(name || '城').trim().slice(0, 1)
}

function provinceIndexLabel(name) {
  return String(name || '').trim().slice(0, 1) || '#'
}

function CityCard({ city, count, tone, onClick }) {
  return (
    <button type="button" className={`city-card city-card--${tone}`} onClick={onClick} title={city}>
      <span className="city-card-initial" aria-hidden="true">{cityInitial(city)}</span>
      <span className="city-card-body">
        <span className="city-card-title">{city}</span>
        <span className="city-card-meta">{count.toLocaleString('zh-CN')} 条地址</span>
      </span>
      <RightOutlined className="city-card-arrow" aria-hidden="true" />
    </button>
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
      map[prov].push({ city: row.city, count: Number(row.count) || 0 })
    }
    return map
  }, [stats])

  const provinces = useMemo(() =>
    Object.keys(provinceMap).sort((a, b) => a === '其他' ? 1 : b === '其他' ? -1 : a.localeCompare(b, 'zh')),
    [provinceMap]
  )

  const visibleProvinces = useMemo(() =>
    provinces.map(name => ({
      name,
      cities: provinceMap[name].filter(({ city }) => !searchQuery || fuzzyMatch(city, searchQuery)),
    })).filter(({ cities }) => cities.length > 0),
    [provinceMap, provinces, searchQuery]
  )

  useEffect(() => {
    return () => window.clearTimeout(indexBubbleTimer.current)
  }, [])

  const hideIndexBubbleSoon = () => {
    window.clearTimeout(indexBubbleTimer.current)
    indexBubbleTimer.current = window.setTimeout(() => setShowIndexBubble(false), 520)
  }

  const scrollToProvince = (province, behavior, autoHide = true) => {
    activeProvinceRef.current = province
    setActiveProvince(province)
    setShowIndexBubble(true)
    if (autoHide) hideIndexBubbleSoon()
    provinceRefs.current[province]?.scrollIntoView({ behavior, block: 'start' })
  }

  const scrollByPointer = (event, force = false) => {
    const rect = indexRef.current?.getBoundingClientRect()
    if (!rect || visibleProvinces.length === 0) return

    const ratio = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 0.999)
    const index = Math.floor(ratio * visibleProvinces.length)
    const province = visibleProvinces[index]?.name
    if (province && (force || province !== activeProvinceRef.current)) {
      scrollToProvince(province, 'auto', false)
    }
  }

  const handleIndexPointerDown = (event) => {
    if (event.pointerType === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
    isIndexDragging.current = true
    window.clearTimeout(indexBubbleTimer.current)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    scrollByPointer(event, true)
  }

  const handleIndexPointerMove = (event) => {
    if (!isIndexDragging.current) return
    event.preventDefault()
    scrollByPointer(event)
  }

  const handleIndexPointerUp = (event) => {
    if (!isIndexDragging.current) return
    isIndexDragging.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    hideIndexBubbleSoon()
  }

  if (loading) {
    return <div className="state-panel" role="status" aria-label="正在加载城市"><Spin size="large" /></div>
  }

  if (stats.length === 0) {
    return (
      <div className="state-panel state-panel-empty">
        <div className="state-panel-icon"><DatabaseOutlined /></div>
        <h2 className="state-panel-title">暂无地址数据</h2>
        <p className="state-panel-desc">管理员可在控制台导入地址。</p>
      </div>
    )
  }

  if (visibleProvinces.length === 0) {
    return (
      <div className="state-panel state-panel-empty">
        <div className="state-panel-icon"><SearchOutlined /></div>
        <h2 className="state-panel-title">没有找到相关城市</h2>
      </div>
    )
  }

  const hasProvinceIndex = visibleProvinces.length > 1

  return (
    <>
      <div className={`city-grid-wrap${hasProvinceIndex ? ' city-grid-wrap--indexed' : ''}`}>
        {hasProvinceIndex && (
          <nav
            ref={indexRef}
            className="province-index"
            aria-label="省份索引"
            onTouchStart={event => event.stopPropagation()}
            onPointerDown={handleIndexPointerDown}
            onPointerMove={handleIndexPointerMove}
            onPointerUp={handleIndexPointerUp}
            onPointerCancel={handleIndexPointerUp}
          >
            {visibleProvinces.map(({ name: prov }) => (
              <button
                key={prov}
                type="button"
                className={`province-index-item${prov === activeProvince ? ' is-active' : ''}`}
                title={prov}
                aria-label={prov}
                onClick={() => scrollToProvince(prov, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')}
              >
                {provinceIndexLabel(prov)}
              </button>
            ))}
          </nav>
        )}
        {showIndexBubble && activeProvince && (
          <div className="province-index-bubble" aria-hidden="true">
            {activeProvince}
          </div>
        )}

        <div className="province-sections">
          {visibleProvinces.map(({ name: prov, cities }, index) => (
            <section key={prov} ref={node => { provinceRefs.current[prov] = node }} className="province-section">
              <div className="province-heading">
                <h2 className="province-name">{prov}</h2>
                <span className="province-count">
                  {cities.length} 个城市 · {cities.reduce((total, { count }) => total + count, 0).toLocaleString('zh-CN')} 条地址
                </span>
              </div>
              <div className="city-card-grid">
                {cities.map(({ city, count }) => (
                  <CityCard
                    key={city}
                    city={city}
                    count={count}
                    tone={['blue', 'teal', 'violet'][index % 3]}
                    onClick={() => {
                      setSelected({ city, province: prov })
                      trackEvent(readableEventName('打开城市', city), {
                        event_type: 'city_detail_open',
                        city,
                        province: prov,
                        address_count: count,
                      })
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
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
