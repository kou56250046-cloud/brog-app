// 各ページの本文テンプレート
import { escapeHtml, formatDate, map, rel, when } from "../lib/util.mjs";
import { LEVELS } from "../lib/content.mjs";
import { heroFigure, heroThumb } from "../lib/hero.mjs";

const LEVEL_KEYS = Object.keys(LEVELS);

/**
 * 入門→実践→発展 のうち、記事が扱う範囲を塗った目盛り。
 * 範囲は色だけに頼らず、塗り／斜線の質感と、横に添える文字でも示す
 */
function levelTrack(levels) {
  const all = LEVEL_KEYS.every((k) => levels.includes(k));
  const note = all ? "全範囲" : levels.length === 1 ? `${levelRange(levels)}のみ` : levelRange(levels);
  return `<div class="post-level">
  <span class="level-track" aria-hidden="true">${map(
    LEVEL_KEYS,
    (k) => `<span class="lv${levels.includes(k) ? " on" : ""}">${LEVELS[k].label}</span>`
  )}</span>
  <span class="level-note"><span class="sr-only">難易度: </span>${all ? `${levelRange(levels)}の${note}` : note}</span>
</div>`;
}

function levelRange(levels) {
  const sorted = [...levels].sort((a, b) => LEVELS[a].order - LEVELS[b].order);
  return sorted.length > 1
    ? `${LEVELS[sorted[0]].label}→${LEVELS[sorted[sorted.length - 1]].label}`
    : LEVELS[sorted[0]].label;
}

/** 記事一覧の 1 行 */
function entry(a, depth, data) {
  const r = (p) => rel(depth, p);
  const cat = data.catByName.get(a.category);
  return `<article class="entry" data-cat="${escapeHtml(a.category)}" data-levels="${a.levels.join(" ")}" data-slug="${escapeHtml(a.slug)}">
  <time datetime="${a.date}">${formatDate(a.date, "dot")}</time>
  <div class="entry-body">
    <h3><a href="${r(a.url)}">${escapeHtml(a.title)}</a></h3>
    <p>${escapeHtml(a.description)}</p>
    <div class="entry-meta">
      <a class="cat" href="${r(cat.url)}"${cat.color ? ` style="--cat:${cat.color}"` : ""}>${escapeHtml(a.category)}</a>
      <span class="lvl">${levelRange(a.levels)}</span>
      <span>${a.minutes}分</span>
    </div>
  </div>
  <div class="entry-thumb" aria-hidden="true"${cat.color ? ` style="--cat:${cat.color}"` : ""}>${heroThumb(a)}</div>
</article>`;
}

function entryList(items, depth, data) {
  return `<div class="entries">${map(items, (a) => entry(a, depth, data))}</div>`;
}

/* ---------- トップ ---------- */

/** 絞り込みやカテゴリー一覧が意味を持ち始める記事数。これ未満では出さない */
const FACET_MIN_ARTICLES = 3;

function chipRow(filter, label, items) {
  const id = `filter-${filter}`;
  return `<div class="chip-row" role="group" aria-labelledby="${id}" data-filter="${filter}">
        <span class="chip-label" id="${id}">${label}</span>
        ${map(items, (it, i) => `<button type="button" class="chip${i === 0 ? " on" : ""}" aria-pressed="${i === 0}" data-value="${escapeHtml(it.value)}">${escapeHtml(it.label)}${it.count ? `<span>${it.count}</span>` : ""}</button>`)}
      </div>`;
}

export function home(data, site) {
  const depth = 0;
  const r = (p) => rel(depth, p);
  const facets = data.articles.length >= FACET_MIN_ARTICLES;

  const filters = facets
    ? `<div class="filters">
      ${chipRow("cat", "カテゴリ", [{ value: "", label: "すべて" }, ...data.categories.map((c) => ({ value: c.name, label: c.name, count: c.count }))])}
      ${chipRow("level", "レベル", [{ value: "", label: "すべて" }, ...LEVEL_KEYS.map((k) => ({ value: k, label: LEVELS[k].label }))])}
    </div>`
    : "";

  const side = facets
    ? `<aside class="home-side">
    <section>
      <h2 class="side-h">カテゴリー</h2>
      <ul class="cat-list">
        ${map(data.categories, (c) => `<li><a href="${r(c.url)}"${c.color ? ` style="--cat:${c.color}"` : ""}><span class="name">${escapeHtml(c.name)}</span><span class="n">${c.count}</span></a>${c.description ? `<p>${escapeHtml(c.description)}</p>` : ""}</li>`)}
      </ul>
    </section>
    <section>
      <h2 class="side-h">よく使うタグ</h2>
      <p class="tag-cloud">${map(data.tags.slice(0, 24), (t) => `<a href="${r(t.url)}">${escapeHtml(t.name)}<span>${t.count}</span></a>`)}</p>
      <p><a class="more" href="${r("tags.html")}">すべてのタグを見る</a></p>
    </section>
  </aside>`
    : "";

  return `<section class="home-hero">
  <div class="wrap">
    <h1>${escapeHtml(site.tagline)}</h1>
    <p class="home-lead">${escapeHtml(site.description)}。</p>
    <form class="big-search" role="search" onsubmit="return false">
      <label class="sr-only" for="q">記事を検索</label>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
      <input id="q" type="search" placeholder="キーワードで記事を検索（本文・コード説明も対象）" autocomplete="off" />
    </form>
    ${filters}
  </div>
</section>

<div class="wrap home-grid${side ? "" : " no-side"}">
  <section id="articles" aria-labelledby="articles-h">
    <h2 id="articles-h" class="section-h">記事<span class="count" data-count>${data.stats.articleCount}本</span></h2>
    <p class="search-status" role="status" data-status></p>
    <div data-list>${data.articles.length ? entryList(data.articles, depth, data) : '<p class="empty">まだ記事がありません。「〜について記事を作成して」と頼むと、リサーチから始まります。</p>'}</div>
  </section>
  ${side}
</div>`;
}

/* ---------- 記事 ---------- */

function toc(headings) {
  const items = headings.filter((h) => h.level === 2 || h.level === 3);
  if (items.length < 2) return "";
  return `<nav class="toc" aria-label="目次">
  <details open>
    <summary>目次</summary>
    <ol>${map(items, (h) => `<li class="toc-l${h.level}"><a href="#${escapeHtml(encodeURIComponent(h.id))}" data-id="${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`)}</ol>
  </details>
</nav>`;
}

export function articlePage({ article: a, html, headings, related, prev, next, series, data }) {
  const depth = 1;
  const r = (p) => rel(depth, p);
  const cat = data.catByName.get(a.category);

  const seriesNav = series.length > 1
    ? `<nav class="series" aria-label="シリーズ「${escapeHtml(a.series)}」">
  <p class="series-h">シリーズ：${escapeHtml(a.series)}</p>
  <ol>${map(series, (s) => `<li${s.slug === a.slug ? ' aria-current="page"' : ""}><a href="${r(s.url)}">${escapeHtml(s.title)}</a></li>`)}</ol>
</nav>`
    : "";

  return `<article class="post">
  <header class="post-head wrap">
    <p class="post-crumb"><a href="${r("")}">記事一覧</a><span aria-hidden="true">／</span><a href="${r(cat.url)}">${escapeHtml(a.category)}</a></p>
    ${levelTrack(a.levels)}
    <h1>${escapeHtml(a.title)}</h1>
    <p class="post-desc">${escapeHtml(a.description)}</p>
    <dl class="spec">
      <div><dt>公開</dt><dd><time datetime="${a.date}">${formatDate(a.date)}</time>${a.updated ? `<br /><span class="spec-sub">更新 <time datetime="${a.updated}">${formatDate(a.updated)}</time></span>` : ""}</dd></div>
      ${when(a.verified, `<div><dt>情報の確認日</dt><dd><time datetime="${a.verified}">${formatDate(a.verified)}</time></dd></div>`)}
      <div><dt>読了</dt><dd>約${a.minutes}分${a.codeLines ? `（コード${a.codeLines}行）` : ""}</dd></div>
      <div><dt>タグ</dt><dd class="tags">${map(a.tags, (t) => `<a href="${r(data.tagByName.get(t).url)}">${escapeHtml(t)}</a>`)}</dd></div>
    </dl>
    ${heroFigure(a, cat.color)}
  </header>

  <div class="post-layout wrap">
    <aside class="post-aside">${toc(headings)}</aside>
    <div class="prose">
${seriesNav}
${html}
    </div>
  </div>

  <footer class="post-foot wrap">
    ${when(prev || next, `<nav class="pager" aria-label="前後の記事">
      ${prev ? `<a class="prev" href="${r(prev.url)}"><span>前の記事</span>${escapeHtml(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="${r(next.url)}"><span>次の記事</span>${escapeHtml(next.title)}</a>` : "<span></span>"}
    </nav>`)}
    ${when(related.length, `<section class="related"><h2 class="section-h">関連する記事</h2>${entryList(related, depth, data)}</section>`)}
  </footer>
</article>`;
}

/* ---------- カテゴリー・タグ ---------- */

export function listPage({ kind, name, description, items, data }) {
  const depth = 1;
  const r = (p) => rel(depth, p);
  return `<div class="wrap list-page">
  <p class="post-crumb"><a href="${r("")}">記事一覧</a><span aria-hidden="true">／</span>${kind}</p>
  <h1>${kind === "タグ" ? "#" : ""}${escapeHtml(name)}</h1>
  ${description ? `<p class="list-desc">${escapeHtml(description)}</p>` : ""}
  <p class="count">${items.length}本</p>
  ${entryList(items, depth, data)}
</div>`;
}

export function tagsPage(data) {
  const depth = 0;
  const r = (p) => rel(depth, p);
  const sorted = [...data.tags].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return `<div class="wrap list-page">
  <p class="post-crumb"><a href="${r("")}">記事一覧</a><span aria-hidden="true">／</span>タグ</p>
  <h1>タグ</h1>
  <p class="list-desc">${data.tags.length}種類。数字はそのタグが付いた記事の本数。</p>
  <p class="tag-cloud lg">${map(sorted, (t) => `<a href="${r(t.url)}">${escapeHtml(t.name)}<span>${t.count}</span></a>`)}</p>
</div>`;
}

export function offlinePage() {
  return `<div class="wrap list-page">
  <h1>オフラインです</h1>
  <p class="list-desc">このページはまだ端末に保存されていません。一度開いたページと、インストール時に保存した記事はオフラインでも読めます。</p>
  <p><a class="more" href="./index.html">記事一覧へ戻る</a></p>
</div>`;
}

export function notFoundPage() {
  return `<div class="wrap list-page">
  <h1>ページが見つかりません</h1>
  <p class="list-desc">URL が変わったか、記事が下書きに戻された可能性があります。</p>
  <p><a class="more" href="./index.html">記事一覧へ戻る</a></p>
</div>`;
}
