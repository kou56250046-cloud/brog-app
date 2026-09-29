# レビューエージェントの設計思想 リサーチメモ（2026-09-29）

## 事実（出典付き）

- Cloudflare は CI 上で最大 7 体の専門レビュアー（security / performance / code quality / documentation / release management / compliance / AGENTS.md）を起動し、上位モデルの coordinator が重複排除・再分類・妥当性フィルタを行う。coordinator はソースを読み直して検証する — [Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/)（2026-04-20 / 確認 2026-09-29）
  - 各レビュアーに「何を指摘するか」と同時に「何を無視するか」を与える。無視: ありそうにない前提が要る理論上のリスク、主防御があるときの多層防御の提案、MR が触れていない未変更コード、一般的な改善提案
  - 重大度は critical（障害・悪用可能）/ warning（具体的なリスク）/ suggestion（改善）の 3 段
  - 変更規模で段階分け: 10 行以下は 2 体（約 $0.20）、100 行以下は 4 体（約 $0.67）、それ以上かセキュリティ関連ファイルは 7 体（約 $1.68）
  - 2026-03-10〜04-09 の 30 日で 131,246 回・48,095 MR。中央値 3 分 39 秒、平均 $1.19、指摘は 1 回あたり約 1.2 件。強制上書き（break glass）は 0.6%
- ByteDance の BitsAI-CR は RuleChecker（219 のレビュールールで検出）→ ReviewFilter（幻覚・誤検知を除く検証）の 2 段。精度ピーク 75.0%、週次でフィードバックを集め、指摘行が後のコミットで変更された割合（Outdated Rate）を採用の指標にする。12,000+ WAU — [BitsAI-CR (arXiv:2501.15134)](https://arxiv.org/abs/2501.15134)（2025-01 / 確認 2026-09-29）
- Kuaishou と中国科学院の研究: AST 上のコードスライス（親関数、変数の流れ、呼び出し先のシグネチャと使われ方）で diff の外の文脈を集める。Reviewer → Meta-Reviewer（統合）→ Validator（「重箱の隅か」「偽の問題か」「本当に重大か」で 1〜7 点、4 点以下は捨てる）の多役割構成 — [Towards Practical Defect-Focused Automated Code Review (arXiv:2505.17928)](https://arxiv.org/abs/2505.17928)（2025-05 / 確認 2026-09-29）
- Refute-or-Promote: 候補を反証する役（kill mandate）、先入観を持たない cold-start レビュアー、別系統モデルの Critic、実行による実証ゲート。171 候補の約 79% を公開前に棄却。**10 体のレビュアーが全員一致で存在しない脆弱性を支持し、実際に動かして初めて誤りと分かった**失敗例を報告 — [Refute-or-Promote (arXiv:2604.19049)](https://arxiv.org/abs/2604.19049)（2026-04-21 / 確認 2026-09-29）
- LLM 批評役（CriticGPT）は人間の請負レビュアーより多くの埋め込みバグを見つけたが、幻覚のバグと重箱の隅の指摘も出す。人間＋批評役のチームは同程度のバグを見つけつつ、LLM 単独より幻覚が少ない。精度と再現率はトレードオフ — [LLM Critics Help Catch LLM Bugs (OpenAI, arXiv:2407.00215)](https://arxiv.org/abs/2407.00215)（2024-06 / 確認 2026-09-29）
- curl はバグ報奨金を 2026-01-31 で終了。確認された脆弱性の割合は過去 15% 超 → 2025 年に 5% 未満。AI 生成の報告の流入が理由 — [The Register](https://www.theregister.com/security/2026/01/21/curl-shutters-bug-bounty-program-to-stop-ai-slop/5063039)（2026-01-21）、[BleepingComputer](https://www.bleepingcomputer.com/news/security/curl-ending-bug-bounty-program-after-flood-of-ai-slop-reports/)
- Microsoft の調査: レビューの主な動機は欠陥発見だが、実際の成果は欠陥より知識共有・代替案・チームの認識向上が多い — [Bacchelli & Bird, ICSE 2013](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/)
- CodeReviewer ベンチマークの学習用コメントのうち有効（具体的で行動可能）なのは 64% — [Too Noisy To Learn (arXiv:2502.02757)](https://arxiv.org/abs/2502.02757)（2025-02）
- LLM が口頭で述べる確信度は較正されておらず、高い確信度で間違えることがある — [Overconfidence in LLM-as-a-Judge (arXiv:2508.06225)](https://arxiv.org/abs/2508.06225)、外部からのフィードバックなしの自己修正は推論を改善しない — Huang et al. "Large Language Models Cannot Self-Correct Reasoning Yet"（ICLR 2024, arXiv:2310.01798）

## 主張・意見（誰の）

- AI レビューは「検索エンジン」と同じ精度と再現率のトレードオフ。オフライン評価（正解データ）とオンライン評価（採用率）で測る。目的別にスキルを分ける — HrsUed / [Qiita](https://qiita.com/HrsUed/items/8e60c4dbba07ce0b0e5f)（2026-06-19）
- 指摘を Must / Should / Nice に分類し、日付・PR・採否・理由を表で記録。同じ指摘が 3 回出たらルール候補にする — minewo / [Zenn](https://zenn.dev/minewo/articles/ai-code-review-feedback-ops)（2026-04-29）
- レビュアーを単一責任で分け、起動条件（description）を具体的に書く。導入して終わりでなく育てる — GLOBIS / [Zenn](https://zenn.dev/globis/articles/d0c73d2b176ba5)（2026-03-17）
- 20 件の指摘に本当に直すべき 2〜3 件が埋もれる。重要度分類が要る — [Qiita](https://qiita.com/fuji1009_REBELL/items/54509e90f74c3f970713)（2026-07）

## 記事に使うコード・図の素材

- Finding のデータ構造（claim / evidence / severity / confidence / status）
- 証拠のない指摘を弾く検証関数、証拠行が実在するかをプログラムで確かめる
- 反証チェック（呼び出し元で保証されていないか）を「反証の質問リスト」で表す
- 固定チェック＝決定的なツール（型検査・linter・シークレット検出）、探索型＝LLM
- Aggregator: 重複排除（ファイル＋行範囲＋カテゴリ）→ Severity 再判定 → 抑制条件
- Critic: 別の文脈（cold start）で「成立しない理由」を探させる。偽 LLM で動かす
- Knowledge: accepted / rejected を JSONL に記録、次回の抑制と few-shot に使う

## 未確認・食い違い

- 合議（複数レビュアーの一致数で重み付け）は誤検知を減らすという主張（GitHub の個人実装）と、全員一致で誤る例（Refute-or-Promote）がある → 一致は証拠ではない、と書く
- Critic を同じモデルで回す効果は限定的という示唆（自己修正の研究）。別モデル・別文脈・実行による実証の順に強い、と整理する（筆者の整理として書く）
