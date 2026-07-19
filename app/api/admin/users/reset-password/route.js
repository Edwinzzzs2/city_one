import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAdminUser } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const { userId, newPassword } = await request.json()
    const targetId = Number(userId)
    const password = String(newPassword || '')
    if (!Number.isInteger(targetId) || password.length < 8 || password.length > 128) {
      return NextResponse.json({ ok: false, error: '请选择用户并输入 8–128 位新密码' }, { status: 400 })
    }
    const hash = await bcrypt.hash(password, 12)
    const result = await query(
      'UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [hash, targetId],
    )
    if (!result.rows.length) return NextResponse.json({ ok: false, error: '用户不存在' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/admin/users/reset-password]', error)
    return NextResponse.json({ ok: false, error: '重置密码失败' }, { status: 500 })
  }
}
export const dynamic = 'force-dynamic'

