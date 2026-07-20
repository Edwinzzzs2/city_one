import { NextResponse } from 'next/server'
import { searchPlaces } from '@/lib/amap'
import { getAppUser } from '@/lib/auth'
import { recordMapSearchLog } from '@/lib/db'

function errorDiagnostics(error) {
  const errors = []
  const visit = item => {
    if (!item || errors.includes(item)) return
    errors.push(item)
    visit(item.cause)
    if (Array.isArray(item.errors)) item.errors.forEach(visit)
  }
  visit(error)

  const codes = [...new Set(errors.map(item => item?.code).filter(Boolean))]
  const details = errors
    .map(item => [item?.name, item?.code, item?.message].filter(Boolean).join(': '))
    .filter(Boolean)

  return {
    code: codes.join(', ') || null,
    detail: details.join(' | ') || null,
  }
}

function responseForSearchError(error, diagnostics) {
  const codes = new Set(String(diagnostics.code || '').split(',').map(code => code.trim()).filter(Boolean))
  const timedOut = codes.has('AMAP_CONNECT_TIMEOUT')
    || codes.has('UND_ERR_CONNECT_TIMEOUT')
    || codes.has('ETIMEDOUT')
    || error?.name === 'TimeoutError'

  if (timedOut) {
    return { status: 504, message: '地图服务连接超时，请稍后重试' }
  }
  return { status: 400, message: error?.message || String(error) }
}

async function writeSearchLog(entry) {
  try {
    await recordMapSearchLog(entry)
  } catch (error) {
    console.error('[POST /api/place-search] log write failed', {
      message: error?.message,
      code: error?.code,
    })
  }
}

export async function POST(request) {
  const user = await getAppUser()
  if (!user) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })

  const startedAt = Date.now()
  const requestId = request.headers.get('x-vercel-id') || request.headers.get('x-request-id')
  let body = {}
  try {
    body = await request.json()
    const result = await searchPlaces(body)
    await writeSearchLog({
      userId: user.id,
      username: user.username,
      keywords: body?.keywords || body?.q,
      city: body?.city,
      status: 'success',
      httpStatus: 200,
      resultCount: result.pois?.length ?? result.count,
      durationMs: Date.now() - startedAt,
      requestId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const diagnostics = errorDiagnostics(e)
    const errorResponse = responseForSearchError(e, diagnostics)
    await writeSearchLog({
      userId: user.id,
      username: user.username,
      keywords: body?.keywords || body?.q,
      city: body?.city,
      status: 'error',
      httpStatus: errorResponse.status,
      durationMs: Date.now() - startedAt,
      errorMessage: errorResponse.message,
      errorCode: diagnostics.code,
      errorDetail: diagnostics.detail,
      requestId,
    })
    return NextResponse.json({ ok: false, error: errorResponse.message }, { status: errorResponse.status })
  }
}
export const dynamic = 'force-dynamic'
