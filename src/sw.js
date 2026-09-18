// src/sw.js — custom service worker (verwendet mit vite-plugin-pwa "injectManifest")

import { precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

const BASE = "/sudoku/"; // muss zu `base` in vite.config.js passen
const SHARE_TARGET_PATH = `${BASE}share-target/`;
const APP_SHELL = `${BASE}index.html`;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Share-Target: Bild aus dem "Teilen"-Menü entgegennehmen
  if (request.method === "POST" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // 2) SPA-Offline-Fallback: bei Navigation zuerst Netzwerk versuchen,
  //    offline auf die gecachte index.html zurückfallen.
  if (request.mode === "navigate" && request.method === "GET") {
    event.respondWith(fetch(request).catch(() => caches.match(APP_SHELL)));
  }
});

async function handleShareTarget(event) {
  console.log("[share-target] POST empfangen:", event.request.url);
  try {
    const formData = await event.request.formData();
    console.log("[share-target] formData Felder:", [...formData.keys()]);
    const file = formData.get("image");
    console.log("[share-target] image-Feld:", file);
    if (file) {
      const cache = await caches.open("shared-images");
      await cache.put("/shared-image", new Response(file));
      console.log("[share-target] Bild im Cache gespeichert, Größe:", file.size);
    } else {
      console.warn("[share-target] Kein 'image'-Feld in formData gefunden.");
    }
  } catch (e) {
    console.error("[share-target] Fehler:", e);
  }
  return Response.redirect(`${BASE}?shared=1`, 303);
}
