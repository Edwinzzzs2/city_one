'use client'
import React from 'react'
import { App } from 'antd'
import { CopyOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { readableEventName, trackEvent } from '@/utils/analytics'

function fallbackCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

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
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else if (!fallbackCopy(text)) {
        throw new Error('fallback copy failed')
      }
      trackEvent(readableEventName('复制地址', text), {
        event_type: 'address_copy',
        surface: className || 'copyable-address',
        address_length: text.length,
      })
      message.success('地址已复制')
    } catch {
      try {
        if (!fallbackCopy(text)) throw new Error('fallback copy failed')
        trackEvent(readableEventName('复制地址', text), {
          event_type: 'address_copy',
          surface: className || 'copyable-address',
          address_length: text.length,
          fallback: true,
        })
        message.success('地址已复制')
      } catch {
        message.error('复制失败，请长按地址手动复制')
      }
    }
  }

  return (
    <button type="button" className={className || 'copyable-address'} onClick={handleCopy} aria-label="复制地址">
      <EnvironmentOutlined className="copyable-address-pin" style={iconStyle} />
      <span className="copyable-address-text">{children || text}</span>
      <CopyOutlined className="copyable-address-copy" />
    </button>
  )
}
