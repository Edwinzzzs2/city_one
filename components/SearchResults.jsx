'use client'
import React from 'react'
import { Spin } from 'antd'
import { SearchOutlined, ShopOutlined, UserOutlined } from '@ant-design/icons'
import { renderHighlight } from '@/utils/fuzzy'
import CopyableAddress from './CopyableAddress'

function Highlight({ value, query }) {
  return <>{renderHighlight(value, query, React)}</>
}

export default function SearchResults({ query, rows, loading }) {
  const count = rows.length.toLocaleString('zh-CN')

  return (
    <section className="search-results" aria-labelledby="search-results-title" aria-busy={loading}>
      <div className="search-results-head">
        <h1 id="search-results-title">搜索结果</h1>
        {!loading && <p>“{query}” · {count} 条地址</p>}
      </div>

      {loading ? (
        <div className="state-panel" role="status" aria-label="正在搜索地址"><Spin size="large" /></div>
      ) : rows.length === 0 ? (
        <div className="state-panel state-panel-empty">
          <div className="state-panel-icon"><SearchOutlined /></div>
          <h2 className="state-panel-title">没有找到相关地址</h2>
          <p className="state-panel-desc">试试其他搜索词。</p>
        </div>
      ) : (
        <ul className="address-list">
          {rows.map((item, index) => {
            const region = [item.province, item.city, item.district].filter(Boolean).join(' / ')

            return (
              <li key={item.id ?? index} className="address-row">
                <CopyableAddress address={item.address} className="copyable-address result-address">
                  <Highlight value={item.address || '未填写地址'} query={query} />
                </CopyableAddress>
                {region && <div className="address-row-region"><Highlight value={region} query={query} /></div>}
                <div className="address-row-meta">
                  {item.name && (
                    <span className="address-meta-chip"><UserOutlined /><Highlight value={item.name} query={query} /></span>
                  )}
                  {item.company && (
                    <span className="address-meta-chip"><ShopOutlined /><Highlight value={item.company} query={query} /></span>
                  )}
                  {[item.industry, item.status, item.source].map((value, metaIndex) => value && (
                    <span className="address-meta-chip" key={metaIndex}><Highlight value={value} query={query} /></span>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && rows.length >= 500 && (
        <p className="search-results-note">当前最多显示 500 条结果，可以输入更具体的关键词缩小范围。</p>
      )}
    </section>
  )
}
