# 技術ナレッジブログ（brog-app）構築 + 初回記事「AIエージェント」

## Context

空の `~/projects/brog-app` に、個人の学習ナレッジ用の技術ブログを作る。
- 検索・カテゴリ分類が必要。記事はエンジニア向けの技術解説（コード・表・フロー図が主役）
- GitHub で公開予定（→ GitHub Pages）。記事コードは Python
- 「〜について記事を作成して」で **Webリサーチ → 構成案の提案 → 承認後に執筆** が回る仕組みを持たせる
- 初回記事は「AIエージェント開発の知識と仕組み（基礎→発展、コード解説付き）」

規模判定: **M**（新規・多ファイル・データ構造あり）。このプランを仕様ゲートとし、承認後に `.claude/specs/blog-foundation/` へ requirements / design / tasks として書き出してから実装する。

## 方針：既存の依存ゼロSSGを流用して技術ブログ向けに作り替える

`~/projects/brog-creator-web` が npm 依存ゼロの自作SSG（Markdown→HTML・フロントマター・検索・カテゴリ・開発サーバー）を持っている。これをコピーして土台にし、スピリチュアル系の見た目と構成を技術ブログ向けに差し替える。テンプレは `static-zero`（依存ゼロ）を採用し、公開先だけ GitHub Pages に変える。

流用するファイル（コピー後に改修）:
| 元 | 用途 | 改修 |
|---|---|---|
| `src/lib/markdown.mjs` (243行) | MD→HTML。表・コードフェンス対応済み | コードハイライト・コールアウト・図ブロック・見出しID追加 |
| `src/lib/frontmatter.mjs` | YAMLサブセット | そのまま |
| `src/lib/content.mjs` | 記事読込・集計・関連記事 | `level` / `series` フィールド追加 |
| `src/lib/util.mjs` | 日付・カテゴリ色 | そのまま＋調整 |
| `build.mjs` / `scripts/serve.mjs` | ビルド・開発サーバー | 相対パス出力、検索インデックスJS化 |
| `src/templates/*`, `src/assets/*` | 画面 | **作り直し**（技術ブログのデザイン） |

## 機能（受入条件）

1. `node build.mjs` で `content/articles/*.md` から `dist/` を生成。npm install 不要
2. **トップ**: 最新記事一覧、カテゴリ・タグ一覧、検索ボックス
3. **検索**: タイトル・説明・タグ・本文の全文検索（クライアント側、`dist/search-index.js` に埋め込み。`file://` でも動く）。カテゴリ・タグ・レベルで絞り込み
4. **カテゴリ/タグページ**: `categories/<slug>.html`, `tags/<slug>.html`
5. **記事ページ**: 追従目次、読了時間、レベル表示（入門/実践/発展）、前後・関連記事、読書進捗バー
6. **コードブロック**: ビルド時シンタックスハイライト（python / ts・js / bash / json / yaml の自作トークナイザ）、ファイル名ラベル（```` ```python title="agent.py" ````）、コピーボタン、行ハイライト
7. **コールアウト**: `> [!NOTE]` `[!TIP]` `[!WARNING]` `[!IMPORTANT]`（GitHub 互換記法）
8. **フロー図**: ```` ```flow ```` ブロックの簡易DSL（`A[入力] --> B{判定}` / `B -- yes --> C` / ループ用の戻り矢印）をビルド時にインラインSVGへ変換。複雑な図は ```` ```svg ```` で生SVGをそのまま埋め込める
9. ライト/ダーク切替（OS追従＋手動）、スマホ幅で横スクロールが出ない
10. **全リンクを相対パスで出力** → `file://` でも GitHub Pages のサブパス（`/brog-app/`）でも同じ成果物が動く
11. `.github/workflows/pages.yml`：main への push で `node build.mjs` → Pages へデプロイ（`dist/` は git 管理外）
12. 記事作成スキル `.claude/skills/write-article/SKILL.md`（下記）

## 記事作成フロー（スキル化）

「〜について記事を作成して」で起動:
1. **リサーチ**: WebSearch/WebFetch を複数観点で並列実行（公式ドキュメント・一次論文・主要企業のエンジニアリングブログ・直近の動向/リリース・設計思想や批判的意見）。ライブラリ仕様は context7 で最新版を確認
2. 結果を `research/<slug>.md` に出典URL・日付付きで保存（事実と主張を区別）
3. **構成案を提示して止まる**: タイトル案3つ（刺さる系）＋ 章立て（各章の狙い・入れる図/表/コード）＋ 想定分量
4. 承認後に執筆 → `content/articles/YYYY-MM-DD-<slug>.md`、末尾に参考文献
5. `node build.mjs` → 開発サーバーで表示確認、Python コードは `python -m py_compile` で構文確認
- 執筆ルールは `docs/writing-guide.md`（見出しの付け方、図・表・コードの使いどころ、1コード1説明、TL;DR、難易度表示）

## 初回記事の構成案（実装時にリサーチして更新・再提示する）

タイトル案:
- 「LLMに"ループ"を渡した瞬間、エージェントが生まれる——50行から始める設計の全体像」
- 「チャットボットとAIエージェントは何が違うのか：コードで分解する基礎→発展ロードマップ」
- 「AIエージェントは"賢さ"より"設計"で決まる——ツール・記憶・評価まで実装で理解する」

章立て（カテゴリ: AIエージェント / レベル: 入門→発展）:
0. TL;DR と全体マップ（フロー図：本記事の読み方）
1. エージェントとは何か：ワークフロー vs エージェント（比較表）
2. 心臓部「エージェントループ」：図＋最小実装（Python・Claude API の tool use、約50行）
3. ツール設計：スキーマ・説明文・エラーの返し方（良い例/悪い例のコード）
4. コンテキストエンジニアリング：システムプロンプト・短期/長期メモリ・圧縮・RAG
5. 定番パターン5種：chaining / routing / parallelization / orchestrator-workers / evaluator-optimizer（表＋コード）
6. マルチエージェントとサブエージェント：使いどころとコスト
7. 外部接続の標準化：MCP・Agent Skills
8. 本番運用：ガードレール・人間の承認・権限・プロンプトインジェクション・評価(evals)・観測
9. フレームワーク比較表（Claude Agent SDK / OpenAI Agents SDK / LangGraph ほか、最新版を調査）
10. 設計思想のまとめ：「単純に始め、必要な分だけ複雑にする」チェックリスト
11. 参考文献

コードは最新モデル ID（claude-api スキルで確認）を使う。

## 非目標

- CMS・管理画面・ブラウザ上での記事編集
- コメント・いいね・アクセス解析・広告
- npm 依存の追加、Mermaid 等の外部ライブラリ/CDN
- 汎用 Mermaid 互換の図レンダラ（`flow` DSL は縦方向のボックス＋矢印＋戻り矢印に限定）
- 記事内コードの実 API 実行による検証（構文確認まで）
- 多言語対応、RSS 以外の配信、PWA/Service Worker
- GitHub リポジトリの作成・push（`/ship` で指示を受けてから行う）
- 2本目以降の記事

## 構成

```
brog-app/
├── build.mjs / site.config.mjs / package.json(依存なし)
├── content/articles/YYYY-MM-DD-slug.md
├── research/<slug>.md          リサーチメモ（出典付き）
├── src/lib/{markdown,highlight,flow,frontmatter,content,util}.mjs
├── src/templates/{layout,pages}.mjs
├── src/assets/{style.css,app.js}
├── scripts/serve.mjs
├── docs/writing-guide.md
├── .github/workflows/pages.yml
└── .claude/{CLAUDE.md, specs/blog-foundation/, skills/write-article/SKILL.md}
```
`.claude/CLAUDE.md` は `~/.claude/templates/static-zero.md` をベースに、「file:// 要件は相対パスで満たす／公開は GitHub Pages」に書き換える。

## 実装順

1. 仕様書書き出し・`.claude/CLAUDE.md`・`.gitignore`・`git init`
2. SSG コア流用（frontmatter/markdown/content/build/serve）＋相対パス化 → サンプル記事でビルド確認
3. highlight.mjs・コールアウト・flow.mjs（SVG生成）
4. テンプレート・CSS・app.js（検索・絞り込み・目次・コピー・テーマ切替）
5. Pages ワークフロー・writing-guide・write-article スキル
6. 初回記事：リサーチ → 構成案を再提示（**ここで一度止まる**）→ 執筆
7. `/review-report`（code-reviewer + ui-review）→ `/review-fix high`

## 検証

- `node build.mjs` がエラーなく完了し、`dist/` に index / 記事 / カテゴリ / タグ / search-index.js が出る
- `node scripts/serve.mjs` で開き、claude-in-chrome で確認：検索で本文中の語がヒット、カテゴリ・タグ絞り込み、目次追従、コピー、ダーク切替、375px 幅で横スクロールなし、flow 図とハイライト表示
- `dist/index.html` を `file://` で開いても同じく動く（相対パスの確認）
- 記事内 Python を抽出して `python -m py_compile` が通る
- `package.json` の dependencies/devDependencies が空
