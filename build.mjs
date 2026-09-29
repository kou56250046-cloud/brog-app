#!/usr/bin/env node
// 静的サイトビルダー
// content/articles/*.md を読み、dist/ に HTML / CSS / JS を書き出す。
// 外部パッケージには一切依存しない（Node 標準ライブラリのみ）。
// ページ内の参照はすべて相対パス。file:// でも GitHub Pages のサブパスでも動く。

import fs from "node:fs";
import path from "node:path";
import site from "./site.config.mjs";
import { loadSite, relatedArticles } from "./src/lib/content.mjs";
import { renderMarkdown, stripMarkdown } from "./src/lib/markdown.mjs";
import { resetFlowIds } from "./src/lib/flow.mjs";
import { renderPage } from "./src/templates/layout.mjs";
import * as P from "./src/templates/pages.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const V = String(Date.now()).slice(-8); // アセットのキャッシュバスター

const t0 = Date.now();
let fileCount = 0;
let byteCount = 0;

/* ---------- ファイル出力 ---------- */

function write(rel, content) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fileCount += 1;
  byteCount += Buffer.byteLength(content);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      fileCount += 1;
      byteCount += fs.statSync(src).size;
    }
  }
}

const xml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

const abs = (p) => `${site.url.replace(/\/$/, "")}/${p}`;

/* ---------- ビルド ---------- */

fs.rmSync(DIST, { recursive: true, force: true });
const data = loadSite(site);
const page = (opts) => renderPage({ site, v: V, ...opts });

// --- トップ ---
write("index.html", page({
  depth: 0,
  path: "index.html",
  title: site.title,
  description: site.description,
  search: true,
  body: P.home(data, site),
}));

// --- 記事 ---
data.articles.forEach((a, i) => {
  resetFlowIds();
  let rendered;
  try {
    rendered = renderMarkdown(a.content);
  } catch (err) {
    throw new Error(`${a.slug}.md の変換に失敗: ${err.message}`);
  }
  const series = a.series
    ? data.articles.filter((x) => x.series === a.series).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.slug < y.slug ? -1 : 1))
    : [];
  write(a.url, page({
    depth: 1,
    path: a.url,
    title: a.title,
    description: a.description,
    ogType: "article",
    progress: true,
    body: P.articlePage({
      article: a,
      html: rendered.html,
      headings: rendered.headings,
      related: relatedArticles(a, data.articles),
      prev: data.articles[i + 1] || null,
      next: data.articles[i - 1] || null,
      series,
      data,
    }),
  }));
});

// --- カテゴリー・タグ ---
for (const c of data.categories) {
  write(c.url, page({
    depth: 1,
    path: c.url,
    title: c.name,
    description: c.description || `カテゴリー「${c.name}」の記事 ${c.count} 本。`,
    body: P.listPage({ kind: "カテゴリー", name: c.name, description: c.description, items: data.articles.filter((a) => a.category === c.name), data }),
  }));
}

for (const t of data.tags) {
  write(t.url, page({
    depth: 1,
    path: t.url,
    title: `#${t.name}`,
    description: `タグ「${t.name}」の記事 ${t.count} 本。`,
    body: P.listPage({ kind: "タグ", name: t.name, description: "", items: data.articles.filter((a) => a.tags.includes(t.name)), data }),
  }));
}

write("tags.html", page({
  depth: 0,
  path: "tags.html",
  title: "タグ",
  description: "すべてのタグの一覧。",
  body: P.tagsPage(data),
}));

// 404 は任意の階層で返されるため <base> でサイトルートを固定する
write("404.html", page({
  depth: 0,
  path: "404.html",
  base: new URL(site.url.replace(/\/?$/, "/")).pathname,
  title: "ページが見つかりません",
  description: "お探しのページは見つかりませんでした。",
  body: P.notFoundPage(),
}));

/* ---------- データファイル ---------- */

// 検索インデックス。file:// で fetch できないため JS として読み込ませる
const index = data.articles.map((a) => ({
  s: a.slug,
  t: a.title,
  d: a.description,
  g: a.tags,
  c: a.category,
  l: a.levels,
  u: a.url,
  dt: a.date,
  m: a.minutes,
  b: stripMarkdown(a.content),
}));
write("search-index.js", `window.SEARCH_INDEX=${JSON.stringify(index).replace(/</g, "\\u003c")};\n`);

// RSS
const rssItems = data.articles
  .slice(0, 30)
  .map((a) => `    <item>
      <title>${xml(a.title)}</title>
      <link>${xml(abs(a.url))}</link>
      <guid isPermaLink="true">${xml(abs(a.url))}</guid>
      <description>${xml(a.description)}</description>
      <category>${xml(a.category)}</category>
      <pubDate>${new Date(`${a.date}T09:00:00+09:00`).toUTCString()}</pubDate>
    </item>`)
  .join("\n");

write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(site.title)}</title>
    <link>${xml(abs(""))}</link>
    <description>${xml(site.description)}</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${xml(abs("feed.xml"))}" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>
`);

// サイトマップ
const urls = ["", "tags.html", ...data.categories.map((c) => c.url), ...data.tags.map((t) => t.url), ...data.articles.map((a) => a.url)];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xml(abs(u))}</loc></url>`).join("\n")}
</urlset>
`);

// GitHub Pages で Jekyll 処理を止める
write(".nojekyll", "");

/* ---------- アセット ---------- */

copyDir(path.join(ROOT, "public"), DIST);
copyDir(path.join(ROOT, "src", "assets"), path.join(DIST, "assets"));

/* ---------- 結果表示 ---------- */

const kb = (byteCount / 1024).toFixed(0);
console.log(`ビルド完了  ${Date.now() - t0}ms`);
console.log(`  記事 ${data.stats.articleCount} 本 / カテゴリー ${data.stats.categoryCount} / タグ ${data.stats.tagCount}`);
console.log(`  出力 ${fileCount} ファイル・${kb} KB → dist/`);
