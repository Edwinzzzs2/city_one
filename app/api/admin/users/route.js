import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/auth'
import { query, transaction } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  const result = await query(`
    SELECT id, username, is_admin, is_active, last_login_at, created_at
    FROM app_users
    ORDER BY is_admin DESC, created_at ASC
  `)
  return NextResponse.json({ ok: true, users: result.rows })
}

export async function PATCH(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const body = await request.json()
    const targetId = Number(body.userId)
    if (!Number.isInteger(targetId)) {
      return NextResponse.json({ ok: false, error: '用户参数无效' }, { status: 400 })
    }
    if (targetId === Number(admin.id) && (body.isAdmin === false || body.isActive === false)) {
      return NextResponse.json({ ok: false, error: '不能停用自己或移除自己的管理员权限' }, { status: 400 })
    }

    const updated = await transaction(async client => {
      const current = await client.query(
        'SELECT id, username, is_admin, is_active FROM app_users WHERE id = $1 FOR UPDATE',
        [targetId],
      )
      if (!current.rows[0]) {
        const error = new Error('用户不存在')
        error.status = 404
        throw error
      }

      const isAdmin = typeof body.isAdmin === 'boolean' ? body.isAdmin : current.rows[0].is_admin
      const isActive = typeof body.isActive === 'boolean' ? body.isActive : current.rows[0].is_active
      const result = await client.query(
        `UPDATE app_users SET is_admin = $1, is_active = $2, updated_at = NOW()
         WHERE id = $3 RETURNING id, username, is_admin, is_active`,
        [isAdmin, isActive, targetId],
      )
      return result.rows[0]
    })

    return NextResponse.json({ ok: true, user: updated })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || '更新用户失败' }, { status: error.status || 500 })
  }
}

