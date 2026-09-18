// src/sw.js — custom service worker (used with vite-plugin-pwa "injectManifest")
//
// Handles the Web Share Target: when the user shares an image to the installed
// Sudoku PWA (Android/Chrome "Teilen" → Sudoku), the browser POSTs it here.
// We stash the file in Cache Storage and redirect into the app with ?shared=1,
// where App.jsx picks it up and runs it through the existing OCR scanner.

import { precacheAndRoute } from "workbox-precaching";

precacheAndRoute(self.__WB_MANIFEST);

const BASE = "/sudoku/"; // must match `base` in vite.config.js
const SHARE_TARGET_PATH = `${BASE}share-target/`;

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event));
  }
});

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const file = formData.get("image");
    if (file) {
      const cache = await caches.open("shared-images");
      await cache.put("/shared-image", new Response(file));
    }
  } catch (e) {
    // fall through — app will just not find anything in the cache
  }
  return Response.redirect(`${BASE}?shared=1`, 303);
}
