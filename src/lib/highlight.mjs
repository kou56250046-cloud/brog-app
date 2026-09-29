// 依存ゼロのシンタックスハイライタ（ビルド時に実行）
// 対応言語: python / js / ts / bash / json / yaml
// 出力はクラス付きの <span>。色は style.css の --tok-* で決める。
//   k=キーワード s=文字列 c=コメント n=数値 f=関数名 b=組み込み d=デコレータ p=キー v=変数

import { escapeHtml } from "./markdown.mjs";

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const PY_KEYWORDS = words(`
  and as assert async await break class continue def del elif else except finally for from
  global if import in is lambda nonlocal not or pass raise return try while with yield match case
  None True False self
`);
const PY_BUILTINS = words(`
  print len range dict list set tuple str int float bool type isinstance enumerate zip map filter
  sorted reversed open super any all min max sum abs repr hasattr getattr setattr input iter next
  Exception ValueError KeyError TypeError RuntimeError
`);
const JS_KEYWORDS = words(`
  const let var function return if else for while do break continue switch case default new
  class extends import export from as async await try catch finally throw typeof instanceof in of
  this super null undefined true false void yield static get set type interface enum implements
  readonly private public protected declare namespace keyof satisfies
`);
const JS_BUILTINS = words(`
  console JSON Math Object Array String Number Boolean Promise Map Set Date Error RegExp process
  string number boolean any unknown never Record Partial
`);
const SH_KEYWORDS = words(`if then else elif fi for in do done while case esac function return export local`);
const SH_BUILTINS = words(`
  cd echo cat ls cp mv rm mkdir pip python node npm pnpm npx git curl uv source set grep sed
`);

/** 言語ごとの規則。先に書いたものが優先される */
const RULES = {
  python: [
    ["c", /#.*/y],
    ["s", /[rbfu]{0,2}("""[\s\S]*?"""|'''[\s\S]*?''')/iy],
    ["s", /[rbfu]{0,2}("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/iy],
    ["d", /@[\w.]+/y],
    ["n", /\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b/iy],
    ["w", /[A-Za-z_]\w*/y],
  ],
  js: [
    ["c", /\/\/.*/y],
    ["c", /\/\*[\s\S]*?\*\//y],
    ["s", /`(?:\\.|[^`\\])*`/y],
    ["s", /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],
    ["n", /\b\d[\d_]*(?:\.\d+)?\b/y],
    ["w", /[A-Za-z_$][\w$]*/y],
  ],
  bash: [
    ["c", /#.*/y],
    ["s", /"(?:\\.|[^"\\])*"|'[^']*'/y],
    ["v", /\$\{?[\w@#?]+\}?/y],
    ["w", /[A-Za-z_][\w-]*/y],
  ],
  json: [
    ["p", /"(?:\\.|[^"\\])*"(?=\s*:)/y],
    ["s", /"(?:\\.|[^"\\])*"/y],
    ["n", /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy],
    ["k", /\b(?:true|false|null)\b/y],
  ],
  yaml: [
    ["c", /#.*/y],
    ["p", /[\w.-]+(?=\s*:(?:\s|$))/y],
    ["s", /"(?:\\.|[^"\\])*"|'[^']*'/y],
    ["n", /\b\d+(?:\.\d+)?\b/y],
    ["k", /\b(?:true|false|null|yes|no)\b/y],
  ],
};

const ALIASES = { py: "python", python: "python", js: "js", javascript: "js", ts: "js", typescript: "js",
  tsx: "js", jsx: "js", sh: "bash", bash: "bash", shell: "bash", console: "bash", json: "json",
  yaml: "yaml", yml: "yaml" };

const WORD_SETS = {
  python: [PY_KEYWORDS, PY_BUILTINS],
  js: [JS_KEYWORDS, JS_BUILTINS],
  bash: [SH_KEYWORDS, SH_BUILTINS],
};

const span = (cls, text) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

/**
 * コードをハイライト済み HTML にする。未対応言語はエスケープだけ行う。
 * @param {string} code
 * @param {string} lang
 */
export function highlight(code, lang) {
  const key = ALIASES[String(lang).toLowerCase()];
  const rules = RULES[key];
  if (!rules) return escapeHtml(code);

  const [kw, bi] = WORD_SETS[key] ?? [new Set(), new Set()];
  let out = "";
  let plain = "";
  let pos = 0;
  let prevWord = "";

  const flush = () => {
    if (plain) out += escapeHtml(plain);
    plain = "";
  };

  while (pos < code.length) {
    let matched = false;
    for (const [cls, re] of rules) {
      re.lastIndex = pos;
      const m = re.exec(code);
      if (!m || !m[0]) continue;
      const text = m[0];
      flush();
      if (cls === "w") {
        const after = code.slice(pos + text.length).match(/^\s*\(/);
        if (kw.has(text)) out += span("k", text);
        else if (prevWord === "def" || prevWord === "class" || prevWord === "function") out += span("f", text);
        else if (bi.has(text)) out += span("b", text);
        else if (after && key !== "bash") out += span("f", text);
        // bash は行頭の語をコマンドとして色付けする
        else if (key === "bash" && /^\s*(?:\$\s+)?$/.test(code.slice(0, pos).split("\n").pop())) out += span("f", text);
        else out += escapeHtml(text);
        prevWord = text;
      } else {
        out += span(cls, text);
      }
      pos += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      const ch = code[pos];
      if (!/\s/.test(ch)) prevWord = ch === "." ? prevWord : "";
      plain += ch;
      pos += 1;
    }
  }
  flush();
  return out;
}
