# 記事の見出し画像（設計図ヒーロー） — タスク

第 1 版の T0 の控えを使う。置き場所は
`C:/Users/kou56/AppData/Local/Temp/claude/C--Users-kou56-projects-brog-app/f04f3dc1-885a-4498-8959-d6925c1fe0ae/scratchpad/before/`
（fm.json / flows.json / slugs.json）、作るスクリプトは同じ scratchpad の `snap.mjs`。検索の控えは FNV 4293057911・9823 字。
別セッションで控えが消えていたら、`git worktree add <一時ディレクトリ> HEAD` で変更前を取り出し、そこで `node build.mjs` してから
`node snap.mjs <その一時ディレクトリ> <出力先>` で作り直す。

## T1 第 1 版の不要分を戻す
- 触るファイル: src/lib/frontmatter.mjs, content/articles/*.md（33 本）
- やること: frontmatter.mjs を `git checkout` で戻す。33 本の前付けから `hero:` の 4〜5 行を消す
- **完了条件:** `git diff` で frontmatter.mjs の差分が 0、33 本の差分も 0。前付けの解析結果が before/fm.json と一致

## T2 flow の解析器を hero 用に拡張
- 触るファイル: src/lib/flow.mjs
- やること: `parse(src, { hero })` を export。group / end / title / note / `<-->` を解釈し、hero でなければ例外
- **完了条件:** 67 図の出力が before/flows.json と一致。```` ```flow ```` に `group` を書いた原稿でビルドが例外で止まる。
  サンプルの hero 原稿で groups・notes・title・both が期待どおりに取れる（scratchpad のスクリプト）

## T3 hero.mjs（取り出し・検査・配置・描画）と content.mjs
- 触るファイル: src/lib/hero.mjs, src/lib/content.mjs
- やること: `extractHero` / `parseHero` / LR と TB のレーン配置 / `heroFigure` / `heroThumb` / フォールバック
- **完了条件:** scratchpad のスクリプトで、正常例は LR・TB の SVG と凡例・要点が出る。
  title なし・ノード 13 個・レーン 4 つ・group の入れ子・end 不足・note 4 つ・存在しないノードへの note・
  幅超過・hero 2 つ・hero なしで `<slug>.md: hero …` の警告が出て null。SVG に `id=`・`#`/`rgb(` の色値が無い。
  hero ブロックが本文と検索インデックスから消えている

## T4 テンプレートと CSS
- 触るファイル: src/templates/pages.mjs, src/assets/style.css
- やること: 記事ページとカードに差し込み、スタイルと向きの切り替え
- **完了条件:** サンプル 1 本に hero を書き、幅 375 / 1366 / 1920、ライト・ダーク・手動切替で表示して
  requirements の「記事ページの表示」「記事一覧のカード」を満たす（寸法は `getBoundingClientRect` で測る。幅は 360 / 375 / 860 / 1366 / 1920）。
  「RAG」検索の控えが一致する

## T5 既存 33 本に hero を書く
- 触るファイル: content/articles/*.md
- やること: 各記事の本文を読み、全体フローか構成を図にし、設計の要点を note で 1〜3 個示す
- **完了条件:** ビルドの `hero` 警告が 0 件。33 記事すべてで、ノードの文字 11px 以上・それ以外 9px 以上・
  ラベルが箱からはみ出さない・横スクロールが無い（幅 360 と 860 と 1366 で自動計測）。スクリーンショットで全記事を目視確認

## T6 執筆ガイドとスキル
- 触るファイル: docs/writing-guide.md, .claude/skills/write-article/SKILL.md
- やること: 記法の表・書き方の指針・例を追加。スキルの構成案と確認表に hero を足す
- **完了条件:** ガイドの例をそのまま本文に貼ってビルドすると、警告なしで描画される
