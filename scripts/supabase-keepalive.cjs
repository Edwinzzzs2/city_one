const { setTimeout: delay } = require('node:timers/promises')

const PROJECT_REF = 'couqibjqkteustcupify'
const REQUESTS_PER_RUN = 3
const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 10000
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function configuration(env) {
  const base = String(env.SUPABASE_KEEPALIVE_URL || '').trim()
  const key = String(env.SUPABASE_KEEPALIVE_KEY || '').trim()
  if (!base || !key) throw new Error('请设置 SUPABASE_KEEPALIVE_URL 和 SUPABASE_KEEPALIVE_KEY')
  const url = new URL(base)
  // 保活只访问本项目的 Supabase，不能误用已经迁移到内网库的 DATABASE_URL。
  if (url.protocol !== 'https:' || url.hostname !== `${PROJECT_REF}.supabase.co`
    || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== '/') {
    throw new Error('SUPABASE_KEEPALIVE_URL 必须是本项目的 HTTPS 项目根地址')
  }
  url.pathname = '/rest/v1/city_addresses'
  url.search = '?select=id&limit=1'
  return { url, key }
}

async function queryOnce(config, fetchRequest = fetch) {
  let lastFailure
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 请求真实业务表才能形成数据库活动；只读一个 ID，不记录或修改业务数据。
      const response = await fetchRequest(config.url, {
        headers: { apikey: config.key, Accept: 'application/json' },
        cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.ok) {
        const rows = await response.json()
        if (!Array.isArray(rows)) throw new Error('Supabase 返回了非预期结果')
        return
      }
      let code = ''
      try { code = (await response.json()).code || '' } catch { /* 网关错误可能没有 JSON 响应。 */ }
      // 只输出状态和错误码，不输出响应正文、API key 或表内数据。
      lastFailure = new Error(`Supabase HTTP ${response.status}${code ? ` (${code})` : ''}`)
      if (!RETRYABLE_STATUSES.has(response.status)) throw lastFailure
    } catch (error) {
      if (error === lastFailure) throw error
      lastFailure = new Error(`Supabase 查询失败：${error.name || '网络异常'}`)
    }
    if (attempt < MAX_ATTEMPTS) await delay(attempt * 1000)
  }
  throw lastFailure
}

async function keepAlive(env = process.env, fetchRequest = fetch) {
  const config = configuration(env)
  for (let i = 0; i < REQUESTS_PER_RUN; i++) await queryOnce(config, fetchRequest)
  console.log(`[supabase-keepalive] ${new Date().toISOString()} 完成 ${REQUESTS_PER_RUN} 次只读查询`)
}

if (require.main === module) {
  keepAlive().catch(error => {
    console.error(`[supabase-keepalive] ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { configuration, keepAlive }
