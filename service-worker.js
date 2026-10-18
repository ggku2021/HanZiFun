const CACHE_NAME = "hanzifun-__BUILD_VERSION__";
const CDN_ORIGIN = "https://cdn.jsdelivr.net";
const APP_SHELL = [
  "./",
  "./index.html",
  "./tailwind.css",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/fflate.min.js",
  "./data/content-templates.js",
  "./data/strokes.js",
  "./data/stroke-index.js",
  "./data/pinyin.js"
];
const PDF_RUNTIME = [
  "./vendor/jspdf.umd.min.js",
  "./vendor/hb-subset.wasm",
  "./vendor/fonts/kai.ttf",
  "./vendor/fonts/kai-chars.json",
  "./vendor/fonts/song.ttf",
  "./vendor/fonts/song-chars.json",
  "./vendor/fonts/hei.ttf",
  "./vendor/fonts/hei-chars.json",
  "./vendor/fonts/fangsong.ttf",
  "./vendor/fonts/fangsong-chars.json"
];

function isContentHashedStrokePack(url) {
  return /\/data\/strokes-pack-\d+-[a-f0-9]{8,}\.zip$/i.test(url.pathname);
}

async function putInCache(cache, request) {
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Failed to fetch ${request.url}: ${response.status}`);
  await cache.put(request, response);
}

async function cacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(urls.map((url) => {
    const href = new URL(url, self.location.href).href;
    return putInCache(cache, new Request(href, { mode: "cors" })).catch(() => undefined);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: "no-cache" })
            .then((response) => {
              if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
              return cache.put(url, response);
            })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("hanzifun-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_URLS" && Array.isArray(event.data.urls)) {
    event.waitUntil(cacheUrls(event.data.urls));
  }
  if (event.data?.type === "CACHE_PDF_RUNTIME") {
    event.waitUntil(cacheUrls(PDF_RUNTIME));
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isCDN = url.origin === CDN_ORIGIN;
  if (url.origin !== self.location.origin && !isCDN) return;

  if (isCDN) {
    const result = isContentHashedStrokePack(url)
      ? caches.match(event.request).then(async (cached) => {
        if (cached) return { response: cached, cacheWrite: Promise.resolve() };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch(event.request, { signal: controller.signal });
          let cacheWrite = Promise.resolve();
          if (response.ok) {
            const cacheResponse = response.clone();
            cacheWrite = caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, cacheResponse))
              .catch(() => undefined);
          }
          return { response, cacheWrite };
        } finally {
          clearTimeout(timer);
        }
      })
      : fetch(event.request)
        .then((response) => {
          let cacheWrite = Promise.resolve();
          if (response.ok) {
            const cacheResponse = response.clone();
            cacheWrite = caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, cacheResponse))
              .catch(() => undefined);
          }
          return { response, cacheWrite };
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return { response: cached, cacheWrite: Promise.resolve() };
          throw new Error("CDN request failed and no cache available");
        });
    event.respondWith(result.then(({ response }) => response));
    event.waitUntil(result.then(({ cacheWrite }) => cacheWrite).catch(() => undefined));
    return;
  }

  // Same-origin: network-first — always fetch fresh content, fall back to cache offline
  const result = fetch(event.request, { cache: "no-cache" })
    .then((response) => {
      let cacheWrite = Promise.resolve();
      if (response.ok) {
        const cacheResponse = response.clone();
        cacheWrite = caches.open(CACHE_NAME)
          .then((cache) => cache.put(event.request, cacheResponse))
          .catch(() => undefined);
      }
      return { response, cacheWrite };
    })
    .catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return { response: cached, cacheWrite: Promise.resolve() };
      throw new Error("Network failed and no cache available");
    });

  event.respondWith(result.then(({ response }) => response));
  event.waitUntil(result.then(({ cacheWrite }) => cacheWrite).catch(() => undefined));
});
