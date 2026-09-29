# brog-app — 技術ナレッジブログ

エンジニア向けの学習ナレッジを、図・表・コードで基礎から発展まで解説する個人ブログ。
Markdown 原稿を依存ゼロの自作 SSG で静的 HTML にし、GitHub Pages で公開する。
CMS・コメント・アクセス解析は持たない。

`~/projects/brog-creator-web` の SSG を流用して技術ブログ向けに作り替えたもの。

---

## 絶対的な制約

### 1. npm 依存ゼロ

- `package.json` の `dependencies` / `devDependencies` は空のまま
- ビルドは Node 標準モジュールだけで書く。Markdown・ハイライト・図の生成も自作
- Mermaid / Prism / highlight.js / CDN フォントを入れない

### 2. 相対パスで出力する

- 生成 HTML 内のリンク・アセット参照は**すべて相対パス**（`rel()` を通す）
- これで `file://`・開発サーバー・GitHub Pages のサブパス（`/brog-app/`）の全部で同じ成果物が動く
- 検索インデックスは `search-index.js`（`window.SEARCH_INDEX = …`）。`fetch` しない
- 絶対 URL（`site.url`）を使うのは RSS・サイトマップ・OGP だけ

### 3. 外部サービスを使わない

DB・認証・解析・広告は使わない。公開は GitHub Pages のみ。

---

## 構成

```
build.mjs                 ビルドの入口（dist/ を作り直す）
site.config.mjs           サイト名・公開 URL
content/articles/         記事原稿（YYYY-MM-DD-slug.md）。唯一の情報源
research/<slug>.md        記事のリサーチメモ（出典 URL と取得日）
src/lib/markdown.mjs      MD → HTML（コールアウト・コードブロック・図を含む）
src/lib/highlight.mjs     シンタックスハイライト（python/js/ts/bash/json/yaml）
src/lib/flow.mjs          ```flow DSL → インライン SVG
src/templates/            レイアウトとページ
src/assets/               style.css / app.js
docs/writing-guide.md     記事の書き方（執筆前に必ず読む）
.claude/skills/write-article/  「〜について記事を作成して」の手順
```

## コマンド

```bash
node build.mjs            # dist/ を生成
node scripts/serve.mjs    # http://localhost:4323 （変更を監視して再ビルド）
```

---

## 記事

- 「〜について記事を作成して」と言われたら `.claude/skills/write-article/SKILL.md` に従う。
  リサーチ → **構成案を提示して止まる** → 承認後に執筆
- 書き方は `docs/writing-guide.md`。記法の一覧もそこにある
- コード例の言語は Python を基本にする
- `status: published` のものだけが出力される。下書きは `draft`
