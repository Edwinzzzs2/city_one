export function getPostgresConnectionOptions(connectionString) {
  const options = { connectionString }
  if (!connectionString) return options

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    // 不在这里重写非法连接串，让 pg 保留原本的错误提示。
    return options
  }

  const hostname = parsed.hostname.toLowerCase()
  const isSupabase = hostname.endsWith('.pooler.supabase.com')
    || /^db\.[a-z0-9]+\.supabase\.co$/.test(hostname)
  const sslMode = parsed.searchParams.get('sslmode')
  const hasExplicitTls = ['ssl', 'sslcert', 'sslkey', 'sslrootcert']
    .some(key => parsed.searchParams.has(key))

  // 普通 PG 交给驱动按连接串配置；不能强制 SSL，也不能删除 sslmode=disable。
  // Supabase 的明确证书配置、verify-full 等模式同样保留，不降级证书验证。
  if (!isSupabase || hasExplicitTls || (sslMode !== null && sslMode !== 'require')) {
    return options
  }

  // 沿用 Supabase 的 TLS 兼容策略，避免 Vercel 对 pooler 证书链的验证失败。
  // URL 的 SSL 参数会覆盖 pg 的 ssl 对象，因此仅在此兼容分支移除它们。
  parsed.searchParams.delete('sslmode')
  parsed.searchParams.delete('uselibpqcompat')
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } }
}
