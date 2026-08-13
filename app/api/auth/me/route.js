import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true, authenticated: true, user })
}

