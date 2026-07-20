import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/auth'
import { recordAmapUsage, recordMapSearchLog } from '@/lib/db'

function safeNumber(value, fallback = 0, max = 120000) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.min(Math.trunc(number), max)
}

export async function POST(request) {
  const user = await getAppUser()
  if (!user) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    const keywords = String(body?.keywords || '').trim()
    if (!keywords) {
      return NextResponse.json({ ok: false, error: '缺少搜索关键词' }, { status: 400 })
    }

    const status = body?.status === 'success' ? 'success' : 'error'
    const attempts = Math.max(1, safeNumber(body?.attempts, 1, 2))
    await recordAmapUsage('place_search', attempts)
    await recordMapSearchLog({
      userId: user.id,
      username: user.username,
      keywords,
      city: body?.city,
      status,
      httpStatus: status === 'success' ? 200 : 502,
      resultCount: status === 'success' ? safeNumber(body?.resultCount, 0, 1000) : null,
      durationMs: safeNumber(body?.durationMs),
      errorMessage: status === 'error' ? body?.errorMessage : null,
      errorCode: status === 'error' ? body?.errorCode : null,
      errorDetail: `source=browser_amap_js; attempts=${attempts}`,
      requestId: request.headers.get('x-vercel-id') || request.headers.get('x-request-id'),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/place-search/log]', error)
    return NextResponse.json({ ok: false, error: '地图搜索日志写入失败' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
