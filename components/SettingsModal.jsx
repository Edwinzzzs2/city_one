'use client'
import React, { useEffect, useState } from 'react'
import { Modal, Form, Input, Select, Slider, Button, Alert, Divider, Space } from 'antd'
import { SettingOutlined, KeyOutlined, LinkOutlined } from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { useBodyScrollLock } from '@/utils/useBodyScrollLock'
import { readableEventName, trackEvent } from '@/utils/analytics'
import { App } from 'antd'
const PRESET_MODELS = ['gpt-5.5','gpt-5.4','gpt-5.2-pro','gpt-5.2','gpt-5.4-mini','gpt-4o','gpt-4o-mini']


export default function SettingsModal({ open, onClose }) {
  const { settings, updateSettings } = useDataStore()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [batchVal, setBatchVal] = useState(settings.batchSize || 40)
  const [saving, setSaving] = useState(false)
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue(settings)
    setBatchVal(settings.batchSize || 40)
  }, [open, settings, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      await updateSettings({ ...values, batchSize: batchVal })
      trackEvent(readableEventName('保存设置', values.model), {
        event_type: 'settings_save',
        model: values.model,
        batch_size: batchVal,
        has_api_key: Boolean(values.apiKey || settings.hasApiKey),
      })
      message.success('AI 配置已保存')
      onClose()
    } catch (e) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={<Space><SettingOutlined style={{ color: 'var(--color-primary-light)' }} /><span style={{ color: 'var(--text-primary)' }}>AI 配置</span></Space>}
      open={open} onCancel={onClose} onOk={handleOk} okText="保存" cancelText="取消" width={420}
      confirmLoading={saving}
      className="settings-modal"
      wrapClassName="app-modal-wrap"
    >
      <Alert
        style={{ marginBottom: 14, marginTop: 4 }}
        message="配置保存到数据库，密钥仅服务端使用。"
        type="info" showIcon
      />
      <Form form={form} layout="vertical" initialValues={settings} requiredMark={false}>
        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>API 接入地址</span>}
          name="apiBaseUrl" rules={[{ required: true, message: '请填写 API 地址' }]}
          extra={<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>例：https://your.sub2api.com/v1</span>}
        >
          <Input prefix={<LinkOutlined />} placeholder="https://your.sub2api.com/v1" size="middle" />
        </Form.Item>

        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>API 密钥</span>}
          name="apiKey"
          rules={[
            {
              validator: (_, value) => {
                if (value || settings.hasApiKey) return Promise.resolve()
                return Promise.reject(new Error('请填写密钥'))
              },
            },
          ]}
          extra={<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>显示为 ********；重新输入可覆盖。</span>}
        >
          <Input.Password prefix={<KeyOutlined />} placeholder="sk-xxxxxxxxxxxxxxxx" size="middle" />
        </Form.Item>

        <Form.Item label={<span style={{ color: 'var(--text-secondary)' }}>模型</span>} name="model">
          <Select showSearch options={PRESET_MODELS.map(m => ({ label: m, value: m }))} />
        </Form.Item>

        <Divider style={{ borderColor: 'var(--color-border)', margin: '8px 0 12px' }} />

        <Form.Item
          label={<span style={{ color: 'var(--text-secondary)' }}>每批条数 ({batchVal} 条)</span>}
          extra={<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>建议 30-50。</span>}
        >
          <Slider min={10} max={100} step={10} value={batchVal} onChange={setBatchVal} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
