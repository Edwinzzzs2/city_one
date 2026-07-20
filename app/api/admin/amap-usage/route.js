import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/auth'
import { getSystemSettings, transaction } from '@/lib/db'

function quotaValue(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0
}

function serviceSummary(row, quota) {
  const month = Number(row?.month_count || 0)
  const today = Number(row?.today_count || 0)
  return {
    today,
    month,
    quota,
    remaining: quota > 0 ? Math.max(0, quota - month) : null,
    percentage: quota > 0 ? Math.min(100, Number(((month / quota) * 100).toFixed(1))) : null,
  }
}

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ ok: false, error: '需要管理员权限' }, { status: 403 })

  try {
    const [settings, data] = await Promise.all([
      getSystemSettings(),
      transaction(async client => {
        const summary = await client.query(`
          WITH clock AS (
            SELECT
              (NOW() AT TIME ZONE 'Asia/Shanghai')::date AS today,
              date_trunc('month', NOW() AT TIME ZONE 'Asia/Shanghai')::date AS month_start
          ), services(service) AS (VALUES ('map_init'), ('place_search'))
          SELECT
            services.service,
            COALESCE(SUM(usage.count) FILTER (WHERE usage.usage_date = clock.today), 0)::int AS today_count,
            COALESCE(SUM(usage.count) FILTER (WHERE usage.usage_date >= clock.month_start AND usage.usage_date <= clock.today), 0)::int AS month_count,
            clock.today::text AS today,
            clock.month_start::text AS month_start,
            (clock.month_start + INTERVAL '1 month - 1 day')::date::text AS month_end
          FROM services
          CROSS JOIN clock
          LEFT JOIN amap_usage_daily usage ON usage.service = services.service
          GROUP BY services.service, clock.today, clock.month_start
          ORDER BY services.service
        `)
        const daily = await client.query(`
          WITH clock AS (
            SELECT (NOW() AT TIME ZONE 'Asia/Shanghai')::date AS today
          ), dates AS (
            SELECT generate_series(clock.today - 13, clock.today, INTERVAL '1 day')::date AS usage_date
            FROM clock
          )
          SELECT
            dates.usage_date::text AS date,
            COALESCE(SUM(usage.count) FILTER (WHERE usage.service = 'map_init'), 0)::int AS map_init,
            COALESCE(SUM(usage.count) FILTER (WHERE usage.service = 'place_search'), 0)::int AS place_search
          FROM dates
          LEFT JOIN amap_usage_daily usage ON usage.usage_date = dates.usage_date
          GROUP BY dates.usage_date
          ORDER BY dates.usage_date
        `)
        return { summary: summary.rows, daily: daily.rows }
      }),
    ])

    const rows = Object.fromEntries(data.summary.map(row => [row.service, row]))
    const period = data.summary[0] || {}
    return NextResponse.json({
      ok: true,
      estimated: true,
      period: { today: period.today, monthStart: period.month_start, monthEnd: period.month_end },
      services: {
        mapInit: serviceSummary(rows.map_init, quotaValue(settings.amapMapMonthlyQuota)),
        placeSearch: serviceSummary(rows.place_search, quotaValue(settings.amapSearchMonthlyQuota)),
      },
      daily: data.daily,
    })
  } catch (error) {
    console.error('[GET /api/admin/amap-usage]', error)
    return NextResponse.json({ ok: false, error: '读取高德用量失败' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
