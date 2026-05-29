'use client'
import React, { useState, useMemo } from 'react'
import { Spin } from 'antd'
import { EnvironmentOutlined } from '@ant-design/icons'
import { fuzzyMatch } from '@/utils/fuzzy'
import CityDetail from './CityDetail'

function cityInitial(name) {
  return String(name || '城').trim().slice(0, 1)
}

function CityCard({ city, count, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? 'var(--color-surface2)' : 'var(--color-surface)',
        border: `1px solid ${hov ? 'color-mix(in srgb,var(--color-primary) 44%,var(--color-border))' : 'var(--color-border)'}`,
        borderRadius: 8, padding: 10, cursor: 'pointer',
        transition: 'all 0.22s cubic-bezier(0.4,0,0.2,1)',
        transform: hov ? 'translateY(-2px)' : 'none',
        boxShadow: hov ? 'var(--shadow-hover)' : 'none',
        display: 'flex', alignItems: 'center', gap: 10,
        minHeight: 58,
        outline: 'none', position: 'relative', overflow: 'hidden',
      }}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'color-mix(in srgb,var(--color-primary) 10%,var(--color-surface))', border: '1px solid color-mix(in srgb,var(--color-primary) 22%,var(--color-border))', color: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, position: 'relative', zIndex: 1, flexShrink: 0 }}>
        {cityInitial(city)}
      </div>
      <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>{city}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <EnvironmentOutlined style={{ color: 'var(--text-muted)', fontSize: 11 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}>{count}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>条地址</span>
        </div>
      </div>
    </div>
  )
}

export default function CityGrid({ stats, loading, searchQuery }) {
  const [selected, setSelected] = useState(null)

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
      <div className="city-grid-wrap" style={{ padding: '0 16px 80px' }}>
        {provinces.map(prov => {
          const cities = (provinceMap[prov] || []).filter(c => !searchQuery || fuzzyMatch(c.city, searchQuery))
          if (cities.length === 0) return null
          const totalInProv = cities.reduce((s, c) => s + c.count, 0)

          return (
            <div key={prov} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px 12px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px' }}>{prov}</span>
                <span style={{ fontSize: 11, color: 'var(--color-primary-light)', fontWeight: 600 }}>· {cities.length} 城市 · {totalInProv} 条</span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
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
