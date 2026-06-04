import { NextResponse } from 'next/server'
import { geocodeAddress } from '@/lib/amap'

export async function POST(request) {
  try {
    const body = await request.json()
    const result = await geocodeAddress(body)
    return NextResponse.json({ ok: true, point: result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
  }
}
