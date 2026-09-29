// ```flow ブロックの簡易 DSL をビルド時にインライン SVG へ変換する（依存ゼロ）
//
// 記法（Mermaid の flowchart に寄せたサブセット）:
//   direction LR              向き。TB（縦・既定）か LR（横）
//   A[四角] --> B(角丸)        ノード定義と矢印。一度定義したら以降は ID だけで参照できる
//   B --> C{判定}              ひし形
//   C -- yes --> D([端点])      ラベル付き矢印（C -->|yes| D も可）
//   D -.-> B                  点線の矢印
//   A[強調]:::hl               強調スタイル（hl / muted）
//   %% コメント
// 戻り方向の矢印（ループ）は自動で検出し、図の外側を回して描く。
// ラベル内の改行は "\n" と書く。

import { escapeHtml } from "./markdown.mjs";

const FONT = 14;
const LINE = 20;
const PAD_X = 18;
const PAD_Y = 11;
const MAX_TEXT = 196;
const GAP_MAIN = 52;
const GAP_CROSS = 28;
const MARGIN = 16;

let figureSeq = 0;

/** 文字幅の概算（全角 = 1em、半角 ≒ 0.58em） */
function textWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ]/.test(ch) ? FONT * 0.58 : FONT;
  return w;
}

/** 指定幅で折り返す（明示改行 \n を優先） */
function wrap(label) {
  const lines = [];
  for (const part of label.split(/\\n|<br\s*\/?>/)) {
    let cur = "";
    for (const ch of part) {
      if (textWidth(cur + ch) > MAX_TEXT && cur) {
        lines.push(cur);
        cur = "";
      }
      cur += ch;
    }
    lines.push(cur);
  }
  return lines;
}

const SHAPES = [
  ["pill", /^\(\[(.*?)\]\)/],
  ["rect", /^\[(.*?)\]/],
  ["round", /^\((.*?)\)/],
  ["diamond", /^\{(.*?)\}/],
];

const EDGE_RE = /^\s*(?:(-->|==>)(?:\|([^|]+)\|)?|--\s*(.+?)\s*-->|(-\.->)(?:\|([^|]+)\|)?|-\.\s*(.+?)\s*\.->)/;

function parse(src) {
  const nodes = new Map();
  const edges = [];
  let dir = "TB";

  const node = (rest) => {
    const m = rest.match(/^\s*([A-Za-z_][\w-]*)/);
    if (!m) throw new Error(`flow: ノード ID が読めません: "${rest.trim()}"`);
    const id = m[1];
    let r = rest.slice(m[0].length);
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: id, shape: "rect", cls: "", order: nodes.size };
      nodes.set(id, n);
    }
    for (const [shape, re] of SHAPES) {
      const s = r.match(re);
      if (s) {
        n.shape = shape;
        n.label = s[1].replace(/^"(.*)"$/, "$1");
        r = r.slice(s[0].length);
        break;
      }
    }
    const c = r.match(/^:::(\w+)/);
    if (c) {
      n.cls = c[1];
      r = r.slice(c[0].length);
    }
    return { id, rest: r };
  };

  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) continue;
    const d = line.match(/^(?:direction\s+)?(TB|TD|LR)$/i);
    if (d) {
      dir = d[1].toUpperCase() === "LR" ? "LR" : "TB";
      continue;
    }
    let { id: from, rest } = node(line);
    while (rest.trim()) {
      const e = rest.match(EDGE_RE);
      if (!e) throw new Error(`flow: 矢印が読めません: "${rest.trim()}"`);
      const dashed = Boolean(e[4] || e[6]);
      const label = (e[2] || e[3] || e[5] || e[6] || "").trim();
      const next = node(rest.slice(e[0].length));
      edges.push({ from, to: next.id, label, dashed, bold: e[1] === "==>" });
      from = next.id;
      rest = next.rest;
    }
  }
  return { nodes: [...nodes.values()], edges, dir };
}

/** DFS で戻り辺（ループ）を判定する */
function markBackEdges(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => out.get(e.from).push(e));
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    for (const e of out.get(id)) {
      const s = state.get(e.to);
      if (s === 1 || e.from === e.to) e.back = true;
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  nodes.forEach((n) => state.get(n.id) || visit(n.id));
}

function layout({ nodes, edges, dir }) {
  const TB = dir === "TB";
  markBackEdges(nodes, edges);

  // 大きさ
  for (const n of nodes) {
    n.lines = wrap(n.label);
    const tw = Math.max(...n.lines.map(textWidth));
    const th = n.lines.length * LINE;
    n.w = Math.round(tw + PAD_X * 2);
    n.h = Math.round(th + PAD_Y * 2);
    if (n.shape === "diamond") {
      n.w = Math.round(tw * 1.25 + 48);
      n.h = Math.round(th + 40);
    }
    n.w = Math.max(n.w, 64);
  }

  // 段（最長経路）
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fwd = edges.filter((e) => !e.back);
  nodes.forEach((n) => (n.rank = 0));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of fwd) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (b.rank < a.rank + 1) {
        b.rank = a.rank + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 段ごとの並び（親の位置の平均で1回だけ並べ替える）
  const ranks = [];
  nodes.forEach((n) => (ranks[n.rank] ??= []).push(n));
  const mainSize = (n) => (TB ? n.h : n.w);
  const crossSize = (n) => (TB ? n.w : n.h);

  let main = 0;
  ranks.forEach((row, r) => {
    if (r > 0) {
      const center = (n) => {
        const parents = fwd.filter((e) => e.to === n.id).map((e) => byId.get(e.from).cross);
        return parents.length ? parents.reduce((s, x) => s + x, 0) / parents.length : 0;
      };
      row.forEach((n) => (n.key = center(n)));
      row.sort((a, b) => a.key - b.key || a.order - b.order);
    }
    const size = Math.max(...row.map(mainSize));
    const total = row.reduce((s, n) => s + crossSize(n), 0) + GAP_CROSS * (row.length - 1);
    let c = -total / 2;
    row.forEach((n, idx) => (n.last = idx === row.length - 1));
    for (const n of row) {
      n.main = main + size / 2;
      n.cross = c + crossSize(n) / 2;
      c += crossSize(n) + GAP_CROSS;
    }
    main += size + GAP_MAIN + (TB ? 0 : 12);
  });

  // 座標に変換（x, y は中心）
  for (const n of nodes) {
    n.x = TB ? n.cross : n.main;
    n.y = TB ? n.main : n.cross;
  }
  return { byId, TB };
}

const r1 = (v) => Math.round(v * 10) / 10;

function renderNode(n) {
  const x = r1(n.x - n.w / 2);
  const y = r1(n.y - n.h / 2);
  let shape;
  if (n.shape === "diamond") {
    const pts = [[n.x, n.y - n.h / 2], [n.x + n.w / 2, n.y], [n.x, n.y + n.h / 2], [n.x - n.w / 2, n.y]];
    shape = `<polygon points="${pts.map((p) => p.map(r1).join(",")).join(" ")}" />`;
  } else {
    const rx = n.shape === "pill" ? n.h / 2 : n.shape === "round" ? 12 : 6;
    shape = `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${r1(rx)}" />`;
  }
  const top = n.y - (n.lines.length * LINE) / 2 + LINE / 2;
  const text = n.lines
    .map((l, i) => `<text x="${r1(n.x)}" y="${r1(top + i * LINE)}">${escapeHtml(l)}</text>`)
    .join("");
  const cls = ["fl-node", `fl-${n.shape}`, n.cls ? `fl-${n.cls}` : ""].filter(Boolean).join(" ");
  return `<g class="${cls}">${shape}${text}</g>`;
}

function edgeLabel(x, y, label) {
  if (!label) return "";
  const w = Math.round(textWidth(label) * 0.86 + 12);
  return `<g class="fl-elabel"><rect x="${r1(x - w / 2)}" y="${r1(y - 10)}" width="${w}" height="20" rx="4" /><text x="${r1(x)}" y="${r1(y)}">${escapeHtml(label)}</text></g>`;
}

/**
 * flow DSL を SVG 文字列にする。
 * @param {string} src
 * @param {string} [caption]
 */
export function renderFlow(src, caption = "") {
  const graph = parse(src);
  if (!graph.nodes.length) return "";
  const { byId, TB } = layout(graph);
  const marker = `fl-arrow-${++figureSeq}`;

  // 図の外周
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of byId.values()) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }

  const paths = [];
  const labels = [];
  let loopLane = 0;

  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const cls = `fl-edge${e.dashed ? " fl-dashed" : ""}${e.bold ? " fl-bold" : ""}${e.back ? " fl-back" : ""}`;

    if (e.back) {
      // 図の外側（TB は右、LR は下）を回す
      loopLane += 1;
      const off = 26 + (loopLane - 1) * 18;
      let d, lx, ly;
      if (TB) {
        // 同じ段の右側に別ノードがあると横線が突き抜けるため、
        // 右端のノードは側面から、それ以外は下辺・上辺から出入りする
        const lane = maxX + off;
        const start = a.last
          ? `M${r1(a.x + a.w / 2)},${r1(a.y)} H${r1(lane - 8)} Q${r1(lane)},${r1(a.y)} ${r1(lane)},${r1(a.y - 8)}`
          : `M${r1(a.x)},${r1(a.y + a.h / 2)} V${r1(a.y + a.h / 2 + 12)} H${r1(lane - 8)} Q${r1(lane)},${r1(a.y + a.h / 2 + 12)} ${r1(lane)},${r1(a.y + a.h / 2 + 12 - 8)}`;
        const end = b.last
          ? `V${r1(b.y + 8)} Q${r1(lane)},${r1(b.y)} ${r1(lane - 8)},${r1(b.y)} H${r1(b.x + b.w / 2 + 2)}`
          : `V${r1(b.y - b.h / 2 - 12 + 8)} Q${r1(lane)},${r1(b.y - b.h / 2 - 12)} ${r1(lane - 8)},${r1(b.y - b.h / 2 - 12)} H${r1(b.x + b.w / 4)} V${r1(b.y - b.h / 2 - 2)}`;
        d = `${start} ${end}`;
        lx = lane; ly = (a.y + b.y) / 2;
        maxX = Math.max(maxX, lane + (e.label ? textWidth(e.label) / 2 + 8 : 4));
      } else {
        const lane = maxY + off;
        const sy = a.y + a.h / 2, ty = b.y + b.h / 2;
        d = `M${r1(a.x)},${r1(sy)} V${r1(lane - 8)} Q${r1(a.x)},${r1(lane)} ${r1(a.x - 8)},${r1(lane)} H${r1(b.x + 8)} Q${r1(b.x)},${r1(lane)} ${r1(b.x)},${r1(lane - 8)} V${r1(ty + 2)}`;
        lx = (a.x + b.x) / 2; ly = lane;
        maxY = Math.max(maxY, lane + 12);
      }
      paths.push(`<path class="${cls}" d="${d}" marker-end="url(#${marker})" />`);
      labels.push(edgeLabel(lx, ly, e.label));
      continue;
    }

    let sx, sy, tx, ty, d;
    if (TB) {
      sx = a.x; sy = a.y + a.h / 2; tx = b.x; ty = b.y - b.h / 2 - 2;
      const my = (sy + ty) / 2;
      d = `M${r1(sx)},${r1(sy)} C${r1(sx)},${r1(my)} ${r1(tx)},${r1(my)} ${r1(tx)},${r1(ty)}`;
    } else {
      sx = a.x + a.w / 2; sy = a.y; tx = b.x - b.w / 2 - 2; ty = b.y;
      const mx = (sx + tx) / 2;
      d = `M${r1(sx)},${r1(sy)} C${r1(mx)},${r1(sy)} ${r1(mx)},${r1(ty)} ${r1(tx)},${r1(ty)}`;
    }
    paths.push(`<path class="${cls}" d="${d}" marker-end="url(#${marker})" />`);
    labels.push(edgeLabel((sx + tx) / 2, (sy + ty) / 2, e.label));
  }

  const vx = Math.floor(minX - MARGIN);
  const vy = Math.floor(minY - MARGIN);
  const vw = Math.ceil(maxX - minX + MARGIN * 2);
  const vh = Math.ceil(maxY - minY + MARGIN * 2);
  const title = caption || graph.nodes.map((n) => n.label.replace(/\\n/g, " ")).join(" → ");

  const svg = `<svg class="flow-svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" style="--flow-w:${vw}px" role="img" aria-label="${escapeHtml(title)}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="fl-head" /></marker></defs>
${paths.join("\n")}
${[...byId.values()].map(renderNode).join("\n")}
${labels.join("")}
</svg>`;

  return `<figure class="figure flow"><div class="figure-scroll">${svg}</div>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

/** ビルドごとにマーカー ID の連番を戻す（同一ページ内で一意なら足りる） */
export function resetFlowIds() {
  figureSeq = 0;
}
