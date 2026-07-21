// Course+ service worker.
//
// Scoped to /Course-plus-app/ so it controls THIS app's pages even when a
// sibling suite app has registered a broader root-scope ('/') worker on the
// shared github.io origin — the browser routes a page to the registration with
// the longest matching scope, so ours wins for /Course-plus-app/*. This is what
// stops a sibling's cached shell from being served to us (the old "blank page /
// stale bundle" bug).
//
// Strategy:
//  - HTML shell  -> NETWORK-FIRST, so a new deploy is picked up immediately;
//                   fall back to the cached shell only when offline.
//  - hashed asset (assets/*-<hash>.js|css|wasm) -> CACHE-FIRST; the content hash
//    is in the filename, so a cache hit is always the right bytes.
//  - everything else (Supabase API, Hugging Face model/wasm downloads, fonts,
//    other apps) -> NOT intercepted; goes straight to the network. We never
//    respondWith() for cross-origin or out-of-scope requests, so we can't break
//    API calls and don't double-cache the ~40MB Whisper model (transformers.js
//    keeps that in its own 'transformers-cache').
const CACHE = 'course-plus-v37'
const SCOPE_PATH = new URL(self.registration.scope).pathname // e.g. "/Course-plus-app/"

self.addEventListener('install', () => {
  // Take over as soon as the new worker is installed — no waiting for all tabs
  // to close, so a fresh deploy applies on the next navigation.
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Drop only OUR own stale cache versions; leave sibling apps' caches and the
    // transformers model cache untouched.
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => k.startsWith('course-plus-') && k !== CACHE).map((k) => caches.delete(k)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Only our own same-origin, in-scope requests. Bypass everything else.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return

  const isShell = req.mode === 'navigate'
    || url.pathname === SCOPE_PATH
    || url.pathname === SCOPE_PATH + 'index.html'

  if (isShell) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put(SCOPE_PATH, res.clone()) // store under the scope root for offline
        return res
      } catch {
        const cache = await caches.open(CACHE)
        return (await cache.match(SCOPE_PATH)) || (await cache.match(req)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    })())
  }
  // Other in-scope GETs (manifest, icon) fall through to the network.
})
