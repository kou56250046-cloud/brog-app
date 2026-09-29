#!/usr/bin/env node
// アプリアイコンを生成する（依存ゼロ。PNG 化にはローカルの Chrome / Edge をヘッドレスで使う）
// 使い方: node scripts/make-icons.mjs
// 出力: src/assets/favicon.svg, public/icons/*.png
//
// モチーフ: このブログのフロー図そのもの。
//   上の箱 = コード（>_）、下の箱 = 理解（整った行）、アンバーの矢印 = 作って分解して理解するループ
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const INDIGO = "#3b4cca";
const INK = "#2c3aa6";
const AMBER = "#e8a33d";
const WHITE = "#ffffff";

/**
 * @param {object} o
 * @param {boolean} o.bleed  背景を全面に塗る（maskable・apple-touch 用）
 * @param {boolean} o.detail 箱の中の記号を描く（小さいサイズでは省く）
 */
function iconSvg({ bleed, detail }) {
  const bg = bleed
    ? `<rect width="512" height="512" fill="${INDIGO}"/>`
    : `<rect x="16" y="16" width="480" height="480" rx="112" fill="${INDIGO}"/>`;
  const inner = detail
    ? `<path d="M196 164l22 18-22 18" fill="none" stroke="${INDIGO}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M236 200h56" stroke="${INDIGO}" stroke-width="12" stroke-linecap="round"/>
  <path d="M196 318h92M196 342h60" stroke="${INK}" stroke-width="12" stroke-linecap="round" opacity=".55"/>`
    : "";
  // 図形の中心 (272, 257) をキャンバス中央へ。maskable は安全領域（半径 40%）に収めるため拡大しない
  const place = `translate(256 256) scale(${bleed ? 1 : 1.18}) translate(-272 -257)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${bg}
  <g transform="${place}">
  <rect x="160" y="140" width="176" height="84" rx="18" fill="${WHITE}"/>
  <path d="M248 226v44" stroke="${WHITE}" stroke-width="12" stroke-linecap="round"/>
  <path d="M230 258l18 20 18-20" fill="none" stroke="${WHITE}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="160" y="290" width="176" height="84" rx="18" fill="${WHITE}"/>
  <path d="M338 332h28a18 18 0 0 0 18-18V200a18 18 0 0 0-18-18h-12" fill="none" stroke="${AMBER}" stroke-width="14" stroke-linecap="round"/>
  <path d="M358 164l-22 18 22 18" fill="none" stroke="${AMBER}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  ${inner}
  </g>
</svg>
`;
}

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "icons");
fs.mkdirSync(OUT, { recursive: true });

// ファビコンは小さく表示されるので中の記号を省く
fs.writeFileSync(path.join(ROOT, "src", "assets", "favicon.svg"), iconSvg({ bleed: false, detail: false }));

const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!browser) {
  console.error("Chrome / Edge が見つかりません。CHROME_PATH にパスを指定してください。");
  process.exit(1);
}

const TARGETS = [
  { file: "icon-192.png", size: 192, bleed: false, detail: true },
  { file: "icon-512.png", size: 512, bleed: false, detail: true },
  { file: "maskable-192.png", size: 192, bleed: true, detail: true },
  { file: "maskable-512.png", size: 512, bleed: true, detail: true },
  { file: "apple-touch-icon.png", size: 180, bleed: true, detail: true },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
for (const t of TARGETS) {
  const html = path.join(tmp, `${t.file}.html`);
  fs.writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${t.size}px;height:${t.size}px">${iconSvg(t).replace("<svg ", `<svg width="${t.size}" height="${t.size}" `)}</div>
</body></html>`
  );
  const out = path.join(OUT, t.file);
  const r = spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--user-data-dir=${path.join(tmp, "profile")}`,
    "--default-background-color=00000000",
    `--window-size=${t.size},${t.size}`,
    `--screenshot=${out}`,
    pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 60000 });
  if (!fs.existsSync(out)) {
    console.error(`生成に失敗: ${t.file}\n${r.stderr}`);
    process.exit(1);
  }
  console.log(`  ${t.file} (${t.size}px)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("アイコンを public/icons/ に出力しました");
