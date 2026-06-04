import { NextResponse } from 'next/server'
import { searchPlaces } from '@/lib/amap'

export async function POST(request) {
  try {
    const body = await request.json()
    const result = await searchPlaces(body)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
  }
}
