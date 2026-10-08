import assert from 'node:assert/strict'
import test from 'node:test'
import { getPostgresConnectionOptions } from '../lib/postgresConfig.mjs'

test('普通 PG 不强制 SSL，保留显式 TLS 配置', () => {
  for (const suffix of ['', '?sslmode=disable', '?sslmode=require', '?sslmode=verify-full&sslrootcert=ca.pem']) {
    const connectionString = `postgresql://user:password@192.168.31.80:5432/cityone${suffix}`
    assert.deepEqual(getPostgresConnectionOptions(connectionString), { connectionString })
  }
})

test('Supabase 直连和 pooler 默认保留 TLS 兼容处理', () => {
  for (const host of ['db.couqibjqkteustcupify.supabase.co', 'aws-0-ap-southeast-1.pooler.supabase.com']) {
    for (const suffix of ['', '?sslmode=require&uselibpqcompat=true&application_name=city_one']) {
      const options = getPostgresConnectionOptions(`postgresql://user:password@${host}:5432/postgres${suffix}`)
      const url = new URL(options.connectionString)
      assert.deepEqual(options.ssl, { rejectUnauthorized: false })
      assert.equal(url.searchParams.has('sslmode'), false)
      assert.equal(url.searchParams.has('uselibpqcompat'), false)
      if (suffix) assert.equal(url.searchParams.get('application_name'), 'city_one')
    }
  }
})

test('Supabase 显式 TLS 模式和证书配置不被覆盖', () => {
  for (const suffix of ['?sslmode=disable', '?sslmode=verify-full', '?sslmode=require&sslrootcert=ca.pem', '?ssl=true']) {
    const connectionString = `postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres${suffix}`
    assert.deepEqual(getPostgresConnectionOptions(connectionString), { connectionString })
  }
})

test('类似 Supabase 的第三方域名不套用兼容策略', () => {
  const connectionString = 'postgresql://user:password@aws-0.pooler.supabase.com.example.org:5432/postgres'
  assert.deepEqual(getPostgresConnectionOptions(connectionString), { connectionString })
})

test('缺失或非法连接串保留给驱动处理', () => {
  for (const connectionString of [undefined, '', 'invalid']) {
    assert.deepEqual(getPostgresConnectionOptions(connectionString), { connectionString })
  }
})
