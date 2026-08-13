import { NextResponse } from 'next/server'
import { query, initDB } from '@/lib/db'
import { getAdminUser, getAppUser } from '@/lib/auth'
import { geocodeAddress, getAmapWebServiceKey } from '@/lib/amap'

const RETRYABLE_LIMIT_ERRORS = new Set([
  'CUQPS_HAS_EXCEEDED_THE_LIMIT',
  'CQPS_HAS_EXCEEDED_THE_LIMIT',
  'QPS_HAS_EXCEEDED_THE_LIMIT',
  'USER_VISIT_TOO_FREQUENTLY',
])
const MISSING_LOCATION = '(lng IS NULL OR lat IS NULL OR (lng = 0 AND lat = 0))'

function clampBatchSize(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 20
  return Math.max(1, Math.min(50, Math.floor(number)))
}

function clampDelay(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 450
  return Math.max(0, Math.min(2000, Math.floor(number)))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shortStatus(prefix, message) {
  return `${prefix}:${String(message || '').slice(0, 66)}`
}

function isRetryableLimitError(message) {
  return RETRYABLE_LIMIT_ERRORS.has(String(message || '').trim())
}

function retryableFilter(retryFailed) {
  if (retryFailed) return ''

  return `
    AND (
      geocode_status IS NULL
      OR geocode_status NOT LIKE 'failed:%'
      OR geocode_status IN (
        'failed:CUQPS_HAS_EXCEEDED_THE_LIMIT',
        'failed:CQPS_HAS_EXCEEDED_THE_LIMIT',
        'failed:QPS_HAS_EXCEEDED_THE_LIMIT',
        'failed:USER_VISIT_TOO_FREQUENTLY'
      )
    )
  `
}

export async function POST(request) {
  if (!await getAdminUser()) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    await initDB()

    const body = await request.json().catch(() => ({}))
    const limit = clampBatchSize(body.limit)
    const delayMs = clampDelay(body.delayMs)
    const retryFailed = body.retryFailed === true

    if (!await getAmapWebServiceKey()) {
      return NextResponse.json({ ok: false, error: '缺少 AMAP_WEB_SERVICE_KEY' }, { status: 400 })
    }

    const failedFilter = retryableFilter(retryFailed)
    const pending = await query(
      `SELECT id, province, city, district, address
       FROM city_addresses
       WHERE ${MISSING_LOCATION}
         AND COALESCE(address, '') <> ''
         ${failedFilter}
       ORDER BY id
       LIMIT $1`,
      [limit]
    )

    let updated = 0
    let failed = 0
    let rateLimited = false
    const errors = []

    for (const row of pending.rows) {
      if (delayMs > 0) await sleep(delayMs)

      try {
        const point = await geocodeAddress(row)
        await query(
          `UPDATE city_addresses
           SET lng = $1,
               lat = $2,
               geocode_status = $3,
               geocode_level = $4,
               geocode_address = $5,
               geocode_at = NOW(),
               updated_at = NOW()
           WHERE id = $6`,
          [
            point.lng,
            point.lat,
            'ok',
            point.level || null,
            point.formattedAddress || null,
            row.id,
          ]
        )
        updated += 1
      } catch (e) {
        if (isRetryableLimitError(e.message)) {
          rateLimited = true
          if (errors.length < 5) {
            errors.push({ id: row.id, address: row.address, error: e.message })
          }
          await query(
            `UPDATE city_addresses
             SET geocode_status = $1,
                 geocode_at = NOW(),
                 updated_at = NOW()
             WHERE id = $2`,
            [shortStatus('failed', e.message), row.id]
          )
          break
        }

        failed += 1
        if (errors.length < 5) {
          errors.push({ id: row.id, address: row.address, error: e.message })
        }
        await query(
          `UPDATE city_addresses
           SET geocode_status = $1,
               geocode_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [shortStatus('failed', e.message), row.id]
        )
      }
    }

    const remaining = await query(
      `SELECT COUNT(*)::int AS count
       FROM city_addresses
       WHERE ${MISSING_LOCATION}
         AND COALESCE(address, '') <> ''
         ${failedFilter}`
    )

    return NextResponse.json({
      ok: true,
      requested: pending.rows.length,
      updated,
      failed,
      remaining: remaining.rows[0]?.count || 0,
      rateLimited,
      errors,
    })
  } catch (e) {
    console.error('[POST /api/addresses/geocode]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
export const dynamic = 'force-dynamic'
