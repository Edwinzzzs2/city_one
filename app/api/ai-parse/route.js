import { NextResponse } from 'next/server'

const SYSTEM_PROMPT = `你是一个专业的数据清洗助手。我会给你从Excel表格中提取的原始数据行（JSON数组），请将每一行整理成标准格式。

需要提取的字段：
- province: 省份名称（如"浙江"，不含"省"字；直辖市填城市名如"北京"）
- city: 城市/地市名称（如"杭州"，不含"市"字；直辖市填城市名如"北京"）
- district: 区/县名称（如"西湖区"，可含"区/县"字）
- address: 详细地址（去掉省市前缀，只保留街道门牌之后的内容）
- industry: 所属行业（原样保留）
- source: 客户来源（原样保留）
- status: 状态（原样保留）
- name: 客户/机构名称（原样保留）
- company: 公司名称（原样保留）
- phone: 电话号码（原样保留）

提取规则：
1. city字段只填城市名，不含省份，例如填"杭州"不填"浙江省杭州市"
2. 如果address字段包含完整地址（如"广州市番禺区XX路XX号"），从中提取省市区填入对应字段，address只保留详细门牌地址
3. 如果某字段无法确定，填 null
4. 只返回JSON数组，不要任何说明文字和代码块标记`

/**
 * 从 SSE 流（text/event-stream）中提取 content 文本
 * 兼容 gpt-5.x 系列返回流式响应的情况
 */
async function readSSEContent(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const obj = JSON.parse(data)
        const delta = obj.choices?.[0]?.delta?.content
        if (delta) fullContent += delta
      } catch {
        // 忽略非 JSON 行
      }
    }
  }

  return fullContent
}

/**
 * 调用 AI，自动处理 JSON 和 SSE 两种响应格式
 */
async function callAI(url, apiKey, model, messages) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`AI API 错误 (${resp.status}): ${errText.slice(0, 300)}`)
  }

  const contentType = resp.headers.get('content-type') || ''

  if (contentType.includes('text/event-stream')) {
    // 流式 SSE 响应
    return await readSSEContent(resp)
  } else {
    // 普通 JSON 响应
    const data = await resp.json()
    return data.choices?.[0]?.message?.content || ''
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { rows, settings: clientSettings } = body

    // 服务端环境变量作为兜底默认值
    const settings = {
      apiBaseUrl: clientSettings?.apiBaseUrl || process.env.AI_API_BASE_URL || '',
      apiKey:     clientSettings?.apiKey     || process.env.AI_API_KEY     || '',
      model:      clientSettings?.model      || process.env.AI_MODEL       || 'gpt-5.5',
      batchSize:  clientSettings?.batchSize  || 40,
    }

    if (!settings.apiBaseUrl || !settings.apiKey) {
      return NextResponse.json(
        { ok: false, error: '未配置 API 地址或密钥，请在 App 设置中填写或在 .env.local 中配置' },
        { status: 400 }
      )
    }

    const { apiBaseUrl, apiKey, model, batchSize } = settings
    // 修复双斜杠
    const base = apiBaseUrl.replace(/\/+$/, '').replace(/\/\/v(\d)/, '/v$1')
    const url = `${base}/chat/completions`

    // 分批处理
    const batches = []
    for (let i = 0; i < rows.length; i += batchSize) {
      batches.push(rows.slice(i, i + batchSize))
    }

    const results = []

    for (const batch of batches) {
      const content = await callAI(url, apiKey, model, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: JSON.stringify(batch) },
      ])

      // 清理 Markdown 代码块包裹
      const cleaned = content
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim()

      try {
        const parsed = JSON.parse(cleaned)
        if (Array.isArray(parsed)) {
          results.push(...parsed)
        } else {
          results.push(...batch)
        }
      } catch {
        // JSON 解析失败，原样保留
        results.push(...batch)
      }
    }

    return NextResponse.json({ ok: true, rows: results })
  } catch (e) {
    console.error('[POST /api/ai-parse]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
