'use client'
import { useEffect, useState } from 'react'
import { Alert, App, Form, Input, Modal, Select, Slider } from 'antd'
import { SettingOutlined, KeyOutlined, LinkOutlined } from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { useBodyScrollLock } from '@/utils/useBodyScrollLock'
import { readableEventName, trackEvent } from '@/utils/analytics'
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
      title={(
        <div className="dialog-title">
          <span className="dialog-title-icon"><SettingOutlined aria-hidden="true" /></span>
          <span>AI 配置</span>
        </div>
      )}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      width={460}
      centered
      confirmLoading={saving}
      className="apple-dialog"
      classNames={{ wrapper: 'apple-dialog-wrap', mask: 'apple-dialog-mask' }}
    >
      <Alert
        className="dialog-notice"
        message="配置保存在服务端，API 密钥仅供服务端调用。"
        type="info"
        showIcon
      />
      <Form className="settings-form" form={form} layout="vertical" initialValues={settings} requiredMark={false} size="large">
        <Form.Item
          label="API 接入地址"
          name="apiBaseUrl"
          rules={[{ required: true, message: '请填写 API 地址' }]}
        >
          <Input prefix={<LinkOutlined />} placeholder="https://your.sub2api.com/v1" inputMode="url" />
        </Form.Item>

        <Form.Item
          label="API 密钥"
          name="apiKey"
          rules={[
            {
              validator: (_, value) => {
                if (value || settings.hasApiKey) return Promise.resolve()
                return Promise.reject(new Error('请填写密钥'))
              },
            },
          ]}
          extra={settings.hasApiKey ? '已保存密钥。输入新密钥即可替换。' : undefined}
        >
          <Input.Password prefix={<KeyOutlined />} placeholder="sk-xxxxxxxxxxxxxxxx" autoComplete="off" />
        </Form.Item>

        <Form.Item label="模型" name="model">
          <Select showSearch options={PRESET_MODELS.map(m => ({ label: m, value: m }))} />
        </Form.Item>

        <Form.Item
          label={`每批 ${batchVal} 条`}
          extra="建议每批 30 至 50 条。"
        >
          <Slider ariaLabelForHandle="每批条数" min={10} max={100} step={10} value={batchVal} onChange={setBatchVal} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
