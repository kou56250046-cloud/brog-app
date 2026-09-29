// Service Worker（ビルド時に dist/sw.js へ書き出す。__VERSION__ と __PRECACHE__ はビルドで置換）
// - 全ページとアセットをインストール時に保存し、オフラインでも全記事を読めるようにする
// - HTML はネットワーク優先（更新をすぐ反映）、それ以外はキャッシュ優先
"use strict";

const CACHE = "devkb-__VERSION__";
const PRECACHE = __PRECACHE__;
const OFFLINE = "offline.html";

const scoped = (p) => new URL(p, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scoped))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("devkb-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.registration.scope)) return;

  const isPage = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match(scoped(OFFLINE)))
        )
    );
    return;
  }

  // アセットは ?v= が付くので、クエリを無視して保存済みのものを返す
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
