'use client'
import React, { useState, useEffect } from 'react'
import { Drawer, Input, List, Tag, Space, Typography, Empty, Spin } from 'antd'
import { SearchOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { fuzzyFilter, renderHighlight } from '@/utils/fuzzy'

const { Text } = Typography

function MetaTag({ color, bg, border, children }) {
  if (!children) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, color, background: bg, border: `1px solid ${border}` }}>
      {children}
    </span>
  )
}

export default function CityDetail({ city, province, open, onClose }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && city) {
      setLoading(true)
      setQ('')
      fetch(`/api/addresses?city=${encodeURIComponent(city)}`)
        .then(r => r.json())
        .then(d => { setRows(d.rows || []) })
        .catch(() => setRows([]))
        .finally(() => setLoading(false))
    }
  }, [open, city])

  const filtered = fuzzyFilter(rows, q, ['address', 'district', 'industry', 'name', 'company'])

  return (
    <Drawer
      title={
        <Space>
          <span style={{ fontSize: 20 }}>🏙️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', lineHeight: 1.2 }}>{city}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>{province} · {rows.length} 条地址</div>
          </div>
        </Space>
      }
      placement="right" onClose={() => { setQ(''); onClose() }} open={open}
      width={Math.min(540, typeof window !== 'undefined' ? window.innerWidth : 540)}
      styles={{
        body: { padding: 0, background: 'var(--color-bg2)' },
        header: { background: 'var(--color-bg2)', borderBottom: '1px solid var(--color-border)', padding: '16px 20px' },
        mask: { backdropFilter: 'blur(4px)' },
      }}
    >
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg2)' }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
          placeholder="搜索此城市内的地址..."
          value={q} onChange={e => setQ(e.target.value)} allowClear
        />
        {q && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>找到 <span style={{ color: 'var(--color-primary-light)', fontWeight: 600 }}>{filtered.length}</span> 条</div>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}><Spin size="large" /></div>
      ) : filtered.length === 0 ? (
        <Empty description={<span style={{ color: 'var(--text-muted)' }}>{q ? '未找到匹配地址' : '暂无数据'}</span>} style={{ padding: '48px 0' }} />
      ) : (
        <List
          dataSource={filtered}
          renderItem={(item) => (
            <List.Item
              style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexDirection: 'column', alignItems: 'flex-start', transition: 'background 0.2s', cursor: 'default' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 8, width: '100%' }}>
                <EnvironmentOutlined style={{ color: 'var(--color-primary-light)', marginRight: 6, fontSize: 12 }} />
                {q ? renderHighlight(item.address, q, React) : item.address}
              </div>
              {(item.name || item.company) && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {item.name && <span style={{ marginRight: 8 }}>👤 {item.name}</span>}
                  {item.company && <span>🏢 {item.company}</span>}
                </div>
              )}
              <Space size={6} wrap>
                {item.district && <MetaTag color="#a29bff" bg="rgba(108,99,255,0.1)" border="rgba(108,99,255,0.2)">📍 {item.district}</MetaTag>}
                {item.industry && <MetaTag color="#5ee8ff" bg="rgba(0,210,255,0.07)" border="rgba(0,210,255,0.15)">🏢 {item.industry}</MetaTag>}
                {item.source   && <MetaTag color="#ff9b9b" bg="rgba(255,107,107,0.07)" border="rgba(255,107,107,0.15)">👤 {item.source}</MetaTag>}
                {item.status   && <MetaTag color="#5eeba8" bg="rgba(46,213,115,0.07)" border="rgba(46,213,115,0.15)">✅ {item.status}</MetaTag>}
                {item.phone    && <MetaTag color="var(--text-muted)" bg="transparent" border="var(--color-border)">📞 {item.phone}</MetaTag>}
              </Space>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}
