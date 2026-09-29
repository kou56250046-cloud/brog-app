// 全ページ共通のシェル（head / ヘッダー / フッター）
import { escapeHtml, rel, when } from "../lib/util.mjs";

/**
 * @param {object} o
 * @param {object} o.site
 * @param {string} o.v        アセットのキャッシュバスター
 * @param {number} o.depth    ページの階層（0 = ルート）
 * @param {string} o.path     ルートからのパス（canonical 用）
 * @param {string} o.title
 * @param {string} o.description
 * @param {string} o.body
 * @param {boolean} [o.progress]  読書進捗バーを出すか
 * @param {boolean} [o.search]    検索インデックスを読み込むか
 * @param {string} [o.ogType]
 */
export function renderPage(o) {
  const { site, v, depth, title, description, body } = o;
  const r = (p) => rel(depth, p);
  const fullTitle = title === site.title ? site.title : `${title} | ${site.title}`;
  const canonical = `${site.url.replace(/\/$/, "")}/${o.path === "index.html" ? "" : o.path}`;

  return `<!doctype html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${when(o.base, `<base href="${escapeHtml(o.base || "")}" />`)}
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:title" content="${escapeHtml(fullTitle)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="${o.ogType || "website"}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta name="theme-color" content="#f5f6f2" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#14181f" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="${r("assets/favicon.svg")}" type="image/svg+xml" />
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="${r("feed.xml")}" />
<link rel="stylesheet" href="${r("assets/style.css")}?v=${v}" />
<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body data-root="${depth ? "../".repeat(depth) : "./"}">
<a class="skip" href="#main">本文へ移動</a>
${when(o.progress, '<div class="progress" aria-hidden="true"><span></span></div>')}
<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="${r("")}">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="4"/><path d="M7 9l3 3-3 3M12.5 15H17"/></svg>
      <span>${escapeHtml(site.title)}</span>
    </a>
    <nav class="site-nav" aria-label="サイト">
      <a href="${r("")}#articles">記事</a>
      <a href="${r("tags.html")}">タグ</a>
      <form class="nav-search" action="${r("")}" role="search">
        <label class="sr-only" for="nav-q">記事を検索</label>
        <input id="nav-q" name="q" type="search" placeholder="検索" autocomplete="off" />
        <kbd>/</kbd>
      </form>
      <button class="theme-toggle" type="button" aria-label="配色を切り替える" title="配色を切り替える">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4"/></svg>
      </button>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="site-footer-inner">
    <p>${escapeHtml(site.tagline)}</p>
    <p><a href="${r("feed.xml")}">RSS</a>${site.repo ? ` ／ <a href="${escapeHtml(site.repo)}">GitHub</a>` : ""}</p>
  </div>
</footer>
${when(o.search, `<script src="${r("search-index.js")}?v=${v}"></script>`)}
<script src="${r("assets/app.js")}?v=${v}"></script>
</body>
</html>
`;
}
