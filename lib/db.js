import { Pool } from 'pg'

// 全局单例连接池，避免 Next.js 热重载时重复创建
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

/**
 * 执行 SQL 查询（带自动释放连接）
 */
export async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

/**
 * 初始化数据库表（首次运行自动建表）
 */
export async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS city_addresses (
      id            SERIAL PRIMARY KEY,
      province      VARCHAR(50),
      city          VARCHAR(50),
      district      VARCHAR(100),
      address       TEXT,
      industry      VARCHAR(100),
      source        VARCHAR(100),
      status        VARCHAR(100),
      name          VARCHAR(200),
      company       VARCHAR(200),
      phone         VARCHAR(50),
      sheet_name    VARCHAR(100),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // 创建常用查询的索引
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_city     ON city_addresses(city)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_province ON city_addresses(province)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_city_addresses_address  ON city_addresses USING gin(to_tsvector('simple', COALESCE(address,'')))`)
}
