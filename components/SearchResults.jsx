'use client'
import React from 'react'
import { Empty, List, Space, Spin, Tag, Typography } from 'antd'
import { ShopOutlined, UserOutlined } from '@ant-design/icons'
import { renderHighlight } from '@/utils/fuzzy'
import CopyableAddress from './CopyableAddress'

const { Text } = Typography

function Highlight({ value, query }) {
  return <>{renderHighlight(value, query, React)}</>
}

function MetaTag({ icon, color, children }) {
  if (!children) return null
  return (
    <Tag
      color={color}
      style={{ marginInlineEnd: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {icon} {children}
    </Tag>
  )
}

export default function SearchResults({ query, rows, loading }) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: '56px 20px' }}>
        <Empty description={<span style={{ color: 'var(--text-muted)' }}>没有找到相关地址</span>} />
      </div>
    )
  }

  return (
    <section className="search-results">
      <div className="search-results-head">
        <span>搜索结果</span>
        <strong>{rows.length}</strong>
        <span>条</span>
      </div>

      <List
        dataSource={rows}
        renderItem={(item) => (
          <List.Item className="search-result-item">
            <div className="result-location">
              <div style={{ minWidth: 0 }}>
                <CopyableAddress address={item.address} className="copyable-address result-address">
                  <Highlight value={item.address || '未填写地址'} query={query} />
                </CopyableAddress>
                <div className="result-region">
                  {[item.province, item.city, item.district].filter(Boolean).map((part, index) => (
                    <React.Fragment key={`${part}-${index}`}>
                      {index > 0 && <span> / </span>}
                      <Highlight value={part} query={query} />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>

            <Space size={6} wrap className="result-tags">
              <MetaTag icon={<UserOutlined />} color="purple">
                {item.name && <Highlight value={item.name} query={query} />}
              </MetaTag>
              <MetaTag icon={<ShopOutlined />} color="cyan">
                {item.company && <Highlight value={item.company} query={query} />}
              </MetaTag>
              <MetaTag color="blue">
                {item.industry && <Highlight value={item.industry} query={query} />}
              </MetaTag>
              <MetaTag color="green">
                {item.status && <Highlight value={item.status} query={query} />}
              </MetaTag>
              <MetaTag color="red">
                {item.source && <Highlight value={item.source} query={query} />}
              </MetaTag>
            </Space>
          </List.Item>
        )}
      />

      {rows.length >= 500 && (
        <Text style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12, padding: '12px 20px 80px' }}>
          当前最多显示 500 条结果，可以输入更具体的关键词缩小范围。
        </Text>
      )}
    </section>
  )
}
