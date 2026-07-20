import { NextResponse } from 'next/server'
import { searchPlaces } from '@/lib/amap'
import { getAppUser } from '@/lib/auth'
import { recordMapSearchLog } from '@/lib/db'

function errorDiagnostics(error) {
  const rootCause = error?.cause
  const causes = Array.isArray(rootCause?.errors) ? rootCause.errors : [rootCause]
  const codes = [...new Set(causes.map(cause => cause?.code).filter(Boolean))]
  const details = causes
    .filter(Boolean)
    .map(cause => [cause?.name, cause?.code, cause?.message].filter(Boolean).join(': '))
    .filter(Boolean)

  return {
    code: codes.join(', ') || rootCause?.code || null,
    detail: details.join(' | ') || rootCause?.message || null,
  }
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
    const errorMessage = e?.message || String(e)
    await writeSearchLog({
      userId: user.id,
      username: user.username,
      keywords: body?.keywords || body?.q,
      city: body?.city,
      status: 'error',
      httpStatus: 400,
      durationMs: Date.now() - startedAt,
      errorMessage,
      errorCode: diagnostics.code,
      errorDetail: diagnostics.detail,
      requestId,
    })
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 400 })
  }
}
export const dynamic = 'force-dynamic'
