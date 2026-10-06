// 記事の見出し画像（設計図ヒーロー）。本文の ```hero ブロック → インライン SVG
//
// 記法は ```flow と同じノード・矢印に、次を足したもの（解析は flow.mjs の parse({ hero: true })）:
//   title 文                 大見出し（必須）
//   group ID 名前 … end      レーン。中で初めて定義したノードがそのレーンに入る
//   A[文字]:::llm:::hl        担い手（code / llm / human / data）と強調（hl / muted）
//   A <--> B                 双方向の矢印
//   note A 文                設計の要点。ノードに番号を付け、図の下に並べる
//
// 横向き（段が左→右、レーンが上下）と縦向き（レーンを上から積み、中は 1 列）を両方作り、CSS で切り替える。
// 色は class で付けて style.css が CSS 変数から塗る。同じページに何枚も並ぶので SVG 内では id を使わない。
import { escapeHtml, fnv1a } from "./util.mjs";
import { markBackEdges, parse, textWidth, wrap } from "./flow.mjs";

const M = 16;
const PAD_X = 18;
const PAD_Y = 10;
const FONT = 15;
const LINE = 20;
const TEXT_MAX = 120;
const NODE_MAX = TEXT_MAX + PAD_X * 2;
const NODE_MIN = 64;
const RANK_GAP = 48;
const STACK_GAP = 16;
const BAND_PAD = 14;
const LANE_HEAD = 24;
const BAND_GAP = 12;
const COL_GAP = 28;
const ROUTE_GAP = 20;
const ROUTE_STEP = 20;
const MAX_LR = 1008;
// 横向きの図をこの幅より大きく描く記事は、860〜959px の画面でも縦向きにする。
// 860px での器の内幅は約 770（860 − 左右の余白 48 − hero の余白 40 − 枠 2）で、
// 962 を超えると倍率が 0.8 を割り、ノードの文字が 12px を下回る
const WIDE_LR = 962;

const ROLES = { code: "コード", llm: "LLM", human: "人", data: "データ" };
const MARKS = ["hl", "muted"];

const n1 = (v) => Math.round(v * 10) / 10;
/** 全角換算の字数 */
const zen = (s) => textWidth(s, 1);

/**
 * 本文から ```hero ブロックを取り出す。本文・検索・読了時間に入れないため、取り出した本文を返す
 * @param {string} content
 */
export function extractHero(content) {
  // フェンスの開閉は markdown.mjs と同じ規則で追う（閉じは trim() がマーカーと一致する行）。
  // ほかのフェンスの中（```` で囲んだ記法の例など）にある ```hero は取り出さない
  const lines = content.split("\n");
  const blocks = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (!fence) {
      out.push(lines[i]);
      continue;
    }
    const [, marker, lang] = fence;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== marker) j++;
    if (lang.toLowerCase() === "hero") blocks.push(lines.slice(i + 1, j).join("\n"));
    else out.push(...lines.slice(i, j + 1));
    i = j;
  }
  return { src: blocks[0] ?? null, count: blocks.length, body: out.join("\n") };
}

/**
 * ```hero の中身を解析・検査し、両向きの配置まで済ませる。外れていれば warn に理由を渡して null
 * @param {string | null} src
 * @param {number} count 本文にあった ```hero の数
 * @param {(msg: string) => void} warn
 */
export function parseHero(src, count, warn) {
  const fail = (msg) => {
    warn(msg);
    return null;
  };
  if (!count) return fail("がありません（フォールバック画像になります）");
  if (count > 1) return fail(`ブロックが ${count} つあります（1 つにしてください）`);

  let g;
  try {
    g = parse(src, { hero: true });
  } catch (e) {
    return fail(`が読めません: ${e.message}`);
  }

  if (!g.title) return fail("に title がありません");
  if (zen(g.title) > 40) return fail(`の title が全角 40 字を超えています（"${g.title}"）`);
  if (g.nodes.length < 2 || g.nodes.length > 12) return fail(`のノードは 2〜12 個にしてください（今は ${g.nodes.length} 個）`);
  const loop = g.edges.find((e) => e.from === e.to);
  if (loop) return fail(`の ${loop.from} から自分自身への矢印は描けません`);

  const lanes = g.groups.map((x) => ({ ...x }));
  if (g.nodes.some((n) => !n.group)) lanes.push({ id: "", label: "" });
  // レーンは原稿に最初に出てきた順。group に入らない入口のノードを先に書けば、無名レーンが上に来る
  const first = (id) => Math.min(...g.nodes.filter((n) => n.group === id).map((n) => n.order));
  lanes.sort((a, b) => first(a.id) - first(b.id));
  if (lanes.length > 3) return fail(`のレーンは 3 つまでです（group に入らないノードも 1 レーンと数えます。今は ${lanes.length} つ）`);
  for (const l of lanes) {
    if (l.id && !g.nodes.some((n) => n.group === l.id)) return fail(`の group "${l.id}" にノードがありません`);
  }

  for (const n of g.nodes) {
    const unknown = n.classes.filter((c) => !ROLES[c] && !MARKS.includes(c));
    if (unknown.length) return fail(`の :::${unknown[0]} は使えません（${[...Object.keys(ROLES), ...MARKS].join(" / ")}）`);
    if (n.classes.length > 2) return fail(`の ${n.id} にクラスが 3 つ以上あります`);
    const roles = n.classes.filter((c) => ROLES[c]);
    if (roles.length > 1) return fail(`の ${n.id} に担い手が 2 つあります`);
    n.role = roles[0] ?? "";
    n.mark = n.classes.find((c) => MARKS.includes(c)) ?? "";
    n.lines = wrap(n.label, TEXT_MAX, FONT);
    if (n.lines.length > 2) return fail(`の "${n.label.replace(/\\n/g, "")}" が 2 行に収まりません（全角 8 字×2 行まで）`);
  }

  if (g.notes.length > 3) return fail(`の note は 3 つまでです（今は ${g.notes.length} つ）`);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const [i, note] of g.notes.entries()) {
    const n = byId.get(note.node);
    if (!n) return fail(`の note が存在しないノード "${note.node}" を指しています`);
    if (n.badge) return fail(`の ${note.node} に note が 2 つあります`);
    if (zen(note.text) > 40) return fail(`の note が全角 40 字を超えています（"${note.text}"）`);
    n.badge = i + 1;
  }

  const hero = { title: g.title, nodes: g.nodes, edges: g.edges, lanes, notes: g.notes, byId };
  measure(hero);
  hero.lr = layoutLR(hero);
  if (hero.lr.w > MAX_LR) {
    return fail(`の横向きの図の幅が ${Math.round(hero.lr.w)} で、上限 ${MAX_LR} を超えます（ラベルを短くするか段を減らしてください）`);
  }
  hero.tb = layoutTB(hero);
  return hero;
}

/** ノードの大きさと段（戻り辺を除いた最長経路） */
function measure(hero) {
  for (const n of hero.nodes) {
    const tw = Math.max(...n.lines.map((l) => textWidth(l, FONT)));
    n.w = Math.min(NODE_MAX, Math.max(NODE_MIN, Math.round(tw + PAD_X * 2)));
    n.h = n.lines.length * LINE + PAD_Y * 2;
    if (n.shape === "diamond") {
      n.w = Math.round(n.w * 1.2);
      n.h += 16;
    }
  }
  markBackEdges(hero.nodes, hero.edges);
  const fwd = hero.edges.filter((e) => !e.back);
  hero.nodes.forEach((n) => (n.rank = 0));
  for (let pass = 0; pass < hero.nodes.length; pass++) {
    let changed = false;
    for (const e of fwd) {
      const a = hero.byId.get(e.from);
      const b = hero.byId.get(e.to);
      if (b.rank < a.rank + 1) {
        b.rank = a.rank + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** レーン名（14px 太字）が帯からはみ出さない図の幅 */
function laneLabelWidth(lanes) {
  const bandX = M - BAND_PAD + 2;
  return Math.max(0, ...lanes.map((l) => (l.label ? textWidth(l.label, 14) * 1.05 + 10 + 8 + bandX * 2 : 0)));
}

/** 横向き: x = 段、y = レーン。同じレーン・同じ段は縦に積む */
function layoutLR(hero) {
  const { nodes, edges, lanes, byId } = hero;
  const ranks = Math.max(...nodes.map((n) => n.rank)) + 1;
  const rankW = Array.from({ length: ranks }, (_, r) => Math.max(0, ...nodes.filter((n) => n.rank === r).map((n) => n.w)));
  const rankX = [];
  let x = M;
  for (let r = 0; r < ranks; r++) {
    rankX[r] = x + rankW[r] / 2;
    x += rankW[r] + RANK_GAP;
  }
  const w = Math.max(x - RANK_GAP + M, laneLabelWidth(lanes));

  const pos = new Map();
  const bands = [];
  let y = M;
  for (const lane of lanes) {
    const mine = nodes.filter((n) => n.group === lane.id);
    const stacks = Array.from({ length: ranks }, (_, r) => mine.filter((n) => n.rank === r));
    const inner = Math.max(...stacks.map((s) => s.reduce((t, n) => t + n.h, 0) + STACK_GAP * Math.max(0, s.length - 1)));
    const head = lane.label ? LANE_HEAD : 0;
    const top = y + head + BAND_PAD / 2;
    stacks.forEach((stack, r) => {
      // 親の位置の平均で 1 回だけ並べ替える（flow と同じ）
      const key = (n) => {
        const ys = edges.filter((e) => e.to === n.id && !e.back && pos.has(e.from)).map((e) => pos.get(e.from).y);
        return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : 0;
      };
      stack.sort((a, b) => key(a) - key(b) || a.order - b.order);
      const total = stack.reduce((t, n) => t + n.h, 0) + STACK_GAP * Math.max(0, stack.length - 1);
      let cy = top + (inner - total) / 2;
      for (const n of stack) {
        pos.set(n.id, { x: rankX[r], y: cy + n.h / 2 });
        cy += n.h + STACK_GAP;
      }
    });
    const h = head + inner + BAND_PAD * 1.5;
    bands.push({ lane, x: M - BAND_PAD + 2, y, w: w - (M - BAND_PAD + 2) * 2, h });
    y += h + BAND_GAP;
  }

  // ノードの上下の範囲。段を飛ばす矢印と戻る矢印が、途中のノードの裏を通らないように使う
  const span = (n) => ({ top: pos.get(n.id).y - n.h / 2, bottom: pos.get(n.id).y + n.h / 2 });
  const clear = (yy, list) => list.every((s) => yy < s.top - 6 || yy > s.bottom + 6);
  const colLeft = (r) => rankX[r] - rankW[r] / 2;
  const colRight = (r) => rankX[r] + rankW[r] / 2;
  const laneGaps = bands.slice(0, -1).map((b) => b.y + b.h + BAND_GAP / 2);
  let backs = 0;

  const paths = edges.map((e) => {
    const a = { ...byId.get(e.from), ...pos.get(e.from) };
    const b = { ...byId.get(e.to), ...pos.get(e.to) };
    if (a.rank < b.rank) {
      const sx = a.x + a.w / 2, sy = a.y, tx = b.x - b.w / 2, ty = b.y;
      const mid = nodes.filter((n) => n.rank > a.rank && n.rank < b.rank).map(span);
      const lo = Math.min(sy, ty), hi = Math.max(sy, ty);
      if (!mid.some((s) => s.bottom + 6 > lo && s.top - 6 < hi)) {
        const mx = (sx + tx) / 2;
        return { e, d: [[sx, sy], [mx, sy], [mx, ty], [tx, ty]], label: [(sx + tx) / 2, (sy + ty) / 2] };
      }
      // 途中の段のノードとぶつかるので、空いている高さ（出発・到着の高さ、レーンの間）を通す
      const mean = (sy + ty) / 2;
      const yy = [sy, ty, ...laneGaps.sort((p, q) => Math.abs(p - mean) - Math.abs(q - mean))].find((v) => clear(v, mid));
      if (yy !== undefined) {
        const x1 = colRight(a.rank) + RANK_GAP / 2, x2 = colLeft(b.rank) - RANK_GAP / 2;
        return { e, d: [[sx, sy], [x1, sy], [x1, yy], [x2, yy], [x2, ty], [tx, ty]], poly: true, label: [(x1 + x2) / 2, yy] };
      }
      const mx = (sx + tx) / 2;
      return { e, d: [[sx, sy], [mx, sy], [mx, ty], [tx, ty]], label: [(sx + tx) / 2, (sy + ty) / 2] };
    }
    if (a.rank === b.rank) {
      const down = b.y > a.y;
      const sy = a.y + (down ? a.h / 2 : -a.h / 2), ty = b.y + (down ? -b.h / 2 : b.h / 2);
      return { e, d: [[a.x, sy], [a.x, ty]], label: [a.x, (sy + ty) / 2] };
    }
    // 戻る矢印: 間の段にある同じレーンのノードより下を回す。複数あれば 1 本ごとに下げる
    const inLanes = nodes.filter((n) => n.rank >= b.rank && n.rank <= a.rank && (n.group === a.group || n.group === b.group));
    const low = Math.max(...inLanes.map((n) => span(n).bottom)) + 12 + 10 * backs++;
    return { e, d: [[a.x, a.y + a.h / 2], [a.x, low], [b.x, low], [b.x, b.y + b.h / 2]], poly: true, label: [(a.x + b.x) / 2, low] };
  });
  return { w, h: y - BAND_GAP + M, pos, bands, paths };
}

/** 縦向き: レーンを上から積み、中のノードを段の順に 1 列で並べる。続かない矢印は右の通り道を回す */
function layoutTB(hero) {
  const { nodes, edges, lanes, byId } = hero;
  const colW = Math.max(...nodes.map((n) => n.w));
  const cx = M + colW / 2;
  const pos = new Map();
  const bands = [];
  let idx = 0;
  let y = M;
  for (const lane of lanes) {
    const mine = nodes.filter((n) => n.group === lane.id).sort((a, b) => a.rank - b.rank || a.order - b.order);
    const head = lane.label ? LANE_HEAD : 0;
    let cy = y + head + BAND_PAD / 2;
    for (const n of mine) {
      pos.set(n.id, { x: cx, y: cy + n.h / 2, lane: lane.id, idx: idx++ });
      cy += n.h + COL_GAP;
    }
    const h = cy - COL_GAP - y + BAND_PAD;
    bands.push({ lane, y, h });
    y += h + BAND_GAP;
  }

  // 同じレーンで隣り合うノードの間は真下へ。ただし往復の 2 本目は重なるので通り道へ回す
  const seen = new Set();
  const direct = new Set(edges.filter((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (a.lane !== b.lane || Math.abs(b.idx - a.idx) !== 1) return false;
    const pair = [e.from, e.to].sort().join("\n");
    if (seen.has(pair)) return false;
    seen.add(pair);
    return true;
  }));
  const adjacent = (e) => direct.has(e);
  // 通り道を回る矢印がノードの右辺の同じ点に集まらないよう、本数に応じて上下にずらす
  const sides = new Map();
  for (const e of edges.filter((x) => !adjacent(x))) {
    for (const id of [e.from, e.to]) sides.set(id, [...(sides.get(id) ?? []), e]);
  }
  const offset = (id, e) => {
    const list = sides.get(id);
    return (list.indexOf(e) - (list.length - 1) / 2) * Math.min(10, (byId.get(id).h - 12) / list.length);
  };

  let route = 0;
  let labelRight = 0;
  const paths = edges.map((e) => {
    const a = { ...byId.get(e.from), ...pos.get(e.from) };
    const b = { ...byId.get(e.to), ...pos.get(e.to) };
    if (adjacent(e)) {
      const down = b.idx > a.idx;
      const sy = a.y + (down ? a.h / 2 : -a.h / 2), ty = b.y + (down ? -b.h / 2 : b.h / 2);
      // ラベルは線の右に出るので、その右端も図の幅に入れる
      if (e.label) labelRight = Math.max(labelRight, a.x + 10 + textWidth(e.label, 13) + 10);
      return { e, d: [[a.x, sy], [b.x, ty]], label: [a.x + 10, (sy + ty) / 2], side: true };
    }
    const gx = M + colW + ROUTE_GAP + ROUTE_STEP * route++;
    if (e.label) labelRight = Math.max(labelRight, gx + 6 + textWidth(e.label, 13) + 10);
    const ay = a.y + offset(e.from, e), by = b.y + offset(e.to, e);
    // ひし形は右の頂点からしか出入りできないので、ずらした分だけ辺の内側へ寄せる
    const edgeX = (n, dy) => n.x + n.w / 2 - (n.shape === "diamond" ? (Math.abs(dy) * n.w) / n.h : 0);
    return {
      e,
      d: [[edgeX(a, ay - a.y), ay], [gx, ay], [gx, by], [edgeX(b, by - b.y), by]],
      poly: true,
      label: [gx + 6, (a.y + b.y) / 2],
      side: true,
    };
  });
  const w = Math.max(M + colW + (route ? ROUTE_GAP + ROUTE_STEP * (route - 1) : 0) + M, labelRight + M, laneLabelWidth(lanes));
  for (const band of bands) Object.assign(band, { x: M - BAND_PAD + 2, w: w - (M - BAND_PAD + 2) * 2 });
  return { w, h: y - BAND_GAP + M, pos, bands, paths };
}

/** 矢印の先（終点の接線方向に三角形）。marker を使わないので id が要らない */
function tip([fx, fy], [tx, ty]) {
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  const ux = (tx - fx) / len, uy = (ty - fy) / len;
  const bx = tx - ux * 9, by = ty - uy * 9;
  return `<polygon class="hero-tip" points="${n1(tx)},${n1(ty)} ${n1(bx - uy * 5)},${n1(by + ux * 5)} ${n1(bx + uy * 5)},${n1(by - ux * 5)}"/>`;
}

function drawEdge({ e, d, poly, label, side }, bare) {
  const cls = `hero-edge${e.dashed ? " hero-dashed" : ""}${e.bold ? " hero-bold" : ""}`;
  const pts = d.map(([x, y]) => `${n1(x)},${n1(y)}`);
  const path = d.length === 4 && !poly ? `M${pts[0]} C${pts[1]} ${pts[2]} ${pts[3]}` : `M${pts.join(" L")}`;
  let out = `<path class="${cls}" d="${path}"/>` + tip(d[d.length - 2], d[d.length - 1]);
  if (e.both) out += tip(d[1], d[0]);
  if (e.label && !bare) {
    const [x, y] = label;
    const lw = textWidth(e.label, 13) + 10;
    const lx = side ? x : x - lw / 2;
    out += `<g class="hero-elabel"><rect x="${n1(lx)}" y="${n1(y - 10)}" width="${n1(lw)}" height="20" rx="4"/>` +
      `<text x="${n1(lx + lw / 2)}" y="${n1(y + 4.5)}" text-anchor="middle">${escapeHtml(e.label)}</text></g>`;
  }
  return out;
}

function drawNode(n, { x, y }, bare) {
  const left = x - n.w / 2, top = y - n.h / 2;
  let shape;
  if (n.shape === "diamond") {
    shape = (cls) => `<polygon class="${cls}" points="${n1(x)},${n1(top)} ${n1(x + n.w / 2)},${n1(y)} ${n1(x)},${n1(top + n.h)} ${n1(left)},${n1(y)}"/>`;
  } else {
    const rx = n.shape === "pill" ? n.h / 2 : n.shape === "round" ? 14 : 6;
    shape = (cls) => `<rect class="${cls}" x="${n1(left)}" y="${n1(top)}" width="${n1(n.w)}" height="${n1(n.h)}" rx="${n1(rx)}"/>`;
  }
  const cls = ["hero-node", n.role && `hero-${n.role}`, n.mark && `hero-${n.mark}`].filter(Boolean).join(" ");
  const diamond = n.shape === "diamond";
  let out = `<g class="${cls}">${shape("hero-shape")}`;
  // 担い手は色だけでなく形の印でも示す（ひし形は左の頂点の内側、ほかは左上の角）
  if (n.role) out += glyph(n.role, diamond ? left + 12 : left + 9, diamond ? y : top + 9);
  if (!bare) {
    const base = y - ((n.lines.length - 1) * LINE) / 2 + FONT * 0.35;
    out += n.lines.map((l, i) => `<text x="${n1(x)}" y="${n1(base + i * LINE)}" text-anchor="middle">${escapeHtml(l)}</text>`).join("");
    if (n.badge) {
      // ひし形は右上の辺の中点、ほかは右上の角に付ける（外接矩形の角だと、ひし形から離れて浮く）
      const bx = diamond ? x + n.w / 4 : left + n.w - 2;
      const by = diamond ? top + n.h / 4 : top + 2;
      out += `<circle class="hero-badge" cx="${n1(bx)}" cy="${n1(by)}" r="10"/><text class="hero-badge-n" x="${n1(bx)}" y="${n1(by + 4)}" text-anchor="middle">${n.badge}</text>`;
    }
  }
  return out + "</g>";
}

/** 担い手の印。コード=四角、LLM=丸、人=三角、データ=ひし形 */
function glyph(role, cx, cy) {
  const c = `class="hero-glyph"`;
  if (role === "code") return `<rect ${c} x="${n1(cx - 3.5)}" y="${n1(cy - 3.5)}" width="7" height="7"/>`;
  if (role === "llm") return `<circle ${c} cx="${n1(cx)}" cy="${n1(cy)}" r="4"/>`;
  if (role === "human") return `<polygon ${c} points="${n1(cx)},${n1(cy - 4.5)} ${n1(cx + 4.5)},${n1(cy + 3.5)} ${n1(cx - 4.5)},${n1(cy + 3.5)}"/>`;
  return `<polygon ${c} points="${n1(cx)},${n1(cy - 4.5)} ${n1(cx + 4.5)},${n1(cy)} ${n1(cx)},${n1(cy + 4.5)} ${n1(cx - 4.5)},${n1(cy)}"/>`;
}

function drawLayout(hero, lay, { bare = false, cls, attrs }) {
  const bands = lay.bands
    .filter((b) => b.lane.id)
    .map((b) => `<rect class="hero-band" x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" rx="10"/>` +
      (bare || !b.lane.label ? "" : `<text class="hero-lane" x="${n1(b.x + 10)}" y="${n1(b.y + 17)}">${escapeHtml(b.lane.label)}</text>`))
    .join("");
  const edges = lay.paths.map((p) => drawEdge(p, bare)).join("");
  const nodes = hero.nodes.map((n) => drawNode(n, lay.pos.get(n.id), bare)).join("");
  return `<svg class="hero-svg ${cls}" viewBox="0 0 ${n1(lay.w)} ${n1(lay.h)}" width="${n1(lay.w)}" height="${n1(lay.h)}" style="--w:${n1(lay.w)}px" ${attrs} xmlns="http://www.w3.org/2000/svg">${bands}${edges}${nodes}</svg>`;
}

/**
 * 読み上げ用の説明。大見出しと要点は画面上の HTML が読まれるので入れず、
 * 図にしか無い情報（どのレーンに誰が担うノードがあり、どう流れるか）だけを短く書く
 */
function describe(hero) {
  const name = (n) => n.label.replace(/\\n/g, "");
  const lanes = hero.lanes.map((l) => {
    const names = hero.nodes.filter((n) => n.group === l.id).map((n) => (n.role ? `${name(n)}（${ROLES[n.role]}）` : name(n)));
    return l.label ? `${l.label}：${names.join("、")}` : names.join("、");
  });
  const flow = hero.edges.map((e) => `${name(hero.byId.get(e.from))}${e.both ? "⇄" : "→"}${name(hero.byId.get(e.to))}`);
  return `設計図。${lanes.join("。")}。流れ：${flow.join("、")}`;
}

/* ---------- フォールバック（hero が無い記事） ---------- */

const FB_W = 600;
const FB_CELL = (FB_W - M * 2) / 8;

/** slug を種にした擬似乱数（mulberry32） */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** slug から決まる幾何学模様 */
function patternSvg(slug, rows, attrs = "") {
  const rnd = random(fnv1a(slug));
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 8; c++) {
      const kind = rnd();
      const op = [0.15, 0.3, 0.55, 0.85][Math.floor(rnd() * 4)];
      const cx = M + FB_CELL * (c + 0.5);
      const cy = M + FB_CELL * (r + 0.5);
      const s = FB_CELL * 0.62;
      if (kind < 0.25) continue;
      if (kind < 0.55) out.push(`<circle class="hero-pat" cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(s / 2)}" fill-opacity="${op}"/>`);
      else if (kind < 0.8) out.push(`<rect class="hero-pat" x="${n1(cx - s / 2)}" y="${n1(cy - s / 2)}" width="${n1(s)}" height="${n1(s)}" rx="8" fill-opacity="${op}"/>`);
      else out.push(`<circle class="hero-ring" cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(s / 2 - 2)}" stroke-opacity="${n1(Math.min(1, op + 0.3))}"/>`);
    }
  }
  const h = M * 2 + FB_CELL * rows;
  return `<svg class="hero-svg hero-fallback" viewBox="0 0 ${FB_W} ${n1(h)}" width="${FB_W}" height="${n1(h)}" style="--w:${FB_W}px" ${attrs}aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
}

/* ---------- 出力 ---------- */

const catStyle = (color) => (color ? ` style="--cat:${color}"` : "");

/**
 * 記事ページの見出し画像（figure 全体）
 * @param {{ slug: string, hero: object | null, category: string, series: string }} a
 * @param {string} [catColor]
 */
export function heroFigure(a, catColor) {
  const hero = a.hero;
  if (!hero) {
    const meta = [a.category, a.series].filter(Boolean).map((t) => `<span>${escapeHtml(t)}</span>`).join("");
    return `<figure class="hero hero-none"${catStyle(catColor)} aria-hidden="true">${patternSvg(a.slug, 2)}<p class="hero-meta">${meta}</p></figure>`;
  }
  const label = escapeHtml(describe(hero));
  const roles = Object.keys(ROLES).filter((r) => hero.nodes.some((n) => n.role === r));
  // 凡例の見本は図のノードと同じ枠・面・印で描く（色だけに頼らない）
  const swatch = (r) => `<svg class="hero-swatch" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false"><g class="hero-node hero-${r}"><rect class="hero-shape" x="1" y="1" width="16" height="16" rx="4"/>${glyph(r, 9, 9)}</g></svg>`;
  const legend = roles.length
    ? `<ul class="hero-legend">${roles.map((r) => `<li>${swatch(r)}${ROLES[r]}</li>`).join("")}</ul>`
    : "";
  const notes = hero.notes.length ? `<ol class="hero-notes">${hero.notes.map((n) => `<li>${escapeHtml(n.text)}</li>`).join("")}</ol>` : "";
  // 横幅の大きい図は 860px ちょうどで横向きにすると縮みすぎるので、切り替えを遅らせる（style.css の .hero-wide）
  const wide = hero.lr.w > WIDE_LR ? " hero-wide" : "";
  return `<figure class="hero${wide}"${catStyle(catColor)}>
  <figcaption class="hero-title">${escapeHtml(hero.title)}</figcaption>
  ${legend}
  <div class="hero-art">${drawLayout(hero, hero.lr, { cls: "hero-lr", attrs: `role="img" aria-label="${label}"` })}${drawLayout(hero, hero.tb, { cls: "hero-tb", attrs: `role="img" aria-label="${label}"` })}</div>
  ${notes}
</figure>`;
}

/** 記事一覧のカード用の縮小版（文字なし） */
export function heroThumb(a) {
  if (!a.hero) return patternSvg(a.slug, 2, 'preserveAspectRatio="xMidYMid meet" ');
  return drawLayout(a.hero, a.hero.lr, { bare: true, cls: "hero-mini", attrs: 'preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"' });
}
