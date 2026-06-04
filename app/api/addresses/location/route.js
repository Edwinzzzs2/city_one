import { NextResponse } from 'next/server'
import { query, initDB } from '@/lib/db'

function parseId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('门店 ID 无效')
  return id
}

function parseCoordinate(value, label, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}无效`)
  }
  return number
}

export async function POST(request) {
  try {
    await initDB()

    const body = await request.json()
    const id = parseId(body.id)
    const lng = parseCoordinate(body.lng, '经度', -180, 180)
    const lat = parseCoordinate(body.lat, '纬度', -90, 90)
    const geocodeStatus = String(body.geocodeStatus || 'manual_map').slice(0, 80)
    const geocodeLevel = body.geocodeLevel ? String(body.geocodeLevel).slice(0, 80) : null
    const geocodeAddress = body.geocodeAddress ? String(body.geocodeAddress) : null

    const result = await query(
      `UPDATE city_addresses
       SET lng = $1,
           lat = $2,
           geocode_status = $3,
           geocode_level = $4,
           geocode_address = $5,
           geocode_at = NOW(),
           updated_at = NOW()
       WHERE id = $6
       RETURNING
         id, province, city, district, address, industry, source, status,
         name, company, phone, lng, lat, geocode_status, geocode_level, geocode_address`,
      [lng, lat, geocodeStatus, geocodeLevel, geocodeAddress, id]
    )

    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, error: '未找到门店记录' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, row: result.rows[0] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
  }
}
