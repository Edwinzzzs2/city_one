const CACHE_PREFIX = 'city-one-static-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' })
        if (response.ok && !response.redirected) await cache.put(url, response)
      } catch {
        // A protected preview may reject public assets. Do not block activation.
      }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function updateStaticCache(request) {
  const response = await fetch(request)
  if (response.ok && !response.redirected) {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request)
      } catch {
        return await caches.match('/offline.html') || Response.error()
      }
    })())
    return
  }

  const isStaticAsset = url.pathname.startsWith('/_next/static/')
    || PRECACHE_URLS.includes(url.pathname)
  if (!isStaticAsset) return

  const networkUpdate = updateStaticCache(request)
  event.waitUntil(networkUpdate.catch(() => undefined))
  event.respondWith(caches.match(request).then(cached => cached || networkUpdate))
})
