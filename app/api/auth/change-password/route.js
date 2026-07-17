import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAuthenticatedUser, clearAuthCookie } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(request) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 })

  try {
    const { currentPassword, newPassword } = await request.json()
    if (String(newPassword || '').length < 8 || String(newPassword || '').length > 128) {
      return NextResponse.json({ ok: false, error: '新密码需为 8–128 个字符' }, { status: 400 })
    }
    const result = await query('SELECT password_hash FROM app_users WHERE id = $1', [user.id])
    const valid = await bcrypt.compare(String(currentPassword || ''), result.rows[0]?.password_hash || '')
    if (!valid) return NextResponse.json({ ok: false, error: '当前密码不正确' }, { status: 400 })

    const hash = await bcrypt.hash(String(newPassword), 12)
    await query('UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, user.id])
    await clearAuthCookie()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/auth/change-password]', error)
    return NextResponse.json({ ok: false, error: '修改密码失败' }, { status: 500 })
  }
}
