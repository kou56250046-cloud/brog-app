---
title: 長く・安全に・測りながら回す——要約・承認・部下・評価で仕上げるAIエージェント
description: 標準ライブラリだけで作る AI エージェントの最終回。長い履歴を要約に畳む仕組み、書き込みの前に人間の承認を取る仕組み、部下のエージェントをツールとして渡す構成、同じ課題を何度も解かせて pass^k を測る評価を足し、本物の LLM で売上レポートを作らせる。
date: "2026-10-01"
verified: "2026-10-01"
category: AIエージェント
tags: [AIエージェント, LLM, Python, コンテキストエンジニアリング, Human-in-the-loop, マルチエージェント, 評価, ハンズオン]
level: [advanced]
series: Pythonで作って動かすAIエージェント
status: published
---
```hero
title 長く・安全に・測りながら回すための部品を足す
group loop ループ
  L(LLM が\nツールを頼む):::llm
  SUM[履歴を要約に\n畳む]:::code
  AP{承認が要る?}:::code
  X[実行する]:::code
end
group human 人
  H{人が許可?}:::human:::hl
end
group sub 部下
  SA(部下エージェント\n= ツール 1 つ):::llm
end
L --> AP
AP -->|いいえ| X
AP -->|はい| H
H -->|許可| X
H -.->|断り| L
X -->|調べもの| SA
note SUM ツールの依頼と結果の組を壊さずに、要約へ畳む
note H 断られたら理由を返し、LLM に別の手を考えさせる
note SA 部下は結論だけを返す。全体は pass@k と pass^k で測る
```


[第 2 回](2026-10-01-agent-handson-2-practice.html)で、エージェントは本物の LLM で動き、ログとテストで追えるようになった。ただ、このままでは長い作業を任せると履歴があふれる。ファイルの上書きも LLM の判断だけで実行してしまう。しかも「たまたまうまくいった」のか「毎回うまくいく」のかが分からない。

最終回では、この 3 つを片付ける。履歴を要約に畳む仕組み、取り消しのきかない操作の前に人間の承認を取る仕組み、部下のエージェントに調べものを切り出す構成を足す。最後に、同じ課題を何度も解かせて信頼性を測る。

> [!TIP] この記事で分かること
> - 長くなった履歴を、ツールの依頼と結果の組を壊さずに要約へ畳む方法
> - 書き込みの前に人間の承認を取り、断られたら LLM に別の手を考えさせる方法
> - 部下のエージェントを「ツール 1 つ」として渡し、結論だけを受け取る構成
> - 同じ課題を k 回解かせる評価と、pass@k・pass^k の違い
> - 自作で続けるか、フレームワークへ移るかの目安

## 第 3 回で足すファイル

```text title="第 3 回を終えたときの agent-lab/（変わる所だけ）"
agent-lab/
├── agentlab/
│   ├── __main__.py           変  --team で部下付きの構成にする
│   ├── loop.py               変  要約・承認・LLM の失敗の記録を組み込む
│   ├── memory.py             新  長い履歴を要約に畳む
│   ├── approval.py           新  書き込みの前に人間が承認する
│   └── subagent.py           新  部下のエージェントをツールにする
├── tests/
│   └── test_guard.py         新  承認と要約のテスト
└── evals/
    ├── run_evals.py          新  同じ課題を k 回解かせて測る
    └── fixtures/
        └── sales.csv         新  毎回同じ状態から始めるための元データ
```

## 長い作業で履歴があふれる：要約に畳む

ループは、LLM の返事とツールの結果をすべて履歴に積み上げる。ファイルをいくつも読む作業では、すぐに何万文字にもなる。LLM が一度に読める量には上限があり、上限より手前でも、履歴が長いほど大事な情報を見落としやすくなると報告されている。

そこで、履歴が一定の長さを超えたら、**古い部分を LLM 自身に要約させて 1 通に置き換える**。最初の役割の説明と利用者の依頼、それに直近のやり取りは原文のまま残す。

```python title="agentlab/memory.py" caption="上限を超えたら、依頼と直近を残して、間を要約 1 通に置き換える" {14,25}
"""長くなった履歴の古い部分を、要約 1 通に畳む。"""
from .core import LLM

SUMMARY_PROMPT = ("次のやり取りを、この後の作業に必要な事実だけで箇条書きに要約してください。"
                  "読んだファイル名、出てきた数値、決まったこと、残っている作業を必ず残すこと。\n\n")


def size(messages: list[dict]) -> int:
    """履歴の大きさを、本文の文字数の合計で見積もる。"""
    return sum(len(str(m.get("content") or "")) for m in messages)


def safe_cut(messages: list[dict], keep_last: int) -> int:
    """畳む範囲の終わりを決める。★ ツールの依頼と、その結果の間では切らない。"""
    cut = len(messages) - keep_last
    while cut > 2 and messages[cut]["role"] == "tool":  # 結果の途中なら、依頼の位置まで戻る
        cut -= 1
    return cut


def compact(messages: list[dict], llm: LLM, limit: int = 8000, keep_last: int = 6) -> list[dict]:
    if size(messages) <= limit:                       # 上限以下なら何もしない
        return messages
    cut = safe_cut(messages, keep_last)
    old = messages[2:cut]                             # ★ 0 番の役割と 1 番の依頼は畳まずに残す
    if not old:
        return messages
    lines = [f"{m['role']}: {m.get('content') or [c.name for c in m.get('tool_calls', [])]}"
             for m in old]                            # 畳む部分を「役: 中身」の文章に並べる
    summary = llm.chat([{"role": "user", "content": SUMMARY_PROMPT + "\n".join(lines)}], tools=[])
    note = {"role": "user", "content": "（ここまでの経過の要約）\n" + summary.text}
    return messages[:2] + [note] + messages[cut:]     # 依頼 → 要約 → 直近のやり取り、の順に並べ直す
```

- 畳む範囲は `messages[2:cut]` である。0 番の役割の説明と 1 番の依頼を畳むと、エージェントは「そもそも何を頼まれたか」を見失う
- `safe_cut` は、**ツールの依頼と、その結果の間では切らない**ようにする。結果だけが残って依頼が消えると、多くの API は「対応する依頼のない結果」としてエラーを返す
- 要約の頼み方に「ファイル名・数値・残っている作業を必ず残す」と書く。何も指定しないと、作業に要る細部ほど落ちる

1 通 3000 文字のファイルを 4 回読んだ履歴を畳むと、次のようになる。

```bash title="要約する前と後"
前: 10 通 12004 文字 ['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool']
後: 7 通 6035 文字 ['system', 'user', 'user', 'assistant', 'tool', 'assistant', 'tool']
```

3 番目の `user` が要約である。その後ろは、依頼（`assistant`）と結果（`tool`）の組のまま残っている。

> [!WARNING]
> 要約は情報を捨てる操作である。数値の細部や、まだ読んでいないファイルの名前が落ちると、エージェントは同じファイルを読み直したり、違う数字で答えたりする。上限は余裕を持たせて大きめにし、畳んだことはログに残す。

## 取り消しのきかない操作の前に止める：approval.py

ファイルの上書き、メールの送信、支払いのように、やり直しのきかない操作がある。こうした操作を LLM の判断だけで実行させると、依頼の読み違いや、読んだ文書に紛れ込んだ悪意ある指示（プロンプトインジェクション）で事故が起きる。

そこで、危ないツールだけを名前で登録しておく。呼ばれたら実行の**前**に人間に内容を見せ、許可を取る。

```flow caption="危ないツールだけ、実行の前に人間が判断する。断られたら理由を LLM に返す"
A(LLM がツールを頼む) --> B{承認が要る\nツール?}
B -- いいえ --> D[実行する]
B -- はい --> C{人間が許可?}:::hl
C -- はい --> D
C -- いいえ --> E[断りの文を\n結果として返す]
D --> F([結果を LLM に返す])
E --> F
```

```python title="agentlab/approval.py" caption="承認が要るツールの一覧と、人間への問い合わせ" {4,16,21}
"""取り消しのきかないツールは、実行の前に人間の承認を取る。"""
from .core import ToolCall

RISKY = {"write_file"}  # ★ 承認が要るツールの名前。消す・送る・払うものはここに足す
DENIED = ("人間が実行を許可しませんでした。同じ操作を繰り返さず、"
          "ここまでに分かったことで答えるか、別の方法を提案してください。")


def ask_in_terminal(call: ToolCall) -> bool:
    """画面に内容を見せて y / n を聞く。y 以外はすべて「許可しない」として扱う。"""
    print(f"\n--- 承認が必要です: {call.name} ---")
    for key, value in call.arguments.items():        # 何をしようとしているかを全部見せる
        print(f"{key}:\n{value}\n")
    try:
        return input("実行してよいですか？ [y/N] ").strip().lower() == "y"
    except EOFError:                                 # ★ 答える人がいない（入力が無い）なら許可しない
        return False


def approve_all(call: ToolCall) -> bool:
    """テストと評価用。すべて許可する（★ 本番の対話では使わない）。"""
    return True


def check(call: ToolCall, approve) -> str | None:
    """承認が要るのに許可されなかったら、LLM に返す断りの文を返す。問題なければ None。"""
    if call.name in RISKY and isinstance(call.arguments, dict) and not approve(call):
        return DENIED
    return None
```

- 承認が要るツールは `RISKY` に名前で並べる。消す・送る・払うツールを足したら、ここにも足す
- 問い合わせでは、引数を**全部**見せる。「ファイルを書きます」だけで本文を見せないと、人間は中身を確かめずに許可してしまう
- `y` 以外はすべて「許可しない」にする。入力が無い環境（自動実行など）では `input()` が `EOFError` で落ちるので、これも「許可しない」に倒す。筆者の検証でも、入力を渡さずに動かしたら問い合わせの所で落ちた
- 断ったときは、実行せずに断りの文を**ツールの結果として**返す。LLM はそれを読んで、別の方法を考えるか、ここまでの結果で答える

## ループに組み込む

要約と承認を、ループに組み込む。あわせて、第 2 回のログで見つかった「計算を 1 つずつ頼んで往復が増える」問題に、システムプロンプトの 1 行で手を打つ。LLM の呼び出し自体が失敗したときも、ログに終わり方を残すようにした。

```python title="agentlab/loop.py（完成版）" caption="毎回の呼び出しの前に履歴を畳み、危ないツールは実行の前に承認を取る" {22,37}
"""エージェントの心臓部。LLM とツールの間を、答えが出るまで往復させる。"""
from . import approval
from .core import LLM
from .log import RunLog
from .memory import compact
from .tools.registry import Toolbox

SYSTEM = ("あなたは手元のツールを使って依頼に答えるアシスタントです。"
          "計算や文字数は推測せず、必ずツールで確かめてから答えてください。"
          "ファイルの中身は、読んでから答えてください。"
          "互いに関係しない計算は、1 回の返事でまとめて頼んでください。")


def run_agent(task: str, llm: LLM, toolbox: Toolbox, max_turns: int = 12,
              log: RunLog | None = None, approve=approval.ask_in_terminal) -> str:
    log = log or RunLog()
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": task}]
    log.event("start", task=task)
    for turn in range(1, max_turns + 1):
        before = len(messages)
        messages = compact(messages, llm)                 # ★ 長くなっていたら、古い部分を畳む
        if len(messages) < before:
            log.event("compact", removed=before - len(messages))
        try:
            reply = llm.chat(messages, toolbox.schemas())
        except RuntimeError as e:                         # LLM 自体が使えないときは続けられない
            log.event("end", status="llm_error", turns=turn, error=str(e)[:200])
            raise                                         # 記録だけ残して、呼び出し元に知らせる
        messages.append({"role": "assistant", "content": reply.text,
                         "tool_calls": reply.tool_calls, "raw": reply.raw})
        log.event("llm", turn=turn, text=reply.text, calls=[c.name for c in reply.tool_calls])
        if not reply.tool_calls:
            log.event("end", status="answered", turns=turn)
            return reply.text
        for call in reply.tool_calls:
            denied = approval.check(call, approve)        # ★ 実行の「前」に承認を確かめる
            result = denied or toolbox.run(call)          # 断られたら、実行せずに断りの文を返す
            log.event("tool", name=call.name, args=call.arguments, result=result,
                      error=result.startswith("エラー"), denied=bool(denied))
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    log.event("end", status="max_turns", turns=max_turns)
    return f"{max_turns} 回往復しても答えが出なかったので止めました。"
```

- システムプロンプトの最後の 1 文で、関係しない計算をまとめて頼ませる。後で見る実行例では、部下のエージェントが 6 件の計算を 1 回の返事でまとめて頼んだ
- `compact` は LLM を呼ぶ前に毎回通す。短いうちは何もしない
- 承認は `toolbox.run` より前に確かめる。実行してから聞いても、上書きされたファイルは戻らない
- LLM が使えない（`RuntimeError`）ときは、`status="llm_error"` を記録してから呼び出し元に知らせる。ログに「途中で消えた依頼」を残さないためである

## 部下のエージェントに調べものを切り出す

ファイルを読んで計算する作業は、途中経過が長い。その途中経過がすべて司令塔の履歴に積まれると、肝心の「何を書くか」の判断に使える余白が減る。

そこで、調べものを**部下のエージェント**に任せる。部下は自分の履歴の中で作業し、司令塔には結論だけを返す。部下の作り方は簡単で、`run_agent` を中で呼ぶ関数を 1 つのツールとして司令塔に渡せばよい。

```flow caption="司令塔は「部下に頼む」と「書く」だけを持つ。部下は読むことと計算しかできない"
A([利用者の依頼]) --> B(司令塔):::hl
B -- ask_researcher --> C(部下\n読む・計算する)
C -- 結論だけ --> B
B -- write_file --> D{人間の承認}
D --> E([report.md])
```

```python title="agentlab/subagent.py" caption="部下のエージェントを、ask_researcher という 1 つのツールにする" {14,25}
"""部下のエージェントを、司令塔から使える 1 つのツールにする。"""
from typing import Annotated

from . import approval
from .core import LLM
from .log import RunLog
from .loop import run_agent
from .tools.basic import basic
from .tools.files import files
from .tools.registry import Toolbox


def make_researcher(llm: LLM, log: RunLog) -> Toolbox:
    reader = Toolbox()                                   # ★ 部下には「読む」ツールしか渡さない
    reader.funcs = {name: files.funcs[name] for name in ("list_files", "read_file")}
    team = Toolbox()

    @team.tool
    def ask_researcher(request: Annotated[str, "調べてほしいこと。目的と、返してほしい形も書く"]) -> str:
        """workspace のファイルを読んで調べ、計算する部下に仕事を頼む。部下は書き込みはしない。
        返ってくるのは調べた結果の要約だけ。"""
        answer = run_agent(request, llm, basic + reader, max_turns=10,
                           log=log.child("researcher"),       # 記録は親子が分かる番号で残す
                           approve=approval.approve_all)       # 部下は危険なツールを持たない
        return answer[:2000]                             # ★ 部下の途中経過は捨て、結論だけを返す

    return team
```

- 部下には `list_files` と `read_file` と計算しか渡さない。読んだ文書に「ファイルを消せ」と書かれていても、部下にはその手段がない
- 書き込みは司令塔だけが持ち、そこに承認が掛かる。**危ない権限を持つ者を 1 か所にする**と、承認の漏れが起きにくい
- 部下の答えは 2000 文字で切る。部下が何を読み、何回計算したかは司令塔の履歴に入らない
- 記録は `log.child("researcher")` で、`親の番号/researcher` という番号で残す。後で親子の関係をたどれる

> [!NOTE]
> 部下を増やすと、LLM の呼び出し回数とトークン（料金の単位）も増える。複数のエージェントに分けるのは、1 体では履歴があふれる、または権限を分けたいときに限るのがよい。判断の目安は「[複数Agentは最後の手段](2026-09-29-agent-parts-6-multi-agent.html)」に書いた。

入口では、`--team` が付いたときだけ部下付きの構成にする。

```python title="agentlab/__main__.py（完成版）" caption="--team を付けると、司令塔は部下と書き込みだけを持つ" {18}
"""python -m agentlab "依頼" で動かす入口。--team で部下付きの構成にする。"""
import sys

from .llm import make_llm
from .log import RunLog
from .loop import run_agent
from .subagent import make_researcher
from .tools.basic import basic
from .tools.files import files

args = sys.argv[1:]
team_mode = "--team" in args                     # --team が付いていたら部下付きにする
task = " ".join(a for a in args if a != "--team")
if not task:
    sys.exit('使い方: python -m agentlab [--team] "sales.csv を集計して report.md にまとめて"')

llm, log = make_llm(), RunLog()
if team_mode:                                    # ★ 司令塔は「部下に頼む」と「書く」だけを持つ
    tools = make_researcher(llm, log)
    tools.funcs["write_file"] = files.funcs["write_file"]  # 書く道具は司令塔だけが持つ
else:
    tools = basic + files
print(run_agent(task, llm, tools, log=log))
```

本物の LLM で、売上レポートを作らせてみる。承認の問い合わせには `y` と答えた。

```bash title="実行結果（本物の LLM。抜粋、文面は実行ごとに変わる）"
$ python -m agentlab --team "sales.csv を集計して、商品ごとの 8 月と 9 月の売上（個数×単価）と前月比を表にまとめ、report.md に書いて"
  [start] task='sales.csv を集計して、商品ごとの 8 月と 9 月の売上（個数×単価）と前月比を表にまとめ、report.md'
  [llm] turn='1', text='', calls="['ask_researcher']"
  [start] task='sales.csv の中身を読み込み、商品ごとの8月と9月の売上（個数×単価）、および前月比（'
  [llm] turn='1', text='', calls="['list_files']"
  [llm] turn='2', text='', calls="['read_file']"
  [llm] turn='3', text='', calls="['calc', 'calc', 'calc', 'calc', 'calc', 'calc']"
  [llm] turn='4', text='', calls="['calc', 'calc', 'calc']"
  [llm] turn='5', text='sales.csv のデータをもとに、商品ごとの8月と9月の売上（個数×単価）および前月比を計算し…', calls='[]'
  [end] status='answered', turns='5'
  [tool] name='ask_researcher', args="{'request': 'sales.csv の中身を読み込み、…'}", result='sales.csv のデータをもとに、…', error='False', denied='False'
  [llm] turn='2', text='', calls="['write_file']"

--- 承認が必要です: write_file ---
path:
report.md

content:
# 8月・9月 商品別売上レポート
…（本文の全体がここに表示される）

実行してよいですか？ [y/N] y
  [tool] name='write_file', args="{'path': 'report.md', 'content': '# 8月・9月 商品別売上レポート…'}", result='report.md に 644 文字を書きました', error='False', denied='False'
  [llm] turn='3', text='sales.csv を集計し、商品ごとの8月・9月の売上と前月比を計算して `report.md` にまとめました。', calls='[]'
  [end] status='answered', turns='3'
```

できた `report.md` の表は次のとおりで、数値はすべて正しかった。

| 商品 | 8月売上 (円) | 9月売上 (円) | 前月比 (9月/8月) | 増減率 |
| :--- | ---: | ---: | ---: | ---: |
| ノート | 42,000 | 52,500 | 1.25 | +25.0% |
| ペン | 36,000 | 31,200 | 0.87 | -13.3% |
| 付箋 | 16,000 | 22,000 | 1.38 | +37.5% |

司令塔は 3 往復で済み、その履歴には部下の 9 回の計算は入っていない。部下は 6 件の売上の計算を 1 回の返事でまとめて頼み、次の返事で前月比 3 件をまとめて頼んだ。

> [!NOTE] 実際に起きた失敗
> 無料枠で何度も試していると、部下の呼び出しが `429`（使用量の上限超え）で失敗した。そのエラー文はツールの結果として司令塔に届き、司令塔は依頼を簡単にして頼み直した。さらに、司令塔自身の呼び出しが `503`（混雑）で失敗したときは、やり直しても通らず、プログラムが止まった。このとき、ログに終わり方が残っていなかった。これが、ループに `llm_error` の記録を足した理由である。

## 守りが効いているかをテストする

承認と要約は、普段の実行では働く場面が少ない。そのため、壊れていても気づきにくい。偽 LLM で、わざとその場面を作ってテストしておく。

```python title="tests/test_guard.py" caption="断られた書き込みが実行されないこと、要約が依頼と結果の組を壊さないことを確かめる" {23,36}
"""第 3 回で足した守り（承認・履歴の圧縮）のテスト。"""
import os
import tempfile
import unittest

from agentlab import approval
from agentlab.core import Reply, ToolCall
from agentlab.llm.fake import ScriptedLLM
from agentlab.log import RunLog
from agentlab.loop import run_agent
from agentlab.memory import compact
from agentlab.tools.files import files

TMP = tempfile.mkdtemp()


class GuardTest(unittest.TestCase):
    def test_denied_write_is_not_executed(self):
        os.environ["AGENTLAB_WORKSPACE"] = TMP
        write = ToolCall("w1", "write_file", {"path": "report.md", "content": "…"})
        llm = ScriptedLLM([Reply(tool_calls=[write]), Reply(text="書くのをやめました")])
        run_agent("書いて", llm, files, log=RunLog(os.path.join(TMP, "l.jsonl"), echo=False),
                  approve=lambda call: False)                   # ★ 人間が「いいえ」と答えた想定
        self.assertFalse(os.path.exists(os.path.join(TMP, "report.md")))  # ファイルは作られていない
        self.assertEqual(llm.seen[1][-1]["content"], approval.DENIED)     # 断りの文が LLM に届いた

    def test_compact_never_splits_call_and_result(self):
        big = "x" * 500                                          # 1 通 500 文字の重い結果
        messages = [{"role": "system", "content": "役割"}, {"role": "user", "content": "依頼"}]
        for i in range(4):                                       # 依頼 → 結果 の組を 4 回積む
            call = ToolCall(f"c{i}", "read_file", {"path": "a.txt"})
            messages += [{"role": "assistant", "content": "", "tool_calls": [call]},
                         {"role": "tool", "tool_call_id": f"c{i}", "content": big}]
        result = compact(messages, ScriptedLLM([Reply(text="要約")]), limit=1000, keep_last=3)
        self.assertEqual([m["role"] for m in result[:3]], ["system", "user", "user"])
        self.assertEqual(result[3]["role"], "assistant")         # ★ 要約の直後は依頼側から始まる


if __name__ == "__main__":
    unittest.main()
```

```bash title="実行結果"
$ python -m unittest -v
test_compact_never_splits_call_and_result (tests.test_guard.GuardTest.test_compact_never_splits_call_and_result) ... ok
test_denied_write_is_not_executed (tests.test_guard.GuardTest.test_denied_write_is_not_executed) ... ok
test_bad_arguments_are_reported (tests.test_loop.LoopTest.test_bad_arguments_are_reported) ... ok
test_result_goes_back_with_same_id (tests.test_loop.LoopTest.test_result_goes_back_with_same_id) ... ok
test_stops_at_max_turns (tests.test_loop.LoopTest.test_stops_at_max_turns) ... ok
test_unknown_tool_is_reported (tests.test_loop.LoopTest.test_unknown_tool_is_reported) ... ok
test_workspace_escape_is_rejected (tests.test_loop.LoopTest.test_workspace_escape_is_rejected) ... ok

----------------------------------------------------------------------
Ran 7 tests in 0.017s

OK
```

## 何回やっても正しく動くかを測る

テストで確かめられるのは「配線」までで、LLM の判断が正しいかは分からない。しかも本物の LLM は毎回違う動きをするので、1 回うまくいっただけでは信用できない。そこで、**同じ課題を k 回ずつ解かせて**、成功の割合を見る。

成功の数え方は 2 通りある。

| 指標 | 意味 | 向いている場面 |
|---|---|---|
| pass@k | k 回のうち 1 回でも成功したか | 人間が結果を選べる。候補を出す用途 |
| pass^k | k 回すべて成功したか | 毎回そのまま使われる。業務の自動化 |

エージェントに仕事を任せるなら、見るべきは pass^k である。「3 回に 1 回は間違える」エージェントは、pass@3 では満点に見える。

```python title="evals/run_evals.py" caption="課題ごとに k 回解かせ、合否をプログラムで判定して、pass@k と pass^k を出す" {15,23,28,42}
"""同じ課題を k 回ずつ解かせ、pass@k と pass^k を測る。使い方: python -m evals.run_evals 3"""
import os
import shutil       # フォルダーを丸ごと複製する標準ライブラリ
import sys
import tempfile
from pathlib import Path

from agentlab import approval
from agentlab.llm import make_llm
from agentlab.log import RunLog
from agentlab.loop import run_agent
from agentlab.tools.basic import basic
from agentlab.tools.files import files

FIXTURES = Path(__file__).parent / "fixtures"  # ★ 毎回まったく同じ状態から始めるための元データ
WORD = "スーパーカリフラジリスティックエクスピアリドーシャス"


def digits(text: str) -> str:
    return text.replace(",", "")               # 「105,700」も「105700」も同じとみなす


TASKS = [  # (名前, 依頼, 合否を決める関数)。★ 判定は LLM ではなくプログラムで書く
    ("計算", "(1200+800)*1.1 は？", lambda ans, ws: "2200" in digits(ans)),
    ("文字数", f"「{WORD}」は何文字？", lambda ans, ws: str(len(WORD)) in ans),
    ("読む", "sales.csv の 9 月の売上合計（個数×単価）は？", lambda ans, ws: "105700" in digits(ans)),
    ("書く", "sales.csv の 8 月の売上合計を total.txt に数字だけで書いて",  # 答えの文ではなく、
     lambda ans, ws: (ws / "total.txt").is_file()                          # ★ できたファイルを確かめる
     and digits((ws / "total.txt").read_text(encoding="utf-8")).strip() == "94000"),
]


def trial(task: str, check, llm) -> str:
    """1 回だけ解かせて pass / fail / error を返す。"""
    ws = Path(tempfile.mkdtemp())                       # 使い捨ての workspace を作り、
    shutil.copytree(FIXTURES, ws, dirs_exist_ok=True)   # 元データを複製する
    os.environ["AGENTLAB_WORKSPACE"] = str(ws)
    try:
        answer = run_agent(task, llm, basic + files, log=RunLog("logs/evals.jsonl", echo=False),
                           approve=approval.approve_all)  # 評価中は人間を待たない
    except RuntimeError:
        return "error"                                  # ★ 通信の失敗は「不正解」と分けて数える
    return "pass" if check(answer, ws) else "fail"


def main(k: int):
    llm = make_llm()
    for name, task, check in TASKS:
        results = [trial(task, check, llm) for _ in range(k)]  # 同じ課題を k 回
        passed = [r == "pass" for r in results]
        print(f"{name}\t{' '.join(results)}\tpass@{k}={any(passed)}\tpass^{k}={all(passed)}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 3)
```

- 毎回、元データを使い捨ての workspace に複製してから始める。前の回で書いたファイルが残っていると、次の回の結果が正しく測れない
- 合否は LLM に聞かず、**プログラムで判定する**。「書く」課題は、答えの文ではなく、実際にできたファイルの中身を確かめる
- 通信の失敗は `error` として、不正解の `fail` と分けて数える。混ぜると、LLM が間違えたのか、サービスが混んでいたのかが分からない

偽 LLM と本物の LLM で、それぞれ 3 回ずつ解かせた。

```bash title="実行結果"
$ python -m evals.run_evals 3                 # 偽 LLM
計算	pass pass pass	pass@3=True	pass^3=True
文字数	pass pass pass	pass@3=True	pass^3=True
読む	fail fail fail	pass@3=False	pass^3=False
書く	fail fail fail	pass@3=False	pass^3=False

$ AGENTLAB_LLM=openai_compat python -m evals.run_evals 3   # 本物の LLM（接続先などの環境変数は設定済み）
計算	pass pass pass	pass@3=True	pass^3=True
文字数	pass pass pass	pass@3=True	pass^3=True
読む	pass pass pass	pass@3=True	pass^3=True
書く	pass pass pass	pass@3=True	pass^3=True
```

偽 LLM は、規則にない「読む」「書く」で失敗する。評価の仕組みが、できていないことを正しく「できていない」と判定している確認になる。

評価があると、構成を変えたときの影響を数字で比べられる。試しに、道具箱から `count_chars` を外し、計算ツールだけを渡して「文字数」の課題を 5 回解かせた。

| 構成 | 正解（26 文字） | LLM が答えた文字数 |
|---|---|---|
| `count_chars` あり | 3 / 3 | 26 |
| `count_chars` なし | 0 / 5 | 23〜27 とばらつく |

ツールがないと、LLM は 1 文字ずつ分解して数えようとし、毎回違う数を答えた。中には「Python などで数えると 23 文字」と、実際にはしていない計算をしたかのように書いた答えもあった。書き込みのツールを渡した状態では、単語をファイルに書いてから数えようとした。**ツールの有無と説明文は、評価の数字で確かめてから決める。**

> [!NOTE]
> この評価は課題が 4 つ、試行は 3 回ずつしかない。モデルを選ぶ根拠にするには少なすぎる。実際の業務で使うなら、失敗した事例を課題として足し続け、モデルやプロンプトを変えるたびに流す。

## 自作で続けるか、フレームワークに移るか

3 回で作った `agent-lab/` は、標準ライブラリだけで、コメントを含めて約 650 行である。ループ・ツール・窓口・ログ・テスト・承認・要約・部下・評価がそろった。中身が見えるので、何が起きているかを自分で追える。

一方で、次のものが要るようになったら、フレームワークや既製の仕組みに移ることを考える時期である。

| 欲しくなったもの | 自作で続ける場合の手間 | 移るなら探す機能 |
|---|---|---|
| 途中で止めて、翌日に続きから再開 | 履歴と進み具合をすべて保存・復元する | 状態の永続化・チェックポイント |
| 承認を待つ間、プログラムを止めておく | 承認待ちの状態を保存し、別の画面から再開する | 中断と再開（human-in-the-loop） |
| 社内の多数のツールにつなぐ | 1 つずつ窓口を書く | MCP などの標準の接続方式 |
| 処理の流れを図で見たい | ログから自分で組み立てる | トレースの可視化 |
| 何十種類もの LLM を切り替える | 形式ごとに窓口を書く | 多数のサービスに対応した共通の口 |

移った後も、この連載で書いた考え方はそのまま使える。依頼と結果を番号で対にする、返事を作り直さずに返す、危ないツールの前で止める、エラー文に次の一手を書く、pass^k で測る、の 5 つである。フレームワークはこれらを代わりに書いてくれるだけで、決めるのは使う側である。

## 連載全体のチェックリスト

- [ ] 第 1 回: 型・偽 LLM・ツールの登録・ループを、変わる理由ごとに別のファイルにした
- [ ] 第 1 回: 往復に上限があり、ツールの失敗でループが止まらない
- [ ] 第 2 回: サービス固有の書き方は窓口の 1 ファイルにあり、返事は作り直さずに返す
- [ ] 第 2 回: ファイル操作は workspace の中だけで、エラー文に次の一手が書いてある
- [ ] 第 2 回: 1 回の依頼をログで追え、偽 LLM のテストがキーなしで通る
- [ ] 第 3 回: 履歴を畳むとき、依頼とツールの結果の組を壊さない
- [ ] 第 3 回: 取り消しのきかないツールは実行の前に承認を取り、答える人がいなければ断る
- [ ] 第 3 回: 部下には必要な権限だけを渡し、結論だけを受け取る
- [ ] 第 3 回: 同じ課題を k 回解かせ、pass^k で信頼性を測っている

## 参考文献

- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）
- [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)（2025-06-13）
- [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026-01）
- [OWASP Gen AI Security Project, LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)（確認 2026-10-01）
- [Sumers et al., Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)（TMLR 2024）
- [Cemri et al., Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)（NeurIPS 2025）
- [Google AI for Developers, Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)（確認 2026-10-01）
- [Qiita, AIエージェントを自作して、やっと「ループエンジニアリング」の意味がわかった](https://qiita.com/mi25/items/32e27c4d51f468214ec9)（2026-08-12）
