const MAX_EVENT_NAME_LENGTH = 96

function normalizeEventValue(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  return String(value).slice(0, 500)
}

function normalizeEventData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, normalizeEventValue(value)])
      .filter(([, value]) => value !== undefined)
      .slice(0, 50),
  )
}

export function trackEvent(name, data) {
  if (typeof window === 'undefined') return
  if (!window.umami?.track) return

  const eventName = String(name || '').trim().slice(0, MAX_EVENT_NAME_LENGTH)
  if (!eventName) return

  try {
    window.umami.track(eventName, normalizeEventData(data))
  } catch {
    // Analytics should never break the primary workflow.
  }
}

export function readableEventName(action, detail) {
  const prefix = String(action || '').trim()
  const suffix = String(detail || '').replace(/\s+/g, ' ').trim()
  const name = suffix ? `${prefix}: ${suffix}` : prefix

  return name.slice(0, MAX_EVENT_NAME_LENGTH)
}
