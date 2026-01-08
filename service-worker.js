
const CACHE_NAME = 'gforce-pro-v2';
const ASSETS = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://esm.sh/react-dom@^19.2.3/',
  'https://esm.sh/react@^19.2.3/',
  'https://esm.sh/@google/genai@^1.34.0',
  'https://esm.sh/recharts@^3.6.0',
  'https://esm.sh/jspdf@^2.5.1',
  'https://esm.sh/html2canvas@^1.4.1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Stratégie : Network First, falling back to cache
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
