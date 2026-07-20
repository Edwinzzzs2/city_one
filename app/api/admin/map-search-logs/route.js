import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/auth'
import { transaction } from '@/lib/db'

const PAGE_SIZE = 20
const MAX_SEARCH_LENGTH = 100

function clampPage(value) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

export async function GET(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const searchParams = new URL(request.url).searchParams
    const page = clampPage(searchParams.get('page'))
    const status = ['success', 'error'].includes(searchParams.get('status')) ? searchParams.get('status') : null
    const days = ['1', '7', '30'].includes(searchParams.get('days')) ? Number(searchParams.get('days')) : null
    const keyword = String(searchParams.get('q') || '').trim().slice(0, MAX_SEARCH_LENGTH)
    const values = []
    const conditions = []

    if (status) {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }
    if (days) {
      values.push(days)
      conditions.push(`created_at >= NOW() - ($${values.length}::int * INTERVAL '1 day')`)
    }
    if (keyword) {
      values.push(`%${keyword}%`)
      const placeholder = `$${values.length}`
      conditions.push(`(
        keywords ILIKE ${placeholder}
        OR username ILIKE ${placeholder}
        OR COALESCE(city, '') ILIKE ${placeholder}
        OR COALESCE(error_message, '') ILIKE ${placeholder}
        OR COALESCE(error_code, '') ILIKE ${placeholder}
      )`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (page - 1) * PAGE_SIZE
    const result = await transaction(async client => {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS count FROM map_search_logs ${where}`,
        values,
      )
      const rowValues = [...values, PAGE_SIZE, offset]
      const rowsResult = await client.query(
        `SELECT
           id, username, keywords, city, status, http_status, result_count,
           duration_ms, error_message, error_code, error_detail, request_id, created_at
         FROM map_search_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        rowValues,
      )
      const summaryResult = await client.query(`
        SELECT
          COUNT(*)::int AS total_retained,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS requests_24h,
          COUNT(*) FILTER (WHERE status = 'error' AND created_at >= NOW() - INTERVAL '24 hours')::int AS errors_24h,
          COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')), 0)::int AS avg_duration_24h,
          MAX(created_at) AS latest_at,
          (SELECT pg_total_relation_size('map_search_logs')) AS table_bytes
        FROM map_search_logs
      `)
      return {
        count: countResult.rows[0]?.count || 0,
        rows: rowsResult.rows,
        summary: summaryResult.rows[0],
      }
    })

    const pageCount = Math.max(1, Math.ceil(result.count / PAGE_SIZE))
    return NextResponse.json({
      ok: true,
      logs: result.rows,
      summary: result.summary,
      pagination: { page, pageSize: PAGE_SIZE, pageCount, total: result.count },
    })
  } catch (error) {
    console.error('[GET /api/admin/map-search-logs]', error)
    return NextResponse.json({ ok: false, error: '读取地图搜索日志失败' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
