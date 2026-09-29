---
title: AIエージェントは「賢さ」より「設計」で決まる——ツール・文脈・評価まで実装で理解する
description: LLM にループとツールを渡すと何が起きるのか。最小 50 行のエージェントから、ツール設計・コンテキストエンジニアリング・5 つの定番パターン・マルチエージェント・MCP・本番運用まで、Python のコードと図で基礎から発展まで分解する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, LLM, Claude API, Python, コンテキストエンジニアリング, MCP, 設計パターン]
level: [basic, practice, advanced]
status: published
---

同じモデルを使っているのに、あるエージェントは仕事をやり遂げ、別のエージェントは同じ場所をぐるぐる回り続ける。差を生んでいるのはモデルの賢さではなく、**モデルの周りに何をどう組んだか**だ。

この記事では、AIエージェントを「LLM を中心に置いたソフトウェア」として分解する。最小の実装から始めて、ツール・文脈・構成パターン・運用へと一段ずつ積み上げていく。

> [!TIP] この記事で分かること
> - エージェントとワークフローの違いと、どちらを選ぶべきかの判断基準
> - エージェントの心臓部「ループ」を 50 行で実装する方法
> - エージェントが使いやすいツールの設計（悪い例 → 良い例）
> - 長く動かすための文脈の管理（キャッシュ・圧縮・外部メモ）
> - 定番 5 パターンとマルチエージェントの使いどころ
> - 本番で必要になる安全策と評価の考え方

コードはすべて Python と Anthropic 公式 SDK（`pip install anthropic`）で書いている。モデルは執筆時点（2026 年 9 月）の Claude Opus 5.5（`claude-opus-5-5`）を使う。API キーは環境変数 `ANTHROPIC_API_KEY` から自動で読まれる。

## 全体マップ：この記事の読み方

記事は下の順に積み上がる。前の章の部品を、次の章で組み合わせる構成になっている。

```flow caption="この記事の構成。入門→実践→発展の順に積み上げる"
A([LLM 単体]) --> B[ツールと記憶を足す\n= 拡張された LLM]
B --> C[ループで回す\n= エージェント]:::hl
C --> D[ツールを磨く]
C --> E[文脈を管理する]
D --> F[パターンで組む]
E --> F
F --> G[複数で分担する]
G --> H([本番で運用する])
```

## ワークフローとエージェントは何が違うのか

「AIエージェント」という言葉は広く使われすぎている。Anthropic は 2024 年 12 月の記事 "Building Effective Agents" で、LLM を使うシステムを 2 種類に分けた。

- **ワークフロー**：LLM とツールを、**開発者があらかじめ書いたコード経路**で動かすもの
- **エージェント**：LLM が**自分で次の手順とツールを決めながら**、環境からのフィードバックを見てループするもの

違いは「誰が制御フローを持っているか」だ。

| 観点 | ワークフロー | エージェント |
|---|---|---|
| 次に何をするか決めるのは | 開発者のコード | LLM |
| ステップ数 | 事前に決まる | 実行するまで分からない |
| 予測可能性・テストしやすさ | 高い | 低い |
| コスト・レイテンシ | 小さく一定 | 大きく変動する |
| 向いているタスク | 手順が決まっている分類・変換・定型処理 | 調査・デバッグ・コーディングなど手順が読めない問題 |

同じ記事は、設計の原則として次の一文を挙げている。**「できるだけ単純な解から始め、必要なときだけ複雑にする」**。

多くのタスクは、1 回の LLM 呼び出しかワークフローで足りる。エージェントを選ぶのは、手順を事前に書き下せないと分かってからでいい。

> [!NOTE] エージェントにする前に確かめる 4 つの問い
> 1. **複雑さ**：手順を事前に書き下せないほど複雑か
> 2. **価値**：コストと待ち時間が増えても見合う成果か
> 3. **実現性**：モデルがその種類の仕事を実際にこなせるか
> 4. **失敗の代償**：誤りをテストやレビューで検出し、戻せるか
>
> どれか 1 つでも「いいえ」なら、ワークフローに留める。

## 心臓部は「ループ」：50 行で作る最小エージェント

エージェントの正体は驚くほど単純だ。**ツールを使える LLM を、ツールを呼ばなくなるまでループで回す**。これだけで成り立つ。

```flow caption="エージェントループ。LLM がツールを呼ぶ限り回り続ける"
A([ユーザーの依頼]) --> B(LLM が次の一手を考える)
B --> C{ツールを\n呼ぶ?}
C -- はい --> D[ツールを実行して\n結果を会話に足す]:::hl
D --> B
C -- いいえ --> E([最終回答を返す])
```

例として、手元のメモを検索して質問に答える「ナレッジ検索エージェント」を作る。ツールは「メモを検索する」と「メモを読む」の 2 つだけにする。

```python title="agent.py" caption="最小のエージェント。ツール定義・ツール実行・ループの 3 部品でできている" {43,45,51-52}
import json
import anthropic

client = anthropic.Anthropic()
MODEL = "claude-opus-5-5"

NOTES = {
    "n1": "エージェントとは、環境からのフィードバックを見ながらループでツールを使う LLM のこと。",
    "n2": "プロンプトキャッシュは先頭一致。system の中身を 1 文字変えると以降のキャッシュが無効になる。",
}

TOOLS = [
    {
        "name": "search_notes",
        "description": "メモをキーワードで検索し、一致したメモの ID と冒頭 40 文字を返す。",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "検索語。1〜3 語"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_note",
        "description": "ID を指定してメモの全文を読む。ID は search_notes の結果から得る。",
        "input_schema": {
            "type": "object",
            "properties": {"note_id": {"type": "string"}},
            "required": ["note_id"],
        },
    },
]


def run_tool(name: str, args: dict) -> str:
    if name == "search_notes":
        hits = [{"id": k, "head": v[:40]} for k, v in NOTES.items() if args["query"] in v]
        return json.dumps(hits, ensure_ascii=False)
    if name == "read_note":
        return NOTES.get(args["note_id"], "そのIDのメモはありません。")
    return f"未知のツール: {name}"


def run_agent(task: str, max_turns: int = 10) -> str:
    messages = [{"role": "user", "content": task}]
    for _ in range(max_turns):
        response = client.messages.create(
            model=MODEL, max_tokens=16000, tools=TOOLS, messages=messages
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            return "".join(b.text for b in response.content if b.type == "text")

        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = run_tool(block.name, block.input)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
        messages.append({"role": "user", "content": results})
    return "ターン上限に達しました。"


if __name__ == "__main__":
    print(run_agent("プロンプトキャッシュで気をつけることは？"))
```

コードの要点は 3 つある。

**1. 会話履歴がそのまま状態になる。** API は状態を持たない。`messages` に「依頼 → LLM の応答（ツール呼び出し）→ ツールの結果 → …」を積み上げて毎回丸ごと送る。エージェントの「記憶」は、最も基本的にはこのリストだ。

**2. 止まる条件は `stop_reason` で判断する。** 強調した 51〜52 行目のとおり、`stop_reason` が `"tool_use"` のあいだは LLM がツールを求めている。それ以外（`"end_turn"` など）になったら最終回答として返す。

**3. ツールの結果は `tool_use_id` で呼び出しと対応づける。** LLM は 1 回の応答で複数のツールを同時に呼ぶことがある。その場合も、結果は**すべて 1 つの user メッセージにまとめて**返す。

> [!WARNING] ループには必ず上限を付ける
> 43・45 行目の `max_turns` がないと、ツールの結果に満足できない LLM が延々と呼び出しを続けることがある。コストの上限としても、ターン数の上限は最初から入れておく。

実際には、このループを SDK に任せることもできる。関数にデコレータを付けるだけで、スキーマ生成・実行・ループを SDK が肩代わりする。

```python title="agent_runner.py" caption="SDK のツールランナー版（ベータ）。docstring がそのままツールの説明になる"
import anthropic
from anthropic import beta_tool

client = anthropic.Anthropic()


@beta_tool
def read_note(note_id: str) -> str:
    """ID を指定してメモの全文を読む。

    Args:
        note_id: search_notes の結果に含まれるメモの ID。
    """
    return {"n1": "エージェントとはループでツールを使う LLM のこと。"}.get(note_id, "なし")


runner = client.beta.messages.tool_runner(
    model="claude-opus-5-5",
    max_tokens=16000,
    tools=[read_note],
    messages=[{"role": "user", "content": "メモ n1 には何が書いてある？"}],
)
for message in runner:
    print(message.stop_reason)
```

仕組みを理解するまでは手で書いたループを、理解したらランナーを使う、という順番をおすすめする。

## ツール設計：エージェントの性能は道具で決まる

Anthropic のエンジニアリングブログは、ツール設計をこう表現している。「エージェントの効果は、与えたツールの質を超えない」。ツールは人間向けの API とは違う。**読み手が LLM であることを前提に設計する**必要がある。

同社はこれを ACI（Agent-Computer Interface）と呼び、人間向けの画面設計（HCI）と同じだけの手間をかけるべきだとしている。

### 悪い例と良い例

同じ「チケットを検索する」ツールを、2 通りに定義してみる。

```python title="tools_bad.py" caption="悪い例。名前も説明も曖昧で、何を返すかも分からない"
bad_tool = {
    "name": "search",
    "description": "検索します",
    "input_schema": {
        "type": "object",
        "properties": {"q": {"type": "string"}, "opt": {"type": "string"}},
    },
}
```

```python title="tools_good.py" caption="良い例。いつ使うか・何を返すか・引数の制約までを説明に書く" {3-7,12}
good_tool = {
    "name": "tickets_search",
    "description": (
        "サポートチケットを本文とタイトルで全文検索する。"
        "顧客の過去の問い合わせを調べるときに使う。個別の詳細は tickets_get で取る。"
        "結果は新しい順に最大 limit 件。各件は id・タイトル・状態・作成日だけを含む。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "検索語。例: 'ログインできない'"},
            "status": {"type": "string", "enum": ["open", "closed", "all"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "required": ["query"],
        "additionalProperties": False,
    },
    "strict": True,
}
```

違いを表にまとめる。

| 観点 | 悪い例 | 良い例 |
|---|---|---|
| 名前 | `search`（何を？） | `tickets_search`（対象を名前空間で区切る） |
| 説明 | 動作だけ | いつ使うか・何を返すか・隣のツールとの使い分け |
| 引数 | `q`・`opt` の意味が不明 | 説明と例、`enum` で取りうる値を限定 |
| 返す量 | 不明 | 件数の上限と含まれる項目を明記 |
| 型の保証 | なし | `strict: True` でスキーマどおりの引数を保証 |

12 行目の `enum` はポカヨケ（間違えようのない形にする工夫）の典型だ。自由文字列にすると `"Open"` や `"未対応"` のような揺れが入る。取りうる値を列挙すれば、そもそも間違えられない。

> [!IMPORTANT] ツールを選ぶ基準は人間と同じ
> 「人間のエンジニアが、この状況でどのツールを使うべきか断言できないなら、エージェントにそれ以上を期待できない」（Anthropic, *Effective context engineering for AI agents*）。機能が重なるツールを並べると、エージェントは迷う。

### エラーは「次にどうすればいいか」まで返す

ツールが失敗したとき、例外のスタックトレースをそのまま返しても LLM は立て直せない。**何が起きたかと、次に何をすればいいか**を文章で返す。

```python title="tool_errors.py" caption="失敗を LLM が読める形で返す。is_error を付けると失敗として扱われる"
def tool_result(tool_use_id: str, output: str, *, error: bool = False) -> dict:
    return {"type": "tool_result", "tool_use_id": tool_use_id, "content": output, "is_error": error}


def read_note_safely(tool_use_id: str, note_id: str, notes: dict) -> dict:
    if note_id not in notes:
        return tool_result(
            tool_use_id,
            f"メモ '{note_id}' はありません。ID は search_notes の結果にある n で始まる文字列です。"
            "先に search_notes で検索してください。",
            error=True,
        )
    text = notes[note_id]
    if len(text) > 4000:
        # 長すぎる結果は切り詰め、続きの取り方を伝える
        return tool_result(tool_use_id, text[:4000] + "\n…（以下省略。offset を指定すると続きを読めます）")
    return tool_result(tool_use_id, text)
```

後半の切り詰めも重要だ。ツールの結果はすべて文脈に積まれる。巨大な結果を返すツールは、次の章で扱う「文脈の予算」を一気に食いつぶす。**ページング・絞り込み・切り詰めに妥当な既定値を持たせる**のが、トークン効率の良いツールの条件になる。

## コンテキストエンジニアリング：LLM に何を見せるか

ループが長くなると、`messages` はどんどん膨らむ。ここで問題になるのが **context rot（文脈の劣化）** だ。文脈に入れるトークンが増えるほど、モデルが個々の情報に払える注意が薄まり、性能が落ちる。

Anthropic はこれを受けて、プロンプトエンジニアリングを広げた「コンテキストエンジニアリング」という考え方を示した。**推論のたびに、最適なトークンの集合を選んで維持する**技術だ。何を書くかだけでなく、何を入れないか、いつ捨てるかまでを設計する。

```flow caption="文脈に入るもの。どれも有限の注意を奪い合う"
direction LR
A[システム\nプロンプト] --> Z[LLM の\n文脈]:::hl
B[ツール定義] --> Z
C[会話履歴] --> Z
D[ツールの結果] --> Z
E[取得した文書] --> Z
```

文脈を管理する手段は、大きく 4 つある。

| 手段 | 何をするか | 効く場面 |
|---|---|---|
| 必要なときに取得（Just-in-time） | 全文ではなく ID やパスだけ持ち、必要な分だけツールで読む | 資料が大量にある |
| キャッシュ | 変わらない先頭部分を再利用して安く速くする | 同じシステムプロンプトで何度も呼ぶ |
| 圧縮（compaction） | 古い履歴を要約して置き換える | 1 回の作業が長時間続く |
| 外部メモ | 進捗や決定事項をファイルに書き出す | 文脈がリセットされても続けたい |

最小エージェントの `search_notes` → `read_note` という 2 段構えは、まさに「必要なときに取得」の実装になっている。全メモを最初に渡さず、見出しで当たりをつけてから必要な 1 件だけを読む。

### システムプロンプトは「ちょうどいい高度」で

システムプロンプトは、細かすぎても曖昧すぎても失敗する。

| 失敗の型 | 例 | 何が起きるか |
|---|---|---|
| 低すぎる（硬い分岐） | 「A なら X、B なら Y、ただし C のときは…」を延々と列挙 | 想定外の入力で破綻し、保守できなくなる |
| 高すぎる（曖昧） | 「いい感じに手伝ってください」 | 判断の手がかりがなく、振る舞いがぶれる |
| ちょうどいい | 目的・判断基準・典型例を少数 | 見たことのない状況でも原則から判断できる |

例も同じ考え方で入れる。エッジケースを網羅するより、**多様で典型的な例を少数**見せる方が効く。

### キャッシュと圧縮をコードで入れる

変わらない部分（システムプロンプトとツール定義）はキャッシュし、長くなった履歴はサーバー側で圧縮させる。

```python title="long_running.py" caption="キャッシュと圧縮（compaction、ベータ）を有効にしたループの 1 ターン" {7,12-13,19}
import anthropic

client = anthropic.Anthropic()
SYSTEM = [{
    "type": "text",
    "text": "あなたは社内ナレッジを調べて答えるアシスタントです。…（長い指示）",
    "cache_control": {"type": "ephemeral"},
}]


def step(messages: list, tools: list):
    response = client.beta.messages.create(
        betas=["compact-2026-01-12"],
        model="claude-opus-5-5",
        max_tokens=16000,
        system=SYSTEM,
        tools=tools,
        messages=messages,
        context_management={"edits": [{"type": "compact_20260112"}]},
    )
    # 圧縮ブロックも含めて応答を丸ごと履歴に戻す（テキストだけ抜き出すと圧縮状態が消える）
    messages.append({"role": "assistant", "content": response.content})
    print("キャッシュから読んだトークン:", response.usage.cache_read_input_tokens)
    return response
```

キャッシュは**先頭一致**で効く。システムプロンプトに現在時刻のような毎回変わる値を入れると、それ以降のキャッシュはすべて無効になる。`cache_read_input_tokens` がずっと 0 なら、どこかで先頭が変わっていると疑う。

### 外部メモ：文脈の外に記憶を置く

何時間も続く作業では、圧縮しても情報は落ちていく。そこで、エージェント自身に進捗をファイルへ書かせる。Claude Code が `CLAUDE.md` や TODO リストを使うのと同じ発想だ。

```python title="notes_tool.py" caption="エージェントが自分用のメモを読み書きするツール"
from pathlib import Path

NOTES_FILE = Path("NOTES.md")

NOTES_TOOLS = [
    {
        "name": "notes_read",
        "description": "作業メモ全体を読む。作業を再開するときや、方針を思い出したいときに最初に使う。",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "notes_append",
        "description": "決定事項・分かったこと・残りの作業を 1〜3 行で追記する。区切りのよいところで使う。",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
]


def run_notes_tool(name: str, args: dict) -> str:
    if name == "notes_read":
        return NOTES_FILE.read_text(encoding="utf-8") if NOTES_FILE.exists() else "（メモはまだありません）"
    with NOTES_FILE.open("a", encoding="utf-8") as f:
        f.write(f"- {args['text']}\n")
    return "追記しました。"
```

文脈は揮発する作業机、メモは引き出しだと考えると分かりやすい。机が片付けられても、引き出しを開ければ続きから始められる。

## 定番の 5 パターン：ワークフローで組む

エージェントを作る前に、まずワークフローで解けないかを考える。Anthropic は実運用でよく使われる構成を 5 つに整理している。

| パターン | 形 | 使いどころ | 例 |
|---|---|---|---|
| プロンプトチェーン | 直列に処理をつなぐ | 手順が固定で、段階ごとに確認したい | 下書き → 校正 → 翻訳 |
| ルーティング | 入力を分類して振り分ける | 種類ごとに最適な処理が違う | 問い合わせを返金・技術・その他へ |
| 並列化 | 同時に投げてまとめる | 独立した観点がある／多数決で確度を上げたい | 複数観点のレビュー |
| オーケストレーター・ワーカー | 司令塔が仕事を分けて配る | 必要なサブタスクが事前に読めない | 複数ファイルにまたがる修正 |
| 評価者・改善者 | 作る側と採点する側で往復 | 評価基準が明確で、直すほど良くなる | 文章の推敲、翻訳の品質向上 |

以下のコードは、すべて次の小さな関数を共通で使う。

```python title="llm.py" caption="1 回呼び出すだけの共通関数"
import anthropic

client = anthropic.Anthropic()


def ask(prompt: str, system: str = "", effort: str = "low") -> str:
    response = client.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        system=system,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in response.content if b.type == "text")
```

`effort` は考える深さとトークン消費の調整つまみだ。分類のような軽い仕事は `low`、推敲や設計のような重い仕事は `high` にする。

### 1. プロンプトチェーン

```python title="chain.py"
from llm import ask


def write_article(topic: str) -> str:
    outline = ask(f"「{topic}」の記事の章立てを 5 項目で作って。")
    if outline.count("\n") < 3:  # ゲート：段階ごとに機械的に確かめられる
        raise ValueError("章立てが短すぎます")
    draft = ask(f"次の章立てで本文を書いて。\n{outline}", effort="high")
    return ask(f"誤字と冗長な表現だけを直して。\n{draft}")
```

段と段のあいだに**プログラムで確かめるゲート**を挟めるのが、チェーンの利点だ。

### 2. ルーティング

```python title="route.py"
from llm import ask

HANDLERS = {
    "refund": "あなたは返金担当です。規約に沿って手順を案内します。",
    "tech": "あなたは技術サポートです。再現手順を確認してから答えます。",
    "other": "あなたは総合窓口です。適切な窓口を案内します。",
}


def route(question: str) -> str:
    label = ask(f"次の問い合わせを refund / tech / other のどれか 1 語で分類して。\n{question}").strip()
    system = HANDLERS.get(label, HANDLERS["other"])  # 想定外の出力は安全側に倒す
    return ask(question, system=system, effort="medium")
```

### 3. 並列化

```python title="parallel.py"
from concurrent.futures import ThreadPoolExecutor
from llm import ask

VIEWPOINTS = ["セキュリティ", "性能", "読みやすさ"]


def review(code: str) -> str:
    with ThreadPoolExecutor() as pool:
        reviews = list(pool.map(lambda v: ask(f"{v}の観点だけでレビューして。\n{code}"), VIEWPOINTS))
    joined = "\n\n".join(f"## {v}\n{r}" for v, r in zip(VIEWPOINTS, reviews))
    return ask(f"次のレビューを重要度順に統合して。\n{joined}")
```

観点ごとに分けると、それぞれが 1 つの問いに集中できる。1 回で全部見させるより抜けが減る。

### 4. オーケストレーター・ワーカー

```python title="orchestrator.py"
import json
from llm import ask


def solve(task: str) -> str:
    plan = ask(
        f"次のタスクを独立したサブタスクに分け、JSON の文字列配列だけを返して。\n{task}",
        effort="high",
    )
    subtasks = json.loads(plan)
    results = [ask(f"全体の目的: {task}\n担当: {s}") for s in subtasks]
    return ask("次の結果を統合して最終回答にして。\n" + "\n---\n".join(results), effort="high")
```

並列化と似ているが、**サブタスクを LLM 自身が決める**点が違う。事前に分け方を書けない問題に向く。

### 5. 評価者・改善者

```python title="evaluator.py"
from llm import ask


def refine(task: str, max_rounds: int = 3) -> str:
    draft = ask(task, effort="high")
    for _ in range(max_rounds):
        verdict = ask(
            "次の回答を採点基準（正確さ・具体性・簡潔さ）で評価し、"
            f"合格なら PASS とだけ、不合格なら直すべき点を箇条書きで返して。\n{draft}"
        )
        if verdict.strip() == "PASS":
            break
        draft = ask(f"指摘に沿って直して。\n指摘:\n{verdict}\n\n回答:\n{draft}", effort="high")
    return draft
```

```flow caption="評価者・改善者パターン。合格するか上限に達するまで往復する"
A[生成する] --> B{採点する}
B -- 不合格 --> C[指摘を受けて直す]
C --> B
B -- 合格 --> D([完成])
```

採点基準をはっきり言葉にできるときだけ効く。基準が曖昧だと、採点役が毎回違うことを言い出して収束しない。

## マルチエージェント：分けるほど良くなるわけではない

エージェントを複数に分けると、それぞれが独立した文脈を持てる。Anthropic のリサーチ機能では、Claude Opus 4 を司令塔に、Claude Sonnet 4 をサブエージェントにした構成が、単体の Opus 4 より社内評価で 90.2% 高い成績を出した（2025 年 6 月の記事）。

ただし同じ記事は、代償もはっきり書いている。

| 構成 | トークン消費（チャット比） |
|---|---|
| 通常のチャット | 1 倍 |
| 単一エージェント | 約 4 倍 |
| マルチエージェント | 約 15 倍 |

さらに、ブラウジング評価（BrowseComp）での性能差の 80% は**使ったトークン量だけで説明できた**。つまりマルチエージェントの強さの大部分は、「並列にたくさん読めること」から来ている。

ここから判断基準が導ける。

| 向いている | 向いていない |
|---|---|
| 独立に調べられる論点が多い（広い調査） | 全員が同じ文脈を共有する必要がある |
| 読む量が多く、1 つの文脈に収まらない | サブタスク同士の依存が強い |
| 権限を分けたい（個人情報を読む係と書く係） | 並列化しにくい（多くのコーディング作業） |

### サブエージェントは「要約を返す関数」として作る

実務でよく使われるのは、司令塔が全体の文脈を持ち、**使い捨てのサブエージェントに調べ物を任せて要約だけ受け取る**形だ。サブエージェントがどれだけ読んでも、司令塔の文脈には要約しか入らない。

```python title="subagent.py" caption="サブエージェントをツールとして司令塔に渡す" {9-11}
from agent import run_agent  # 最初に作った最小エージェント

SUBAGENT_TOOL = {
    "name": "delegate_research",
    "description": "独立した調べ物を別のエージェントに任せ、結論の要約だけを受け取る。広く読む必要がある調査に使う。",
    "input_schema": {
        "type": "object",
        "properties": {
            "objective": {"type": "string", "description": "何を明らかにしたいか"},
            "output_format": {"type": "string", "description": "返してほしい形。例: 3 行の箇条書き"},
            "boundaries": {"type": "string", "description": "調べなくてよい範囲"},
        },
        "required": ["objective", "output_format"],
    },
}


def delegate_research(objective: str, output_format: str, boundaries: str = "") -> str:
    brief = f"目的: {objective}\n出力形式: {output_format}\n範囲外: {boundaries or 'なし'}\n2,000 字以内で結論だけ返すこと。"
    return run_agent(brief)
```

入力に `objective`・`output_format`・`boundaries` を要求しているのには理由がある。Anthropic のリサーチ機能の知見では、委任が失敗する主因は指示の曖昧さだった。サブエージェントには**目的・出力形式・使う道具・作業の境界**を必ず渡す。

## 外部接続の標準化：MCP と Skills

ツールを増やしていくと、「Slack とつなぐ」「DB とつなぐ」を毎回ゼロから書くことになる。これを標準化したのが **MCP（Model Context Protocol）** だ。

```flow caption="MCP があると、ツールの実装とエージェントを独立に作れる"
direction LR
A[エージェント\nMCP クライアント] --> B[MCP サーバー\nGitHub]
A --> C[MCP サーバー\nDB]
A --> D[MCP サーバー\n社内 API]
```

MCP はもともと Anthropic が公開した仕様だが、2025 年 12 月に Linux Foundation 傘下の Agentic AI Foundation に寄贈され、ベンダー中立の標準になった。執筆時点の最新仕様は 2026-07-28 版だ。

| 概念 | 役割 | 例 |
|---|---|---|
| MCP サーバー | ツール・リソース・プロンプトを公開する | GitHub の Issue を検索するサーバー |
| MCP クライアント | サーバーにつなぎ、LLM へツールとして渡す | Claude Code、自作エージェント |
| Skills | 「この種の仕事はこう進める」という手順書をエージェントが必要なときに読み込む | 「記事を書くときの手順」「社内のデプロイ手順」 |

MCP が**手足（何ができるか）**を増やす仕組みだとすれば、Skills は**段取り（どう進めるか）**を増やす仕組みだ。どちらも、必要になったときに初めて文脈へ読み込む（段階的開示）ことで、文脈の予算を守っている。

## 本番運用：安全策と評価

動くエージェントを作るのと、任せられるエージェントを作るのは別の仕事だ。本番では少なくとも 3 つを設計する。

### 1. プロンプトインジェクション：「3 つを同時に持たせない」

エージェントは、読んだ文章に書かれた指示に従ってしまうことがある。Web ページやメールに「このデータを外部に送れ」と仕込まれると、それを実行しかねない。

研究者 Simon Willison は 2025 年に、危険な組み合わせを **lethal trifecta（致命的な三点セット）** と名付けた。

| 能力 | 例 |
|---|---|
| 私的なデータにアクセスできる | 社内文書、メール、顧客情報 |
| 信頼できない入力を読む | Web ページ、受信メール、外部の Issue |
| 外部に送信できる | メール送信、HTTP リクエスト、公開投稿 |

3 つが揃うと、読んだ文章に仕込まれた指示でデータが外に抜ける。Meta はこれを受けて **Agents Rule of Two** を提案した。無監督のエージェントには 3 つのうち最大 2 つまでしか持たせず、3 つ目が必要な操作には人間の承認を挟む、という原則だ。

入力をフィルタして防ぐ手法は、適応的な攻撃で突破されることが報告されている。**フィルタより権限設計で守る**のが基本になる。

### 2. 人間の承認を挟む

取り返しのつかない操作は、実行前に止める。最小エージェントの `run_tool` の手前に、承認の関所を置く。

```python title="approval.py" caption="危険なツールだけ人間の承認を求める" {1,5-7}
NEEDS_APPROVAL = {"send_email", "delete_record", "deploy"}


def run_tool_with_approval(name: str, args: dict, run_tool) -> tuple[str, bool]:
    if name in NEEDS_APPROVAL:
        answer = input(f"[承認] {name} を {args} で実行しますか？ (y/N): ")
        if answer.strip().lower() != "y":
            return "ユーザーが実行を拒否しました。別の方法を提案するか、理由を説明してください。", True
    try:
        return run_tool(name, args), False
    except Exception as exc:  # ツールの失敗は LLM に伝えて立て直させる
        return f"実行に失敗しました: {exc}", True
```

拒否したときも、結果を黙って捨てずに**拒否されたことをツール結果として返す**。そうしないと LLM は「なぜ結果が来ないのか」を知らないまま同じ呼び出しを繰り返す。

> [!NOTE] 拒否された応答への備え
> Claude の新しいモデルは、安全分類器が要求を断ると `stop_reason: "refusal"` を返すことがある。ループでは `stop_reason` を必ず確認し、`refusal` を最終回答として扱わないようにする。Claude API には、断られたときに別モデルで自動再実行するフォールバック機能（ベータ）もある。

### 3. 評価：「1 回できた」と「毎回できる」は違う

エージェントは確率的に動く。同じ課題でも成功したり失敗したりする。Anthropic の評価ガイド（2026 年 1 月）は、2 つの指標を区別するよう勧めている。

| 指標 | 意味 | k を増やすと |
|---|---|---|
| pass@k | k 回試して **1 回でも**成功する確率 | 上がる |
| pass^k | k 回試して **すべて**成功する確率 | 下がる |

開発中の「できた！」は pass@k 的な感覚だ。しかし利用者に毎回任せるなら、見るべきは pass^k の方になる。

```python title="metrics.py" caption="試行結果から 2 つの指標を計算する"
def pass_at_k(results: list[bool], k: int) -> float:
    """1 回の成功率 p から、k 回中 1 回以上成功する確率を見積もる。"""
    p = sum(results) / len(results)
    return 1 - (1 - p) ** k


def pass_hat_k(results: list[bool], k: int) -> float:
    """k 回すべて成功する確率を見積もる。"""
    p = sum(results) / len(results)
    return p ** k


trials = [True, True, False, True, True, True, False, True, True, True]  # 成功率 80%
print(f"pass@3 = {pass_at_k(trials, 3):.3f}")  # 0.992
print(f"pass^3 = {pass_hat_k(trials, 3):.3f}")  # 0.512
```

成功率 80% のエージェントは、3 回に 1 回でも成功すればいい用途なら 99% 信頼できる。しかし 3 回連続で成功しなければならない用途では、半分しか信頼できない。

採点は 1 種類に頼らない。ファイルや DB の状態を確かめる**コードによる採点**、文章の質を見る **LLM による採点**、そして両者がずれていないかを確かめる**人間の確認**を組み合わせる。

## フレームワークの選び方

ここまでのコードは、あえてフレームワークを使わずに書いた。Anthropic の記事も「まず API を直接使え。フレームワークを使うなら、中で何が起きているか理解してから」と勧めている。そのうえで、主要なものの考え方の違いを整理する。

| フレームワーク | 中心にある考え方 | 向いている場面 |
|---|---|---|
| Claude Agent SDK | Claude Code の仕組み（ファイル操作・コマンド実行・サブエージェント・フック・MCP）をライブラリとして使う | ファイルやコードを扱うエージェントを手早く作る |
| OpenAI Agents SDK | エージェント間で制御を渡す「handoff」 | 役割の違うエージェントへ会話を引き継ぐ |
| LangGraph | 処理をグラフ（状態機械）として定義する | 分岐が多く、途中保存や人間の承認を細かく制御したい |
| Google ADK | Google Cloud と組み合わせるアプリケーション層、エージェント間通信（A2A） | GCP 中心の環境、マルチモーダル |

機能の細部は頻繁に変わるので、選ぶときは各公式ドキュメントで最新版を確認してほしい。判断の軸は「**制御フローを誰が持つか**」だ。コードで細かく握りたいなら LangGraph、LLM に任せて道具を揃えたいなら Agent SDK 系、という見方をすると迷いにくい。

## 設計チェックリスト

最後に、エージェントを作るときに順に確かめることをまとめる。

| 段階 | 確かめること |
|---|---|
| 作る前 | 1 回の呼び出しやワークフローで解けないか。4 つの問いを満たすか |
| ループ | ターン上限があるか。`stop_reason` の全パターンを扱っているか |
| ツール | 名前と説明だけで使い分けられるか。引数を `enum` などで絞ったか。エラーで次の手を伝えているか |
| 文脈 | 全部渡していないか。キャッシュの先頭に変わる値が入っていないか。長時間なら圧縮と外部メモがあるか |
| 構成 | 分ける理由（独立性・読む量・権限）があるか。サブエージェントに目的・形式・境界を渡したか |
| 安全 | 3 つの能力を同時に持たせていないか。取り返しのつかない操作に承認があるか |
| 評価 | pass^k で見ているか。コード・LLM・人間の採点を組み合わせたか |

エージェントの性能を上げたくなったとき、最初に疑うべきはモデルではない。**ツールの説明、文脈の中身、ループの止め方**だ。この 3 つを整えるだけで、同じモデルが別物のように働き始める。

## 参考文献

- Anthropic, [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)（2025-06-13）
- Anthropic, [Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11）
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）
- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01）
- Model Context Protocol, [Specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- Model Context Protocol Blog, [The 2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- Airia, [AI Security in 2026: Prompt Injection, the Lethal Trifecta, and How to Defend](https://airia.com/blog/ai-security-in-2026-prompt-injection-the-lethal-trifecta-and-how-to-defend/)（lethal trifecta と Rule of Two の解説）
- LangChain, [The best AI agent frameworks in 2026](https://www.langchain.com/resources/ai-agent-frameworks)

※ モデル名・API の書き方は 2026 年 9 月時点の Anthropic 公式 SDK に基づく。
