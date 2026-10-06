# 記事の見出し画像（設計図ヒーロー） — 設計

## データ構造

flow の解析結果を拡張する（`src/lib/flow.mjs` の `parse` を export）:

```ts
type Node = { id; label; shape; cls; order; group?: string };   // group を追加
type Edge = { from; to; label; dashed; bold; both?: boolean };   // <--> を追加
type Graph = { nodes: Node[]; edges: Edge[]; dir: "TB" | "LR";
               groups: { id: string; label: string }[];          // 追加
               title?: string; notes: { node: string; text: string }[] };  // 追加
parse(src, { hero: boolean })  // hero:false で group / title / note / <--> があれば例外
```

記事オブジェクトに増えるもの（`content.mjs`）:

```ts
article.hero: Graph | null   // 無い・不正なら null（警告を出してフォールバックへ）
article.content              // ```hero ブロックを取り除いた本文
```

既存データの移行: 第 1 版で 33 本の前付けに書いた `hero:` を削除し、本文先頭の ```` ```hero ```` に書き直す。

## 処理の流れ

```
原稿 ─ parseFrontmatter（変更前に戻す）
content.mjs loadArticles
   └ extractHero(content) → { src, body }     ```hero を 1 つ取り出し、本文から消す（2 つ以上は警告）
   └ parseHero(src, warn) → Graph | null       flow の parse({hero:true}) + 上限の検査 + 両向きの配置を試して幅を検査
pages.mjs articlePage ─ heroFigure(a, cat)
   <figure class="hero" style="--cat:…">
     <p class="hero-title">大見出し</p>
     <div class="hero-art"> <svg class="hero-svg hero-lr">…</svg> <svg class="hero-svg hero-tb">…</svg> </div>
     <ul class="hero-legend">使った担い手だけ</ul>
     <ol class="hero-notes">要点</ol>
   </figure>
pages.mjs entry ─ heroThumb(a)  横向きの図形だけ（文字・番号なし）か、フォールバックの模様
```

大見出し・凡例・要点は HTML にする。SVG の中で折り返しを見積もらずに済み、狭い画面でも自然に折り返し、読み上げも素直になる。

## 配置（src/lib/hero.mjs）

flow の `layout` は使わず、レーンを持つ配置を hero.mjs に書く。文字幅は flow の `textWidth` / `wrap` を使う。

- **段（rank）**: flow と同じく、戻り辺を除いた最長経路。`<-->` は前向きの辺として扱う
- **レーン**: `group` の順。group に入らないノードは末尾の無名レーン（帯も名前も描かない）
- **定数**: 外周の余白 16、ノードの左右パディング 18・上下 10、ノード幅の上限 156（文字 120 + 36）・下限 64、
  段の間隔 48、同じ段で積むときの間隔 16、帯の内側の余白 14、帯の上のレーン名の領域 24、帯の間隔 12
- **横向き（LR）**: x = 段、y = レーン。同じレーン・同じ段に複数あれば縦に積む（親の位置の平均で 1 回並べ替える）。
  段の幅 = その段の最大のノード幅。レーンの帯の高さ = 名前の領域 + その中の最大の積み高さ + 上下の余白。帯の左上にレーン名（14px 太字）。
  幅 = 16×2 + Σ段の幅 + 48×(段数−1)。ラベルが全角 8 字なら 5 段で 32 + 780 + 192 = 1004
- **縦向き（TB）**: レーンの帯を上から順に積む。帯の中ではノードを段の順（同じ段は定義順）に 1 列で縦に並べ、間隔 28。
  同じレーンで順に続くノードの間の矢印は真下へ。それ以外（レーンをまたぐ、段が飛ぶ、戻る）の矢印は、
  ノードの右辺から出て図の右側の通り道（ノード列の右 20 から、1 本ごとに 14 ずつ外側）を上下し、相手の右辺へ入る。
  幅 = 16 + 帯の余白 14 + ノード幅（最大 156）+ 通り道（20 + 14×本数）+ 16。通り道 3 本で約 264。
  幅に依存する制限は設けない（360px でも縮まずに 1:1 で表示できる）
- 文字: ノード 15px（全角 8 字幅で折り返し、2 行まで）、レーン名 14px、矢印ラベル 13px、番号 12px
- **クラス**: ノードは担い手 1 つと `hl` / `muted` 1 つまで（`:::llm:::hl`）。枠の色は担い手（なければ flow と同じ）、
  `hl` は枠を太く（3）し、担い手が無いときは `--cat`。`muted` は破線
- **矢印（LR）**: 段が進む辺は flow と同じ 3 次ベジェ。同じ段でレーンだけ違う辺は直線（上下）。
  戻り辺は 2 点の外側に膨らむ 2 次ベジェで、自分のレーンの余白の中に収める。
  先端は終点の接線方向に三角形の `<polygon>` を計算して描く（`marker` と `id` を使わない）。`<-->` は両端に描く
- **担い手**: ノードの `<g>` に `hero-code` などの class。CSS で枠 = 担い手の色、面 = 同じ色を `fill-opacity: .12` で重ねる。
  色は既存の変数を使う: code = `--note`、llm = `--important`、human = `--warning`、data = `--tip`（ダークの値もある）。
  担い手なしは flow と同じ配色
- **番号**: note の順に 1〜3。ノードの右上に半径 10 の丸（面 `--surface`、枠 `--cat`）と `--ink` の数字（色の面に文字を載せない）
- **幅の検査**: LR の viewBox 幅 ≤ 1008。超えたら警告（ラベルを短く、段を減らすよう促す）
- **縮小版**: LR の配置で、`<text>` と番号を出さずに帯・ノード・矢印だけを描く。`.entry-thumb` は 120×68 の固定枠、
  SVG は `preserveAspectRatio="xMidYMid meet"` で枠に収める

## 表示（style.css）

- `.hero { max-width: calc(var(--measure) + var(--toc-gap) + var(--toc-w)) }`（`.spec` と同じ）。背景 `--surface`、枠 1px `--line`、
  内側の余白 20px（640px 以下は 12px）
- `.hero-title`: `clamp(1.25rem, 2.6vw, 1.7rem)`、太字
- `.hero-svg { width: 100%; max-width: <自然な幅>px; height: auto }`（自然な幅は style 属性 `--w` で渡す。flow の `--flow-w` と同じ方式）
- `@media (min-width: 860px) { .hero-tb { display: none } }`、`@media (max-width: 859.98px) { .hero-lr { display: none } }`
- 文字サイズの下限（`.post-head` の左右の余白を含めて計算）:
  - 860px（LR の最悪）: 入れ物 860 − 48 − 40 − 2 = 770。LR 最大 1008 で倍率 0.764 → ノード 11.5px、矢印ラベル 9.9px、番号 9.2px
  - 360px（TB の最悪）: 入れ物 360 − 32 − 24 − 2 = 302。TB は約 264 なので 1:1 → ノード 15px
- 凡例は色見本つきの横並び、要点は番号の丸を CSS で描いた `<ol>`
- カード: `.entry` を 3 列（`96px minmax(0,1fr) 120px`）、`.entry-thumb` の背景 `--sunken`。`.related` と 640px 以下は非表示

## 第 1 版から残すもの・戻すもの

| もの | 扱い |
|---|---|
| `flow.mjs` の `textWidth` / `wrap` の export と引数化 | 残す |
| `util.mjs` の `fnv1a` | 残す（フォールバックの模様に使う） |
| `hero.mjs` のフォールバックの模様・縮小版の入れ物・CSS の枠とカード 3 列 | 残して作り替える |
| `hero.mjs` の 4 型の配置と `normalizeHero` | 消す |
| `frontmatter.mjs` のネスト対応 | 変更前に戻す（`git checkout`） |
| 33 本の前付けの `hero:` | 消して ```` ```hero ```` に書き直す |

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| src/lib/frontmatter.mjs | 変更前に戻す |
| src/lib/flow.mjs | `parse` を export し、`{ hero }` で group / end / title / note / `<-->` / 担い手 class を解釈。hero でないときは例外 |
| src/lib/util.mjs | `fnv1a`（第 1 版のまま） |
| src/lib/hero.mjs | `extractHero` / `parseHero` / `heroFigure` / `heroThumb` とレーン配置 |
| src/lib/content.mjs | 本文から hero を取り出して記事オブジェクトに載せ、警告を出す |
| src/templates/pages.mjs | `articlePage` と `entry` に差し込み |
| src/assets/style.css | `.hero-*`、担い手の色、向きの切り替え、カード |
| content/articles/*.md（33 本） | 前付けの `hero:` を消し、本文先頭に ```` ```hero ```` |
| docs/writing-guide.md | 記法・指針・例 |
| .claude/skills/write-article/SKILL.md | 構成案と確認表に hero |

`build.mjs`・`markdown.mjs`・`sw.js` は変えない（取り出しは content.mjs で済ませ、本文には残さない）。

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| 第 1 版の 4 型（flow / steps / layers / compare） | 要点の並びは示せても、全体の構造と「誰が何を決めるか」が伝わらない |
| 前付けに図を書く | 前付けパーサは 1 行 1 項目の作り。複数行の図を書くには YAML のブロック文字列対応が要り、書きにくい |
| ```` ```flow ```` に group などを足して本文でも使えるようにする | 本文の 67 図の出力が変わる恐れがある。見出し用に絞れば検証範囲が hero だけで済む |
| 大見出し・要点も SVG に描く | 折り返しの見積もりが要り、狭い画面で文字が縮む。HTML なら自然に折り返す |
| 1 枚の SVG を縮めるだけで狭い画面に対応 | 横長の図は 375px で文字が 6〜8px になる。縦向きを別に作る方が読める |
| レーンの入れ子・自由配置 | 配置の計算が一気に複雑になる。帯 1 段で「層・境界・担い手」の大半を表せる |
| Canva などで画像を作る | 日本語が崩れやすい・ダークモードに追従しない・記事ごとに手作業（ユーザーと検討済み） |
| 縦向きでレーンを左右の列に並べる | 3 レーンで幅が約 600 になり、375px で文字が 10px を割る。上下に積めば幅がレーン数に依存しない |
