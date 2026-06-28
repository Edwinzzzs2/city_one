import { Pool } from 'pg'

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

export async function initDB() {
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
      'ui_show_protection'
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
  }
}
