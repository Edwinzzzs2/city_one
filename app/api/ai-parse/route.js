import { NextResponse } from 'next/server'
import { getAISettings } from '@/lib/db'
import { getAppUser } from '@/lib/auth'

const AI_REQUEST_TIMEOUT_MS = 120_000

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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 4096,
        stream: false,
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
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`AI API 请求超时（${AI_REQUEST_TIMEOUT_MS / 1000} 秒），请检查 API 地址、模型名称或调小每批条数`)
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request) {
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    const body = await request.json()
    const { rows } = body
    const settings = await getAISettings()

    if (!settings.apiBaseUrl || !settings.apiKey) {
      return NextResponse.json(
        { ok: false, error: '未配置 API 地址或密钥，请在 AI 配置中填写' },
        { status: 400 }
      )
    }

    const { apiBaseUrl, apiKey, model, batchSize } = settings
    // 修复双斜杠
    const base = apiBaseUrl.replace(/\/+$/, '').replace(/\/\/v(\d)/, '/v$1')
    const url = `${base}/chat/completions`
    const safeUrl = (() => {
      try {
        const u = new URL(url)
        return `${u.origin}${u.pathname}`
      } catch {
        return url.replace(/\/\/([^/@]+@)?/, '//')
      }
    })()

    // 分批处理
    const batches = []
    for (let i = 0; i < rows.length; i += batchSize) {
      batches.push(rows.slice(i, i + batchSize))
    }

    const results = []

    console.log(`[POST /api/ai-parse] start rows=${rows.length} batches=${batches.length} batchSize=${batchSize} model=${model} url=${safeUrl}`)

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index]
      console.log(`[POST /api/ai-parse] batch ${index + 1}/${batches.length} sending rows=${batch.length}`)
      const content = await callAI(url, apiKey, model, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: JSON.stringify(batch) },
      ])
      console.log(`[POST /api/ai-parse] batch ${index + 1}/${batches.length} received chars=${content.length}`)

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
        console.warn(`[POST /api/ai-parse] batch ${index + 1}/${batches.length} returned non-JSON content, keeping original rows`)
        results.push(...batch)
      }
    }

    console.log(`[POST /api/ai-parse] done rows=${results.length}`)
    return NextResponse.json({ ok: true, rows: results })
  } catch (e) {
    console.error('[POST /api/ai-parse]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
export const dynamic = 'force-dynamic'
