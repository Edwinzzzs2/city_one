'use client'
import { useState, useRef, useEffect } from 'react'
import { Alert, App, Button, Modal, Progress, Radio, Space, Table, Tag, Tooltip } from 'antd'
import { ImportOutlined, RobotOutlined, StopOutlined } from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { useBodyScrollLock } from '@/utils/useBodyScrollLock'
import { readableEventName, trackEvent } from '@/utils/analytics'

const steps = ['等待解析', '解析数据', '预览确认']

const previewColumns = [
  { title: '省', dataIndex: 'province', width: 88, render: value => value || '—' },
  { title: '市', dataIndex: 'city', width: 88, render: value => <strong>{value || '—'}</strong> },
  { title: '区', dataIndex: 'district', width: 100, render: value => value || '—' },
  {
    title: '详细地址', dataIndex: 'address', ellipsis: true,
    render: value => <Tooltip title={value} placement="topLeft"><span>{value || '—'}</span></Tooltip>,
  },
  {
    title: '标签', key: 'tags', width: 220,
    render: (_, row) => (
      <Space size={4} wrap>
        {row.industry && <Tag bordered={false}>{row.industry}</Tag>}
        {row.source && <Tag bordered={false}>{row.source}</Tag>}
        {row.status && <Tag bordered={false}>{row.status}</Tag>}
      </Space>
    )
  },
]

function ParseStats({ items }) {
  return (
    <dl className="parse-stats">
      {items.map(({ label, value, unit }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}{unit && <span>{unit}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AiParseModal({ open, onClose, onImported }) {
  const { rawRows, settings, clearRawRows } = useDataStore()
  const { message } = App.useApp()

  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [parsedRows, setParsedRows] = useState([])
  const [error, setError] = useState('')
  const [importMode, setImportMode] = useState('append')
  const [currentBatch, setCurrentBatch] = useState({ index: 0, total: 0 })
  const abortRef = useRef(false)
  const requestRef = useRef(null)
  useBodyScrollLock(open)

  useEffect(() => {
    if (open) {
      setStep(0)
      setParsedRows([])
      setError('')
      setCurrentBatch({ index: 0, total: 0 })
      setProgress({ done: 0, total: rawRows.length })
    }
  }, [open, rawRows.length])

  const handleStart = async () => {
    if (!settings.apiBaseUrl || (!settings.apiKey && !settings.hasApiKey)) {
      setError('请先在控制台「系统配置」中填写 API 地址和密钥')
      return
    }
    setError(''); setStep(1)
    abortRef.current = false

    const batchSize = settings.batchSize || 40
    const results = []
    let done = 0

    try {
      const totalBatches = Math.ceil(rawRows.length / batchSize)
      trackEvent(readableEventName('开始 AI 解析', `${rawRows.length} 条`), {
        event_type: 'ai_parse_start',
        row_count: rawRows.length,
        batch_size: batchSize,
        batch_count: totalBatches,
      })
      setCurrentBatch({ index: 0, total: totalBatches })

      for (let i = 0; i < rawRows.length; i += batchSize) {
        if (abortRef.current) throw new Error('已取消')
        const batch = rawRows.slice(i, i + batchSize)
        const batchIndex = Math.floor(i / batchSize) + 1
        const controller = new AbortController()

        requestRef.current = controller
        setCurrentBatch({ index: batchIndex, total: totalBatches })

        const resp = await fetch('/api/ai-parse', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        })
        requestRef.current = null

        let data
        try {
          data = await resp.json()
        } catch {
          throw new Error(`AI 解析接口返回异常（HTTP ${resp.status}）`)
        }
        if (!resp.ok || !data.ok) throw new Error(data.error || `AI 解析接口错误（HTTP ${resp.status}）`)

        results.push(...data.rows)
        done += batch.length
        setProgress({ done, total: rawRows.length })
      }

      setParsedRows(results)
      setStep(2)
      trackEvent(readableEventName('完成 AI 解析', `${results.length} 条`), {
        event_type: 'ai_parse_finish',
        row_count: results.length,
        batch_count: totalBatches,
      })
    } catch (e) {
      requestRef.current = null
      if (e.name === 'AbortError' || e.message === '已取消') {
        setStep(0)
        setError('已取消解析')
        trackEvent(readableEventName('取消 AI 解析', `${rawRows.length} 条`), {
          event_type: 'ai_parse_cancel',
          row_count: rawRows.length,
        })
      } else {
        setError(e.message)
        setStep(0)
        trackEvent(readableEventName('AI 解析失败', `${rawRows.length} 条`), {
          event_type: 'ai_parse_error',
          row_count: rawRows.length,
        })
      }
    }
  }

  const handleCancelParsing = () => {
    abortRef.current = true
    requestRef.current?.abort()
    trackEvent(readableEventName('点击', '取消 AI 解析'), {
      event_type: 'operation_click',
      operation: 'ai_parse_cancel',
      done: progress.done,
      total: progress.total,
    })
  }

  const handleConfirm = async () => {
    try {
      const resp = await fetch('/api/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows, mode: importMode }),
      })
      const data = await resp.json()
      if (!data.ok) throw new Error(data.error)
      trackEvent(readableEventName('确认写入数据', `${parsedRows.length} 条`), {
        event_type: 'ai_import_confirm',
        mode: importMode,
        row_count: parsedRows.length,
        city_count: new Set(parsedRows.map(r => r.city).filter(Boolean)).size,
        inserted: data.inserted,
      })
      message.success(`已写入 ${data.inserted} 条地址`)
      clearRawRows()
      setStep(0)
      onClose()
      onImported?.()
    } catch (e) {
      trackEvent(readableEventName('写入数据失败', `${parsedRows.length} 条`), {
        event_type: 'ai_import_error',
        mode: importMode,
        row_count: parsedRows.length,
      })
      message.error('写入失败：' + e.message)
    }
  }

  const parsing = step === 1
  const preview = step === 2
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      title={(
        <div className="dialog-title">
          <span className="dialog-title-icon"><RobotOutlined aria-hidden="true" /></span>
          <span>AI 智能解析</span>
          {settings.model && <span className="parse-model">{settings.model}</span>}
        </div>
      )}
      open={open}
      onCancel={parsing ? undefined : onClose}
      closable={!parsing}
      maskClosable={!parsing}
      keyboard={!parsing}
      centered
      footer={preview ? (
        <div className="parse-footer">
          <div className="parse-mode">
            <span id="parse-import-mode">写入方式</span>
            <Radio.Group
              role="radiogroup"
              aria-labelledby="parse-import-mode"
              value={importMode}
              onChange={event => setImportMode(event.target.value)}
            >
              <Radio.Button value="append">追加到现有数据</Radio.Button>
              <Radio.Button value="replace">替换全部数据</Radio.Button>
            </Radio.Group>
          </div>
          <div className="parse-actions">
            <Button onClick={() => setStep(0)}>重新解析</Button>
            <Button type="primary" icon={<ImportOutlined />} onClick={handleConfirm}>确认写入数据库</Button>
          </div>
        </div>
      ) : null}
      width={preview ? 920 : 520}
      className="apple-dialog"
      classNames={{ wrapper: 'apple-dialog-wrap', mask: 'apple-dialog-mask' }}
    >
      <ol className="parse-steps" aria-label="解析步骤">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step}>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="parse-setup">
          <ParseStats items={[
            { label: '待解析行数', value: rawRows.length, unit: '条' },
            { label: '预计批次', value: Math.ceil(rawRows.length / (settings.batchSize || 40)), unit: '批' },
          ]} />
          {error && <Alert message={error} type="error" showIcon />}
          <Alert
            className="dialog-notice"
            message="AI 将提取省、市、区，清理地址前缀，并保留行业、来源、状态等字段。"
            type="info"
            showIcon
          />
          <Button type="primary" size="large" block onClick={handleStart} disabled={rawRows.length === 0}>
            开始解析
          </Button>
        </div>
      )}

      {parsing && (
        <div className="parse-progress">
          <h2>正在解析地址</h2>
          <p role="status">
            已完成 {progress.done} / {progress.total} 条
            {currentBatch.index > 0 && ` · 第 ${currentBatch.index} / ${currentBatch.total} 批`}
          </p>
          <Progress percent={pct} strokeColor="var(--accent)" trailColor="var(--bg)" />
          <Button danger icon={<StopOutlined />} onClick={handleCancelParsing}>取消解析</Button>
        </div>
      )}

      {preview && (
        <div className="parse-preview">
          <ParseStats items={[
            { label: '总条数', value: parsedRows.length },
            { label: '城市数', value: new Set(parsedRows.map(row => row.city).filter(Boolean)).size },
            { label: '省份数', value: new Set(parsedRows.map(row => row.province).filter(Boolean)).size },
            { label: '待确认', value: parsedRows.filter(row => !row.city).length },
          ]} />
          <Table
            className="parse-table"
            dataSource={parsedRows.map((row, index) => ({ ...row, key: index }))}
            columns={previewColumns}
            size="small"
            scroll={{ x: 720, y: 320 }}
            pagination={{ pageSize: 50, showSizeChanger: false, responsive: true, showTotal: total => `共 ${total} 条` }}
          />
        </div>
      )}
    </Modal>
  )
}
