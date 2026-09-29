# AIエージェント向けのデータ設計 リサーチメモ（2026-09-29）

## 事実（出典付き）

### データの「意味」を渡すと精度が上がる
- 列の説明文（column description）を足すと Text-to-SQL の正解率が上がる。BIRD-Bench の開発セット（11 DB・798 列）で、GPT-4o は 0.3013 → 0.3678、Mixtral 8x22B は 0.1750 → 0.2959。列名が意味を持たない列では 20% 超の改善。人間が「余計」と評した詳しめの説明の方が成績が良かった — [Wretblad ほか, Synthetic SQL Column Descriptions and Their Impact on Text-to-SQL Performance](https://arxiv.org/abs/2408.04691)（arXiv v4 2024-11-05 / 確認 2026-09-29）
- dbt Labs のベンチマーク（ACME Insurance、15 テーブル・11 問 × 20 回）。Text-to-SQL 84.1〜90.0% に対し、セマンティックレイヤー経由は 98.2〜100%。ただしスキーマ全体を文脈に入れた条件、セマンティックレイヤーは追加で 3 モデルを整備した条件。セマンティックレイヤーは範囲外の質問に「答えられない」と失敗し、誤答は返さない。Text-to-SQL は「もっともらしいが誤った答え」を失敗の合図なしに返す — [dbt Developer Blog, Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026)（2026-04-07 / 確認 2026-09-29）
- AWS の検証（EC サイト DB、略語・数値のステータスコード入り）。カタログなしのエージェントは割引前金額で売上を計算しキャンセル注文も含めて約 13% 過大。LLM 呼び出しはカタログあり 3 回・なし 7 回。「業務ルールは DB 構造からは推測できない」 — [池田 貴之, AIエージェントのデータ分析にビジネスデータカタログは必要か？ 検証してみた](https://zenn.dev/aws_japan/articles/88d99d2df3f289)（Zenn, 2026-03-28）

### ツールが返すデータの形
- UUID のような意味のない ID より、名前など意味のある識別子を返すと検索タスクの精度が上がり幻覚が減る。`response_format` を enum（concise / detailed）で選ばせる例で、詳細 206 トークン → 簡潔 72 トークン。ページング・範囲指定・絞り込み・切り詰めに妥当な既定値を持たせる — [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11）
- MCP 仕様 2026-07-28: ツールは `outputSchema` を持てる。指定したらサーバーは準拠した `structuredContent` を返さねばならず（MUST）、互換のため同じ JSON をテキストでも返すべき（SHOULD）。状態をまたぐ場合は明示的なハンドル（例 `basket_id`）を返し、寿命をツール説明に書き、期限切れは実行エラーで伝える。実行エラーは `isError: true` で、モデルが自分で直せる内容を返す — [MCP Specification 2026-07-28 / Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

### 書き込みの安全性
- エージェントの再試行は「少なくとも 1 回」実行の問題。書き込みツールには冪等キー（同じ操作なら同じキー）、一意制約、操作台帳＋突き合わせのいずれかを用意する。冪等キーの有効期限を過ぎると保護されない — [Formation, Agent Tool Call Idempotency for Safe Retries](https://formation.dev/blog/agent-tool-retry-idempotency) / [eunomia, When an AI Agent Retries a Tool Call…](https://eunomia.dev/research/agent-tool-retry-effect-idempotency/)
- 書き込みには状態確認（read-back）の操作を対で用意すべき、という提案 — 同上（eunomia）

### データ基盤側の設計
- Thoughtworks: エージェント向けデータの 5 属性（Trusted / Contextual / Traceable / Governed / Operational）。人間は怪しいデータで手を止めるが、エージェントはそのまま動く。データ契約（鮮度 SLA・スキーマをコードで）、隔離（不正データをエージェントに届けない）、指標は 1 か所で定義、50 個の API より 5〜10 の業務能力、読み取り専用から始める — [Sadalage & Chandrasekaran, Making Data Ready for Agentic AI](https://martinfowler.com/articles/making-data-ready-for-agentic-ai.html)（2026-08-27）
- Oracle の AI Ready Data 評価の 6 観点: Clean / Contextual / Consumable / Current / Correlated / Compliant — [Shiro Kobayashi, Qiita](https://qiita.com/shirok/items/3b9ccefff059ff1ab40d)（2026-06-23）
- Google Cloud: メダリオンの上に「プラチナレイヤー」（意味・関係・ガバナンス・鮮度） — [Zenn google_cloud_jp](https://zenn.dev/google_cloud_jp/articles/ff74bf18e44f97)（2025-07-01）

### 記憶のデータ
- 記憶を作業・エピソード・意味・手続きの 4 種に分ける（CoALA）。記録には `source`、`confidence`、`written_at` / `last_confirmed_at` / `expires_at`、`supersedes` を持たせる。生のエピソードは早く期限切れにし、重要な行動の前に再確認する。「忘れるのは欠陥ではなく機能」 — [小西 秀和, AI Agent Memory Design Guide](https://hidekazu-konishi.com/entry/ai_agent_memory_design_guide.html)（2026-06-11 初版 / 2026-08-29 更新）
- 複数システムにまたがる質問では、毎回取りに行く方式（scatter-gather）が遅延・トークン・精度で不利。「顧客」を各システムでどう識別しているか答えられないなら既に問題がある — [takanorisuzuki, AIエージェントが毎回データを取りに行く設計の限界](https://zenn.dev/knowledge_graph/articles/kg-agent-memory-first-design)（Zenn, 2026-05-24）

### 文書データ（RAG）
- チャンク分割の評価（トークン単位の再現率・適合率・IoU）。200 トークン前後の小さめのチャンクが効率で優位、重なり（overlap）をなくすと IoU が上がった。分割法の違いで再現率に約 9 ポイントの差 — [Chroma Research, Evaluating Chunking Strategies for Retrieval](https://www.trychroma.com/research/evaluating-chunking)（2024-07-03）
- チャンクに文書全体の文脈（会社名・期間など）を前置きしてから埋め込むと、上位 20 件の取りこぼしが 35% 減。BM25（キーワード検索）と組み合わせて 49% 減（5.7% → 2.9%）、再ランキングを足して 67% 減（→ 1.9%）。「埋め込み＋BM25 は埋め込み単体より良い」 — [Anthropic, Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)（2024-09-19）
- 「1 チャンク = 1 トピック（規程なら 1 条＋例外）」、最低限のメタデータは date / version / source — [sanpi333, Qiita](https://qiita.com/sanpi333/items/969f38a05a524da1b48e)（2026-01-01）。有効期間・既定で現行版を返す設計はこの記事には書かれていない（検索結果の要約の誤り。本文では自分の設計として書く）
- 見出し・ページ・シート名などの構造をチャンクに残し、根拠（資料・ページ・セル範囲）を出力に含める — 同上
- 権限は検索の**前**に絞る。検索後に捨てる方式だと、LLM が制限された内容を読んでしまい、要約や言い換えで漏れる — [Pinecone, RAG with Access Control](https://www.pinecone.io/learn/rag-access-control/) / [DEV: Enforcing RAG access control inside the retrieval query](https://dev.to/royalpinto007/enforcing-rag-access-control-inside-the-retrieval-query-not-after-it-4gm3)
- 固定サイズ 512 トークン・重なり 10〜20% を出発点とする推奨がある一方、重なりに効果がなかったという分析もある。**一律の正解はない**ので自分のデータで測る — 各種ガイド（premai、firecrawl、Zenn [libercraft](https://zenn.dev/libercraft/articles/20260511-rag-chunking-comparison)）。数値は出典によって揃わない

### 系譜・ガバナンス
- OpenLineage: 実行（run）・ジョブ（job）・データセット（dataset）の 3 つと、それに付ける「ファセット」（スキーマ・統計・品質チェックなど）で系譜を表す、オープンな標準 — [OpenLineage Object Model](https://openlineage.io/docs/spec/object-model/)
- Databricks Unity Catalog・Snowflake Horizon は列単位の系譜、エージェントや MCP サービスの登録・権限・監査を同じカタログで扱う方向（2026） — [Databricks Blog, What's new with Unity Catalog at Data + AI Summit 2026](https://www.databricks.com/blog/whats-new-unity-catalog-data-ai-summit-2026) / [Snowflake Horizon Catalog](https://docs.snowflake.com/en/user-guide/snowflake-horizon)。製品の紹介なので比較表でだけ使う
- 金融庁「AIディスカッションペーパー（第1.1版）」2026-03-03 公表。第1.1版で AI エージェントの節が追加された。PDF 本文は未読（取得できず）。本文の具体的な記述は引用しない — [金融庁](https://www.fsa.go.jp/news/r7/sonota/20260303/aidp.html)
- MCP 仕様: クライアントはツール利用を監査用にログに残すべき（SHOULD）、ツールの入力を送信前に利用者へ見せるべき — MCP Tools 仕様（上記）

## 主張・意見（誰の）
- 「エージェントがデータの主な利用者になると、データアーキテクチャが AI アーキテクチャになる」— Thoughtworks（上記）
- 「セマンティックレイヤーは BI の便利機能ではなく AI の前提インフラになった」— dbt Summit 2026 の論調（multishoring 記事、Cube・Atlan も同趣旨。いずれも自社製品の売り手なので割り引く）
- 反対意見: モデルの弱さを補う層の多くはモデルに吸収される。ただし「持続的な意味の文脈」（データ環境について整理された知識を質問をまたいで保つもの）は価値が残り、その保存・圧縮・一貫性が研究課題 — [Patel, Zaharia ほか, What Happens When the Model Eats the Stack?](https://arxiv.org/abs/2609.03141)（2026-09-02 投稿。要旨で確認）
- セマンティックレイヤーの限界: 定義した範囲の質問しか答えられない — dbt（上記）

## 記事に使うコード・図の素材
- 悪いスキーマ（`acct_st`, `amt`, `st=3`）→ 説明付きカタログ（辞書）→ LLM に渡す文字列を生成
- 指標を 1 か所で定義し、エージェントは名前で頼む（`get_metric("net_sales", ...)`）ミニ・セマンティックレイヤー
- ツールの返り値: `response_format` と `next_cursor`、意味のある ID
- 冪等キー付きの書き込みツールと状態確認ツール
- 記憶レコードの dataclass（source / confidence / expires_at / supersedes）
- すべて標準ライブラリ（sqlite3・dataclasses）で動く

## 未確認・食い違い
- Thoughtworks 記事の「Text-to-SQL が約 20% → 92% 超」は元の実験条件を確認できていない。本文では使わない
- 「エージェント PoC の 88% が本番に行かない」などの割合は出典が売り手のブログで一次情報を確認できない。使わない
- dbt のベンチマークは 11 問と小さく、dbt 自身の製品の評価。「傾向」として扱う
- arXiv 2609.29095（exactly-once の所在）は本文を読めていない。使わない
