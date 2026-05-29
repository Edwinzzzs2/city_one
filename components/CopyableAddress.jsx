'use client'
import React from 'react'
import { App, Tooltip } from 'antd'
import { CopyOutlined, EnvironmentOutlined } from '@ant-design/icons'

export default function CopyableAddress({ address, children, className, iconStyle }) {
  const { message } = App.useApp()
  const text = String(address || '').trim()

  const handleCopy = async (event) => {
    event.stopPropagation()
    if (!text) {
      message.warning('没有可复制的地址')
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      message.success('地址已复制')
    } catch {
      message.error('复制失败，请长按地址手动复制')
    }
  }

  return (
    <Tooltip title="点击复制地址">
      <button type="button" className={className || 'copyable-address'} onClick={handleCopy}>
        <EnvironmentOutlined className="copyable-address-pin" style={iconStyle} />
        <span className="copyable-address-text">{children || text}</span>
        <CopyOutlined className="copyable-address-copy" />
      </button>
    </Tooltip>
  )
}
