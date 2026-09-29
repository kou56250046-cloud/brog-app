#!/usr/bin/env node
// 記事中の ```python ブロックを抜き出し、python -m py_compile で構文だけ確かめる
// 使い方: node scripts/check-code.mjs content/articles/<file>.md [...]
//         引数なしなら content/articles の全記事
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const files = process.argv.slice(2);
const targets = files.length
  ? files
  : fs.readdirSync("content/articles").filter((f) => f.endsWith(".md")).map((f) => path.join("content/articles", f));

const python = ["python", "python3", "py"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);
if (!python) {
  console.error("python が見つかりません。構文確認をスキップしました。");
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-code-"));
let total = 0;
let failed = 0;

for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.error(`見つかりません: ${file}`);
    failed++;
    continue;
  }
  const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(```+)\s*(python|py)\b/);
    if (!open) continue;
    const start = i + 1;
    const body = [];
    i++;
    while (i < lines.length && lines[i].trim() !== open[1]) body.push(lines[i++]);
    total++;
    // リスト項目内のコードは項目の字下げが付いているので、共通の字下げを外してから確かめる
    const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length), Infinity);
    const src = path.join(tmp, `block_${total}.py`);
    fs.writeFileSync(src, body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n") + "\n");
    const r = spawnSync(python, ["-m", "py_compile", src], { encoding: "utf8" });
    if (r.status !== 0) {
      failed++;
      console.log(`NG  ${file}:${start + 1}\n${(r.stderr || r.stdout).replaceAll(src, `block@L${start + 1}`)}`);
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Python ブロック ${total} 個 / 構文エラー ${failed} 個`);
process.exit(failed ? 1 : 0);
