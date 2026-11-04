// Offline support + reliable updates.
// - Every request for the app's own files goes to the server first, *revalidating* (cache: 'no-cache'),
//   so a new version shows up the next time the app opens — even in an installed Android/iPhone app,
//   where GitHub Pages' 10-minute browser cache would otherwise serve old files.
// - If there's no connection, the last copy saved here is used (works offline / in the gym basement).
// Bump VERSION whenever app files change.
const VERSION = 'grit-v37';
const SHELL = ['./', 'index.html', 'app.css', 'db.js', 'charts.js', 'food-lookup.js', 'health.js', 'nutrition.js', 'training.js', 'cloud.js', 'editor.js', 'chat.js', 'notify.js', 'assign.js', 'recipes.js', 'app.js', 'config.js', 'vendor/supabase.js', 'plans/index.json', 'plans/pbbsw-phase-1.json', 'manifest.webmanifest', 'favicon.png', 'brand-g-green.png', 'brand-g-tan.png', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // navigation requests can't be re-created with options, so fetch them by URL
  const fresh = req.mode === 'navigate'
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(new Request(req, { cache: 'no-cache' }));
  e.respondWith(
    fresh
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? './' : req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./') || caches.match('index.html')))
  );
});

// ---------- phone notifications ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'GRIT', body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'GRIT', {
      body: d.body || '', icon: 'icon-192.png', badge: 'favicon.png', tag: d.tag || undefined, renotify: !!d.tag,
      data: { link: d.link || null, id: d.id || null },
    });
    if (self.navigator && self.navigator.setAppBadge && d.badge) self.navigator.setAppBadge(d.badge).catch(() => {});
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'grit-push' }));
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const go = encodeURIComponent(JSON.stringify(Object.assign({}, data.link || {}, { nid: data.id || null })));
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => x.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ type: 'grit-open', link: data.link || null, id: data.id || null }); return w.focus(); }
    return self.clients.openWindow(self.registration.scope + '?go=' + go);
  })());
});
