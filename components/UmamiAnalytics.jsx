'use client'
import { useEffect } from 'react'

function setDataAttribute(script, name, value) {
  if (value === undefined || value === null || value === '') return
  script.setAttribute(`data-${name}`, String(value))
}

export default function UmamiAnalytics() {
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/public-config', { cache: 'no-store' })
        const data = await response.json()
        const config = data?.umami
        if (cancelled || !config?.websiteId || document.getElementById('umami-analytics')) return

        const script = document.createElement('script')
        script.id = 'umami-analytics'
        script.async = true
        script.src = config.scriptUrl || 'https://cloud.umami.is/script.js'
        setDataAttribute(script, 'website-id', config.websiteId)
        setDataAttribute(script, 'host-url', config.hostUrl)
        setDataAttribute(script, 'domains', config.domains)
        setDataAttribute(script, 'tag', config.tag)
        setDataAttribute(script, 'auto-track', config.autoTrack)
        setDataAttribute(script, 'do-not-track', config.doNotTrack)
        setDataAttribute(script, 'exclude-search', config.excludeSearch)
        setDataAttribute(script, 'exclude-hash', config.excludeHash)
        document.head.appendChild(script)
      } catch {
        // Analytics must never interrupt the application.
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return null
}
