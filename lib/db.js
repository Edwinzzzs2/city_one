import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

function getPool() {
  if (!globalThis._cityOnePgPool) {
    const rawConnectionString = process.env.DATABASE_URL
    let connectionString = rawConnectionString

    // Supabase's transaction pooler presents a certificate chain that can be
    // rejected by the CA bundle in some Vercel Node runtimes. Keep TLS
    // enabled, but let pg accept the pooler's certificate explicitly. Remove
    // sslmode/uselibpqcompat from the URL because pg's connection-string
    // parser otherwise overrides the explicit ssl option below.
    if (rawConnectionString) {
      try {
        const parsed = new URL(rawConnectionString)
        parsed.searchParams.delete('sslmode')
        parsed.searchParams.delete('uselibpqcompat')
        connectionString = parsed.toString()
      } catch {
        // Leave the original value intact so pg can report its normal error.
      }
    }

    globalThis._cityOnePgPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      // Vercel functions scale horizontally; keep a small pool per instance
      // while avoiding connection bursts against the Supabase pooler.
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    })
  }
  return globalThis._cityOnePgPool
}

export async function query(sql, params = []) {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

async function ensureInitialAdmin() {
  const adminUsername = String(process.env.ADMIN_USERNAME || '').trim()
  const adminPassword = String(process.env.ADMIN_PASSWORD || '')
  if (!adminUsername || !adminPassword) return

  const existingAdmin = await query('SELECT id FROM app_users WHERE LOWER(username) = LOWER($1)', [adminUsername])
  if (existingAdmin.rows.length > 0) return

  const passwordHash = await bcrypt.hash(adminPassword, 12)
  await query(
    `INSERT INTO app_users (username, password_hash, password_plain, is_admin) VALUES ($1, $2, $3, TRUE)
     ON CONFLICT DO NOTHING`,
    [adminUsername, passwordHash, adminPassword],
  )
}

async function initializeDB() {
  // The schema is provisioned during migration. Avoid replaying every DDL
  // statement on every serverless request, especially through Supabase's
  // transaction pooler where each round trip is relatively expensive.
  const existingTables = await query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('city_addresses', 'app_settings', 'app_users', 'registration_whitelist')
  `)
  if (existingTables.rows[0]?.count === 4) {
    await ensureInitialAdmin()
    return
  }

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

  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id             SERIAL PRIMARY KEY,
      username       VARCHAR(80) NOT NULL,
      password_hash  TEXT NOT NULL,
      password_plain TEXT,
      is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at  TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_plain TEXT`)
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

  await ensureInitialAdmin()
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
  const client = await getPool().connect()
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
  const client = await getPool().connect()
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
    apiBaseUrl: map.ai_api_base_url || '',
    apiKey: map.ai_api_key || '',
    model: map.ai_model || 'gpt-5.5',
    batchSize: Number(map.ai_batch_size || 40) || 40,
    themeMode: normalizeThemeMode(map.ui_theme_mode || 'light'),
    protectionRadiusKm: normalizeProtectionRadius(map.ui_protection_radius_km || 3),
    showProtection: normalizeBoolean(map.ui_show_protection, true),
    amapJsKey: map.amap_js_key || '',
    amapSecurityCode: map.amap_security_code || '',
    amapWebServiceKey: map.amap_web_service_key || '',
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
    umamiWebsiteId: map.umami_website_id || '',
    umamiScriptUrl: map.umami_script_url || 'https://cloud.umami.is/script.js',
    umamiHostUrl: map.umami_host_url || '',
    umamiDomains: map.umami_domains || '',
    umamiTag: map.umami_tag || '',
    umamiAutoTrack: normalizeBoolean(map.umami_auto_track, true),
    umamiDoNotTrack: normalizeBoolean(map.umami_do_not_track, false),
    umamiExcludeSearch: normalizeBoolean(map.umami_exclude_search, false),
    umamiExcludeHash: normalizeBoolean(map.umami_exclude_hash, false),
  }
}
