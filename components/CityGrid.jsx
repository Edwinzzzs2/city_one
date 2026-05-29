'use client'
import React, { useState, useEffect, useMemo } from 'react'
import { Spin, Empty, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { fuzzyMatch } from '@/utils/fuzzy'
import CityDetail from './CityDetail'

const EMOJIS = ['🏙️','🌆','🌇','🌃','🏛️','🏢','🗼','🏡','🌉','🗺️']
function cityEmoji(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return EMOJIS[h % EMOJIS.length]
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
        border: `1px solid ${hov ? 'rgba(108,99,255,0.4)' : 'var(--color-border)'}`,
        borderRadius: 16, padding: '16px 14px', cursor: 'pointer',
        transition: 'all 0.22s cubic-bezier(0.4,0,0.2,1)',
        transform: hov ? 'translateY(-3px) scale(1.01)' : 'none',
        boxShadow: hov ? '0 8px 28px rgba(108,99,255,0.15),0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 10,
        outline: 'none', position: 'relative', overflow: 'hidden',
      }}
    >
      {hov && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(108,99,255,0.08),rgba(0,210,255,0.04))', pointerEvents: 'none' }} />}
      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 4px 12px rgba(108,99,255,0.35)', position: 'relative', zIndex: 1, flexShrink: 0 }}>
        {cityEmoji(city)}
      </div>
      <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>{city}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 18, padding: '0 6px', background: 'rgba(108,99,255,0.18)', color: 'var(--color-primary-light)', borderRadius: 9, fontSize: 11, fontWeight: 700 }}>{count}</span>
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
      <div style={{ padding: '0 16px 80px' }}>
        {provinces.map(prov => {
          const cities = (provinceMap[prov] || []).filter(c => !searchQuery || fuzzyMatch(c.city, searchQuery))
          if (cities.length === 0) return null
          const totalInProv = cities.reduce((s, c) => s + c.count, 0)

          return (
            <div key={prov} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px 12px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px' }}>{prov}</span>
                <span style={{ fontSize: 11, color: 'rgba(108,99,255,0.5)', fontWeight: 600 }}>· {cities.length} 城市 · {totalInProv} 条</span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
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
