import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const globalPool = global._pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

if (process.env.NODE_ENV !== 'production') {
  global._pgPool = globalPool
}

export const pool = globalPool

export async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

async function initializeDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS city_addresses (
      id             SERIAL PRIMARY KEY,
      province       VARCHAR(50),
      city           VARCHAR(50),
      district       VARCHAR(100),
      address        TEXT,
      industry       VARCHAR(100),
      source         VARCHAR(100),
      status         VARCHAR(100),
      name           VARCHAR(200),
      company        VARCHAR(200),
      phone          VARCHAR(50),
      lng            DOUBLE PRECISION,
      lat            DOUBLE PRECISION,
      geocode_status VARCHAR(80),
      geocode_level  VARCHAR(80),
      geocode_address TEXT,
      geocode_at     TIMESTAMPTZ,
      sheet_name     VARCHAR(100),
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`)
  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`)
  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS geocode_status VARCHAR(80)`)
  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS geocode_level VARCHAR(80)`)
  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS geocode_address TEXT`)
  await query(`ALTER TABLE city_addresses ADD COLUMN IF NOT EXISTS geocode_at TIMESTAMPTZ`)

  // 修复旧版导入把空坐标写成 0,0 的数据，使其重新进入待补坐标流程。
  await query(`
    UPDATE city_addresses
    SET lng = NULL,
        lat = NULL,
        geocode_status = NULL,
        geocode_level = NULL,
        geocode_address = NULL,
        geocode_at = NULL,
        updated_at = NOW()
    WHERE lng = 0 AND lat = 0
  `)

  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_city ON city_addresses(city)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_province ON city_addresses(province)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_address ON city_addresses USING gin(to_tsvector('simple', COALESCE(address,'')))`)
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_location ON city_addresses(lng, lat) WHERE lng IS NOT NULL AND lat IS NOT NULL`)

  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(80) NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users (LOWER(username))`)

  await query(`
    CREATE TABLE IF NOT EXISTS registration_whitelist (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(80) NOT NULL,
      grant_admin   BOOLEAN NOT NULL DEFAULT FALSE,
      used_at       TIMESTAMPTZ,
      used_by       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      created_by    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_whitelist_username_lower ON registration_whitelist (LOWER(username))`)

  const adminUsername = String(process.env.ADMIN_USERNAME || '').trim()
  const adminPassword = String(process.env.ADMIN_PASSWORD || '')
  if (adminUsername && adminPassword) {
    const existingAdmin = await query('SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)', [adminUsername])
    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12)
      await query(
        `INSERT INTO app_users (username, password_hash, is_admin) VALUES ($1, $2, TRUE)
         ON CONFLICT DO NOTHING`,
        [adminUsername, passwordHash],
      )
    }
  }
}

export async function initDB() {
  if (global._cityOneDBInitialized) return
  if (!global._cityOneDBInitPromise) {
    global._cityOneDBInitPromise = initializeDB()
      .then(() => { global._cityOneDBInitialized = true })
      .catch(error => {
        global._cityOneDBInitPromise = null
        throw error
      })
  }
  return global._cityOneDBInitPromise
}

export async function getSetting(key) {
  await initDB()
  const result = await query('SELECT value FROM app_settings WHERE key = $1', [key])
  return result.rows[0]?.value || ''
}

export async function setSetting(key, value) {
  await initDB()
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value ?? '']
  )
}

export async function setSettings(entries = {}) {
  await initDB()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(entries)) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value ?? ''],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function transaction(callback) {
  await initDB()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function normalizeThemeMode(value) {
  return value === 'dark' || value === 'light' ? value : 'light'
}

function normalizeProtectionRadius(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 3
  return Math.min(5, Math.max(1, Math.round(number)))
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === false) return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return fallback
}

export async function getAISettings() {
  await initDB()
  const result = await query(`
    SELECT key, value
    FROM app_settings
    WHERE key IN (
      'ai_api_base_url',
      'ai_api_key',
      'ai_model',
      'ai_batch_size',
      'ui_theme_mode',
      'ui_protection_radius_km',
      'ui_show_protection',
      'amap_js_key',
      'amap_security_code',
      'amap_web_service_key'
    )
  `)
  const map = Object.fromEntries(result.rows.map(row => [row.key, row.value]))

  return {
    apiBaseUrl: map.ai_api_base_url || process.env.AI_API_BASE_URL || '',
    apiKey: map.ai_api_key || process.env.AI_API_KEY || '',
    model: map.ai_model || process.env.AI_MODEL || 'gpt-5.5',
    batchSize: Number(map.ai_batch_size || 40) || 40,
    themeMode: normalizeThemeMode(map.ui_theme_mode || process.env.UI_THEME_MODE || 'light'),
    protectionRadiusKm: normalizeProtectionRadius(map.ui_protection_radius_km || process.env.UI_PROTECTION_RADIUS_KM || 3),
    showProtection: normalizeBoolean(map.ui_show_protection ?? process.env.UI_SHOW_PROTECTION, true),
    amapJsKey: map.amap_js_key || process.env.NEXT_PUBLIC_AMAP_JS_KEY || '',
    amapSecurityCode: map.amap_security_code || process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE || '',
    amapWebServiceKey: map.amap_web_service_key || process.env.AMAP_WEB_SERVICE_KEY || '',
  }
}

export async function getSystemSettings() {
  const ai = await getAISettings()
  const result = await query(`
    SELECT key, value FROM app_settings
    WHERE key IN (
      'umami_website_id', 'umami_script_url', 'umami_host_url',
      'umami_domains', 'umami_tag', 'umami_auto_track',
      'umami_do_not_track', 'umami_exclude_search', 'umami_exclude_hash'
    )
  `)
  const map = Object.fromEntries(result.rows.map(row => [row.key, row.value]))

  return {
    ...ai,
    umamiWebsiteId: map.umami_website_id || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || '',
    umamiScriptUrl: map.umami_script_url || process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://cloud.umami.is/script.js',
    umamiHostUrl: map.umami_host_url || process.env.NEXT_PUBLIC_UMAMI_HOST_URL || '',
    umamiDomains: map.umami_domains || process.env.NEXT_PUBLIC_UMAMI_DOMAINS || '',
    umamiTag: map.umami_tag || process.env.NEXT_PUBLIC_UMAMI_TAG || '',
    umamiAutoTrack: normalizeBoolean(map.umami_auto_track ?? process.env.NEXT_PUBLIC_UMAMI_AUTO_TRACK, true),
    umamiDoNotTrack: normalizeBoolean(map.umami_do_not_track ?? process.env.NEXT_PUBLIC_UMAMI_DO_NOT_TRACK, false),
    umamiExcludeSearch: normalizeBoolean(map.umami_exclude_search ?? process.env.NEXT_PUBLIC_UMAMI_EXCLUDE_SEARCH, false),
    umamiExcludeHash: normalizeBoolean(map.umami_exclude_hash ?? process.env.NEXT_PUBLIC_UMAMI_EXCLUDE_HASH, false),
  }
}
