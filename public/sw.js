const VAEROEX_CACHE_PREFIX = "vaeroex-pwa";

async function clearVaeroexCaches() {
  if (!self.caches) {
    return;
  }

  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(VAEROEX_CACHE_PREFIX)).map((key) => caches.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(clearVaeroexCaches());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    clearVaeroexCaches().then(() => {
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.disable();
      }

      return undefined;
    })
  );
  self.clients.claim();
});
