#!/usr/bin/env node
// 開発用の簡易サーバー（Node 標準ライブラリのみ）
// content/ と src/ の変更を監視して自動で再ビルドする。
// 公開先（GitHub Pages）と同じパス（site.config.mjs の url のパス部分）で配信し、
// 404・オフラインページの <base> と Service Worker のスコープを本番と揃える。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import site from "../site.config.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const BASE = new URL(site.url.replace(/\/?$/, "/")).pathname; // 例: "/brog-app/"
const PORT = Number(process.env.PORT) || 4323; // ~/projects/PORTS.md で割り当て済み

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function build(label) {
  const t = Date.now();
  const r = spawnSync(process.execPath, ["build.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (r.status === 0) {
    process.stdout.write(`[${label}] ビルド OK (${Date.now() - t}ms)\n`);
  } else {
    process.stdout.write(`[${label}] ビルド失敗\n${r.stderr || r.stdout}\n`);
  }
}

function resolve(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  if (!pathname.startsWith(BASE)) return null;
  const clean = "/" + pathname.slice(BASE.length);
  const candidates = [clean, `${clean}.html`, path.posix.join(clean, "index.html")];
  if (clean === "/") candidates.unshift("/index.html");
  for (const c of candidates) {
    const file = path.join(DIST, c);
    if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

build("init");

http
  .createServer((req, res) => {
    if (req.url === "/" || req.url === BASE.slice(0, -1)) {
      res.writeHead(302, { location: BASE });
      res.end();
      return;
    }
    const file = resolve(req.url || "/");
    if (!file) {
      const nf = path.join(DIST, "404.html");
      res.writeHead(404, { "content-type": TYPES[".html"] });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "404");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => console.log(`\n  http://localhost:${PORT}${BASE}  で確認できます（Ctrl+C で終了）\n`));

let timer = null;
for (const dir of ["content", "src", "site.config.mjs"]) {
  const target = path.join(ROOT, dir);
  if (!fs.existsSync(target)) continue;
  fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build("watch"), 160);
  });
}
