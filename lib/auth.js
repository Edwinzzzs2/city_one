import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { initDB, query } from '@/lib/db'

export const AUTH_COOKIE = 'city_one_auth'
const SESSION_DAYS = 30

export function isAuthEnabled() {
  const value = String(process.env.AUTH_ENABLED || '').trim().toLowerCase()
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function secretKey() {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 AUTH_SECRET')
  }
  const value = configured || 'city-one-development-secret-change-me'
  return new TextEncoder().encode(value)
}

export function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, '')
}

export async function signAuthToken(user) {
  return new SignJWT({
    userId: String(user.id),
    username: user.username,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey())
}

export async function verifyAuthToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    if (!payload.userId || !payload.username) return null
    return payload
  } catch {
    return null
  }
}

export async function setAuthCookie(user) {
  const token = await signAuthToken(user)
  const cookieStore = await cookies()
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function getAuthenticatedUser() {
  await initDB()
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE)?.value
  if (!token) return null

  const payload = await verifyAuthToken(token)
  if (!payload) return null

  const result = await query(
    `SELECT id, username, is_admin, is_active, created_at
     FROM app_users WHERE id = $1`,
    [payload.userId],
  )
  const user = result.rows[0]
  if (!user?.is_active) return null

  return {
    id: user.id,
    username: user.username,
    isAdmin: user.is_admin,
    createdAt: user.created_at,
  }
}

export async function getAdminUser() {
  const user = await getAuthenticatedUser()
  return user?.isAdmin ? user : null
}

export async function getAppUser() {
  if (!isAuthEnabled()) {
    return { id: null, username: 'guest', isAdmin: false, isGuest: true }
  }
  return getAuthenticatedUser()
}
