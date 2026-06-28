import Script from 'next/script'

const DEFAULT_SCRIPT_URL = 'https://cloud.umami.is/script.js'

function cleanEnv(value) {
  const text = String(value || '').trim()
  return text || undefined
}

function cleanBooleanEnv(value) {
  const text = cleanEnv(value)
  if (!text) return undefined

  const normalized = text.toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return 'true'
  if (['0', 'false', 'no', 'off'].includes(normalized)) return 'false'
  return undefined
}

export default function UmamiAnalytics() {
  const websiteId = cleanEnv(process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID)

  if (!websiteId) return null

  const scriptUrl = cleanEnv(process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL) || DEFAULT_SCRIPT_URL

  return (
    <Script
      id="umami-analytics"
      src={scriptUrl}
      strategy="afterInteractive"
      data-website-id={websiteId}
      data-host-url={cleanEnv(process.env.NEXT_PUBLIC_UMAMI_HOST_URL)}
      data-domains={cleanEnv(process.env.NEXT_PUBLIC_UMAMI_DOMAINS)}
      data-tag={cleanEnv(process.env.NEXT_PUBLIC_UMAMI_TAG)}
      data-auto-track={cleanBooleanEnv(process.env.NEXT_PUBLIC_UMAMI_AUTO_TRACK)}
      data-do-not-track={cleanBooleanEnv(process.env.NEXT_PUBLIC_UMAMI_DO_NOT_TRACK)}
      data-exclude-search={cleanBooleanEnv(process.env.NEXT_PUBLIC_UMAMI_EXCLUDE_SEARCH)}
      data-exclude-hash={cleanBooleanEnv(process.env.NEXT_PUBLIC_UMAMI_EXCLUDE_HASH)}
    />
  )
}
