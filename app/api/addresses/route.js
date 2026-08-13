import { NextResponse } from 'next/server'
import { query, initDB } from '@/lib/db'
import { getAppUser } from '@/lib/auth'

const MAP_LIMIT = 20000
const LIST_LIMIT = 1000

function toCoordinate(value) {
  const text = String(value ?? '').trim()
  // Number('') 会得到 0，空坐标必须先拦截，否则会被误判为已落点。
  if (!text) return null

  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

function buildSearchFilter({ q = '', city = '' }) {
  if (q) {
    return {
      where: `
        WHERE (
          address  ILIKE $1 OR
          city     ILIKE $1 OR
          district ILIKE $1 OR
          province ILIKE $1 OR
          industry ILIKE $1 OR
          name     ILIKE $1 OR
          company  ILIKE $1 OR
          phone    ILIKE $1 OR
          source   ILIKE $1 OR
          status   ILIKE $1 OR
          sheet_name ILIKE $1
        )
      `,
      params: [`%${q}%`],
    }
  }

  if (city) {
    return {
      where: 'WHERE city ILIKE $1',
      params: [`%${city}%`],
    }
  }

  return { where: '', params: [] }
}

function appendCondition(where, condition) {
  return where ? `${where} AND ${condition}` : `WHERE ${condition}`
}

function getListWhere(where, listMode) {
  if (listMode === 'missing') return appendCondition(where, '(lng IS NULL OR lat IS NULL)')
  if (listMode === 'manual') return appendCondition(where, "(geocode_status = 'manual_map' OR geocode_status = 'manual')")
  if (listMode === 'all') return where
  return appendCondition(where, 'lng IS NOT NULL AND lat IS NOT NULL')
}

async function getMapRows({ q, city, listMode = 'located' }) {
  const { where, params } = buildSearchFilter({ q, city })
  const mapWhere = appendCondition(where, 'lng IS NOT NULL AND lat IS NOT NULL')
  const listWhere = getListWhere(where, listMode)

  const baseSelect = `
    id, province, city, district, address, industry, source, status,
    name, company, phone, lng, lat, geocode_status, geocode_level, geocode_address
  `

  const [countResult, mapResult, listResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*)::int AS total,
         CAST(COUNT(*) FILTER (WHERE lng IS NOT NULL AND lat IS NOT NULL) AS int) AS located,
         CAST(COUNT(*) FILTER (WHERE lng IS NULL OR lat IS NULL) AS int) AS missing,
         CAST(COUNT(*) FILTER (WHERE geocode_status = 'manual_map' OR geocode_status = 'manual') AS int) AS manual
       FROM city_addresses
       ${where}`,
      params
    ),
    query(
      `SELECT ${baseSelect}
       FROM city_addresses
       ${mapWhere}
       ORDER BY province, city, district, id
       LIMIT ${MAP_LIMIT}`,
      params
    ),
    query(
      `SELECT ${baseSelect}
       FROM city_addresses
       ${listWhere}
       ORDER BY
         CASE WHEN lng IS NULL OR lat IS NULL THEN 0 ELSE 1 END,
         province, city, district, id
       LIMIT ${LIST_LIMIT}`,
      params
    ),
  ])

  return {
    mapRows: mapResult.rows,
    rows: listResult.rows,
    summary: {
      total: countResult.rows[0]?.total || 0,
      located: countResult.rows[0]?.located || 0,
      missing: countResult.rows[0]?.missing || 0,
      manual: countResult.rows[0]?.manual || 0,
      limited: mapResult.rows.length >= MAP_LIMIT,
      listLimited: listResult.rows.length >= LIST_LIMIT,
    },
  }
}

// GET /api/addresses
export async function GET(request) {
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    await initDB()

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') || ''
    const city = searchParams.get('city') || ''
    const map = searchParams.get('map') === '1'
    const listMode = searchParams.get('list') || 'located'

    if (map) {
      const result = await getMapRows({ q, city, listMode })
      return NextResponse.json({ ok: true, ...result })
    }

    let sql, params

    if (q) {
      sql = `
        SELECT * FROM city_addresses
        WHERE
          address  ILIKE $1 OR
          city     ILIKE $1 OR
          district ILIKE $1 OR
          province ILIKE $1 OR
          industry ILIKE $1 OR
          name     ILIKE $1 OR
          company  ILIKE $1 OR
          phone    ILIKE $1 OR
          source   ILIKE $1 OR
          status   ILIKE $1 OR
          sheet_name ILIKE $1
        ORDER BY province, city, district
        LIMIT 500
      `
      params = [`%${q}%`]
    } else if (city) {
      sql = `SELECT * FROM city_addresses WHERE city ILIKE $1 ORDER BY district, address LIMIT 500`
      params = [`%${city}%`]
    } else {
      sql = `
        SELECT
          province,
          city,
          COUNT(*) AS count
        FROM city_addresses
        GROUP BY province, city
        ORDER BY province, city
      `
      params = []
    }

    const result = await query(sql, params)
    return NextResponse.json({ ok: true, rows: result.rows })
  } catch (e) {
    console.error('[GET /api/addresses]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// POST /api/addresses
export async function POST(request) {
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    await initDB()

    const body = await request.json()
    const { rows, mode = 'append' } = body

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: '没有数据' }, { status: 400 })
    }

    if (mode === 'replace') {
      await query('TRUNCATE TABLE city_addresses RESTART IDENTITY')
    }

    const BATCH = 100
    let inserted = 0

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const placeholders = chunk.map((_, j) => {
        const base = j * 13
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13})`
      }).join(',')

      const values = chunk.flatMap(r => [
        r.province || null,
        r.city     || null,
        r.district || null,
        r.address  || null,
        r.industry || null,
        r.source   || null,
        r.status   || null,
        r.name     || null,
        r.company  || null,
        r.phone    || null,
        toCoordinate(r.lng),
        toCoordinate(r.lat),
        r._sheet   || null,
      ])

      await query(
        `INSERT INTO city_addresses
          (province,city,district,address,industry,source,status,name,company,phone,lng,lat,sheet_name)
         VALUES ${placeholders}`,
        values
      )
      inserted += chunk.length
    }

    return NextResponse.json({ ok: true, inserted })
  } catch (e) {
    console.error('[POST /api/addresses]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// DELETE /api/addresses
export async function DELETE() {
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    await initDB()
    await query('TRUNCATE TABLE city_addresses RESTART IDENTITY')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
