# Workflow と AIエージェントの使い分け リサーチメモ（2026-10-05）

ユーザー提供の原稿（判断軸・比較表・業務別の例・チェックリスト・ハイブリッド・制約）を骨格にし、裏付けと反対意見を集めた。

## 事実（出典付き）

### 定義
- Workflow = "systems where LLMs and tools are orchestrated through predefined code paths"、Agent = "systems where LLMs dynamically direct their own processes and tool usage" — [Building Effective AI Agents / Anthropic](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19 / 確認 2026-10-05）
- エージェントが向くのは、必要なステップ数を予測できず、固定の経路を書けない開かれた問題。停止条件（最大反復数）と人間のチェックポイントを置く。"agentic systems often trade latency and cost for better task performance" — 同上
- 自律度は 0/1 ではなく連続的なスペクトラム。☆☆☆ 単純処理（LLM の出力が流れに影響しない）→ ★☆☆ ルーター（if/else を LLM が決める）→ ★★☆ ツール呼び出し → ★★☆ 複数ステップ（ループの継続を LLM が決める）→ ★★★ マルチエージェント／コードエージェント — [smolagents: Introduction to Agents / Hugging Face](https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents)（確認 2026-10-05）
- 「エージェントかどうか」の二択より「自律の度合い」で語る方が生産的 — Andrew Ng（LangChain Interrupt 2025 の対談）[メモ](https://lawrencewu.net/posts/2025-05-13-andrew-ng-harrison-chase-fireside-chat/)（2025-05）

### いつエージェントにするか（OpenAI）
- 3 つの条件: ①複雑な判断（例外・文脈に依存する判断。例: 返金の承認）②保守が難しいルール（ルールが膨大で更新が高コスト・誤りやすい。例: 取引先のセキュリティ審査）③非構造化データへの強い依存（例: 住宅保険の請求処理） — [A practical guide to building agents / OpenAI](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)（2025-04 / 確認 2026-10-05、要約サイト経由で文言確認）
- 人間の介入: 失敗が再試行上限を超えたらエスカレーション。取り消せない・高リスクの操作（注文取消・高額返金・支払い）は「信頼が育つまで」人間の確認を要する — 同上
- まず単一エージェントから始める — 同上

### クラウド事業者
- 文書要約・翻訳・顧客の声の分類のような、手順が決まった仕事にエージェントは要らない。他の手段の方が効率的で安い — [Choose your agentic AI architecture components / Google Cloud](https://docs.cloud.google.com/architecture/choose-agentic-ai-architecture-components)（確認 2026-10-05）

### 実務（コミュニティ、二次情報）
- 「成功している AI 製品の多くは、ほぼ決定的なコードに LLM の工程を要所だけ散りばめたもの」「制御フローは自分で持つ（Own your control flow）」 — [12-Factor Agents / HumanLayer](https://www.humanlayer.dev/blog/12-factor-agents)（2025）
- ログラス: 自律エージェントでデータ選択の迷い・タイムアウト・出力のムラが出たため、業務を 5 ステップのワークフローに分解し AI の役割を限定。検証可能性と信頼性が上がった（数値なし） — [万能なエージェントより、確実なワークフローを / Zenn](https://zenn.dev/loglass/articles/08a238976938a9)（2025-12-14）
- Finatext: PoC は LLM 主導、本番はコード主導へ。LLM に実行対象を自由生成させず ID を選ばせる、検証はコード側、観測単位で Span を切る。コスト約 1/4、入力トークン約 56% 減の報告 — [LLMの自由度を設計する / Zenn](https://zenn.dev/finatext/articles/77560a30ecf3f0)（2026-06-18）
- PharmaX: 呼び名より価値。現状、複雑な業務を安定させるにはワークフロー構築が現実解 — [「完全自律型」AIエージェント至高論への違和感 / Zenn](https://zenn.dev/pharmax/articles/d1d3695e4114c0)（2025-01-14）
- 「ワークフロー型／エージェント型」という対比は Zenn・Qiita で定着している — [Qiita: AIエージェント=自律型ではない](https://qiita.com/taka_yayoi/items/2d52001264ec0412d34c)、[Zenn: ワークフロー型とエージェント型](https://zenn.dev/headwaters/articles/07eaa3cd1da745)

## 主張・意見（誰の）
- 単純に始め、測って、効果が示されたときだけ複雑にする — Anthropic
- 本番は LLM の自由度を絞る方向に動く — Finatext・ログラス（Zenn）、HumanLayer（12-Factor Agents）
- 反対方向の論点: ルールが膨大で保守できないなら、if 文で書けてもエージェント（LLM の判断）に寄せる価値がある — OpenAI ガイドの条件②。ユーザー原稿の「if 文が多い＝エージェントではない」と対にして書く

## 記事に使うコード・図の素材
- 同じ「請求書処理」を Workflow と Agent で書き比べる（偽 LLM で動かす）
- 判断チェックリストを点数化する関数
- 自律度の段階を表にして、コード 1 行で示す（smolagents の表を参考に自前で書く）
- ハイブリッド構成: 受付（WF）→ 調査（Agent、予算付き）→ 検証（WF）→ 報告（WF）
- エージェントの制約: 最大ステップ・ツール回数・時間・コスト・読み取り専用・承認・エスカレーションを 1 つの Budget/Policy にまとめる

## 未確認・食い違い
- OpenAI ガイド PDF 本文は直接テキスト化できず、要約サイト経由で文言を確認した。条件 3 つと人間介入 2 条件は複数の要約で一致
- 「2025 年の本番 AI システムの大半はワークフロー型」という主張は二次情報のみ（intuitionlabs 等）。記事では使わない
