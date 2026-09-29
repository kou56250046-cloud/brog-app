// テンプレートから使う小さなユーティリティ群
import { escapeHtml } from "./markdown.mjs";

export { escapeHtml };

/** 英数字だけの名前は読める slug、日本語を含む名前は短いハッシュにする（ファイル名に使う） */
export function slugify(name) {
  const s = String(name).trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9 ._+#-]*$/.test(s)) {
    return s.replace(/\+/g, "-plus").replace(/#/g, "-sharp").replace(/[ ._]+/g, "-").replace(/-+/g, "-");
  }
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `t-${h.toString(36)}`;
}

/**
 * サイトルートからの相対パスを、あるページから見た相対パスに直す。
 * @param {number} depth ページの階層（index.html は 0、articles/x.html は 1）
 * @param {string} target ルートからのパス（"" でルート）
 */
export function rel(depth, target = "") {
  const up = depth > 0 ? "../".repeat(depth) : "";
  if (!target) return up ? up + "index.html" : "index.html";
  return up + target;
}

export function formatDate(iso, style = "long") {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  if (style === "short") return `${mo}/${d}`;
  if (style === "dot") return `${y}.${mo}.${d}`;
  return `${y}年${Number(mo)}月${Number(d)}日`;
}

/** 条件付きで文字列を出力（テンプレートの分岐を短く書くため） */
export function when(cond, str) {
  return cond ? str : "";
}

/** 配列を HTML 断片に畳み込む */
export function map(list, fn) {
  return list.map(fn).join("");
}
