import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/auth'
import { getSystemSettings, setSettings } from '@/lib/db'

const MASK = '********'
const SECRET_FIELDS = ['apiKey', 'amapSecurityCode', 'amapWebServiceKey']
const KEY_MAP = {
  apiBaseUrl: 'ai_api_base_url', apiKey: 'ai_api_key', model: 'ai_model', batchSize: 'ai_batch_size',
  themeMode: 'ui_theme_mode', protectionRadiusKm: 'ui_protection_radius_km', showProtection: 'ui_show_protection',
  amapJsKey: 'amap_js_key', amapSecurityCode: 'amap_security_code', amapWebServiceKey: 'amap_web_service_key',
  umamiWebsiteId: 'umami_website_id', umamiScriptUrl: 'umami_script_url', umamiHostUrl: 'umami_host_url',
  umamiDomains: 'umami_domains', umamiTag: 'umami_tag', umamiAutoTrack: 'umami_auto_track',
  umamiDoNotTrack: 'umami_do_not_track', umamiExcludeSearch: 'umami_exclude_search', umamiExcludeHash: 'umami_exclude_hash',
}

function publicSettings(settings) {
  const result = { ...settings }
  for (const field of SECRET_FIELDS) {
    result[`has${field[0].toUpperCase()}${field.slice(1)}`] = Boolean(settings[field])
    result[field] = settings[field] ? MASK : ''
  }
  return result
}

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })
  const settings = await getSystemSettings()
  return NextResponse.json({ ok: true, settings: publicSettings(settings) })
}

export async function PUT(request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const body = await request.json()
    const current = await getSystemSettings()
    const entries = {}
    for (const [field, key] of Object.entries(KEY_MAP)) {
      if (!(field in body)) continue
      let value = body[field]
      if (SECRET_FIELDS.includes(field) && value === MASK) value = current[field]
      if (typeof value === 'boolean') value = String(value)
      entries[key] = String(value ?? '').trim()
    }
    await setSettings(entries)
    const next = await getSystemSettings()
    return NextResponse.json({ ok: true, settings: publicSettings(next) })
  } catch (error) {
    console.error('[PUT /api/admin/settings]', error)
    return NextResponse.json({ ok: false, error: '保存系统配置失败' }, { status: 500 })
  }
}
export const dynamic = 'force-dynamic'

