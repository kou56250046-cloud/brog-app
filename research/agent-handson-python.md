# Python で AI エージェントを作って動かす リサーチメモ（2026-10-01）

概念（定義・ツール設計・文脈・評価・安全策）は `ai-agent-fundamentals.md` と `ai-agent-components.md` に既にある。
ここでは「1 つのプロジェクトとして組み上げて動かす」ために要る事実だけを足す。

## 事実（出典付き）

### ループの形
- ツール呼び出し型エージェントは「1 回の API 呼び出しを囲む while ループ + ツール名→関数の辞書 + 止める条件」。止める条件は ①モデルがツールを頼まずに終わる ②ステップ上限 ③出力トークン上限 — [DEV, Your First Tool-Calling Agent With No Framework](https://dev.to/gabrielanhaia/your-first-tool-calling-agent-with-no-framework-just-the-bare-sdk-3ip3)（確認 2026-10-01）
- ハマりどころ: ツール呼び出し 1 つにつき、同じ ID の結果を必ず 1 つ返す / 例外でループを落とさず文字列にして返す / ツール入力を eval しない / スキーマと実装のずれ — 同上
- アシスタントの返事（ツール呼び出し ID 付き）をそのまま履歴に足し、結果を role "tool" で ID に結び付けて返す — [OpenAI 互換 Chat Completions の一般形。Gemini の互換ドキュメントでも同じ形](https://ai.google.dev/gemini-api/docs/openai)（確認 2026-10-01）
- 失敗の 4 型: 終わらない / 呼び出しが壊れている / 成功したが結果がゴミ / 結果を無視して作話する。反復に上限を付け、上限で明確に止める — [besthub.dev, Build a Working AI Agent Loop in 50 Lines](https://www.besthub.dev/articles/build-a-working-ai-agent-loop-in-just-50-lines-of-python-d713156b8b7f)（二次情報）
- 「本質は LLM をどう回し続けるか（ループエンジニアリング）」。悪いループは同じ誤りを繰り返す。対策は文脈管理・ツール設計・ガードレール・ターン上限 — [Qiita mi25, AIエージェントを自作して、やっと「ループエンジニアリング」の意味がわかった](https://qiita.com/mi25/items/32e27c4d51f468214ec9)（2026-08-12）

### 各社のツール呼び出し形式（窓口を 1 か所にする根拠）
| | 定義 | モデル側の呼び出し | 結果の返し方 | 出典 |
|---|---|---|---|---|
| OpenAI 互換 Chat Completions | `tools: [{type:"function", function:{name, description, parameters}}]` | `message.tool_calls[]`（id, function.name, function.arguments=JSON 文字列） | `{role:"tool", tool_call_id, content}` | Gemini 互換ドキュメント / Ollama |
| OpenAI Responses API | `{type:"function", name, description, parameters}` | 出力に `function_call` 項目 | `function_call_output`（call_id） | [Vercel AI Gateway docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses/tool-calling) ほか（二次） |
| Anthropic Messages | `tools: [{name, description, input_schema}]` | `stop_reason: "tool_use"` と `tool_use` ブロック | `tool_result` ブロック（tool_use_id） | [Anthropic docs, Handling stop reasons](https://docs.anthropic.com/en/api/handling-stop-reasons) |

- Gemini は OpenAI ライブラリ / REST から base URL `https://generativelanguage.googleapis.com/v1beta/openai/` で呼べ、tools による function calling に対応 — [Google AI for Developers, OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)（確認 2026-10-01）
- Ollama は `http://localhost:11434/v1` に OpenAI 互換エンドポイントを持ち、tools を受け付ける。ローカルで API キーなしに試せる — [IBM, Tool Calling with Ollama](https://www.ibm.com/think/tutorials/local-tool-calling-ollama-granite) / [insiderllm](https://insiderllm.com/guides/function-calling-local-llms/)（確認 2026-10-01）
- → 「OpenAI 互換 Chat Completions」は複数社・ローカル実行系が受け付ける事実上の共通形。記事ではこれを実物の窓口 1 本にし、他形式は窓口の差し替えで対応すると書く

### プロジェクト構成
- flat layout はインストールなしで動く。src layout は意図しない import を防ぎ、パッケージ化の誤りを見つけやすいが、editable install が要る — [Python Packaging User Guide, src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)（確認 2026-10-01）
- → 記事は「標準ライブラリだけ・pip install なしで `python -m` で動く」ことを優先し flat layout にする。配布するなら src layout へ、と注記

## 主張・意見（誰の）
- 最初の 1 本は素の API で書き、フレームワークは状態保存と人の承認が要る段階で載せ替える — issoh / 複数の英語ブログ（意見）
- ツール管理の配管（引数の詰め直し）は、Python の型ヒントと introspection で数十行に収まる — [softwaredoug, A simple agentic loop with just Python functions](https://softwaredoug.com/blog/2025/10/15/a-simple-agentic-loop-with-just-python-functions)

## 記事に使うコード・図の素材
- データ型（Message / ToolCall / Reply）を dataclass で定義 → LLM の窓口が全部これを返す
- 偽 LLM: 台本（規則）で tool_calls を返す。テストでも使う
- `@tool` デコレータ: 関数の型ヒントと docstring から JSON Schema を作る（inspect）
- ループ: max_turns、ID ごとの結果、例外を文字列に
- 実 LLM: urllib で OpenAI 互換 Chat Completions を叩く（依存ゼロ）。環境変数で URL・モデル・キーを切替
- workspace サンドボックス（パスが外に出ないか Path.resolve で確認）
- JSONL ログ、unittest、承認、要約圧縮、サブエージェント、評価（pass^k）

## 未確認・食い違い
- 実 LLM 接続のコードは筆者環境に API キー / Ollama が無い場合、実行確認できない。偽 LLM 版は全部実行確認する。実 LLM 版は「形式は公式ドキュメント準拠、実行は読者環境」と明記
- Ollama の対応モデル名は変わりやすい。記事ではモデル名を環境変数にし、特定名を推さない

## 実行して確かめたこと（2026-10-01、筆者環境）
検証環境: Python 3.11.9、標準ライブラリのみ。本物の LLM は Gemini の OpenAI 互換エンドポイント（`gemini-flash-latest` / `gemini-flash-lite-latest`）。

- 返事（assistant メッセージ）を受け取った形のまま履歴に戻すと動く。ToolCall から作り直して返すと 400: "Function call is missing a thought_signature in functionCall parts"。返事の tool_calls には `extra_content` が付いていた
  - 一次情報: 思考の署名は暗号化された推論の表現で、履歴の thought ブロックを削除・改変してはいけない — [Google AI for Developers, Thinking](https://ai.google.dev/gemini-api/docs/thinking)（確認 2026-10-01）
  - 他社でも同様: ツール使用中は thinking ブロックを保持して返す — [Claude Docs, Thinking（preserving thinking blocks）](https://platform.claude.com/docs/en/build-with-claude/thinking)（確認 2026-10-01）
- sales.csv の 9 月合計（105,700）: 第 2 回の構成で正解。ただし calc を 1 回ずつ 5 回頼み 7 往復した
- システムプロンプトに「関係しない計算は 1 回の返事でまとめて頼む」を足すと、部下エージェントは 6 件の calc を 1 回の返事で頼んだ
- 無料枠で連続実行すると 429（quota 超過）、混雑時は 503（high demand）が返った。部下が 429 で失敗したとき、エラー文がツール結果として司令塔に返り、司令塔は依頼を簡単にして頼み直した
- 評価（k=3）: 計算・文字数・読む・書く の 4 課題すべて pass^3。偽 LLM では読む・書くが fail（規則に無いため）
- 文字数ツールを外して 5 回聞くと 0/5 正解（23〜27 文字とばらつく。「Python などで数えると 23 文字」とツールを使ったかのような回答も出た）。書き込みツールがあると、単語をファイルに書こうとした
- 入力の無い環境で input() を呼ぶと EOFError で落ちる → 承認は「許可しない」に倒す
