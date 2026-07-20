import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const MAP_SEARCH_LOG_RETENTION_DAYS = 30
const MAP_SEARCH_LOG_MAX_ROWS = 5000
const MAP_SEARCH_LOG_CLEANUP_INTERVAL = 100

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

async function ensureMapSearchLogs() {
  await query(`
    CREATE TABLE IF NOT EXISTS map_search_logs (
      id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id       INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      username      TEXT NOT NULL,
      keywords      TEXT NOT NULL,
      city          TEXT,
      status        TEXT NOT NULL CHECK (status IN ('success', 'error')),
      http_status   SMALLINT NOT NULL CHECK (http_status BETWEEN 100 AND 599),
      result_count  INTEGER CHECK (result_count IS NULL OR result_count >= 0),
      duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0),
      error_message TEXT,
      error_code    TEXT,
      error_detail  TEXT,
      request_id    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT map_search_logs_username_size CHECK (octet_length(username) <= 256),
      CONSTRAINT map_search_logs_keywords_size CHECK (octet_length(keywords) <= 512),
      CONSTRAINT map_search_logs_city_size CHECK (city IS NULL OR octet_length(city) <= 256),
      CONSTRAINT map_search_logs_error_message_size CHECK (error_message IS NULL OR octet_length(error_message) <= 1024),
      CONSTRAINT map_search_logs_error_code_size CHECK (error_code IS NULL OR octet_length(error_code) <= 256),
      CONSTRAINT map_search_logs_error_detail_size CHECK (error_detail IS NULL OR octet_length(error_detail) <= 2048),
      CONSTRAINT map_search_logs_request_id_size CHECK (request_id IS NULL OR octet_length(request_id) <= 256)
    )
  `)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_username_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_username_size CHECK (octet_length(username) <= 256);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_keywords_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_keywords_size CHECK (octet_length(keywords) <= 512);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_city_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_city_size CHECK (city IS NULL OR octet_length(city) <= 256);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_error_message_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_error_message_size CHECK (error_message IS NULL OR octet_length(error_message) <= 1024);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_error_code_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_error_code_size CHECK (error_code IS NULL OR octet_length(error_code) <= 256);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_error_detail_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_error_detail_size CHECK (error_detail IS NULL OR octet_length(error_detail) <= 2048);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_search_logs_request_id_size' AND conrelid = 'map_search_logs'::regclass) THEN
        ALTER TABLE map_search_logs ADD CONSTRAINT map_search_logs_request_id_size CHECK (request_id IS NULL OR octet_length(request_id) <= 256);
      END IF;
    END $$
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_map_search_logs_created_at ON map_search_logs (created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_map_search_logs_user_id ON map_search_logs (user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_map_search_logs_error_created_at ON map_search_logs (created_at DESC) WHERE status = 'error'`)
  await query(`ALTER TABLE map_search_logs ENABLE ROW LEVEL SECURITY`)
}

async function mapSearchLogSizeConstraintsExist() {
  const result = await query(`
    SELECT COUNT(*)::int AS count
    FROM pg_constraint
    WHERE conrelid = 'map_search_logs'::regclass
      AND conname IN (
        'map_search_logs_username_size',
        'map_search_logs_keywords_size',
        'map_search_logs_city_size',
        'map_search_logs_error_message_size',
        'map_search_logs_error_code_size',
        'map_search_logs_error_detail_size',
        'map_search_logs_request_id_size'
      )
  `)
  return result.rows[0]?.count === 7
}

async function initializeDB() {
  // The schema is provisioned during migration. Avoid replaying every DDL
  // statement on every serverless request, especially through Supabase's
  // transaction pooler where each round trip is relatively expensive.
  const existingTables = await query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('city_addresses', 'app_settings', 'app_users', 'registration_whitelist', 'map_search_logs')
  `)
  const existingTableNames = new Set(existingTables.rows.map(row => row.table_name))
  const hasCoreTables = ['city_addresses', 'app_settings', 'app_users', 'registration_whitelist']
    .every(tableName => existingTableNames.has(tableName))
  if (hasCoreTables) {
    // Existing Supabase databases can already have all four tables from an
    // older schema. Keep lightweight column upgrades running before the early
    // return so new admin features do not make the console API fail with
    // "column does not exist".
    await query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_plain TEXT`)
    const mapSearchLogsExist = existingTableNames.has('map_search_logs')
    if (!mapSearchLogsExist || !await mapSearchLogSizeConstraintsExist()) await ensureMapSearchLogs()
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
  await ensureMapSearchLogs()

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

function limitedText(value, maxBytes) {
  if (value === undefined || value === null || value === '') return null
  let text = String(value)
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  text = text.slice(0, maxBytes)
  while (Buffer.byteLength(text, 'utf8') > maxBytes) text = text.slice(0, -1)
  return text
}

export async function recordMapSearchLog(entry = {}) {
  await initDB()

  const resultCount = Number(entry.resultCount)
  const durationMs = Number(entry.durationMs)
  const insertResult = await query(
    `INSERT INTO map_search_logs (
       user_id, username, keywords, city, status, http_status, result_count,
       duration_ms, error_message, error_code, error_detail, request_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      entry.userId !== undefined && entry.userId !== null && Number.isInteger(Number(entry.userId))
        ? Number(entry.userId)
        : null,
      limitedText(entry.username, 256) || 'guest',
      limitedText(entry.keywords, 512) || '',
      limitedText(entry.city, 256),
      entry.status === 'success' ? 'success' : 'error',
      Number(entry.httpStatus) || 500,
      Number.isFinite(resultCount) && resultCount >= 0 ? Math.trunc(resultCount) : null,
      Number.isFinite(durationMs) && durationMs >= 0 ? Math.trunc(durationMs) : 0,
      limitedText(entry.errorMessage, 1024),
      limitedText(entry.errorCode, 256),
      limitedText(entry.errorDetail, 2048),
      limitedText(entry.requestId, 256),
    ],
  )

  const insertedId = Number(insertResult.rows[0]?.id)
  if (!Number.isInteger(insertedId) || insertedId % MAP_SEARCH_LOG_CLEANUP_INTERVAL !== 0) return

  await query(
    `DELETE FROM map_search_logs
     WHERE created_at < NOW() - ($1 * INTERVAL '1 day')`,
    [MAP_SEARCH_LOG_RETENTION_DAYS],
  )
  await query(
    `DELETE FROM map_search_logs
     WHERE id < (
       SELECT id FROM map_search_logs
       ORDER BY id DESC
       OFFSET $1
       LIMIT 1
     )`,
    [MAP_SEARCH_LOG_MAX_ROWS - 1],
  )
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
