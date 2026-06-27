"use client";

import { useEffect } from "react";

export function PwaServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    const clearStaleServiceWorkerState = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister())
        );

        if ("caches" in window) {
          const keys = await window.caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith("vaeroex-pwa")).map((key) => window.caches.delete(key)));
        }
      } catch {
        // Emergency cache cleanup should never interrupt the Vaeroex user flow.
      }
    };

    void clearStaleServiceWorkerState();
  }, []);

  return null;
}
