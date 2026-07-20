import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/auth'
import { recordAmapUsage } from '@/lib/db'

export async function POST(request) {
  const user = await getAppUser()
  if (!user) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })

  try {
    const body = await request.json()
    if (body?.service !== 'map_init') {
      return NextResponse.json({ ok: false, error: '不支持的高德服务类型' }, { status: 400 })
    }
    await recordAmapUsage('map_init')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/amap-usage]', error)
    return NextResponse.json({ ok: false, error: '高德用量记录失败' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
