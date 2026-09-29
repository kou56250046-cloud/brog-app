# AIエージェントの構成要素（16要素・3段階）連載 リサーチメモ（2026-09-29）

既存の `ai-agent-fundamentals.md`（ループ・ツール設計・文脈・パターン・Rule of Two・evals）と
`ai-agent-data-design.md`（RAG のチャンク・記憶のデータ・冪等キー・権限は検索前）を前提に、足りない部分を補う。

## 事実（出典付き）

### Tool 選択
- ツール数が増えると選択精度が落ちる。似た名前のツールに確率が分散し、存在しないツール名や別ツールの引数を混ぜる失敗が出る。候補を検索で絞ってから LLM に選ばせる（retrieval-then-selection）方が、全部見せるより良い — [How Many Tools Should an LLM Agent See? A Chance-Corrected Answer](https://arxiv.org/abs/2605.24660)（arXiv 2026-05 / 確認 2026-09-29）
- 「10〜15 個を超えると精度が落ち始める」という実務報告 — DEV / TianPan.co ほか（二次情報。数値は記事では断定しない）

### Planning
- ReAct: 考える→行動→観察を 1 歩ずつ繰り返す — [Yao et al., ReAct](https://arxiv.org/abs/2210.03629)（ICLR 2023）
- Plan-and-Execute: 先に計画を立て、実行役が各ステップを実行、失敗や状況変化で計画役に戻る（再計画）。高レベルの推論呼び出しが減る — [LangChain Blog, Plan-and-Execute Agents](https://www.langchain.com/blog/planning-agents)
- 「ReAct は想定外に強く、Plan-and-Execute は目的からの逸脱（drift）に強い」 — [DEV, ReAct vs Plan-and-Execute: Picking an Agent Loop in 2026](https://dev.to/gabrielanhaia/react-vs-plan-and-execute-picking-an-agent-loop-in-2026-gnk)（意見）
- Plan-then-Execute は、計画を先に固めるため、実行中に読んだ信頼できない入力で行動が乗っ取られにくい（セキュリティ上の利点） — [Architecting Resilient LLM Agents: A Guide to Secure Plan-then-Execute Implementations](https://arxiv.org/abs/2509.08646)

### State 管理
- 長時間処理はチェックポイント（進捗を外部に記録）と冪等性で「途中から再開できる」ようにする — [Zenn akira_papa](https://zenn.dev/akira_papa/articles/d4225cbbe36248) / [Zenn 76hata](https://zenn.dev/76hata/articles/ai-agent-continuous-operation-design)（二次情報）
- フレームワークによってチェックポイントの粒度が違う（ノード単位 / アクティビティ単位） — [Zenn suwash, Graph Engineering入門](https://zenn.dev/suwash/articles/graph-engineering_20260727)

### Memory
- CoALA: 作業記憶（working）と長期記憶（episodic / semantic / procedural）に分ける — [Sumers et al., Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)（TMLR 2024）
- 保存・昇格・想起の 3 段で設計する。会話ごとに前提・決定・好みを抽出して外部に保存し、次回注入する — [Qiita agentmemories](https://qiita.com/agentmemories/items/ca4dc2742e058a3d2b11)（二次情報）
- 記憶には出典・確信度・期限を持たせる（→ ai-agent-data-design.md の小西氏ガイド）

### エラー処理・リトライ
- ジッター付き指数バックオフ。Full Jitter: `sleep = random(0, min(cap, base * 2 ** attempt))`。ジッターなしより大幅に改善し、標準的な手法とすべき — [AWS Architecture Blog, Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)（2015-03-04 / 2023-05 更新）
- 各層が独立にリトライすると負荷が掛け算で増える。リトライ回数を制限する — [AWS Well-Architected REL05-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html)
- 書き込みのリトライは冪等キーが前提（→ ai-agent-data-design.md）
- ツールが見つからない等でクラッシュさせず、回復可能なエラーを LLM に返す — [Qiita YushiYamamoto](https://qiita.com/YushiYamamoto/items/ea313b459f04cfc0012c)（二次情報）。MCP 仕様の `isError`（実行エラーはモデルが直せる内容を返す）で裏付け

### 権限管理・セキュリティ
- OWASP LLM06:2025 Excessive Agency。原因は 過剰な機能 / 過剰な権限 / 過剰な自律性。対策は機能の最小化・最小権限・高影響の操作に人間の承認・監視とレート制限 — [OWASP Gen AI Security Project](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- OWASP Top 10 for Agentic Applications 2026（2025-12-09 公開、ASI01〜ASI10）。Agent Goal Hijack、正規ツールの悪用など — [OWASP](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- Lethal trifecta / Rule of Two（→ ai-agent-fundamentals.md）
- 権限は検索の前に絞る（→ ai-agent-data-design.md）

### Human 承認
- すべてに人間を入れるのではなく「どこで介入するか」を設計する — [Zenn startspace](https://zenn.dev/startspace/articles/bd01942b140647)（意見）
- 承認待ちで処理を中断（suspend）し、状態を保存して後から再開（resume）する実装が各フレームワークにある — [Zenn condy（Mastra）](https://zenn.dev/condy/articles/24a81b8341fb89) / [Zenn microsoft（Agent Framework）](https://zenn.dev/microsoft/articles/agentframework-v1-005)。→ State 管理と一体

### ログ・監視
- OpenTelemetry GenAI セマンティック規約。操作名 `invoke_agent`（エージェント実行）/ `chat`（モデル呼び出し）/ `execute_tool`（ツール実行）。属性 `gen_ai.request.model`、`gen_ai.usage.input_tokens` / `output_tokens`、`gen_ai.response.finish_reasons`。メトリクス `gen_ai.client.operation.duration`、`gen_ai.client.token.usage`。開発中（Development）で、定義は専用リポジトリへ移った — [OpenTelemetry Blog, Inside the LLM Call](https://opentelemetry.io/blog/2026/genai-observability/) / [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)（確認 2026-09-29）

### 複数 Agent
- MAST: 150 トレースを分析し 14 の失敗モードを 3 分類（システム設計 / エージェント間の不整合 / 検証）。最多は「ステップの繰り返し」、次いで「推論と行動の不一致」「確認の質問をしない」。多くはモデルでなく設計の問題 — [Cemri et al., Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)（NeurIPS 2025）
- トークン約 15 倍、向かない領域（→ ai-agent-fundamentals.md）

## 主張・意見（誰の）
- 「段階を上げるのは必要になってから」— 既存記事と Anthropic の「最も単純な解から」の原則に揃える
- 3 段階（シンプル / 実用的 / 高度）の区分はユーザー提示の整理。業界標準の区分ではないので、記事ではこのブログの整理として示す

## 記事に使うコード・図の素材
- 偽 LLM で動くツール選択（キーワード → ツール）
- 計画（JSON のステップ列）→ 実行 → 再計画
- State をファイルに保存して再開
- Memory: 作業記憶 / 長期記憶の出し入れ、RAG: 簡易ベクトルでなく単語一致の簡易検索
- retry デコレータ（Full Jitter）、エラー分類（リトライする / しない）
- 権限チェック（ロール × ツール × データ範囲）、承認キュー
- ログ: 1 行 JSON（span 風）とコスト集計
- 複数 Agent: 役割ごとの関数と引き継ぎの型

## 未確認・食い違い
- ツール数の閾値（10〜15 / 15〜20 / 80）は出典ごとに違う。記事では「増えるほど落ちる、絞る」とだけ書く
- OTel GenAI 規約は Development。属性名は変わりうると明記する
- OWASP Agentic Top 10 の 10 項目の正式名は一次資料 PDF で未確認。記事では LLM06 を主に使う
