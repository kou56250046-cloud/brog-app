// 依存ゼロの Markdown → HTML 変換器
// 対応記法: 見出し / 段落 / 水平線 / 箇条書き / 番号付きリスト / 引用 /
//           フェンスドコード（ハイライト・ファイル名・行強調）/ GFM テーブル /
//           強調・斜体・打ち消し / インラインコード / リンク・画像 / 裸URLの自動リンク /
//           コールアウト（> [!NOTE] ほか）/ ```flow 図 / ```svg 生SVG / 生 HTML ブロック

import { highlight } from "./highlight.mjs";
import { renderFlow } from "./flow.mjs";

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// コードスパン退避用のプレースホルダ記号（本文には出現しない制御文字）
const MARK = "\u0000";

function inline(src) {
  // コードスパンを先に退避してから他の記法を処理する
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `${MARK}${codes.length - 1}${MARK}`;
  });

  s = escapeHtml(s);

  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, url, title) =>
      `<img src="${url}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy" />`
  );

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, text, href, title) => {
    const ext = /^https?:\/\//.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${href}"${title ? ` title="${title}"` : ""}${ext}>${text}</a>`;
  });

  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // まだリンク化されていない裸の URL
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)"']+)/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  s = s.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, "g"),
    (_, n) => `<code>${escapeHtml(codes[Number(n)])}</code>`
  );

  return s;
}

const isULItem = (l) => /^(\s*)[-*+]\s+\S/.test(l);
const isOLItem = (l) => /^(\s*)\d+[.)]\s+\S/.test(l);
const isItem = (l) => isULItem(l) || isOLItem(l);
const indentOf = (l) => (l.match(/^\s*/) || [""])[0].length;

function renderList(buf, ctx) {
  const first = buf.find(isItem);
  const base = indentOf(first);
  const ordered = isOLItem(first);
  const items = [];

  for (const line of buf) {
    if (isItem(line) && indentOf(line) <= base) {
      items.push([line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")]);
    } else if (items.length) {
      items[items.length - 1].push(line.slice(Math.min(indentOf(line), base + 2)));
    }
  }

  const lis = items.map((lines) => {
    const inner = blocks(lines.join("\n"), ctx).trim();
    const single = inner.match(/^<p>([\s\S]*)<\/p>$/);
    return `<li>${single && !single[1].includes("<p>") ? single[1] : inner}</li>`;
  });

  const tag = ordered ? "ol" : "ul";
  return `<${tag}>\n${lis.join("\n")}\n</${tag}>`;
}

function renderTable(rows) {
  const cells = (row) =>
    row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

  const align = cells(rows[1]).map((c) => {
    if (/^:-+:$/.test(c)) return "center";
    if (/^-+:$/.test(c)) return "right";
    if (/^:-+$/.test(c)) return "left";
    return "";
  });

  const th = cells(rows[0])
    .map((c, i) => `<th${align[i] ? ` style="text-align:${align[i]}"` : ""}>${inline(c)}</th>`)
    .join("");

  const body = rows.slice(2).map((r) => {
    const tds = cells(r)
      .map((c, i) => `<td${align[i] ? ` style="text-align:${align[i]}"` : ""}>${inline(c)}</td>`)
      .join("");
    return `<tr>${tds}</tr>`;
  });

  return `<div class="table-scroll"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body.join("\n")}\n</tbody>\n</table></div>`;
}

const RAW_HTML = /^\s*<(div|details|figure|svg|aside|section|table|video)[\s>]/i;

/* ---------- 見出し ID ---------- */

/** 見出し文から読める ID を作る（日本語はそのまま残す） */
function uniqueId(text, ctx) {
  const base =
    text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*`~]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s　]+/g, "-")
      .replace(/[!-,./:-@[-^`{-~、。（）「」『』【】：？！—―・]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  let id = base;
  for (let n = 2; ctx.ids.has(id); n++) id = `${base}-${n}`;
  ctx.ids.add(id);
  return id;
}

/* ---------- 引用とコールアウト ---------- */

const CALLOUTS = { NOTE: "メモ", TIP: "ヒント", IMPORTANT: "重要", WARNING: "注意", CAUTION: "危険" };

function renderQuote(buf, ctx) {
  const m = (buf[0] || "").match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
  if (!m) return `<blockquote>\n${blocks(buf.join("\n"), ctx)}\n</blockquote>`;
  const type = m[1].toUpperCase();
  const title = m[2].trim() || CALLOUTS[type];
  return `<aside class="callout callout-${type.toLowerCase()}"><p class="callout-title">${inline(title)}</p>\n${blocks(buf.slice(1).join("\n"), ctx)}\n</aside>`;
}

/* ---------- コードブロック ---------- */

const LANG_LABELS = {
  python: "Python", py: "Python", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript",
  typescript: "TypeScript", bash: "Bash", sh: "Shell", shell: "Shell", console: "Console",
  json: "JSON", yaml: "YAML", yml: "YAML", diff: "Diff", text: "Text", txt: "Text",
};

/** ```python title="agent.py" caption="説明" {2,5-7} の info 部分を読む */
function parseInfo(info) {
  const title = (info.match(/title\s*=\s*"([^"]*)"/) || [])[1] || "";
  const caption = (info.match(/caption\s*=\s*"([^"]*)"/) || [])[1] || "";
  const marks = new Set();
  const range = info.replace(/"[^"]*"/g, "").match(/\{([\d,\s-]+)\}/);
  if (range) {
    for (const part of range[1].split(",")) {
      const [a, b] = part.trim().split("-").map(Number);
      if (!a) continue;
      for (let n = a; n <= (b || a); n++) marks.add(n);
    }
  }
  return { title, caption, marks };
}

/** 行をまたぐ <span> を行末で閉じ、次の行頭で開き直す（行単位で包むため） */
function splitHighlighted(html) {
  const out = [];
  let carry = "";
  for (const raw of html.split("\n")) {
    let line = carry + raw;
    carry = "";
    const opens = [...line.matchAll(/<span class="[^"]*">/g)];
    const closes = (line.match(/<\/span>/g) || []).length;
    if (opens.length > closes) {
      carry = opens[opens.length - 1][0];
      line += "</span>";
    }
    out.push(line);
  }
  return out;
}

function renderFence(code, lang, { title, caption, marks }) {
  if (lang === "flow") return renderFlow(code, caption || title);
  if (lang === "svg") {
    return `<figure class="figure">${code}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
  }

  const lines = splitHighlighted(lang === "diff" ? escapeHtml(code) : highlight(code, lang));
  const body = lines
    .map((l, idx) => {
      const cls = ["line"];
      if (marks.has(idx + 1)) cls.push("hl");
      if (lang === "diff" && l.startsWith("+")) cls.push("add");
      if (lang === "diff" && l.startsWith("-")) cls.push("del");
      return `<span class="${cls.join(" ")}">${l}</span>`;
    })
    .join(""); // .line は block 表示なので改行文字を挟まない（挟むと空行が出る）

  const label = LANG_LABELS[lang] || lang;
  const head = `<div class="code-head">${title ? `<span class="code-title">${escapeHtml(title)}</span>` : ""}<span class="code-lang">${escapeHtml(label)}</span><button class="code-copy" type="button" aria-label="コードをコピー">コピー</button></div>`;
  const cap = caption ? `<div class="code-caption">${inline(caption)}</div>` : "";
  return `<div class="code-block" data-lang="${escapeHtml(lang)}">${head}<pre><code>${body}</code></pre>${cap}</div>`;
}

function blocks(md, ctx) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // フェンスドコード
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w-]*)(.*)$/);
    if (fence) {
      const [, marker, lang, info] = fence;
      const body = [];
      i++;
      while (i < lines.length && lines[i].trim() !== marker) body.push(lines[i++]);
      i++;
      out.push(renderFence(body.join("\n"), lang.toLowerCase(), parseInfo(info)));
      continue;
    }

    // 生 HTML ブロック（空行まで）
    if (RAW_HTML.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join("\n"));
      continue;
    }

    // 水平線
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr class="section-rule" />');
      i++;
      continue;
    }

    // 見出し
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = uniqueId(text, ctx);
      ctx.headings.push({ level, id, text: text.replace(/[*`~]/g, "") });
      out.push(
        `<h${level} id="${escapeHtml(id)}">${inline(text)}<a class="anchor" href="#${escapeHtml(encodeURIComponent(id))}" aria-label="この見出しへのリンク">#</a></h${level}>`
      );
      i++;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s*>\s?/.test(lines[i]) || (buf.length && lines[i].trim()))) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(renderQuote(buf, ctx));
      continue;
    }

    // テーブル
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || "")) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }

    // リスト
    if (isItem(line)) {
      const base = indentOf(line);
      const ordered = isOLItem(line);
      // 同種のリスト（番号付き／箇条書き）だけを 1 ブロックとして集める
      const sameList = (l) => isItem(l) && (indentOf(l) > base || isOLItem(l) === ordered);
      const buf = [];
      while (i < lines.length) {
        const l = lines[i];
        if (sameList(l) || (buf.length && l.trim() && /^\s+\S/.test(l))) {
          buf.push(l);
          i++;
          continue;
        }
        if (!l.trim() && sameList(lines[i + 1] || "")) {
          buf.push("");
          i++;
          continue;
        }
        break;
      }
      out.push(renderList(buf, ctx));
      continue;
    }

    // 段落
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isItem(lines[i]) &&
      !/^\s*(#{1,6}\s|>|\||```|~~~|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/.test(lines[i]) &&
      !RAW_HTML.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      out.push(`<p>${inline(para.join("\n")).replace(/\n/g, "<br />\n")}</p>`);
    } else {
      i++;
    }
  }

  return out.join("\n");
}

/**
 * Markdown を HTML に変換する。
 * @param {string} md
 * @returns {{ html: string, headings: {level:number,id:string,text:string}[] }}
 */
export function renderMarkdown(md) {
  const ctx = { headings: [], ids: new Set() };
  const html = blocks(md, ctx);
  return { html, headings: ctx.headings };
}

/** Markdown 記法を取り除いた素のテキストを返す */
export function stripMarkdown(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi, "")
    .replace(/^\s*\|.*$/gm, " ")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
