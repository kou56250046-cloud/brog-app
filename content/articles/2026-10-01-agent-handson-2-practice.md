---
title: 本物のLLMにつなぎ、壊れても追えるようにする——Pythonで作るAIエージェント実践編
description: 標準ライブラリだけで作る AI エージェントの第 2 回。urllib だけで OpenAI 互換の API につなぐ窓口、workspace の外に出さないファイル操作、LLM が自分で直せるエラー文、1 行 JSON のログ、偽 LLM を使ったテストを足し、本物の LLM で実際に動かす。
date: "2026-10-01"
verified: "2026-10-01"
category: AIエージェント
tags: [AIエージェント, LLM, Python, ツール呼び出し, テスト, ハンズオン]
level: [practice]
series: Pythonで作って動かすAIエージェント
status: published
---
```hero
title 本物の LLM につなぎ、壊れても追えるようにする
group loop ループ
  LP[loop.py]:::code --> TW[to_wire\n各社の形式へ]:::code:::hl
  FW[from_wire\nReply に直す]:::code
end
group api LLM のサービス
  API(LLM の API):::llm
end
group guard 守りと記録
  FS[外のファイルは\n読ませない]:::code
  LOG[1 行 JSON の\nログ]:::data
end
TW --> API
API -->|JSON| FW
FW -.->|Reply| LP
LP -->|ツール| FS
FW -.-> LOG
note TW 各社の形式の違いは、窓口の中だけで吸収する
note FS パスを正規化して、workspace の外を触らせない
note LOG 1 回の依頼を最初から最後まで追えるログを残す
```


[第 1 回](2026-10-01-agent-handson-1-basics.html)では、偽の LLM で動くエージェントの骨格を作った。偽物は決まった規則でしか動かないので、本当に「自分で考えて道具を使う」かどうかは、本物の LLM につないで初めて分かる。

第 2 回では、**本物の LLM への窓口**を標準ライブラリだけで書く。あわせて、本物を相手にすると必ず起きる失敗に備える。ファイルを触らせても外へ出さない仕組み、LLM が自分で直せるエラー文、後から追えるログ、壊れていないかを確かめるテストの 4 つである。

> [!TIP] この記事で分かること
> - 各社の LLM の形式の違いを、1 つのファイルに閉じ込める方法
> - LLM の返事を「受け取った形のまま」履歴に戻さないと失敗する理由
> - パスを正規化して、workspace の外のファイルを読ませない方法
> - 「次に何をすればよいか」まで書いたエラー文の作り方
> - 1 回の依頼を最初から最後まで追える、1 行 JSON のログ
> - 台本どおりに返事をする偽 LLM で、ループの約束ごとをテストする方法

## 第 2 回で足すファイル

この回で、リポジトリは次のように育つ。`新` は新しく作るファイル、`変` は第 1 回から書き換えるファイルである。

```text title="第 2 回を終えたときの agent-lab/"
agent-lab/
├── agentlab/
│   ├── __init__.py
│   ├── __main__.py           変  使う LLM を環境変数で選ぶ
│   ├── core.py
│   ├── loop.py               変  ログを残す
│   ├── log.py                新  1 行 JSON のログ
│   ├── llm/
│   │   ├── __init__.py       変  窓口を選ぶ make_llm()
│   │   ├── fake.py           変  台本どおりに返す ScriptedLLM を追加
│   │   └── openai_compat.py  新  本物の LLM への窓口
│   └── tools/
│       ├── __init__.py
│       ├── registry.py       変  エラー文を詳しくする
│       ├── basic.py
│       └── files.py          新  workspace の中だけを読み書き
├── tests/
│   ├── __init__.py           新  空ファイル
│   └── test_loop.py          新  偽 LLM で約束ごとを確かめる
├── workspace/
│   └── sales.csv             新  題材のデータ
└── logs/                         実行すると自動で作られる
```

## 窓口 1 本で、各社の LLM につなぐ

LLM のサービスは、ツールの頼み方と結果の返し方の形式が会社ごとに違う。主な形式を並べると次のようになる。

| 形式 | ツールの説明書 | LLM からの依頼 | 結果の返し方 |
|---|---|---|---|
| OpenAI 互換 Chat Completions | `tools` の中の `function` | 返事の `tool_calls`（引数は JSON の文字列） | `role: "tool"` と `tool_call_id` |
| OpenAI Responses API | `tools` に `name` などを直接書く | 出力の `function_call` 項目 | `function_call_output` と `call_id` |
| Anthropic Messages API | `tools` の `input_schema` | `stop_reason: "tool_use"` と `tool_use` ブロック | `tool_result` ブロックと `tool_use_id` |

このうち **OpenAI 互換 Chat Completions** は、多くのサービスとローカル実行の仕組みが受け付けている。たとえば Gemini API は OpenAI 互換の URL を公開しており、Ollama もローカルに同じ形の口を開く。そこでこの連載では、この形式の窓口を 1 本だけ書く。

他の形式のサービスを使うときは、窓口のファイルを 1 つ足せばよい。ループやツールの側は、第 1 回で決めた `Reply` の形しか見ていないからだ。

```flow caption="形式の違いは窓口の中で吸収する。ループから見えるのは共通の Reply だけ"
direction LR
A[loop.py] -- 共通の履歴 --> B[to_wire\nこの形式に直す]:::hl
B -- HTTP --> C([LLM のサービス])
C -- JSON --> D[from_wire\nReply に直す]:::hl
D -- Reply --> A
```

窓口の前半は、形式の変換である。

```python title="agentlab/llm/openai_compat.py（前半）" caption="共通の履歴とこの形式の書き方を、行きと帰りで相互に変換する" {2,17,33}
"""本物の LLM への窓口。OpenAI 互換の Chat Completions 形式で話す。
★ サービスごとの書き方の違いは、このファイルの中だけに閉じ込める。"""
import json            # 辞書と JSON 文字列を相互に変換する標準ライブラリ
import os              # 環境変数を読む標準ライブラリ
import time            # 待ち時間を作る標準ライブラリ
import urllib.error    # 通信の失敗を表す型
import urllib.request  # HTTP で API を呼ぶ標準ライブラリ

from ..core import Reply, ToolCall


def to_wire(messages: list[dict]) -> list[dict]:
    """共通の履歴を、この形式の書き方に直す。"""
    wire = []
    for m in messages:
        if m["role"] == "assistant" and m.get("raw"):
            wire.append(m["raw"])                       # ★ LLM の返事は、受け取った形のまま返す
        elif m["role"] == "assistant":                  # 偽物など、元の形が無い返事
            wire.append({"role": "assistant", "content": m["content"]})
        else:                                           # system / user / tool はそのままの形で通じる
            wire.append({k: v for k, v in m.items() if k in ("role", "content", "tool_call_id")})
    return wire


def from_wire(message: dict) -> Reply:
    """この形式の返事を、共通の Reply に直す。"""
    calls = []
    for i, c in enumerate(message.get("tool_calls") or []):
        raw_args = c["function"].get("arguments") or "{}"  # 引数は JSON の「文字列」で届く
        try:
            args = json.loads(raw_args)                  # 文字列 → 辞書
        except json.JSONDecodeError:
            args = raw_args                              # ★ 壊れていたら文字列のまま渡し、ツール側でエラーにする
        c["id"] = c.get("id") or f"call_{i}"             # 番号が無いサービス向けに補う（元の形にも書き戻す）
        calls.append(ToolCall(id=c["id"], name=c["function"]["name"], arguments=args))
    return Reply(text=message.get("content") or "", tool_calls=calls, raw=message)
```

- `to_wire` は共通の履歴をこの形式に直す。`system`・`user`・`tool` の発言は形がほぼ同じなので、必要な項目だけを残せば通じる
- `from_wire` は返事を `Reply` に直す。引数は JSON の**文字列**で届くので、辞書に変換する。壊れていて読めないときは、文字列のまま渡してツール側でエラーにする
- 大事なのは、LLM の返事を `raw` に丸ごと取っておき、次に呼ぶときに**受け取った形のまま**返す点である

> [!IMPORTANT] LLM の返事は、作り直さずにそのまま返す
> 最近の LLM は、返事の中に「考えた過程の署名」のような、利用者には読めない情報を入れて返すことがある。これを削ったり作り直したりして返すと、続きの推論ができなくなる。筆者が検証に使った OpenAI 互換エンドポイントでも、`ToolCall` から返事を組み立て直して送ると、次のエラーで止まった。
>
> `400 Function call is missing a thought_signature in functionCall parts.`
>
> Google の Gemini API のドキュメントも、Anthropic の Claude のドキュメントも、思考の情報を含むブロックを履歴から削除・改変しないよう求めている。形式の変換は、自分で作った発言だけに使う。

後半は、HTTP で呼び出す部分である。標準ライブラリの `urllib` だけで書ける。

```python title="agentlab/llm/openai_compat.py（後半）" caption="接続先を環境変数から読み、混雑や一時的な故障のときは間を広げてやり直す" {8,30}
class OpenAICompatLLM:
    def __init__(self, base_url: str, model: str, api_key: str):
        self.url = base_url.rstrip("/") + "/chat/completions"  # 呼び出し先の URL
        self.model, self.api_key = model, api_key

    @classmethod
    def from_env(cls):
        """★ 接続先は環境変数から読む。キーをコードに書かない。"""
        return cls(os.environ["AGENTLAB_BASE_URL"], os.environ["AGENTLAB_MODEL"],
                   os.environ.get("AGENTLAB_API_KEY", ""))  # ローカル実行ならキーは空でよい

    def chat(self, messages, tools):
        body = {"model": self.model, "messages": to_wire(messages)}
        if tools:                                          # ツールがあるときだけ説明書を付ける
            body["tools"] = [{"type": "function", "function": t} for t in tools]
        data = self._post(body)
        return from_wire(data["choices"][0]["message"])    # 返事の候補の 1 つ目を使う

    def _post(self, body: dict, attempts: int = 4) -> dict:
        request = urllib.request.Request(
            self.url, data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"})
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(request, timeout=120) as res:
                    return json.load(res)                  # 成功したら JSON を辞書にして返す
            except urllib.error.HTTPError as e:
                retryable = e.code in (429, 500, 502, 503)   # 混雑・一時的な故障
                if retryable and attempt < attempts - 1:
                    time.sleep(2 ** attempt * 5)           # ★ 5 秒、10 秒、20 秒と間を広げてやり直す
                    continue
                detail = e.read().decode("utf-8", "replace")[:300]
                raise RuntimeError(f"LLM の呼び出しに失敗しました: {e.code} {detail}") from None
```

- 接続先の URL・モデル名・API キーは環境変数から読む。キーをコードに書くと、コードを共有したときにキーも漏れる
- `429`（呼び出しすぎ）や `503`（混雑）は時間をおけば通ることが多いので、5 秒・10 秒・20 秒と間を広げてやり直す
- それ以外の失敗は、サービスが返した理由を付けて `RuntimeError` にする。ループの外に知らせて止める

> [!TIP]
> 何体ものエージェントを同時に動かすなら、待ち時間をランダムにばらつかせる（ジッター）と、やり直しが同じ瞬間に集中しない。考え方は「[失敗する前提で作る](2026-09-29-agent-parts-4-errors-logs.html)」で詳しく書いた。

どの窓口を使うかは、入口ではなく `llm/__init__.py` で決める。

```python title="agentlab/llm/__init__.py" caption="環境変数 AGENTLAB_LLM で窓口を選ぶ。何も指定しなければ偽物" {6}
"""使う LLM を環境変数 AGENTLAB_LLM で選ぶ。"""
import os


def make_llm():
    kind = os.environ.get("AGENTLAB_LLM", "fake")  # ★ 何も指定しなければ偽物で動く
    if kind == "fake":
        from .fake import FakeLLM
        return FakeLLM()
    if kind == "openai_compat":
        from .openai_compat import OpenAICompatLLM
        return OpenAICompatLLM.from_env()
    raise SystemExit(f"AGENTLAB_LLM={kind} は知りません。fake か openai_compat を指定してください")
```

使う環境変数は 4 つである。

| 環境変数 | 意味 | 例 |
|---|---|---|
| `AGENTLAB_LLM` | 使う窓口 | `fake` / `openai_compat` |
| `AGENTLAB_BASE_URL` | 接続先の URL | OpenAI は `https://api.openai.com/v1`、Gemini は `https://generativelanguage.googleapis.com/v1beta/openai/`、ローカルの Ollama は `http://localhost:11434/v1` |
| `AGENTLAB_MODEL` | モデル名 | 各サービスのドキュメントで、ツール呼び出しに対応したものを選ぶ |
| `AGENTLAB_API_KEY` | API キー | ローカル実行なら空でよい |

```bash title="本物の LLM で動かす準備（bash の例）"
export AGENTLAB_LLM=openai_compat
export AGENTLAB_BASE_URL="接続先の URL"
export AGENTLAB_MODEL="モデル名"
export AGENTLAB_API_KEY="$MY_LLM_KEY"   # 別の環境変数に登録してあるキーを渡す。キーを直接打たない
```

PowerShell では `$env:AGENTLAB_LLM = "openai_compat"` のように書く。

> [!NOTE]
> この記事の実行例は、Gemini API の OpenAI 互換エンドポイント（`gemini-flash-latest`、2026-10-01）で確かめた。モデル名の一覧は頻繁に変わるので、使う時点のドキュメントで確かめてほしい。

## ファイルを触らせる：workspace の外に出さない

エージェントに仕事をさせるなら、ファイルを読み書きさせたくなる。ただし、LLM が頼んできたパスをそのまま開くと、`../../.ssh/id_rsa` のような指定で、見せてはいけないファイルまで読まれてしまう。

そこで、触ってよい場所を `workspace/` フォルダー 1 つに決め、**パスを本当の場所に直してから**その中かどうかを判定する。

```python title="agentlab/tools/files.py" caption="workspace の中だけを読み書きするツール。判定はパスを正規化した後で行う" {20,41}
"""workspace フォルダーの中だけを読み書きするツール。"""
import os                  # 環境変数を読む標準ライブラリ
from pathlib import Path   # ファイルの場所（パス）を扱う標準ライブラリ
from typing import Annotated

from .registry import Toolbox

files = Toolbox()
MAX_CHARS = 4000  # 1 回に LLM へ渡す文字数の上限


def workspace() -> Path:
    """触ってよい唯一のフォルダー。既定は ./workspace。"""
    return Path(os.environ.get("AGENTLAB_WORKSPACE", "workspace")).resolve()


def inside(path: str) -> Path:
    """相対パスを本当の場所に直し、workspace の外なら拒否する。"""
    root = workspace()
    target = (root / path).resolve()          # ★ ../ やリンクをたどった「後」の場所で判定する
    if not target.is_relative_to(root):
        raise PermissionError(f"{path} は workspace の外です。workspace 内の相対パスを指定してください")
    return target


@files.tool
def list_files() -> str:
    """workspace にあるファイルの一覧を返す。何があるか分からないときは最初にこれを使う。"""
    root = workspace()
    names = [str(p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]
    return "\n".join(names) or "（ファイルはありません）"


@files.tool
def read_file(path: Annotated[str, "workspace からの相対パス。例: sales.csv"]) -> str:
    """テキストファイルを読む。長いときは先頭 4000 文字だけを返す。"""
    target = inside(path)
    if not target.is_file():                  # 無いときは、次に何をすればよいかを返す
        raise FileNotFoundError(f"{path} はありません。list_files で名前を確かめてください")
    text = target.read_text(encoding="utf-8")
    if len(text) > MAX_CHARS:                 # ★ 長すぎる結果は切り詰め、切ったことを書き添える
        return text[:MAX_CHARS] + f"\n…（残り {len(text) - MAX_CHARS} 文字は省略）"
    return text


@files.tool
def write_file(path: Annotated[str, "workspace からの相対パス。例: report.md"],
               content: Annotated[str, "書き込む本文"]) -> str:
    """テキストファイルを作る。同じ名前のファイルがあれば上書きして消えるので注意する。"""
    target = inside(path)
    target.parent.mkdir(parents=True, exist_ok=True)  # 途中のフォルダーが無ければ作る
    target.write_text(content, encoding="utf-8")
    return f"{path} に {len(content)} 文字を書きました"
```

- `resolve()` は `..` やシンボリックリンク（別の場所を指す目印のファイル）をたどった後の、本当の場所を返す。判定はその後で行う。文字列に `..` が含まれるかを見る方法では、書き方を変えるだけですり抜けられる
- `read_file` は長いファイルを先頭 4000 文字で切り、切ったことを書き添える。何も書かずに切ると、LLM はそれが全部だと思い込む
- ファイルが無いときは「`list_files` で名前を確かめて」と次の一手を返す
- `write_file` は既存のファイルを上書きして消す。人間の承認を挟む仕組みは第 3 回で足す

題材には、2 か月分の売上を入れた CSV を置いておく。

```text title="workspace/sales.csv"
月,商品,個数,単価
2026-08,ノート,120,350
2026-08,ペン,300,120
2026-08,付箋,80,200
2026-09,ノート,150,350
2026-09,ペン,260,120
2026-09,付箋,110,200
```

## 失敗を「次の一手」が分かる文で返す

本物の LLM は、存在しないツール名を作ったり、引数の名前を間違えたり、壊れた JSON を返したりする。第 1 回の `run` も失敗を文字列で返していたが、「何が悪く、どう直せばよいか」までは書いていなかった。

そこで、`Toolbox.run` を次のように書き換える。

```python title="agentlab/tools/registry.py（run を書き換え）" caption="失敗の種類ごとに、LLM が自分で直せる情報を付けて返す" {4,9}
    def run(self, call: ToolCall, max_chars: int = 6000) -> str:
        """頼まれたツールを実行し、結果を必ず文字列で返す。失敗は「次に何をすべきか」まで書く。"""
        func = self.funcs.get(call.name)
        if func is None:                            # ★ 無いツール → 使えるツールの名前を教える
            return f"エラー: {call.name} というツールはありません。使えるのは {', '.join(self.funcs)} です"
        if not isinstance(call.arguments, dict):    # 引数が JSON として壊れていた
            return f"エラー: 引数を JSON として読めませんでした。書き直してください: {call.arguments[:200]}"
        try:
            inspect.signature(func).bind(**call.arguments)  # ★ 実行する前に、引数の名前と数を照合する
        except TypeError as e:
            params = ", ".join(inspect.signature(func).parameters)
            return f"エラー: 引数が合いません（{e}）。{call.name} の引数は {params} です"
        try:
            result = str(func(**call.arguments))
        except Exception as e:                      # ツールの中で起きた失敗
            return f"エラー: {type(e).__name__}: {e}"
        if len(result) > max_chars:                 # 長すぎる結果は切り詰める
            result = result[:max_chars] + f"\n…（{len(result) - max_chars} 文字省略）"
        return result
```

- 存在しないツールを頼まれたら、使えるツールの名前を並べて返す
- 実行する前に `signature(...).bind(...)` で、引数の名前と数が関数に合うかを照合する。合わなければ正しい引数名を教える
- ツールの中で起きた失敗と、呼び方の失敗を分けて返すので、LLM は「呼び方を直す」のか「別の手を考える」のかを選べる

実際に、よくある失敗を流すと次の文が返る。

```bash title="失敗したときに LLM へ返る文"
read_csv({'path': 'sales.csv'}) ->
  エラー: read_csv というツールはありません。使えるのは calc, count_chars, list_files, read_file, write_file です
calc({expression: 1+1) ->
  エラー: 引数を JSON として読めませんでした。書き直してください: {expression: 1+1
calc({'formula': '1+1'}) ->
  エラー: 引数が合いません（missing a required argument: 'expression'）。calc の引数は expression です
read_file({'path': '../.env'}) ->
  エラー: PermissionError: ../.env は workspace の外です。workspace 内の相対パスを指定してください
read_file({'path': 'nothing.txt'}) ->
  エラー: FileNotFoundError: nothing.txt はありません。list_files で名前を確かめてください
```

## ログで、1 回の依頼を最初から最後まで追う

本物の LLM は毎回同じ動きをしない。おかしな答えが出たとき、画面の出力だけでは「どのツールに何を渡し、何が返ったか」を後から確かめられない。そこで、出来事を **1 行 1 件の JSON**（JSON Lines）でファイルに残す。

```python title="agentlab/log.py" caption="出来事を 1 行 1 件の JSON で追記する。全行に依頼の番号を入れる" {11}
"""エージェントの動きを、1 行 1 件の JSON（JSON Lines）で記録する。"""
import json            # 辞書を JSON の文字列にする標準ライブラリ
import sys             # 画面（標準エラー出力）に書く
import time            # 経過時間を測る
import uuid            # 重ならない番号を作る
from pathlib import Path


class RunLog:
    def __init__(self, path: str = "logs/agent_log.jsonl", echo: bool = True):
        self.run_id = uuid.uuid4().hex[:8]       # ★ 1 回の依頼に付ける番号。全行に入れて後で絞り込む
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)  # logs フォルダーが無ければ作る
        self.echo = echo                         # 画面にも短く出すかどうか
        self.started = time.monotonic()          # 開始時刻（経過秒の起点）

    def event(self, kind: str, **data):
        """出来事を 1 件記録する。kind は start / llm / tool / end のどれか。"""
        record = {"run": self.run_id, "sec": round(time.monotonic() - self.started, 2),
                  "kind": kind, **data}
        with self.path.open("a", encoding="utf-8") as f:   # 追記で開く
            f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        if self.echo:                            # 画面には 1 項目 60 文字までに縮めて出す
            short = ", ".join(f"{k}={str(v)[:60]!r}" for k, v in data.items())
            print(f"  [{kind}] {short}", file=sys.stderr)

    def child(self, name: str) -> "RunLog":
        """部下用の記録係を作る。番号を「親/名前」にして、親子の関係を残す（第 3 回で使う）。"""
        sub = RunLog(str(self.path), self.echo)
        sub.run_id = f"{self.run_id}/{name}"
        return sub
```

- `run_id` は 1 回の依頼に付ける番号である。全行に入れておけば、何件もの依頼が混ざったログからでも、1 件分だけを抜き出せる
- 1 行 1 件にしておくと、途中で落ちても書けた行までは読める。集計も 1 行ずつ読めば済む
- `child` は第 3 回で、部下のエージェントの記録を親の記録とつなぐのに使う

ループは、`print` の代わりにこの記録係を使うように書き換える。

```python title="agentlab/loop.py（ログ付き）" caption="開始・LLM の返事・ツールの実行・終わり方を記録する" {23,28}
"""エージェントの心臓部。LLM とツールの間を、答えが出るまで往復させる。"""
from .core import LLM
from .log import RunLog
from .tools.registry import Toolbox

SYSTEM = ("あなたは手元のツールを使って依頼に答えるアシスタントです。"
          "計算や文字数は推測せず、必ずツールで確かめてから答えてください。"
          "ファイルの中身は、読んでから答えてください。")


def run_agent(task: str, llm: LLM, toolbox: Toolbox, max_turns: int = 8,
              log: RunLog | None = None) -> str:
    log = log or RunLog()                               # 記録係が渡されなければ新しく作る
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": task}]
    log.event("start", task=task)
    for turn in range(1, max_turns + 1):
        reply = llm.chat(messages, toolbox.schemas())
        messages.append({"role": "assistant", "content": reply.text,
                         "tool_calls": reply.tool_calls, "raw": reply.raw})
        log.event("llm", turn=turn, text=reply.text, calls=[c.name for c in reply.tool_calls])
        if not reply.tool_calls:
            log.event("end", status="answered", turns=turn)  # ★ どう終わったかを必ず残す
            return reply.text
        for call in reply.tool_calls:
            result = toolbox.run(call)
            log.event("tool", name=call.name, args=call.arguments, result=result,
                      error=result.startswith("エラー"))      # ★ 失敗した呼び出しを後で数えられるように
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    log.event("end", status="max_turns", turns=max_turns)
    return f"{max_turns} 回往復しても答えが出なかったので止めました。"
```

- 終わったときは、必ず `end` を残し、`status` に「答えが出た」か「上限で止めた」かを書く。後で失敗した依頼だけを数えられる
- ツールの記録には `error` を付ける。どのツールがどれくらい失敗しているかを、ログから集計できる

入口は、窓口を `make_llm()` に任せ、道具箱を `+` でまとめるだけになる。

```python title="agentlab/__main__.py" caption="計算・文字数のツールと、ファイルのツールをまとめて渡す" {12}
"""python -m agentlab "依頼" で動かす入口。"""
import sys

from .llm import make_llm
from .loop import run_agent
from .tools.basic import basic
from .tools.files import files

task = " ".join(sys.argv[1:])
if not task:
    sys.exit('使い方: python -m agentlab "sales.csv の 9 月の売上合計は？"')
answer = run_agent(task, make_llm(), basic + files)  # ★ 道具箱を + でまとめて渡す
print(answer)
```

本物の LLM で動かしてみる。画面の `[...]` の行は記録係が画面にも出した要約で、最後の段落が答えである。

```bash title="実行結果（本物の LLM。文面と往復の回数は実行ごとに変わる）"
$ python -m agentlab "sales.csv を読んで、9 月の売上合計（個数×単価の合計）を教えて"
  [start] task='sales.csv を読んで、9 月の売上合計（個数×単価の合計）を教えて'
  [llm] turn='1', text='', calls="['read_file']"
  [tool] name='read_file', args="{'path': 'sales.csv'}", result='月,商品,個数,単価\n2026-08,ノート,120,350\n2026-08,ペン,300,120\n2026-08,付箋', error='False'
  [llm] turn='2', text='', calls="['calc']"
  [tool] name='calc', args="{'expression': '150 * 350 + 260 * 120 + 110 * 200'}", result='105700', error='False'
  [llm] turn='3', text='', calls="['calc']"
  [tool] name='calc', args="{'expression': '150 * 350'}", result='52500', error='False'
  [llm] turn='4', text='', calls="['calc']"
  [tool] name='calc', args="{'expression': '260 * 120'}", result='31200', error='False'
  [llm] turn='5', text='', calls="['calc']"
  [tool] name='calc', args="{'expression': '110 * 200'}", result='22000', error='False'
  [llm] turn='6', text='', calls="['calc']"
  [tool] name='calc', args="{'expression': '52500 + 31200 + 22000'}", result='105700', error='False'
  [llm] turn='7', text='`sales.csv` のデータに基づき計算したところ、2026年9月の売上合計は **105,700円** です。\n\n', calls='[]'
  [end] status='answered', turns='7'
`sales.csv` のデータに基づき計算したところ、2026年9月の売上合計は **105,700円** です。

### 内訳
- **ノート**: 150個 × 350円 = 52,500円
- **ペン**: 260個 × 120円 = 31,200円
- **付箋**: 110個 × 200円 = 22,000円
- **合計**: 52,500 + 31,200 + 22,000 = **105,700円**
```

答えは正しい。偽 LLM と違い、本物は自分で「まずファイルを読む → 9 月の行だけを計算する」と手順を決めた。ツールの依頼を作り直さずに返しているので、7 往復しても会話が途切れていない。

一方でログを見ると、無駄も分かる。2 回目で合計が出ているのに、内訳を示すために計算を 1 つずつ頼み直し、7 往復もかかった。上限を 8 回にしていたので、あと 1 回で打ち切られるところだった。こうした「正解だが遅い・高い」動きは、答えだけを見ていては気づけない。直し方は第 3 回で扱う。

ログのファイルには、同じ出来事が JSON で残っている。

```json title="logs/agent_log.jsonl（抜粋）"
{"run": "2688fcf3", "sec": 7.0, "kind": "llm", "turn": 3, "text": "", "calls": ["calc"]}
{"run": "2688fcf3", "sec": 7.02, "kind": "tool", "name": "calc", "args": {"expression": "150 * 350"}, "result": "52500", "error": false}
{"run": "2688fcf3", "sec": 20.73, "kind": "end", "status": "answered", "turns": 7}
```

## 偽 LLM でテストする

本物の LLM は返事が毎回変わるので、ループの約束ごとを確かめるテストには向かない。そこで、**決めた順に返事をする偽 LLM** を `fake.py` に足す。受け取った履歴を控えておくので、「LLM に何が届いたか」をテストで確かめられる。

```python title="agentlab/llm/fake.py（末尾に追加）" caption="台本どおりに返事をし、渡された履歴を控えておく偽 LLM" {9}
class ScriptedLLM:
    """台本どおりに返事をする偽 LLM。受け取った履歴を控えておき、テストで中身を確かめる。"""

    def __init__(self, replies):
        self.replies = list(replies)    # 返す予定の Reply を順番に並べたもの
        self.seen = []                  # 呼ばれるたびに、渡された履歴の写しを溜める

    def chat(self, messages, tools):
        self.seen.append([dict(m) for m in messages])  # ★ 後で変わらないよう写しを取る
        return self.replies.pop(0)      # 台本の先頭を 1 つ取り出して返す
```

テストは、第 1 回から守ってきた約束ごとを 1 つずつ確かめる。Python 標準の `unittest` を使う。

```python title="tests/test_loop.py" caption="番号の対応・往復の上限・エラー文・workspace の外を、偽 LLM で確かめる" {24,32,45}
"""偽 LLM でループの約束ごとを確かめるテスト。python -m unittest -v で実行する。"""
import os
import tempfile                  # 使い捨てのフォルダーを作る標準ライブラリ
import unittest                  # Python 標準のテストの仕組み

from agentlab.core import Reply, ToolCall
from agentlab.llm.fake import ScriptedLLM
from agentlab.log import RunLog
from agentlab.loop import run_agent
from agentlab.tools.basic import basic
from agentlab.tools.files import files

TMP = tempfile.mkdtemp()                                  # テスト用の一時フォルダー
QUIET = dict(log=RunLog(os.path.join(TMP, "log.jsonl"), echo=False))  # 画面に出さない記録係


class LoopTest(unittest.TestCase):
    def test_result_goes_back_with_same_id(self):
        llm = ScriptedLLM([Reply(tool_calls=[ToolCall("a1", "calc", {"expression": "2*3"})]),
                           Reply(text="6 です")])
        self.assertEqual(run_agent("2*3 は？", llm, basic, **QUIET), "6 です")
        last = llm.seen[1][-1]                            # 2 回目に LLM が受け取った履歴の最後
        self.assertEqual((last["role"], last["tool_call_id"], last["content"]),
                         ("tool", "a1", "6"))             # ★ 同じ番号で、結果が届いている

    def test_stops_at_max_turns(self):
        endless = [Reply(tool_calls=[ToolCall(f"c{i}", "calc", {"expression": "1+1"})])
                   for i in range(10)]                    # ずっとツールを頼み続ける台本
        llm = ScriptedLLM(endless)
        answer = run_agent("…", llm, basic, max_turns=3, **QUIET)
        self.assertIn("止めました", answer)
        self.assertEqual(len(llm.seen), 3)                # ★ LLM は 3 回しか呼ばれていない

    def test_unknown_tool_is_reported(self):
        result = basic.run(ToolCall("x", "delete_all", {}))
        self.assertIn("calc, count_chars", result)        # 使えるツールが案内される

    def test_bad_arguments_are_reported(self):
        result = basic.run(ToolCall("x", "calc", {"formula": "1+1"}))
        self.assertIn("引数は expression", result)        # 正しい引数名が案内される

    def test_workspace_escape_is_rejected(self):
        os.environ["AGENTLAB_WORKSPACE"] = TMP
        result = files.run(ToolCall("x", "read_file", {"path": "../../secret.txt"}))
        self.assertTrue(result.startswith("エラー: PermissionError"))  # ★ 外は読めない


if __name__ == "__main__":
    unittest.main()
```

- 1 つ目は、ツールの結果が**同じ番号で** LLM に届いていることを確かめる。第 1 回の「依頼と結果は必ず対にする」の確認である
- 2 つ目は、ツールを頼み続ける台本で、`max_turns=3` なら LLM が 3 回しか呼ばれないことを確かめる
- 残りの 3 つは、無いツール・合わない引数・workspace の外へのアクセスが、例外ではなく案内付きのエラー文になることを確かめる

```bash title="実行結果"
$ python -m unittest -v
test_bad_arguments_are_reported (tests.test_loop.LoopTest.test_bad_arguments_are_reported) ... ok
test_result_goes_back_with_same_id (tests.test_loop.LoopTest.test_result_goes_back_with_same_id) ... ok
test_stops_at_max_turns (tests.test_loop.LoopTest.test_stops_at_max_turns) ... ok
test_unknown_tool_is_reported (tests.test_loop.LoopTest.test_unknown_tool_is_reported) ... ok
test_workspace_escape_is_rejected (tests.test_loop.LoopTest.test_workspace_escape_is_rejected) ... ok

----------------------------------------------------------------------
Ran 5 tests in 0.016s

OK
```

テストは API キーなしで一瞬で終わる。窓口やループを直したら、本物で試す前にまずこれを流す。

## つまずきやすい所

| 症状 | 原因 | 対処 |
|---|---|---|
| 2 回目の呼び出しで `400` が返る | 返事を作り直して返し、サービス固有の情報を落とした | 返事は `raw` に取っておき、そのまま返す |
| 引数の JSON が読めずに落ちる | LLM が壊れた JSON を返すことがある | 読めなければ文字列のまま渡し、エラー文で書き直しを頼む |
| 見せてはいけないファイルが読める | 文字列の見た目でパスを判定している | `resolve()` で本当の場所に直してから、workspace の中か判定する |
| ときどき `429` / `503` で止まる | 呼び出しすぎ・サービスの混雑 | 間を広げてやり直す。回数には上限を付ける |
| 正解なのに遅くて高い | 往復の回数を見ていない | ログの `turns` とツールの回数を見る |
| キーがコードやログに残る | キーを直接書いた | 環境変数から読む。ログに引数を残すツールでは秘密を扱わない |

## この回のチェックリスト

- [ ] サービス固有の書き方は `llm/` の 1 ファイルに閉じ込めた
- [ ] LLM の返事は、受け取った形のまま履歴に戻している
- [ ] 接続先とキーは環境変数から読み、コードに書いていない
- [ ] ファイル操作は workspace の中だけで、判定は `resolve()` の後に行う
- [ ] エラー文に「次に何をすればよいか」が書いてある
- [ ] 1 回の依頼を `run_id` で追え、終わり方（`status`）が必ず残る
- [ ] 偽 LLM のテストが API キーなしで通る

次回は、長い作業で履歴があふれる問題、取り消しのきかない操作の前に人間の承認を挟む仕組み、部下のエージェントへの仕事の切り出し、そして「何回やっても正しく動くか」を測る評価を足して仕上げる。

## 参考文献

- [Google AI for Developers, OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)（確認 2026-10-01）
- [Google AI for Developers, Thinking（Thought signatures）](https://ai.google.dev/gemini-api/docs/thinking)（確認 2026-10-01）
- [Claude Docs, Thinking（ツール使用時に thinking ブロックを保持する）](https://platform.claude.com/docs/en/build-with-claude/thinking)（確認 2026-10-01）
- [Claude Docs, Handling stop reasons](https://docs.anthropic.com/en/api/handling-stop-reasons)（確認 2026-10-01）
- [Vercel AI Gateway, Responses API tool calling](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses/tool-calling)（確認 2026-10-01）
- [IBM, Tool calling with Ollama](https://www.ibm.com/think/tutorials/local-tool-calling-ollama-granite)（確認 2026-10-01）
- [DEV, Your First Tool-Calling Agent With No Framework](https://dev.to/gabrielanhaia/your-first-tool-calling-agent-with-no-framework-just-the-bare-sdk-3ip3)（確認 2026-10-01）
- [Python ドキュメント, urllib.request](https://docs.python.org/ja/3/library/urllib.request.html) / [unittest](https://docs.python.org/ja/3/library/unittest.html)（確認 2026-10-01）
