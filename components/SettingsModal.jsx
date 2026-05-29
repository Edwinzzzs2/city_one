'use client'
import React, { useState } from 'react'
import { Modal, Form, Input, Select, Slider, Button, Alert, Divider, Space } from 'antd'
import { SettingOutlined, KeyOutlined, LinkOutlined } from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
const PRESET_MODELS = ['gpt-5.5','gpt-5.4','gpt-5.2-pro','gpt-5.2','gpt-5.4-mini','gpt-4o','gpt-4o-mini']


export default function SettingsModal({ open, onClose }) {
  const { settings, updateSettings } = useDataStore()
  const [form] = Form.useForm()
  const [batchVal, setBatchVal] = useState(settings.batchSize || 40)

  const handleOk = () => {
    form.validateFields().then(values => {
      updateSettings({ ...values, batchSize: batchVal })
      onClose()
    })
  }

  return (
    <Modal
      title={<Space><SettingOutlined style={{ color: 'var(--color-primary-light)' }} /><span style={{ color: 'var(--text-primary)' }}>AI 配置</span></Space>}
      open={open} onCancel={onClose} onOk={handleOk} okText="保存" cancelText="取消" width={480}
    >
      <Alert
        style={{ marginBottom: 20, marginTop: 8 }}
        message="API 密钥安全说明"
        description="请求由 Next.js 服务端发出，浏览器不会直接接触 sub2api，无跨域问题。密钥保存在你的浏览器本地。"
        type="info" showIcon
      />
      <Form form={form} layout="vertical" initialValues={settings} requiredMark={false}>
        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>API 接入地址</span>}
          name="apiBaseUrl" rules={[{ required: true, message: '请填写 API 地址' }]}
          extra={<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>例：https://your.sub2api.com/v1</span>}
        >
          <Input prefix={<LinkOutlined />} placeholder="https://your.sub2api.com/v1" />
        </Form.Item>

        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>API 密钥</span>}
          name="apiKey" rules={[{ required: true, message: '请填写密钥' }]}
        >
          <Input.Password prefix={<KeyOutlined />} placeholder="sk-xxxxxxxxxxxxxxxx" />
        </Form.Item>

        <Form.Item label={<span style={{ color: 'var(--text-secondary)' }}>模型</span>} name="model">
          <Select showSearch options={PRESET_MODELS.map(m => ({ label: m, value: m }))} />
        </Form.Item>

        <Divider style={{ borderColor: 'var(--color-border)', margin: '12px 0' }} />

        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>每批条数 ({batchVal} 条)</span>}
          extra={<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>建议 30-50，过大可能超出模型 Token 限制</span>}
        >
          <Slider min={10} max={100} step={10} value={batchVal} onChange={setBatchVal} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
