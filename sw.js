// Offline support + reliable updates.
// - Every request for the app's own files goes to the server first, *revalidating* (cache: 'no-cache'),
//   so a new version shows up the next time the app opens — even in an installed Android/iPhone app,
//   where GitHub Pages' 10-minute browser cache would otherwise serve old files.
// - If there's no connection, the last copy saved here is used (works offline / in the gym basement).
// Bump VERSION whenever app files change.
const VERSION = 'grit-v24';
const SHELL = ['./', 'index.html', 'app.css', 'db.js', 'charts.js', 'food-lookup.js', 'health.js', 'nutrition.js', 'training.js', 'cloud.js', 'editor.js', 'recipes.js', 'app.js', 'config.js', 'vendor/supabase.js', 'plans/index.json', 'plans/pbbsw-phase-1.json', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

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
