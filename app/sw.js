/* Offline support: keeps the app files on the device so it opens without internet.
 * The page is fetched from the network first (so updates arrive), the cache is the fallback.
 * Other app files are versioned (?v=BUILD), so cached copies are safe to serve first.
 * Google sign-in, Drive and logging requests always go to the network.
 */
var VERSION = '2026-11-22.9';
var CACHE = 'prompter-' + VERSION;
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].concat(
  ['app.css', 'core.js', 'log.js', 'merge.js', 'store.js', 'settings.js', 'sync.js', 'prompter.js', 'app.js'].map(function (f) { return f + '?v=' + VERSION; }));

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('prompter-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put('./', copy); }); return r;
    }).catch(function () { return caches.match('./').then(function (r) { return r || caches.match('index.html'); }); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    });
  }));
});
