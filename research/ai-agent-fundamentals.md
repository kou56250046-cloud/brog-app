# AIエージェント開発の基礎から発展まで リサーチメモ（2026-09-29）

## 事実（出典付き）

### 定義と設計原則
- ワークフロー = LLM とツールを**あらかじめ決めたコード経路**で動かす。エージェント = LLM が**自分で手順とツール利用を決める**。自律エージェントの実体は「環境からのフィードバックを見ながらループでツールを使う LLM」 — [Building Effective AI Agents / Anthropic](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）
- 基本部品は「拡張された LLM（augmented LLM）」= 検索・ツール・記憶を足した LLM — 同上
- ワークフローの 5 パターン: prompt chaining / routing / parallelization（sectioning・voting）/ orchestrator-workers / evaluator-optimizer — 同上
- エージェントが向くのは「必要なステップ数を予測できない」開かれた問題 — 同上
- 3 原則: 単純さを保つ / 計画を明示して透明にする / ACI（エージェント・コンピュータ・インターフェース）を丁寧に作る — 同上
- 「最も単純な解から始め、必要なときだけ複雑にする」。フレームワークより先に API を直接使う — 同上
- ツール引数はポカヨケ（間違えにくい形）にする — 同上

### ツール設計
- 「エージェントの性能は与えたツール次第」。名前空間で境界を分ける、意味のある文脈を返す、トークン効率、ページング・絞り込み・切り詰めに妥当な既定値、ツール説明をプロンプトとして書く — [Writing effective tools for agents / Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11）
- 「人間のエンジニアがどのツールを使うべきか断言できない状況で、エージェントにそれ以上を期待できない」 — [Effective context engineering / Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）

### コンテキストエンジニアリング
- 定義: 推論時に最適なトークン集合を選び、維持する戦略の総体。プロンプトエンジニアリングを含むより広い概念 — 同上
- context rot: 文脈が長くなるほど性能が落ちる。注意（attention）は有限の予算 — 同上
- システムプロンプトは「ちょうどよい高度」で。硬すぎる分岐ロジックも、曖昧すぎる指示も避ける — 同上
- 例は網羅より「多様で典型的な少数」 — 同上
- Just-in-time 取得: 識別子（パス・URL）だけ持ち、必要なときにツールで読み込む（段階的開示） — 同上
- 長時間タスク: 圧縮（compaction）/ 構造化ノート（NOTES.md 等）/ サブエージェント（1,000〜2,000 トークンの要約を返す） — 同上

### マルチエージェント
- Opus 4 リード + Sonnet 4 サブエージェントの構成が、単一 Opus 4 より社内評価で 90.2% 高性能 — [How we built our multi-agent research system / Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)（2025-06-13）
- トークン消費: エージェントはチャットの約 4 倍、マルチエージェントは約 15 倍。BrowseComp では性能差の 80% をトークン量が説明 — 同上
- 向かない領域: 全員が同じ文脈を共有する必要がある、依存関係が強い、並列化しにくい（多くのコーディング） — 同上
- 委任時にサブエージェントへ渡すもの: 目的・出力形式・使うツールと情報源・タスクの境界 — 同上

### MCP / Skills
- MCP は 2025-12-09 に Linux Foundation の Agentic AI Foundation へ寄贈 — [Wikipedia: Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- 最新仕様は 2026-07-28 版 — [MCP Specification](https://modelcontextprotocol.io/specification/2026-07-28)
- 2026 ロードマップ（2026-03）: トランスポートのスケール、エージェント間通信、ガバナンス、エンタープライズ対応 — [The 2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

### 評価
- eval の構成要素: task / trial / harness / transcript / outcome / grader / suite。採点はコード・LLM・人間を組み合わせる — [Demystifying evals for AI agents / Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01）
- pass@k（k 回中 1 回でも成功）と pass^k（k 回すべて成功）。本番で要るのは後者の一貫性 — 同上

### セキュリティ
- Lethal trifecta（Simon Willison, 2025）: 私的データへのアクセス / 信頼できない入力 / 外部への送信手段。3 つ揃うとプロンプトインジェクションで情報が抜ける — [Airia](https://airia.com/blog/ai-security-in-2026-prompt-injection-the-lethal-trifecta-and-how-to-defend/)
- Meta の Agents Rule of Two: 無監督のエージェントは 3 つのうち最大 2 つまで。3 つ必要なら人間の承認を挟む — 同上

### SDK / フレームワーク
- Claude Agent SDK: 旧 Claude Code SDK を 2025 年後半に改称。Python / TypeScript。サブエージェント・セッション・MCP・フック・Skills — [morphllm](https://www.morphllm.com/ai-agent-framework)
- OpenAI Agents SDK（2025-03）: Swarm の後継。中心概念は handoff — [gurusup](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- LangGraph: グラフ型の状態機械。永続実行・人間の承認・チェックポイント — [LangChain](https://www.langchain.com/resources/ai-agent-frameworks)
- Google ADK: マルチモーダル、GCP、A2A — 同上

## 主張・意見（誰の）
- 2026 年に実際に採用されている構成は「全文脈を持つ単一のオーケストレーター + 要約だけ返す使い捨てサブエージェント」に収束 — FlowHunt ほか二次情報（一次で未確認）
- 「フィルタで prompt injection は防げない」。適応的攻撃で既存防御は突破される — HackerNoon / Nasr et al.（二次情報経由）

## 記事に使うコード・図の素材
- 最小エージェントループ（Messages API の tool use、stop_reason でループ継続判定）
- ツール定義の悪い例 / 良い例（名前・説明・引数の enum・エラーを文章で返す）
- 5 パターンそれぞれ 10〜20 行
- 圧縮・ノート・サブエージェントの図
- Rule of Two の表、人間承認フック

## 未確認・食い違い
- 「2026-05 の Dynamic Workflows で最大 1,000 並列サブエージェント」— 二次情報のみ。記事では使わない
- MCP の Skills over MCP / MCP Apps の正式な位置づけ — 仕様本文で要確認
- SDK の細かい API は執筆時に claude-api スキルと context7 で確認する
