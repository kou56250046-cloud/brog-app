---
title: 「一度に答えない」エージェントの作り方：Planning と State で複数ステップを回す
description: 顧客を調べ、売上を集め、比較してレポートにする。複数の Tool を順番に使う仕事を、計画（Planning）・計画の検査・進捗の保存（State）・失敗時の再計画で回す方法を、依存ゼロの Python で動かしながら解説する。ReAct と Plan-and-Execute の使い分けも整理する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, LLM, Python, Planning, 状態管理]
level: [practice]
series: AIエージェントの構成要素
status: published
---
```hero
title 一度に答えず、計画を検査してから 1 歩ずつ進める
U([依頼]):::human
group llm LLM が考える
  P(計画を立てる):::llm
  RP(失敗した所だけ\n書き直す):::llm
end
group code プログラムが守る
  C{計画を検査}:::code
  X[1 歩ずつ実行]:::code:::hl
  S[進捗を保存]:::data
end
U --> P --> C
C -->|問題なし| X --> S
C -.->|問題あり| P
X -.->|失敗| RP
RP --> X
note C LLM が書いた計画を、実行前にプログラムで検査する
note S 進捗をファイルに残し、途中から再開できるようにする
note RP 失敗したステップだけ書き直し、同じ処理の繰り返しは止める
```


「青葉商事と北斗製作所の売上を比べて、レポートにして」。人間なら当たり前にこなす依頼だが、エージェントにとっては 1 回の Tool 呼び出しでは終わらない。顧客を調べ、売上を集め、比べて、文章にする。途中で 1 つでも失敗すれば、全体が崩れる。

連載の第 2 話では、段階②の入り口にあたる 4 つの部品を扱う。**複数 Tool・複数ステップ・Planning・State 管理**だ。依存ゼロの Python で、計画を立てて検査し、進捗を保存しながら実行し、失敗したら計画を直すところまで作る。

> [!TIP] この記事で分かること
> - 複数ステップの仕事で、エージェントがどこで崩れやすいか
> - 1 歩ずつ考える ReAct と、先に計画を立てる Plan-and-Execute の使い分け
> - LLM が書いた計画を、実行する前に検査する方法
> - 進捗をファイルに残し、途中から再開できるようにする State 管理
> - 失敗したステップだけを書き直す再計画と、同じ処理の繰り返しを止める見張り

第 1 話「[AIエージェントは16の部品でできている](2026-09-29-agent-parts-1-map.html)」で作った段階①のエージェントの続きになる。コードの読み方も第 1 話と同じで、ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

## 1 回で答えられない依頼は、どこで崩れるか

冒頭の依頼を分解すると、6 つのステップになる。後ろのステップは、前のステップの結果を材料に使う。

```flow caption="売上比較の依頼を分解した 6 ステップ。矢印は「前の結果を使う」関係"
A[s1 青葉商事の\nIDを調べる] --> C[s3 青葉商事の\n売上を取る]
B[s2 北斗製作所の\nIDを調べる] --> D[s4 北斗製作所の\n売上を取る]
C --> E[s5 2社を比べる]:::hl
D --> E
E --> F([s6 レポートにする])
```

このような仕事で、エージェントがつまずく場所はおおむね決まっている。

| 崩れ方 | 例 | 防ぐ部品 |
|---|---|---|
| 順番を間違える | 顧客 ID を調べる前に売上を取ろうとする | Planning ＋計画の検査 |
| 途中で落ちて最初からやり直す | 5 ステップ目で接続が切れ、1 から全部やり直す | State 管理 |
| 1 か所の失敗で全体を諦める | 社名の表記ゆれで止まり、そのまま終わる | 再計画 |
| 同じことを繰り返す | 同じ検索を何度も投げ続ける | 繰り返しの見張り |
| 目的から逸れていく | 途中で見つけた別の話題を調べ始める | Planning（計画が目的を固定する） |

最後の 2 つは、複数のエージェントを使う仕組みでも頻出する。2025 年の研究（MAST）は、複数エージェントの実行記録 150 件を分析し、失敗の中で最も多かったのが「同じステップの繰り返し」だったと報告している。1 体のエージェントでも、同じ対策が効く。

## ReAct と Plan-and-Execute：いつ計画を立てるか

複数ステップの進め方には、大きく 2 つの流派がある。

- **ReAct**：考える → 行動する → 結果を見る、を 1 歩ずつ繰り返す。2022 年の論文で広まった方式で、既存記事で作ったエージェントループはこの形だ
- **Plan-and-Execute**：先に全体の計画を立て、実行役がステップを順に実行する。うまくいかなければ計画役に戻って計画を直す

| 観点 | ReAct（1 歩ずつ） | Plan-and-Execute（先に計画） |
|---|---|---|
| 次の手を決めるタイミング | 毎回、直前の結果を見てから | 最初にまとめて |
| 想定外の結果への強さ | 強い。すぐ次の手を変えられる | 再計画の仕組みが要る |
| 目的から逸れにくいか | 長くなると逸れやすい | 計画が目的を固定するので逸れにくい |
| LLM の呼び出し回数 | ステップごとに毎回 | 計画時と再計画時が中心 |
| 人間が事前に確認できるか | できない（進みながら決まる） | できる（計画を見せて承認をもらえる） |
| 向いている仕事 | 数手で終わる調査、手順が読めない問題 | 手順は読めるがステップが多い定型業務 |

Plan-and-Execute には、セキュリティ上の利点もある。計画を先に固めるので、実行中に読んだ Web ページやメールに「別の操作をしろ」という指示が紛れ込んでいても、行動が乗っ取られにくい。2025 年に公開された論文は、この性質を安全なエージェントの設計に使うことを提案している。

どちらか一方に決める必要はない。**計画は先に立て、各ステップの中では ReAct で細かく動く**、という組み合わせもよく使われる。この記事では、違いが見えやすい Plan-and-Execute で作る。

## 複数 Tool：結果を次に渡せる形で返す

複数の Tool を順番に使うには、**前の Tool の結果を、次の Tool がそのまま使える形で返す**必要がある。第 1 話の Tool は結果を文章で返していたが、ここでは辞書やリストで返すように変える。

```python title="sales_tools.py" caption="結果を辞書やリストで返す Tool。次のステップが中身を取り出せる"
# 練習用のデータ。本番なら顧客 DB と売上 DB から引く
CUSTOMERS = {"青葉商事": "C001", "北斗製作所": "C002"}  # 顧客名 → 顧客 ID
SALES = {"C001": [300, 280, 310, 330], "C002": [180, 200, 210, 240]}  # 顧客 ID → 月ごとの売上（万円）


def get_customer(name: str) -> dict:
    """顧客名から顧客 ID を調べる。見つからなければエラーにする。"""
    if name not in CUSTOMERS:  # 登録されていない名前なら
        raise LookupError(f"顧客「{name}」は見つかりません。登録名: {list(CUSTOMERS)}")  # 候補も添える
    return {"id": CUSTOMERS[name], "name": name}  # ★ 結果は辞書で返す。次のステップが中身を使えるように


def get_sales(customer_id: str) -> list[int]:
    """顧客 ID から、直近 4 か月の売上を返す。"""
    return SALES[customer_id]


def compare(a: list[int], b: list[int]) -> dict:
    """2 社の売上を比べる。計算は LLM にさせず、プログラムで行う。"""
    growth = lambda s: round((s[-1] - s[0]) / s[0] * 100, 1)  # 最初の月から最後の月までの伸び率（%）
    return {"total_a": sum(a), "total_b": sum(b), "growth_a": growth(a), "growth_b": growth(b)}


def make_report(comparison: dict) -> str:
    """比較結果を、人が読む短いレポートにする。"""
    c = comparison  # 名前が長いので短く呼ぶ
    return (f"4か月合計 A社 {c['total_a']}万円 / B社 {c['total_b']}万円。"
            f"伸び率 A社 {c['growth_a']}% / B社 {c['growth_b']}%。")


# Tool の名前と実体の対応表
TOOLS = {"get_customer": get_customer, "get_sales": get_sales, "compare": compare, "make_report": make_report}
```

`get_customer` は `{"id": "C001", "name": "青葉商事"}` のような辞書を返す。次の `get_sales` は、その中の `id` を取り出して使う。

もう 1 つの要点は `compare` だ。**合計や伸び率の計算は LLM にさせず、プログラムで行う**。LLM は計算を間違えることがあり、しかも間違えたことに気づきにくい。数字を扱う処理は Tool にしておけば、同じ入力には毎回同じ答えが返る。

## Planning：計画を書かせ、実行する前に検査する

計画は、LLM に**決まった書式の JSON**で書かせる。各ステップに ID・使う Tool・引数を持たせ、前のステップの結果は `$s1.id`（s1 の結果の `id`）のような参照で書く。

```python title="planner.py" caption="計画を書く偽 LLM と、実行前に計画を検査する関数"
from sales_tools import TOOLS  # 使える Tool の一覧


def fake_plan(task: str) -> list[dict]:
    """練習用の偽 LLM。本物には「使える Tool」と「計画の書式」を渡し、JSON で計画を書かせる。"""
    return [
        {"id": "s1", "tool": "get_customer", "args": {"name": "青葉商事"}},
        {"id": "s2", "tool": "get_customer", "args": {"name": "北斗製作"}},  # わざと社名を間違えている
        {"id": "s3", "tool": "get_sales", "args": {"customer_id": "$s1.id"}},  # ★ $s1.id は「s1 の結果の id」
        {"id": "s4", "tool": "get_sales", "args": {"customer_id": "$s2.id"}},
        {"id": "s5", "tool": "compare", "args": {"a": "$s3", "b": "$s4"}},  # s3 と s4 の結果を比べる
        {"id": "s6", "tool": "make_report", "args": {"comparison": "$s5"}},
    ]


def check_plan(plan: list[dict]) -> list[str]:
    """★ 実行する前に計画を検査する。LLM が書いた計画をそのまま信じない。"""
    problems, seen = [], set()  # 見つけた問題と、ここまでに出てきたステップ ID
    for step in plan:
        if step["tool"] not in TOOLS:  # 存在しない Tool を使おうとしていないか
            problems.append(f"{step['id']}: 未知の Tool {step['tool']}")
        for value in step["args"].values():  # 引数を 1 つずつ見る
            ref = str(value)[1:].split(".")[0] if str(value).startswith("$") else None  # "$s1.id" → "s1"
            if ref and ref not in seen:  # まだ実行されていないステップの結果を使おうとしていないか
                problems.append(f"{step['id']}: まだ実行していない {ref} の結果を使っている")
        seen.add(step["id"])  # このステップは検査済み
    return problems  # 空なら問題なし
```

`fake_plan` は練習用の偽 LLM で、決まった計画を返す。本物の LLM には、使える Tool の説明と計画の書式を渡し、この形の JSON を書かせる。ここでは、わざと 2 つ目の社名を「北斗製作」と間違えさせてある。あとで再計画を試すためだ。

`check_plan` が、この章の要点だ。**LLM が書いた計画をそのまま実行せず、先に機械的に検査する**。見ているのは次の 2 点だ。

| 検査 | 見つけるもの | 例 |
|---|---|---|
| Tool が実在するか | 存在しない Tool の名前 | `send_mail`（本当は `draft_email`） |
| 参照の順番 | まだ実行していないステップの結果を使っている | s1 の引数に `$s2.id` を書いている |

わざと壊した計画を渡すと、次のように問題が返る。

```bash title="壊れた計画を検査した結果"
['s1: まだ実行していない s2 の結果を使っている', 's3: 未知の Tool send_mail']
```

問題が見つかったら、実行せずにこの文を LLM に返して書き直させる。**実行してから失敗するより、実行前に弾く方が安い**。書き込みや送信を含む計画なら、なおさらだ。

> [!TIP] 計画は人間に見せる場所としても使える
> 計画は JSON なので、実行前に一覧として人間に見せられる。「この 6 ステップで進めます。よろしいですか」と確認を挟めば、第 5 話で扱う Human 承認の入口になる。

## State 管理：どこまで終わったかをファイルに残す

長い処理の途中で、プログラムが落ちることがある。ネットワークが切れる、PC がスリープする、API の利用上限に当たる、といった理由だ。進捗を覚えていなければ、最初からやり直すしかない。

**State（状態）** は、エージェントが「今どこまで処理したか」を表すデータだ。この記事では次の 3 つを持たせる。

| 項目 | 中身 | 例 |
|---|---|---|
| `task` | 元の依頼 | 「2 社の売上を比べてレポートにして」 |
| `steps` | 各ステップと、その状態 | s1: done / s2: running / s3: pending |
| `results` | 終わったステップの結果 | s1 → `{"id": "C001", ...}` |

ステップの状態は `pending`（未実行）→ `running`（実行中）→ `done`（完了）か `failed`（失敗）と進む。

```python title="state_runner.py" caption="進捗を 1 ステップごとにファイルへ保存し、終わったステップを飛ばして再開する"
import json, os  # json: データを文字にして保存する道具 / os: ファイルの有無を調べる道具
from sales_tools import TOOLS

STATE_FILE = "state.json"  # ★ 進捗を書き出すファイル。処理が落ちても、ここから再開できる


def load_state(task: str, plan: list[dict]) -> dict:
    """保存済みの進捗があれば読み込み、無ければ新しく作る。"""
    if os.path.exists(STATE_FILE):  # 前回の続きがあるなら
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)  # ファイルから読み戻す
    steps = [dict(step, status="pending") for step in plan]  # 全ステップを「未実行」にする
    return {"task": task, "steps": steps, "results": {}}  # results: ステップ ID → 結果


def save_state(state: dict) -> None:
    """★ 1 ステップ終わるごとに進捗を書き出す。"""
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)  # 日本語をそのまま読める形で保存する


def resolve(value, results: dict):
    """"$s1.id" のような参照を、実際の結果に置き換える。"""
    if not (isinstance(value, str) and value.startswith("$")):  # 参照でなければ、そのまま使う
        return value
    step_id, _, key = value[1:].partition(".")  # "$s1.id" → "s1" と "id" に分ける
    result = results[step_id]  # s1 の結果を取り出す
    return result[key] if key else result  # 項目名があればその項目、無ければ結果まるごと


def run_plan(state: dict) -> dict:
    """未実行のステップを上から順に実行する。失敗したらそこで止める。"""
    for step in state["steps"]:
        if step["status"] == "done":  # ★ 終わったステップは飛ばす（再開したときに二重に実行しない）
            continue
        step["status"] = "running"  # 実行中の印を付ける
        args = {k: resolve(v, state["results"]) for k, v in step["args"].items()}  # 参照を中身に置き換える
        try:
            state["results"][step["id"]] = TOOLS[step["tool"]](**args)  # Tool を実行して結果を残す
            step["status"] = "done"  # 完了の印
        except Exception as e:  # 失敗したら
            step["status"], step["error"] = "failed", str(e)  # 失敗の印と理由を残す
            save_state(state)
            return state  # ここで止め、再計画に回す
        save_state(state)  # 1 ステップごとに保存する
    return state
```

`run_plan` は、ステップを上から順に実行する。★ の付いた 2 か所が State 管理の中心だ。

**1. 1 ステップ終わるごとに保存する。** `save_state` で `state.json` に書き出すので、どこで落ちても、最後に終わったステップまでは記録が残る。

**2. 終わったステップは飛ばす。** 再開したとき `status` が `done` のステップは実行しない。すでに取った売上を取り直さずに済み、メール送信のような操作が二重に走ることも防げる。

`resolve` は、`"$s1.id"` のような参照を実際の値に置き換える関数だ。結果を `results` にまとめて持っているので、後ろのステップは前の結果を ID で取り出せる。

> [!WARNING] 「実行中」のまま落ちたステップに注意する
> Tool を実行した直後、`done` を保存する前に落ちると、そのステップは `running` のまま残る。読み取りならやり直せば済む。しかし送信や登録だと、再開したときに二重に実行されるおそれがある。書き込みの Tool は、同じ操作を 2 回受けても 1 回分しか効かないように作っておく必要がある。これを冪等性（べきとうせい）と呼び、第 4 話で扱う。

### フレームワークでの呼び名

State を保存して再開する仕組みは、エージェント用のフレームワークにも用意されている。呼び名は違うが、考え方は同じだ。

| 呼び名 | 意味 |
|---|---|
| チェックポイント | ある時点の State を保存したもの |
| 永続実行（durable execution） | 落ちても保存点から自動で再開する実行方式 |
| 中断と再開（suspend / resume） | 人間の承認待ちなどで止め、後から続きを実行する |

保存する単位はフレームワークによって違う。処理の節目（ノード）ごとに保存するものもあれば、外部を呼ぶ処理 1 回ごとに保存するものもある。どの単位で保存されるかは、再開したときに**どこからやり直しになるか**を決めるので、使う前に確かめておく。

## 再計画：失敗したステップだけを書き直す

計画には、「北斗製作」のような誤りが混ざることがある。失敗したら、エラーの内容を LLM に見せて**残りの計画を書き直させる**。これが再計画だ。

```flow caption="計画・検査・実行・再計画の流れ"
A([依頼]) --> B(計画を立てる):::hl
B --> C{計画の検査}
C -- 問題あり --> B
C -- 問題なし --> D[1ステップずつ実行\n進捗を保存]
D --> E{失敗した?}
E -- はい --> F(失敗したステップを\n書き直す)
F --> D
E -- いいえ --> G([結果を返す])
```

```python title="replan.py" caption="失敗したら、そのステップだけを書き直して続きから実行する"
from planner import check_plan, fake_plan
from state_runner import load_state, run_plan, save_state


def fake_replan(state: dict) -> list[dict]:
    """練習用の偽 LLM。本物には「終わったステップ」「失敗したステップと理由」を渡し、残りを書き直させる。"""
    failed = next(s for s in state["steps"] if s["status"] == "failed")  # 失敗したステップを探す
    fixed = dict(failed, args={"name": "北斗製作所"}, status="pending")  # エラー文の登録名を見て社名を直す
    fixed.pop("error")  # 失敗の理由は消す
    return [fixed]  # 直したステップだけ返す


def run_with_replan(task: str, max_replans: int = 2) -> str:
    plan = fake_plan(task)  # ① 計画を立てる
    if problems := check_plan(plan):  # ② 計画を検査する（:= は「代入しつつ判定」）
        return f"計画に問題: {problems}"
    state = load_state(task, plan)
    for _ in range(max_replans + 1):  # ★ 再計画にも回数の上限を付ける
        state = run_plan(state)  # ③ 実行する
        failed = [s for s in state["steps"] if s["status"] == "failed"]
        if not failed:  # 全部終わったら、最後のステップの結果が答え
            return state["results"][state["steps"][-1]["id"]]
        print("失敗:", failed[0]["id"], failed[0]["error"])  # どこで何が起きたかを表示する
        for new_step in fake_replan(state):  # ④ ★ 失敗したステップだけ書き直す。終わった分は残す
            index = next(i for i, s in enumerate(state["steps"]) if s["id"] == new_step["id"])
            state["steps"][index] = new_step  # 同じ ID の位置に差し替える
        save_state(state)
    return "再計画の上限に達しました。人間に確認してください。"


if __name__ == "__main__":
    print(run_with_replan("青葉商事と北斗製作所の売上を比べてレポートにして"))
```

`fake_replan` は練習用の偽 LLM で、エラー文に添えた「登録名」を見て社名を直す。本物の LLM には、終わったステップ・失敗したステップ・エラーの理由を渡して書き直させる。第 1 話で「見つからないときは次の手を返す」と書いたのは、ここで効いてくる。

`run_with_replan` の要点は 2 つある。

**1. 終わったステップは残す。** 書き直すのは失敗した s2 だけで、s1 の結果はそのまま使う。全部を計画し直すと、終わった処理をもう一度実行することになる。

**2. 再計画にも回数の上限を付ける。** 直しても直しても失敗する場合は、何度か試したところで打ち切り、人間に渡す。

実行すると、s2 で一度失敗し、直してから最後まで進む。

```bash title="実行結果"
$ python replan.py
失敗: s2 顧客「北斗製作」は見つかりません。登録名: ['青葉商事', '北斗製作所']
4か月合計 A社 1220万円 / B社 830万円。伸び率 A社 10.0% / B社 33.3%。
```

終わったあとの `state.json` には、6 つのステップがすべて `done` として残っている。s1 は失敗の前に終わっていたので、再実行されていない。

## 同じ処理の繰り返しを止める

ReAct 型で 1 歩ずつ進めるエージェントは、同じ Tool を同じ引数で何度も呼ぶことがある。結果が期待と違うと「もう一度調べれば変わるかもしれない」と考えてしまうからだ。

回数の上限（第 1 話の `max_turns`）だけでは、上限に達するまで無駄な呼び出しが続く。そこで、**同じ呼び出しを数えて、早めに LLM に知らせる**見張りを置く。

```python title="loop_guard.py" caption="同じ Tool を同じ引数で繰り返していないかを見張る"
import json  # 引数を並びの決まった文字にして比べるために使う


class LoopGuard:
    """同じ Tool を同じ引数で何度も呼んでいないかを見張る。"""

    def __init__(self, max_same: int = 2, max_calls: int = 20):
        self.max_same = max_same  # 同じ呼び出しを許す回数
        self.max_calls = max_calls  # 1 つの仕事で Tool を呼んでよい総回数
        self.counts = {}  # 呼び出しの種類 → 回数

    def check(self, tool: str, args: dict) -> str | None:
        """問題があれば理由を返す。問題なければ None（何も無い）を返す。"""
        key = tool + json.dumps(args, sort_keys=True, ensure_ascii=False)  # ★ Tool 名＋引数で「同じ呼び出し」を見分ける
        self.counts[key] = self.counts.get(key, 0) + 1  # その呼び出しの回数を 1 増やす
        if self.counts[key] > self.max_same:  # 同じことを繰り返している
            return f"{tool} を同じ引数で {self.counts[key]} 回呼んでいます。結果は変わりません。別の手を考えてください。"
        if sum(self.counts.values()) > self.max_calls:  # 全体の回数が多すぎる
            return "Tool の呼び出し回数が上限を超えました。ここまでの結果で答えてください。"
        return None


guard = LoopGuard()
for _ in range(3):  # 同じ検索を 3 回続けてみる
    print(guard.check("get_sales", {"customer_id": "C001"}))  # 3 回目で警告が出る
```

`check` は、Tool の名前と引数を 1 つの文字列にして、呼び出しの種類ごとに回数を数える。★ の行で `sort_keys=True` を付けているのは、引数の並び順が違うだけの呼び出しも「同じ」と見分けるためだ。

実行すると、3 回目で警告が返る。

```bash title="実行結果"
None
None
get_sales を同じ引数で 3 回呼んでいます。結果は変わりません。別の手を考えてください。
```

警告を出したら、Tool は実行せず、この文を Tool の結果として LLM に返す。LLM は「同じことをしても無駄だ」と読み取り、別の手を考えるか、手元の結果で答える。

> [!NOTE] 検索の言い換えは繰り返しに数えない
> 「北斗製作所」と「北斗製作所 売上」は、引数が違うので別の呼び出しとして数えられる。言い換えて探し直すのは正しい動きなので、止める必要はない。止めたいのは、まったく同じ呼び出しの繰り返しだけだ。

## この記事のチェックリスト

| 部品 | 確かめること |
|---|---|
| 複数 Tool | Tool の結果を、次のステップが中身を取り出せる形（辞書・リスト）で返しているか |
| 複数 Tool | 合計・比率などの計算を LLM ではなくプログラムでしているか |
| Planning | ReAct と Plan-and-Execute のどちらで進めるか、仕事の性質から選んだか |
| Planning | LLM が書いた計画を、実行前に検査しているか（Tool の実在・参照の順番） |
| State | 1 ステップごとに進捗を保存し、再開時に終わったステップを飛ばしているか |
| State | 「実行中」のまま落ちたステップを、再開時にどう扱うか決めたか |
| 再計画 | 失敗したステップだけを書き直し、終わった結果を使い回しているか |
| 再計画 | 再計画と Tool 呼び出しの両方に回数の上限があるか |
| 繰り返し | 同じ Tool・同じ引数の呼び出しを数えて、早めに知らせているか |

次の第 3 話「[エージェントの「覚える」と「調べる」は別物だ](2026-09-29-agent-parts-3-memory-rag.html)」では、会話をまたいで情報を覚えておく Memory と、文書を検索する RAG を分けて設計する。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- Yao et al., [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)（ICLR 2023）
- LangChain, [Plan-and-Execute Agents](https://www.langchain.com/blog/planning-agents)
- [Architecting Resilient LLM Agents: A Guide to Secure Plan-then-Execute Implementations](https://arxiv.org/abs/2509.08646)（arXiv, 2025-09）
- Cemri et al., [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)（NeurIPS 2025）
- Anthropic, [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）

### 日本語で読める関連記事

- [AIに任せた長時間処理が途中で落ちて全部やり直し ― チェックポイントと冪等性で「再開できる」ジョブを設計する](https://zenn.dev/akira_papa/articles/d4225cbbe36248)（Zenn）
- [Graph Engineering入門：AIエージェントのループを明示グラフへ変える](https://zenn.dev/suwash/articles/graph-engineering_20260727)（Zenn, 2026-07）
