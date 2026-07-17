import { NextResponse } from 'next/server'
import { getSystemSettings } from '@/lib/db'
import { isAuthEnabled } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await getSystemSettings()
    return NextResponse.json({
      ok: true,
      authEnabled: isAuthEnabled(),
      umami: {
        websiteId: settings.umamiWebsiteId,
        scriptUrl: settings.umamiScriptUrl,
        hostUrl: settings.umamiHostUrl,
        domains: settings.umamiDomains,
        tag: settings.umamiTag,
        autoTrack: settings.umamiAutoTrack,
        doNotTrack: settings.umamiDoNotTrack,
        excludeSearch: settings.umamiExcludeSearch,
        excludeHash: settings.umamiExcludeHash,
      },
    })
  } catch {
    return NextResponse.json({ ok: true, authEnabled: isAuthEnabled(), umami: null })
  }
}
