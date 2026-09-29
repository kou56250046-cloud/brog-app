// YAML フロントマターの最小パーサ（外部依存なし）
// 対応する記法: key: value / "quoted" / [inline, array] / - block array / 数値 / 真偽値

function unquote(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function coerce(v) {
  const s = v.trim();
  if (s === "") return "";
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    // クォートの内側のカンマでは区切らない（["a, b", c] → ["a, b", "c"]）
    const parts = inner.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [];
    return parts.map((x) => unquote(x)).filter(Boolean);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  return unquote(s);
}

/**
 * @param {string} raw ファイル全文
 * @returns {{ data: Record<string, unknown>, content: string }}
 */
export function parseFrontmatter(raw) {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { data: {}, content: text };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, content: text };

  const head = text.slice(4, end);
  const content = text.slice(end + 4).replace(/^\n/, "");

  const data = {};
  let currentKey = null;

  for (const line of head.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // ブロック配列（先頭が "- "）
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(unquote(item[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    currentKey = key;
    data[key] = rest.trim() === "" ? [] : coerce(rest);
  }

  return { data, content };
}
