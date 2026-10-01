// Service Worker — HALQA SMS
// Caches all app shell assets on install so the app loads fully offline.
// Firebase SDK is intentionally NOT cached here (it comes from CDN and can't be
// precached reliably). The app works offline because all data is in localStorage;
// the only online requirement is Firebase sync (which queues when offline).

const CACHE = "HALQA-v24-production";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/logo.png",
  "/assets/icon-72.png",
  "/assets/icon-96.png",
  "/assets/icon-128.png",
  "/assets/icon-144.png",
  "/assets/icon-152.png",
  "/assets/icon-192.png",
  "/assets/icon-384.png",
  "/assets/icon-512.png"
];

// Install Event: Cache App Shell (tolerant of missing files)
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      console.log("[SW] Pre-caching App Shell");
      // Cache each file individually so one missing file doesn't break install
      for (const url of SHELL) {
        try { await c.add(url); } catch (err) { console.warn("[SW] Could not cache:", url, err.message); }
      }
    })
  );
});

// Activate Event: Cleanup Old Caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: cache-first for shell, network-first for Firebase CDN ─────────────
function shouldRefreshFirst(request) {
  if (request.mode === "navigate") return true;
  const url = new URL(request.url);
  return /\.(?:html|js|css|json)$/i.test(url.pathname);
}

function networkFirst(request) {
  // Good for HTML/navigate to ensure latest shell, but hangs on slow networks
  return fetch(request).then((res) => {
    if (res && res.status === 200 && res.type === "basic") {
      const clone = res.clone();
      caches.open(CACHE).then((c) => c.put(request, clone));
    }
    return res;
  }).catch(() => caches.match(request).then((cached) => {
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("/index.html");
    return undefined;
  }));
}

function staleWhileRevalidate(request) {
  // Instantly returns cached version, while quietly fetching the latest in the background
  return caches.match(request).then((cached) => {
    const fetchPromise = fetch(request).then((res) => {
      if (res && res.status === 200 && res.type === "basic") {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(request, clone));
      }
      return res;
    }).catch(() => { }); // silent fail if offline
    return cached || fetchPromise;
  });
}

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Always pass through Firebase / Supabase / Google API / local print server calls
  if (url.includes("firebaseapp.com") || url.includes("googleapis.com") ||
    url.includes("gstatic.com") || url.includes("firebaseio.com") ||
    url.includes("firebasedatabase.app") || url.includes("identitytoolkit") ||
    url.includes("securetoken.google") || url.includes("cloudfunctions.net") ||
    url.includes("supabase.co") || url.includes("127.0.0.1")) {
    return; // let browser handle natively — never intercept cloud/API traffic
  }

  // For same-origin requests
  if (url.startsWith(self.location.origin)) {
    if (e.request.mode === "navigate") {
      // Always try network first for HTML so the user gets the latest version
      e.respondWith(networkFirst(e.request));
      return;
    }

    const parsedUrl = new URL(e.request.url);
    if (/\.(?:js|css|json)$/i.test(parsedUrl.pathname)) {
      // Blazing fast dynamic module loading (Stale-While-Revalidate)
      e.respondWith(staleWhileRevalidate(e.request));
      return;
    }

    // Everything else (images, etc) is Cache-First
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        }).catch(() => {
          // If offline and not cached, return a minimal offline page for navigation
          if (e.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
      })
    );
  }
});


self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

