---
title: LLMにループを渡すまでを手で書く——標準ライブラリだけで作るAIエージェント入門
description: フレームワークを使わず、Python の標準ライブラリだけで AI エージェントを 1 から組み立てる連載の第 1 回。ディレクトリの分け方、LLM との約束を表す型、練習用の偽 LLM、関数からツールの説明書を自動で作る仕組み、エージェントループまでを書き、API キーなしで実際に動かす。
date: "2026-10-01"
verified: "2026-10-01"
category: AIエージェント
tags: [AIエージェント, LLM, Python, ツール呼び出し, ハンズオン]
level: [basic]
series: Pythonで作って動かすAIエージェント
status: published
---

AIエージェントの解説は多いが、フレームワークを入れて数行で動かす例が中心で、「中で何が起きているか」は見えにくい。この連載では、**Python の標準ライブラリだけ**で 1 つのリポジトリ `agent-lab/` を 3 回かけて育てる。`pip install` は一度もしない。

第 1 回のこの記事では、エージェントの骨格を作る。LLM との約束を表す型・練習用の偽 LLM・ツールの登録の仕組み・ループの 4 つで、API キーがなくても手元で動く。

> [!TIP] この記事で分かること
> - エージェントのリポジトリを「変わる理由」で分けるディレクトリ構成
> - どの LLM サービスでも同じ形で扱うための型の決め方
> - Python の関数から、LLM に渡すツールの説明書を自動で作る方法
> - 答えが出るまで LLM とツールを往復させるループと、その止め方
> - `eval` を使わずに安全な計算ツールを作る方法

エージェントの設計の考え方そのものは「[AIエージェントは「賢さ」より「設計」で決まる](2026-09-29-ai-agent-design-fundamentals.html)」に書いた。この連載はその実装編で、理屈より「動くリポジトリ」を優先する。

## コードの読み方

この記事のコードは、つなげるとそのまま動く。ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。プログラミングに慣れていない人は、次の表を見ながら読むとよい。

| 書き方 | 意味 |
|---|---|
| `# 〜` / `"""〜"""` | 説明文（コメント・docstring）。`"""` は関数の説明書としても使われる |
| `import 名前` / `from 場所 import 名前` | 別のファイルや標準ライブラリの部品を読み込む。`from .core` の `.` は「同じフォルダーの」 |
| `def 名前(引数):` | 関数（手順に名前を付けたもの）の定義 |
| `class 名前:` | 「データと、それを扱う関数」をひとまとめにした型の定義 |
| `@名前` | 直後の関数に、別の処理をかぶせる書き方（デコレーター） |
| `[a, b]` / `{"キー": 値}` | リスト（順番のある入れ物）/ 辞書（名前と値の組の入れ物） |
| `x: str` / `-> str` | 型の注釈。「x は文字列」「この関数は文字列を返す」という目印 |
| `f"...{x}..."` | `{}` の中に値を埋め込んだ文字列 |

## 3 回で作るものと、ディレクトリの分け方

作るのは、手元のファイルを読んで計算し、レポートを書くエージェントである。中心にあるのは、LLM とツールの間を答えが出るまで往復する「ループ」だ。

```flow caption="この連載で作るエージェントの動き。LLM が「ツールを使う」と言う限り往復を続ける"
A([利用者の依頼]) --> B(LLM が次の一手を決める):::hl
B --> C{ツールを頼んだ?}
C -- はい --> D[ツールを実行して\n結果を履歴に足す]
D --> B
C -- いいえ --> E([答えを返す])
```

3 回を終えたときのディレクトリは次のとおりである。丸数字は、そのファイルを作る回を表す。

```text title="完成時の agent-lab/"
agent-lab/
├── agentlab/                 エージェント本体（Python のパッケージ）
│   ├── __init__.py           ① 空ファイル。フォルダーをパッケージにする目印
│   ├── __main__.py           ① python -m agentlab で動く入口
│   ├── core.py               ① 共通の型（ToolCall / Reply / LLM）
│   ├── loop.py               ① エージェントループ（②③で育てる）
│   ├── log.py                ② 1 行 JSON のログ
│   ├── memory.py             ③ 長い履歴を要約に畳む
│   ├── approval.py           ③ 書き込みの前に人間が承認
│   ├── subagent.py           ③ 部下のエージェントをツールにする
│   ├── llm/                  LLM の窓口
│   │   ├── __init__.py       ① 空 → ② 窓口を選ぶ関数
│   │   ├── fake.py           ① 練習用の偽 LLM
│   │   └── openai_compat.py  ② 本物の LLM への窓口
│   └── tools/                ツール
│       ├── __init__.py       ① 空ファイル
│       ├── registry.py       ① 関数をツールとして登録する仕組み
│       ├── basic.py          ① 計算・文字数
│       └── files.py          ② workspace の中だけを読み書き
├── tests/                    ② 偽 LLM で動きを確かめるテスト
├── evals/                    ③ 同じ課題を何度も解かせて測る
├── workspace/                ② エージェントが触ってよい唯一の場所
└── logs/                     ② 実行の記録（自動で作られる）
```

フォルダーは「**何が変わったときに、そのファイルを直すか**」で分けた。変わる理由が同じものを 1 か所に集めておくと、何かを差し替えるときに直す範囲が狭く済む。

| フォルダー | 変わるきっかけ | 例 |
|---|---|---|
| `llm/` | 使う LLM のサービスを替えたとき | 偽物 → 本物、A 社 → B 社 |
| `tools/` | エージェントにさせる仕事が増えたとき | ファイル操作、検索、社内 API |
| `loop.py` / `core.py` | ほとんど変わらない | 止め方や記録の追加くらい |

> [!NOTE]
> パッケージを直下に置くこの形は flat layout と呼ばれ、インストールせずに `python -m` ですぐ動かせる。配布用のライブラリにするなら、`src/` の下に置く src layout の方が、意図しないファイルの読み込みを防げる（Python Packaging User Guide）。この連載は「手元で動かす」ことを優先して flat layout にした。

第 1 回で作るのは、このうち ① の付いたファイルだけである。動作確認は Python 3.11 で行った。`X | None` という型の書き方を使うので、3.10 以上が必要になる。

```bash title="準備（macOS / Linux / Git Bash）"
mkdir -p agent-lab/agentlab/llm agent-lab/agentlab/tools
cd agent-lab
touch agentlab/__init__.py agentlab/llm/__init__.py agentlab/tools/__init__.py
```

Windows の PowerShell では、`mkdir` でフォルダーを作り、`New-Item agentlab/__init__.py` のように空ファイルを 3 つ作る。

## LLM との約束を型にする：core.py

LLM のサービスは、ツールの頼み方や結果の返し方の形式が会社ごとに違う。その違いがループの中にまで入り込むと、サービスを替えるたびにループを書き直すことになる。そこで最初に、**エージェントの中で使う形を 1 つだけ決める**。

会話の履歴は辞書のリストで持つ。1 通ごとに `role`（誰の発言か）を付け、次の 4 種類を使う。

| role | 中身 | いつ足すか |
|---|---|---|
| `system` | エージェントの役割の説明 | 最初に 1 回 |
| `user` | 利用者の依頼 | 最初に 1 回 |
| `assistant` | LLM の返事。文章か、ツールの依頼（`tool_calls`） | LLM を呼ぶたび |
| `tool` | ツールの実行結果と、どの依頼への結果か（`tool_call_id`） | ツールを実行するたび |

LLM からの返事は、次の型で受け取ると決める。

```python title="agentlab/core.py" caption="エージェント全体で共通の型。偽物の LLM も本物の LLM も、この形で返事をする" {9,18}
"""エージェント全体で使う、共通の「形」を決めるファイル。"""
from dataclasses import dataclass, field  # dataclass: 項目の決まった入れ物を手早く作る仕組み
from typing import Protocol               # Protocol: 「この形の関数を持っていればよい」という約束


@dataclass
class ToolCall:
    """LLM からの「このツールを、この引数で使いたい」という依頼 1 件。"""
    id: str          # ★ 依頼の番号。結果を返すとき「どの依頼への答えか」を示すのに使う
    name: str        # 使いたいツールの名前
    arguments: dict  # ツールに渡す引数（引数名 → 値 の辞書）


@dataclass
class Reply:
    """LLM からの返事 1 回分。"""
    text: str = ""                                            # 文章の返事
    tool_calls: list[ToolCall] = field(default_factory=list)  # ★ ツールの依頼。空なら「答えが出た」という意味
    raw: dict | None = None                                   # 本物の LLM が返した元の形（第 2 回で使う）


class LLM(Protocol):
    """LLM の窓口が守る約束。偽物でも本物でも、この形なら差し替えられる。"""

    def chat(self, messages: list[dict], tools: list[dict]) -> Reply:
        ...  # 会話の履歴とツールの説明書を受け取り、Reply を 1 つ返す
```

- `ToolCall` が「このツールを、この引数で使いたい」という依頼 1 件である。`id` は依頼の番号で、結果を返すときに「どの依頼への答えか」を示すのに使う
- `Reply` は返事 1 回分だ。`tool_calls` が空なら「もう答えが出た」と読む。この 1 点で、ループは終わるか続けるかを判断する
- `LLM` は「`chat` という関数を持っていれば何でもよい」という約束である。偽物と本物を差し替えられるのは、両方がこの形を守るからだ

> [!WARNING] 依頼の番号は必ず結果と対にする
> 多くのサービスは、ツールの依頼 1 件につき、同じ番号の結果がちょうど 1 件返ってくることを求める。結果が欠けたり番号がずれたりすると、API がエラーを返すか、LLM が結果を取り違える。番号の対応はループの側で必ず守る。

## API キーなしで動かす：偽 LLM

本物の LLM を使うと、試すたびにお金と時間がかかり、返事も毎回変わる。ループの配線を確かめる段階では、**決まった規則で返事をする偽物**の方が向いている。

この偽 LLM は 2 つのことしかしない。依頼文に計算式があれば `calc` を、「」で囲んだ語と「文字」という言葉があれば `count_chars` を頼む。ツールの結果が届いたら、それを並べて答える。

```python title="agentlab/llm/fake.py" caption="練習用の偽 LLM。本物と同じ Reply の形で返事をする" {17,32}
"""練習用の偽 LLM。決まった規則でツールを頼み、届いた結果をまとめて返す。"""
import re                      # 文字列のパターン検索（正規表現）の標準ライブラリ
from itertools import count    # 1, 2, 3… と番号を配る道具

from ..core import Reply, ToolCall

# 「数字や括弧で始まり、+ - * / を 1 つ以上含む並び」を計算式とみなす
EXPRESSION = re.compile(r"[\d(][\d+\-*/(). ]*[+\-*/][\d+\-*/(). ]*[\d)]")


class FakeLLM:
    def __init__(self):
        self.ids = count(1)  # ツール依頼の番号を配る係

    def chat(self, messages, tools):
        last = messages[-1]                       # 履歴のいちばん新しい 1 通
        if last["role"] == "tool":                # ★ ツールの結果が届いた → まとめて答える
            results = []
            for m in reversed(messages):          # 後ろから、続いているツール結果だけを集める
                if m["role"] != "tool":
                    break
                results.insert(0, m["content"])   # 元の順番に並ぶよう、先頭に差し込む
            return Reply(text="ツールで確かめた結果です: " + " / ".join(results))

        task = last["content"]                    # 利用者の依頼文
        calls = []                                # 頼むツールをここに溜める
        if expr := EXPRESSION.search(task):       # 計算式が書いてあれば calc を頼む
            calls.append(self._call("calc", expression=expr.group().strip()))
        if (quoted := re.search(r"「(.+?)」", task)) and "文字" in task:
            calls.append(self._call("count_chars", text=quoted.group(1)))  # 「」の中の文字数を頼む
        if calls:
            return Reply(tool_calls=calls)        # ★ 文章ではなく「ツールの依頼」を返す
        return Reply(text="ツールは要らないと判断しました: " + task)

    def _call(self, name, **arguments):
        return ToolCall(id=f"call_{next(self.ids)}", name=name, arguments=arguments)
```

- 履歴の最後が `tool`（ツールの結果）なら、ツールを頼まずに文章で答える。これでループが終わる
- 依頼文から計算式と「」の中身を探し、見つかったものだけツールを頼む。1 回の返事で 2 つ頼むこともある
- `_call` は依頼に `call_1`、`call_2` と番号を振る。本物の LLM も、依頼ごとに別々の番号を付けて返してくる

> [!NOTE]
> 偽 LLM で確かめられるのは「配線」だけである。LLM が正しい判断をするかどうかは、本物で試すしかない。その測り方は第 3 回で扱う。

## 関数 1 つでツールを足す：registry.py

LLM はツールの中身を見られない。手がかりになるのは、ツールの**名前・説明文・引数の形**を書いた説明書だけである。この説明書は JSON Schema という共通の書き方で渡すのが一般的だ。

説明書を手で書くと、関数の中身を直したときに説明書の直し忘れが起きる。そこで、Python の関数そのものから説明書を作る。関数名がツール名に、docstring が説明文に、型の注釈が引数の形になる。

```python title="agentlab/tools/registry.py（前半）" caption="関数の引数・型・docstring を調べて、LLM に渡す説明書を作る" {17,25}
"""Python の関数を、LLM が使える「ツール」として登録する仕組み。"""
import inspect  # 関数の引数や説明文を、プログラムから調べる標準ライブラリ
from typing import Annotated, get_args, get_origin, get_type_hints

from ..core import ToolCall

# Python の型 → LLM に伝える型の名前（JSON Schema という共通の書き方）
TYPE_NAMES = {str: "string", int: "integer", float: "number", bool: "boolean"}


def schema_of(func) -> dict:
    """関数から、LLM に渡す説明書（名前・説明・引数の形）を作る。"""
    hints = get_type_hints(func, include_extras=True)  # 引数に付けた型の注釈を取り出す
    props, required = {}, []
    for name, param in inspect.signature(func).parameters.items():  # 引数を 1 つずつ見る
        hint, prop = hints.get(name, str), {}
        if get_origin(hint) is Annotated:               # ★ Annotated[型, "説明"] なら説明も取り出す
            hint, prop["description"] = get_args(hint)[:2]
        prop["type"] = TYPE_NAMES.get(hint, "string")   # 型の名前を JSON Schema の言葉に直す
        props[name] = prop
        if param.default is inspect.Parameter.empty:    # 既定値のない引数は「必須」
            required.append(name)
    return {
        "name": func.__name__,                          # 関数名がそのままツール名になる
        "description": inspect.getdoc(func) or "",      # ★ docstring がそのまま LLM への説明書になる
        "parameters": {"type": "object", "properties": props, "required": required},
    }
```

- `inspect.signature` で引数の一覧を、`get_type_hints` で型の注釈を取り出す
- `Annotated[str, "説明"]` と書いた引数は、型に加えて説明文も説明書に入る。「どんな値を入れればよいか」を LLM に伝える一番の手段になる
- 既定値のない引数は「必須」として `required` に並べる

後半は、ツールを登録して実行する「道具箱」である。

```python title="agentlab/tools/registry.py（後半）" caption="ツールの登録・説明書の一覧・実行をまとめた道具箱" {28,29}
class Toolbox:
    """ツールの道具箱。登録・説明書の一覧・実行の 3 つを受け持つ。"""

    def __init__(self):
        self.funcs = {}                             # ツール名 → 関数 の辞書

    def tool(self, func):
        """@道具箱.tool と書いた関数を登録する（デコレーター）。"""
        self.funcs[func.__name__] = func
        return func                                 # 関数そのものは変えずに返す

    def __add__(self, other):
        """道具箱どうしを + で 1 つにまとめる。"""
        merged = Toolbox()
        merged.funcs = {**self.funcs, **other.funcs}
        return merged

    def schemas(self) -> list[dict]:
        """登録されている全ツールの説明書を並べて返す。"""
        return [schema_of(f) for f in self.funcs.values()]

    def run(self, call: ToolCall) -> str:
        """頼まれたツールを実行し、結果を必ず文字列で返す。"""
        func = self.funcs.get(call.name)
        if func is None:                            # 存在しないツールを頼まれた
            return f"エラー: {call.name} というツールはありません"
        try:
            return str(func(**call.arguments))      # ★ 引数の辞書を、関数の引数に展開して呼ぶ
        except Exception as e:                      # ★ 失敗してもループを止めず、理由を LLM に返す
            return f"エラー: {type(e).__name__}: {e}"
```

- 関数の上に `@道具箱.tool` と書くだけで登録される。関数そのものは変えずに返すので、普通の関数としても呼べる
- `+` で道具箱をまとめられるようにした。第 2 回でファイル操作の道具箱を足すときに使う
- `run` は、失敗しても例外を外へ投げず、**理由を文字列にして返す**。LLM はその文を読んで、引数を直したり別の手を考えたりできる

## LLM が苦手な作業をツールにする：basic.py

最初のツールは、計算と文字数の 2 つにした。LLM は文章を「トークン」という単位で扱うため、桁の多い計算や文字数を数える作業で間違えやすい。こうした作業をツールに任せると、答えが確実になる。

```python title="agentlab/tools/basic.py" caption="計算と文字数のツール。計算は eval を使わず、許した演算だけを実行する" {10,29}
"""基本のツール: 計算と文字数。どちらも LLM が間違えやすい作業。"""
import ast       # Python の式を、部品の木（構文木）に分解する標準ライブラリ
import operator  # + - * / を関数として扱う標準ライブラリ
from typing import Annotated

from .registry import Toolbox

basic = Toolbox()  # この道具箱に、下の 2 つのツールを登録する

# ★ 許す計算だけを並べる。ここに無いもの（関数の呼び出しなど）はすべて拒否する
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.USub: operator.neg}


def _evaluate(node):
    """構文木を 1 段ずつたどって計算する。"""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value                                   # ただの数字
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:  # 「左 演算子 右」の形
        return OPS[type(node.op)](_evaluate(node.left), _evaluate(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:  # -3 のようなマイナス
        return OPS[type(node.op)](_evaluate(node.operand))
    raise ValueError("使えるのは数字と + - * / ( ) だけです")


@basic.tool
def calc(expression: Annotated[str, "計算式。例: (1200+800)*1.1"]) -> str:
    """四則演算をする。金額や個数などの計算は、暗算せず必ずこのツールで行う。"""
    value = _evaluate(ast.parse(expression, mode="eval").body)  # ★ eval は使わない
    return f"{value:.10g}"  # 2200.0000000000005 のような誤差の尻尾を丸めて返す


@basic.tool
def count_chars(text: Annotated[str, "文字数を数えたい文字列"]) -> int:
    """文字数を数える。空白や記号も 1 文字として数える。"""
    return len(text)
```

- 計算に Python の `eval` を使うと、LLM が `__import__("os").system(...)` のような文字列を渡したとき、任意のコマンドが動いてしまう
- そこで `ast` で式を部品の木に分解し、**数字と + − × ÷ だけを許して**自分で計算する。許していない部品が出てきたら `ValueError` で断る
- docstring の「暗算せず必ずこのツールで行う」は、LLM への指示として働く。説明文はプロンプトの一部だと考えて書く

できた説明書は次のようになる。これがそのまま LLM に渡る。

```bash title="calc の説明書を表示した結果"
$ python -c "import json; from agentlab.tools.basic import basic; print(json.dumps(basic.schemas()[0], ensure_ascii=False, indent=2))"
{
  "name": "calc",
  "description": "四則演算をする。金額や個数などの計算は、暗算せず必ずこのツールで行う。",
  "parameters": {
    "type": "object",
    "properties": {
      "expression": {
        "description": "計算式。例: (1200+800)*1.1",
        "type": "string"
      }
    },
    "required": [
      "expression"
    ]
  }
}
```

## 心臓部のループを書く：loop.py

ここまでの部品をつなぐのがループである。ループは「LLM に聞く → ツールを頼まれたら実行して結果を足す → また聞く」を、答えが出るまで繰り返す。

```python title="agentlab/loop.py" caption="エージェントループ。往復の回数に上限を付け、結果は依頼の番号付きで返す" {12,16,21}
"""エージェントの心臓部。LLM とツールの間を、答えが出るまで往復させる。"""
from .core import LLM
from .tools.registry import Toolbox

SYSTEM = ("あなたは手元のツールを使って依頼に答えるアシスタントです。"
          "計算や文字数は推測せず、必ずツールで確かめてから答えてください。")


def run_agent(task: str, llm: LLM, toolbox: Toolbox, max_turns: int = 8) -> str:
    messages = [{"role": "system", "content": SYSTEM},  # 役割の説明
                {"role": "user", "content": task}]      # 利用者の依頼
    for turn in range(1, max_turns + 1):                # ★ 往復は最大 max_turns 回まで
        reply = llm.chat(messages, toolbox.schemas())   # 履歴と説明書を渡して、次の一手を聞く
        messages.append({"role": "assistant", "content": reply.text,
                         "tool_calls": reply.tool_calls, "raw": reply.raw})  # 返事も履歴に残す
        if not reply.tool_calls:                        # ★ ツールを頼まれなければ、それが答え
            return reply.text
        for call in reply.tool_calls:                   # 頼まれたツールを 1 つずつ実行する
            result = toolbox.run(call)
            print(f"  [{turn}回目] {call.name}({call.arguments}) -> {result}")
            messages.append({"role": "tool", "tool_call_id": call.id,  # ★ 依頼の番号を付けて返す
                             "content": result})
    return f"{max_turns} 回往復しても答えが出なかったので止めました。"
```

止まり方は 2 通りしかない。

| 止まり方 | 条件 | 意味 |
|---|---|---|
| 答えが出た | `reply.tool_calls` が空 | LLM が「もうツールは要らない」と判断した |
| 上限に達した | `max_turns` 回往復した | 同じツールを呼び続けるなど、終わらなくなった |

- LLM の返事は、ツールの依頼も含めて**丸ごと履歴に足す**。次に LLM を呼ぶとき「自分が何を頼んだか」が分からないと、届いた結果の意味が読めないからだ
- 結果には `tool_call_id` で依頼の番号を付ける。1 回の返事で複数のツールを頼まれても、どの結果がどの依頼への答えか取り違えない
- 上限がないと、LLM が同じツールを呼び続けたときに永遠に止まらず、本物の LLM ではその分だけ料金がかかる

## 動かす：__main__.py

最後に、コマンドから動かす入口を作る。`python -m agentlab` と打つと、パッケージの中の `__main__.py` が実行される。

```python title="agentlab/__main__.py" caption="コマンドの引数を依頼文にして、エージェントを走らせる" {11}
"""python -m agentlab "依頼" で動かす入口。"""
import sys  # コマンドラインの引数を受け取る標準ライブラリ

from .llm.fake import FakeLLM
from .loop import run_agent
from .tools.basic import basic

task = " ".join(sys.argv[1:])           # コマンドの後ろに書いた文字列を、依頼文にする
if not task:                            # 何も書かれていなければ使い方を出して終わる
    sys.exit('使い方: python -m agentlab "(1200+800)*1.1 を計算して"')
answer = run_agent(task, FakeLLM(), basic)  # ★ LLM・道具箱・依頼を組み合わせて走らせる
print(answer)
```

`agent-lab/` のフォルダーで実行する。

```bash title="実行結果"
$ python -m agentlab "(1200+800)*1.1 を計算して。あと「エージェント」は何文字？"
  [1回目] calc({'expression': '(1200+800)*1.1'}) -> 2200
  [1回目] count_chars({'text': 'エージェント'}) -> 6
ツールで確かめた結果です: 2200 / 6

$ python -m agentlab "こんにちは"
ツールは要らないと判断しました: こんにちは

$ python -m agentlab "10/0 を計算して"
  [1回目] calc({'expression': '10/0'}) -> エラー: ZeroDivisionError: division by zero
ツールで確かめた結果です: エラー: ZeroDivisionError: division by zero
```

> [!NOTE]
> Windows で日本語が文字化けするときは、先に `set PYTHONIOENCODING=utf-8`（PowerShell なら `$env:PYTHONIOENCODING="utf-8"`）を実行する。

1 つ目の実行で、LLM に渡った履歴は次のように積み上がっている。

| 順 | role | 中身 |
|---|---|---|
| 1 | system | 役割の説明 |
| 2 | user | (1200+800)*1.1 を計算して。あと「エージェント」は何文字？ |
| 3 | assistant | tool_calls: `call_1` calc / `call_2` count_chars |
| 4 | tool | `call_1` への結果: 2200 |
| 5 | tool | `call_2` への結果: 6 |
| 6 | assistant | ツールで確かめた結果です: 2200 / 6 |

1 回の返事で 2 つのツールを頼み、結果が番号付きで 2 通返り、次の返事で答えが出た。3 つ目の `10/0` は、ツールが失敗してもループが止まらず、失敗の理由が LLM に届いている。

## つまずきやすい所

| 症状 | 原因 | 対処 |
|---|---|---|
| いつまでも終わらない | 止める条件が「答えが出たとき」だけ | `max_turns` で往復に上限を付ける |
| API が「結果が足りない」と言う | ツールの依頼と結果の番号が対になっていない | 依頼 1 件ごとに、同じ番号の結果を 1 件足す |
| ツールのエラーで全体が落ちる | 例外をそのまま外へ投げている | `run` で受け止めて、理由を文字列で返す |
| LLM が計算を間違える | ツールの説明文に「いつ使うか」が書いていない | docstring に「暗算せず必ず使う」と書く |
| 計算ツールが危険 | 受け取った文字列を `eval` している | `ast` で許した演算だけを実行する |

## この回のチェックリスト

- [ ] `llm/`・`tools/`・ループを、変わる理由ごとに別のファイルにした
- [ ] LLM の返事を `Reply` という 1 つの形で受け取るよう決めた
- [ ] 偽 LLM で、API キーなしにループを動かせる
- [ ] ツールの説明書を関数の docstring と型の注釈から作っている
- [ ] ツールの失敗を文字列で返し、ループを止めない
- [ ] 往復の回数に上限がある
- [ ] 受け取った文字列を `eval` していない

次回は、この骨格に**本物の LLM** をつなぐ。あわせて、ファイルを読み書きするツール、失敗を LLM が直せる形で返す工夫、ログ、テストを足し、「壊れても追える」エージェントにする。

## 参考文献

- [Python Packaging User Guide, src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)（確認 2026-10-01）
- [Python ドキュメント, inspect — 活動中のオブジェクトの情報を取得する](https://docs.python.org/ja/3/library/inspect.html)（確認 2026-10-01）
- [Python ドキュメント, ast — 抽象構文木](https://docs.python.org/ja/3/library/ast.html)（確認 2026-10-01）
- [DEV, Your First Tool-Calling Agent With No Framework](https://dev.to/gabrielanhaia/your-first-tool-calling-agent-with-no-framework-just-the-bare-sdk-3ip3)（確認 2026-10-01）
- [softwaredoug, A simple agentic loop with just Python functions](https://softwaredoug.com/blog/2025/10/15/a-simple-agentic-loop-with-just-python-functions)（2025-10-15）
- [Qiita, AIエージェントを自作して、やっと「ループエンジニアリング」の意味がわかった](https://qiita.com/mi25/items/32e27c4d51f468214ec9)（2026-08-12）
- [Anthropic, Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）
