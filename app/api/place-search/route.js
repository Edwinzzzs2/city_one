import { NextResponse } from 'next/server'
import { searchPlaces } from '@/lib/amap'
import { getAppUser } from '@/lib/auth'

export async function POST(request) {
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    const body = await request.json()
    const result = await searchPlaces(body)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
  }
}
export const dynamic = 'force-dynamic'
