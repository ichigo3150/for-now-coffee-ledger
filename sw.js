// アプリの画面（HTML・CSS・JS・アイコン）を端末に保存して、電波がなくても開けるようにする仕組み。
// 記録データの同期は Firebase 側が自動でやるので、ここでは扱いません。
// ファイルを更新したら VERSION の数字を1つ上げると、各端末に新しい版が届きます。
const VERSION = 'v2';
const CACHE = 'coffee-ledger-' + VERSION;
const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('coffee-ledger-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 自分のサイトのファイルだけ：まずネットから最新を取り、だめなら保存してある版を使う
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
