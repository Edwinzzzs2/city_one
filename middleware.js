import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const AUTH_COOKIE = 'city_one_auth'
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/public-config']

function isAuthEnabled() {
  const value = String(process.env.AUTH_ENABLED || '').trim().toLowerCase()
  if (!value) return process.env.NODE_ENV === 'production'
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

async function hasValidToken(request) {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return Boolean(payload.userId && payload.username)
  } catch {
    return false
  }
}

export async function middleware(request) {
  const { pathname, search } = request.nextUrl
  const isPublicApi = PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))
  if (isPublicApi) return NextResponse.next()

  const isAdminArea = pathname === '/console' || pathname.startsWith('/console/') || pathname.startsWith('/api/admin/')
  if (!isAuthEnabled() && !isAdminArea) return NextResponse.next()

  const authenticated = await hasValidToken(request)
  if (pathname === '/login') {
    return NextResponse.next()
  }

  if (authenticated) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: '登录已失效，请重新登录' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest.json|sw.js).*)'],
}
