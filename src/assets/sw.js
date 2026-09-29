// Service Worker（ビルド時に dist/sw.js へ書き出す。__VERSION__ と __PRECACHE__ はビルドで置換）
// - 全ページとアセットをインストール時に保存し、オフラインでも全記事を読めるようにする
// - HTML はネットワーク優先（更新をすぐ反映）。4 秒で返事が無ければ保存分を出す。それ以外はキャッシュ優先
"use strict";

const CACHE = "devkb-__VERSION__";
const PRECACHE = __PRECACHE__;
const OFFLINE = "offline.html";
/** HTML の取得をこれ以上待ったら、手元の保存分で先に表示する（電波が弱いときに待たせない） */
const NET_TIMEOUT_MS = 4000;

const scoped = (p) => new URL(p, self.registration.scope).href;

// 画面の骨格（トップ・CSS/JS・オフラインページ・アイコン）は必須。1 つでも取れなければインストールしない。
// 個々の記事・一覧ページは任意。1 件の失敗で全体を諦めず、取れた分だけ保存する
const isOptional = (p) => /^(articles|categories|tags)\//.test(p) || p === "tags.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(PRECACHE.filter((p) => !isOptional(p)).map(scoped));
      await Promise.all(PRECACHE.filter(isOptional).map((p) => cache.add(scoped(p)).catch(() => {})));
      await self.skipWaiting();
    })
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
      (async () => {
        const cached = () => caches.match(req, { ignoreSearch: true });
        const net = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
        net.catch(() => {}); // 保存分で先に返した後にネットワークが失敗しても未処理の例外にしない
        // 一定時間で返事が無ければ保存分を出す。保存分も無ければネットワークを待ち続ける
        const slow = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT_MS)).then(cached);
        try {
          return (await Promise.race([net, slow])) || (await net);
        } catch {
          return (await cached()) || caches.match(scoped(OFFLINE));
        }
      })()
    );
    return;
  }

  // アセットは ?v=<ビルド番号> まで含めて完全一致で返す。
  // クエリを無視すると、デプロイ直後に新しい HTML と古い CSS/JS が組み合わさって壊れる。
  // 一致しなければ取りに行き、オフラインのときだけ版違いでも手元の物を使う
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match(req, { ignoreSearch: true }))
    )
  );
});
