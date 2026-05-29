import { NextResponse } from 'next/server'
import { getAISettings, setSetting } from '@/lib/db'

const MASKED_KEY = '********'

function publicSettings(settings) {
  const hasApiKey = Boolean(settings.apiKey)
  return {
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: hasApiKey ? MASKED_KEY : '',
    hasApiKey,
    model: settings.model,
    batchSize: settings.batchSize,
  }
}

export async function GET() {
  try {
    const settings = await getAISettings()
    return NextResponse.json({ ok: true, settings: publicSettings(settings) })
  } catch (e) {
    console.error('[GET /api/settings]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const current = await getAISettings()

    const apiBaseUrl = String(body.apiBaseUrl || '').trim()
    const model = String(body.model || 'gpt-5.5').trim()
    const batchSize = Math.min(100, Math.max(10, Number(body.batchSize || 40) || 40))
    const apiKeyInput = String(body.apiKey || '').trim()
    const apiKey = apiKeyInput && apiKeyInput !== MASKED_KEY ? apiKeyInput : current.apiKey

    if (!apiBaseUrl) {
      return NextResponse.json({ ok: false, error: '请填写 API 地址' }, { status: 400 })
    }
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: '请填写 API 密钥' }, { status: 400 })
    }

    await setSetting('ai_api_base_url', apiBaseUrl)
    await setSetting('ai_api_key', apiKey)
    await setSetting('ai_model', model)
    await setSetting('ai_batch_size', String(batchSize))

    return NextResponse.json({
      ok: true,
      settings: publicSettings({ apiBaseUrl, apiKey, model, batchSize }),
    })
  } catch (e) {
    console.error('[POST /api/settings]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
