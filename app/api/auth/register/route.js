import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { transaction } from '@/lib/db'
import { normalizeUsername, setAuthCookie } from '@/lib/auth'

export async function POST(request) {
  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = String(body.password || '')

    if (username.length < 2 || username.length > 32) {
      return NextResponse.json({ ok: false, error: '用户名需为 2–32 个字符，且不能包含空格' }, { status: 400 })
    }
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ ok: false, error: '密码需为 8–128 个字符' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await transaction(async client => {
      const whitelist = await client.query(
        `SELECT id, grant_admin, used_at
         FROM registration_whitelist
         WHERE LOWER(username) = LOWER($1)
         FOR UPDATE`,
        [username],
      )
      const entry = whitelist.rows[0]
      if (!entry || entry.used_at) {
        const error = new Error('该用户名不在注册白名单中，或邀请已被使用')
        error.status = 403
        throw error
      }

      const existing = await client.query(
        'SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)',
        [username],
      )
      if (existing.rows.length) {
        const error = new Error('用户名已被注册')
        error.status = 409
        throw error
      }

      const inserted = await client.query(
        `INSERT INTO app_users (username, password_hash, password_plain, is_admin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, is_admin`,
        [username, passwordHash, password, entry.grant_admin],
      )
      const created = inserted.rows[0]
      await client.query(
        'UPDATE registration_whitelist SET used_at = NOW(), used_by = $1 WHERE id = $2',
        [created.id, entry.id],
      )
      return created
    })

    await setAuthCookie(user)
    return NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, isAdmin: user.is_admin },
    })
  } catch (error) {
    console.error('[POST /api/auth/register]', error)
    return NextResponse.json(
      { ok: false, error: error.message || '注册失败，请稍后重试' },
      { status: error.status || 500 },
    )
  }
}
export const dynamic = 'force-dynamic'

