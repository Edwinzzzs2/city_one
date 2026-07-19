import { NextResponse } from 'next/server'
import { geocodeAddress } from '@/lib/amap'
import { getAdminUser, getAppUser } from '@/lib/auth'

export async function POST(request) {
  if (!await getAdminUser()) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })
  if (!await getAppUser()) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })
  try {
    const body = await request.json()
    const result = await geocodeAddress(body)
    return NextResponse.json({ ok: true, point: result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 })
  }
}
export const dynamic = 'force-dynamic'
