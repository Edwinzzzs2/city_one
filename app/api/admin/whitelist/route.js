import { NextResponse } from 'next/server'
import { getAdminUser, normalizeUsername } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  const result = await query(`
    SELECT w.id, w.username, w.grant_admin, w.used_at, w.created_at,
           u.username AS used_by_username
    FROM registration_whitelist w
    LEFT JOIN app_users u ON u.id = w.used_by
    ORDER BY (w.used_at IS NULL) DESC, w.created_at DESC
  `)
  return NextResponse.json({ ok: true, whitelist: result.rows })
}

export async function POST(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    if (username.length < 2 || username.length > 32) {
      return NextResponse.json({ ok: false, error: '用户名需为 2–32 个字符' }, { status: 400 })
    }
    const existing = await query('SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)', [username])
    if (existing.rows.length) {
      return NextResponse.json({ ok: false, error: '该用户名已经注册' }, { status: 409 })
    }

    let result = await query(
      `UPDATE registration_whitelist
       SET username = $1, grant_admin = $2, created_by = $3, created_at = NOW()
       WHERE LOWER(username) = LOWER($1) AND used_at IS NULL
       RETURNING id, username, grant_admin, used_at, created_at`,
      [username, Boolean(body.grantAdmin), admin.id],
    )
    if (!result.rows.length) {
      result = await query(
        `INSERT INTO registration_whitelist (username, grant_admin, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, username, grant_admin, used_at, created_at`,
        [username, Boolean(body.grantAdmin), admin.id],
      )
    }
    return NextResponse.json({ ok: true, entry: result.rows[0] })
  } catch (error) {
    console.error('[POST /api/admin/whitelist]', error)
    return NextResponse.json({ ok: false, error: '添加白名单失败' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  const { id } = await request.json()
  const result = await query(
    'DELETE FROM registration_whitelist WHERE id = $1 AND used_at IS NULL RETURNING id',
    [Number(id)],
  )
  if (!result.rows.length) {
    return NextResponse.json({ ok: false, error: '白名单不存在或已被使用' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
