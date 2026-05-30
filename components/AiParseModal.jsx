'use client'
import React, { useState, useRef, useEffect } from 'react'
import {
  Modal, Button, Progress, Steps, Table, Tag, Space,
  Typography, Alert, Statistic, Row, Col, Tooltip, App, Radio
} from 'antd'
import {
  RobotOutlined, CheckCircleOutlined, LoadingOutlined,
  EyeOutlined, ImportOutlined, StopOutlined, WarningOutlined, DatabaseOutlined
} from '@ant-design/icons'
import useDataStore from '@/store/useDataStore'
import { useBodyScrollLock } from '@/utils/useBodyScrollLock'

const { Text, Title } = Typography

const previewColumns = [
  { title: '省', dataIndex: 'province', width: 70, render: v => <Text style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{v || '-'}</Text> },
  { title: '市', dataIndex: 'city', width: 80, render: v => <Text style={{ color: 'var(--color-primary-light)', fontWeight: 600 }}>{v || '-'}</Text> },
  { title: '区', dataIndex: 'district', width: 90, render: v => v ? <Tag color="purple">{v}</Tag> : <Text style={{ color: 'var(--text-muted)' }}>-</Text> },
  {
    title: '详细地址', dataIndex: 'address', ellipsis: true,
    render: v => <Tooltip title={v} placement="topLeft"><Text style={{ color: 'var(--text-primary)', fontSize: 13 }}>{v || '-'}</Text></Tooltip>
  },
  {
    title: '标签', key: 'tags', width: 220,
    render: (_, r) => (
      <Space size={4} wrap>
        {r.industry && <Tag color="cyan">{r.industry}</Tag>}
        {r.source   && <Tag color="red">{r.source}</Tag>}
        {r.status   && <Tag color="green">{r.status}</Tag>}
      </Space>
    )
  },
]

export default function AiParseModal({ open, onClose, onImported }) {
  const { rawRows, settings, clearRawRows } = useDataStore()
  const { message } = App.useApp()

  const [step, setStep] = useState(0)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [parsedRows, setParsedRows] = useState([])
  const [error, setError] = useState('')
  const [importMode, setImportMode] = useState('append') // 'append' | 'replace'
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
      setError('请先在右上角「设置」填写 API 地址和密钥')
      return
    }
    setError(''); setStep(1)
    abortRef.current = false

    const batchSize = settings.batchSize || 40
    const results = []
    let done = 0

    try {
      const totalBatches = Math.ceil(rawRows.length / batchSize)
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
    } catch (e) {
      requestRef.current = null
      if (e.name === 'AbortError' || e.message === '已取消') {
        setStep(0)
        setError('已取消解析')
      } else {
        setError(e.message)
        setStep(0)
      }
    }
  }

  const handleCancelParsing = () => {
    abortRef.current = true
    requestRef.current?.abort()
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
      message.success(`✅ 成功写入数据库 ${data.inserted} 条！`)
      clearRawRows()
      setStep(0)
      onClose()
      onImported?.()
    } catch (e) {
      message.error('写入失败：' + e.message)
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      title={<Space><RobotOutlined style={{ color: 'var(--color-primary-light)' }} /><span style={{ color: 'var(--text-primary)' }}>AI 智能解析</span><Tag color="purple" style={{ borderRadius: 20 }}>{settings.model}</Tag></Space>}
      open={open}
      onCancel={step === 1 ? undefined : onClose}
      closable={step !== 1} maskClosable={step !== 1}
      footer={null}
      width={step === 2 ? 920 : 520}
      wrapClassName="app-modal-wrap"
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24, marginTop: 8 }}
        items={[
          { title: '待解析', icon: <RobotOutlined /> },
          { title: '解析中', icon: step === 1 ? <LoadingOutlined /> : <RobotOutlined /> },
          { title: '预览确认', icon: <EyeOutlined /> },
        ]}
      />

      {/* Step 0 */}
      {step === 0 && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Row gutter={24} style={{ marginBottom: 20 }}>
            <Col span={12}>
              <Statistic title="待解析行数" value={rawRows.length} suffix="条" valueStyle={{ color: 'var(--color-primary-light)' }} />
            </Col>
            <Col span={12}>
              <Statistic title="预计批次" value={Math.ceil(rawRows.length / (settings.batchSize || 40))} suffix="批" valueStyle={{ color: 'var(--color-accent)' }} />
            </Col>
          </Row>

          {error && <Alert message={error} type="error" showIcon icon={<WarningOutlined />} style={{ marginBottom: 16, textAlign: 'left' }} />}

          <Alert
            style={{ marginBottom: 20, textAlign: 'left' }}
            message="AI 将自动处理以下内容"
            description={<ul style={{ paddingLeft: 16, margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 2 }}><li>从地址字段提取省、市、区层级信息</li><li>清洗地址，去除冗余前缀</li><li>保留行业、来源、状态等字段</li></ul>}
            type="info" showIcon
          />

          <Button type="primary" size="large" icon={<RobotOutlined />} onClick={handleStart}
            disabled={rawRows.length === 0} style={{ width: '100%', height: 48, fontSize: 15 }}>
            开始 AI 解析（{rawRows.length} 条）
          </Button>
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <DatabaseOutlined style={{ fontSize: 34, color: 'var(--color-primary-light)', marginBottom: 16 }} />
          <Title level={4} style={{ color: 'var(--text-primary)', marginBottom: 8 }}>正在解析数据...</Title>
          <Text style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 20 }}>
            已完成 {progress.done} / {progress.total} 条
            {currentBatch.total > 0 && ` · 第 ${currentBatch.index} / ${currentBatch.total} 批`}
          </Text>
          <Progress percent={pct} strokeColor={{ '0%': '#6c63ff', '100%': '#00d2ff' }} trailColor="var(--color-surface2)" style={{ marginBottom: 20 }} />
          <Button danger icon={<StopOutlined />} onClick={handleCancelParsing} style={{ background: 'transparent' }}>取消解析</Button>
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <div>
          <Row gutter={12} style={{ marginBottom: 16 }}>
            {[
              { label: '总条数', value: parsedRows.length, color: 'var(--color-primary-light)', bg: 'rgba(108,99,255,0.08)', border: 'rgba(108,99,255,0.2)' },
              { label: '城市数', value: new Set(parsedRows.map(r => r.city).filter(Boolean)).size, color: 'var(--color-accent)', bg: 'rgba(0,210,255,0.06)', border: 'rgba(0,210,255,0.15)' },
              { label: '省份数', value: new Set(parsedRows.map(r => r.province).filter(Boolean)).size, color: '#5eeba8', bg: 'rgba(46,213,115,0.06)', border: 'rgba(46,213,115,0.15)' },
              { label: '待确认', value: parsedRows.filter(r => !r.city).length, color: '#ff9b9b', bg: 'rgba(255,107,107,0.06)', border: 'rgba(255,107,107,0.15)' },
            ].map(s => (
              <Col span={6} key={s.label}>
                <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              </Col>
            ))}
          </Row>

          <Table dataSource={parsedRows.map((r, i) => ({ ...r, key: i }))} columns={previewColumns}
            size="small" scroll={{ x: 700, y: 320 }}
            pagination={{ pageSize: 50, showSizeChanger: false, showTotal: t => `共 ${t} 条` }}
            style={{ marginBottom: 16 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: 13, marginRight: 12 }}>写入方式：</span>
              <Radio.Group value={importMode} onChange={e => setImportMode(e.target.value)} size="small">
                <Radio.Button value="append">追加到现有数据</Radio.Button>
                <Radio.Button value="replace">替换全部数据</Radio.Button>
              </Radio.Group>
            </div>
            <Space>
              <Button onClick={() => setStep(0)}>重新解析</Button>
              <Button type="primary" icon={<ImportOutlined />} size="large" onClick={handleConfirm} style={{ minWidth: 140 }}>
                确认写入数据库
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}
