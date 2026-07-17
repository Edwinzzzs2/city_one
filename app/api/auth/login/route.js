import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { initDB, query } from '@/lib/db'
import { normalizeUsername, setAuthCookie } from '@/lib/auth'

export async function POST(request) {
  try {
    await initDB()
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = String(body.password || '')
    if (!username || !password) {
      return NextResponse.json({ ok: false, error: '请输入用户名和密码' }, { status: 400 })
    }

    const result = await query(
      `SELECT id, username, password_hash, is_admin, is_active
       FROM app_users WHERE LOWER(username) = LOWER($1)`,
      [username],
    )
    const user = result.rows[0]
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false
    if (!valid) {
      return NextResponse.json({ ok: false, error: '用户名或密码不正确' }, { status: 401 })
    }
    if (!user.is_active) {
      return NextResponse.json({ ok: false, error: '账号已被管理员停用' }, { status: 403 })
    }

    await query('UPDATE app_users SET last_login_at = NOW() WHERE id = $1', [user.id])
    await setAuthCookie(user)
    return NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, isAdmin: user.is_admin },
    })
  } catch (error) {
    console.error('[POST /api/auth/login]', error)
    return NextResponse.json({ ok: false, error: '登录失败，请稍后重试' }, { status: 500 })
  }
}
