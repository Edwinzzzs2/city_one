import { NextResponse } from 'next/server'
import { query, initDB } from '@/lib/db'

// ---- GET /api/addresses ----
// 查询所有地址，按省市聚合
export async function GET(request) {
  try {
    await initDB()

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q') || ''
    const city = searchParams.get('city') || ''

    let sql, params

    if (q) {
      // 模糊搜索：地址、城市、区、行业
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
      // 查某个城市的所有地址
      sql = `SELECT * FROM city_addresses WHERE city = $1 ORDER BY district, address`
      params = [city]
    } else {
      // 首页：返回省市统计
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

// ---- POST /api/addresses ----
// 批量写入解析好的地址数据（先清空再写入，支持追加模式）
export async function POST(request) {
  try {
    await initDB()

    const body = await request.json()
    const { rows, mode = 'append' } = body // mode: 'append' | 'replace'

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: '没有数据' }, { status: 400 })
    }

    if (mode === 'replace') {
      await query('TRUNCATE TABLE city_addresses RESTART IDENTITY')
    }

    // 批量插入（每批 100 条）
    const BATCH = 100
    let inserted = 0

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const placeholders = chunk.map((_, j) => {
        const base = j * 11
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11})`
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
        r._sheet   || null,
      ])

      await query(
        `INSERT INTO city_addresses
          (province,city,district,address,industry,source,status,name,company,phone,sheet_name)
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

// ---- DELETE /api/addresses ----
// 清空所有数据
export async function DELETE() {
  try {
    await initDB()
    await query('TRUNCATE TABLE city_addresses RESTART IDENTITY')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
