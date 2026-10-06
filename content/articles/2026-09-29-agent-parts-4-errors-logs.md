---
title: 失敗する前提で作る——エラー処理・リトライ・ログで「止まらない、追える」エージェントへ
description: DB 接続の失敗、API の混雑、見つからないデータ、不正な入力。エージェントの Tool は必ず失敗する。失敗を種類で分けて LLM に次の手を返すエラー処理、ジッター付き指数バックオフのリトライ、二重登録を防ぐ冪等キー、依頼単位で追えるログとコストの集計を、依存ゼロの Python で解説する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, LLM, Python, エラー処理, リトライ, 可観測性]
level: [practice]
series: AIエージェントの構成要素
status: published
---
```hero
title 失敗する前提で「やり直す・LLM に返す・記録する」を分ける
group code プログラム
  T[Tool を実行]:::code --> K{失敗の種類}:::code
  K -->|一時的| RT[待ってやり直す\nジッター付き]:::code:::hl
end
group llm LLM
  L(次の手を考える):::llm
end
group obs 記録
  LOG[ログ\n失敗率・コスト]:::data
end
RT -.->|再試行| T
K -->|恒久的| L
RT -->|上限| L
T -.-> LOG
note RT やり直しは冪等キー付き。二重に登録しない
note L 止めずに、失敗の種類と次の手を LLM が読める形で返す
note LOG 1 つの依頼を最初から最後まで追えるログを残す
```


デモでは完璧に動いたエージェントが、本番では 1 日に何度も止まる。原因の多くは LLM の賢さではない。売上 DB が 3 秒だけ応答しなかった、外部 API が混雑で断ってきた、顧客名に全角スペースが入っていた。**Tool は必ず失敗する**し、失敗したときにどう振る舞うかは、LLM ではなくプログラムが決めることだ。

連載の第 4 話では、失敗に備える 3 つの部品を扱う。**エラー処理・リトライ・ログと監視**だ。止まらないように作り、止まったときに原因を追えるようにする。

> [!TIP] この記事で分かること
> - 失敗を 4 種類に分け、「やり直すか」「LLM に何を伝えるか」を決める方法
> - プログラムを止めずに、失敗を LLM が読める形で返す方法
> - ジッター付き指数バックオフで、やり直しが障害を悪化させないようにする方法
> - やり直しても二重に登録されないようにする冪等キー
> - 1 つの依頼の流れを追えるログと、失敗率・コストの集計

第 3 話「[エージェントの「覚える」と「調べる」は別物だ](2026-09-29-agent-parts-3-memory-rag.html)」の続きだが、この記事だけでも読める。コードには、ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

## 失敗を 4 種類に分ける

エラー処理の第一歩は、**失敗を種類で分ける**ことだ。種類によって、やり直すべきか、LLM に何を伝えるべきかがまったく違う。

| 種類 | 例 | やり直すか | LLM に伝えること |
|---|---|---|---|
| 一時的な失敗 | API の混雑（503・429）、タイムアウト、DB 接続の瞬断 | はい（プログラムが自動で） | 何度か試してもだめなら「時間をおく」 |
| 入力の誤り | 日付の形式違い、必須の引数がない | いいえ | どこをどう直せばよいか |
| データがない | 顧客が見つからない、該当期間の売上がない | いいえ | 名前や ID の確かめ方、候補 |
| 恒久的な失敗 | 権限がない、想定外のバグ | いいえ | 諦めて人間に渡すこと |

ポイントは、**やり直すのは一時的な失敗だけ**という点だ。入力が間違っているのに同じ引数で 5 回やり直しても、5 回失敗するだけだ。

もう 1 つのポイントは、やり直しを**誰が**するかだ。一時的な失敗はプログラムが黙ってやり直せばよく、LLM に判断させる必要はない。入力の誤りやデータがないときは、引数を直せるのは LLM なので、LLM に次の手を伝える。

```flow caption="失敗の種類で、プログラムがやり直すか、LLM に返すかが分かれる。やり直して成功すれば、そのまま結果を返す"
A([Tool が失敗]) --> B{一時的な\n失敗?}
B -- はい --> C[プログラムが\n待ってやり直す]:::hl
C --> D{まだ失敗して\n上限に達した?}
D -- いいえ --> C
D -- はい --> F([LLM に\n「時間をおく」と返す])
B -- いいえ --> E([LLM に\n種類と次の手を返す])
```

## エラー処理：止めずに、次の手を返す

Tool が失敗したときに最もまずいのは、**プログラムごと止まる**ことだ。第 2 話までの State を保存していても、止まれば誰かが再開させるまで何も進まない。

そこで、Tool の失敗は例外（プログラムの失敗の知らせ）のまま外へ投げず、**LLM が読める結果に変換して返す**。LLM とツールをつなぐ標準規格 MCP の仕様にも、この考え方が入っている。ツールの実行エラーは、エラーの印（`isError: true`）を付けた通常の結果として返し、モデルが自分で直せる内容を書く、というものだ。

```python title="errors.py" caption="失敗を種類で分け、LLM が次の手を決められる形にする"
class TemporaryError(Exception):
    """一時的な失敗（混雑・タイムアウトなど）。時間をおけば直る見込みがある。"""


# ★ 失敗の種類ごとに「やり直すか」「LLM に何を伝えるか」を決めた表
RULES = {
    TemporaryError: ("temporary", True, "再試行しても直りませんでした。時間をおくか、人間に報告してください。"),
    TimeoutError: ("temporary", True, "応答がありません。時間をおくか、人間に報告してください。"),
    ValueError: ("bad_input", False, "引数が正しくありません。形式を直して呼び直してください。"),
    LookupError: ("not_found", False, "対象が見つかりません。名前や ID を確かめてください。"),
    PermissionError: ("forbidden", False, "権限がありません。別の方法を考えるか、人間に依頼してください。"),
}


def classify(error: Exception) -> tuple[str, bool, str]:
    """例外（プログラムで起きた失敗）を、種類・やり直すか・次の手の 3 つに分ける。"""
    for error_type, rule in RULES.items():
        if isinstance(error, error_type):  # この種類の失敗か（子分の種類も含めて判定する）
            return rule
    return ("unknown", False, "想定外の失敗です。この操作は諦めて、人間に報告してください。")  # 表に無いもの


def to_tool_result(error: Exception) -> dict:
    """★ 失敗を、LLM が読んで次の手を決められる形にする。プログラムは止めない。"""
    kind, _, hint = classify(error)  # _ は「使わない値」の意味
    return {"ok": False, "kind": kind, "message": str(error), "hint": hint}


if __name__ == "__main__":
    print(to_tool_result(LookupError("顧客「東西物産」は見つかりません")))
    print(to_tool_result(ZeroDivisionError("division by zero")))
```

`RULES` は、失敗の種類ごとに「種類の名前」「やり直すか」「LLM への次の手」を決めた表だ。`LookupError`（見つからない）や `ValueError`（値がおかしい）は Python に最初からある例外の種類で、Tool の中でこれらを使い分けて投げておけば、ここで自動的に分類される。

`to_tool_result` は、失敗を `{"ok": False, ...}` という辞書にする。これを Tool の結果として LLM に返せば、プログラムは止まらず、LLM が次の手を考えられる。

```bash title="実行結果"
$ python errors.py
{'ok': False, 'kind': 'not_found', 'message': '顧客「東西物産」は見つかりません', 'hint': '対象が見つかりません。名前や ID を確かめてください。'}
{'ok': False, 'kind': 'unknown', 'message': 'division by zero', 'hint': '想定外の失敗です。この操作は諦めて、人間に報告してください。'}
```

2 つ目は、表に無い想定外の失敗（0 で割った）だ。想定外の失敗は、LLM に直させようとせず、諦めて人間に報告するよう伝える。原因がプログラムのバグなら、LLM が何度引数を変えても直らないからだ。

> [!WARNING] エラーの文面に内部情報を載せない
> `message` には例外の文面がそのまま入る。DB の接続文字列、ファイルの置き場所、他の顧客の名前などが含まれると、LLM の回答を通じて利用者に見えてしまう。本番では、LLM に返す文面と、ログに残す詳しい文面を分けておく。

## リトライ：待ち時間を広げ、ばらつかせる

一時的な失敗は、少し待ってやり直せば成功することが多い。ただし、**やり方を間違えると、やり直しが障害を悪化させる**。

混雑で断られた 1,000 のクライアントが、全員 1 秒後に一斉にやり直すと、相手のサーバーには再び 1,000 の要求が同時に届く。これを繰り返すと、サーバーはいつまでも回復できない。そこで次の 3 つを組み合わせる。

| 仕組み | やり方 | 防ぐこと |
|---|---|---|
| 指数バックオフ | 待ち時間の上限を 0.5 秒 → 1 秒 → 2 秒 → 4 秒と倍々に広げる | 相手が回復する前に叩き続けること |
| ジッター | 上限の範囲内で、待ち時間をランダムにする | 全員が同じ瞬間にやり直すこと |
| 回数と時間の上限 | 最大 4 回まで、全体で 20 秒まで、のように決める | いつまでも待ち続けること |

AWS のアーキテクチャブログは、この 3 つを比べた記事で、ジッターを入れるだけで無駄な呼び出しが大きく減ることを示し、「ジッター付きのバックオフを標準のやり方にすべきだ」と結論づけている。記事で「Full Jitter」と呼ばれている方式は、待ち時間を `0` から `min(上限, 基準 × 2^回数)` の間でランダムに選ぶものだ。

```python title="retry.py" caption="一時的な失敗のときだけ、待ち時間を広げながらランダムにずらしてやり直す"
import random, time  # random: 乱数（でたらめな数）を作る / time: 待つ・時間を測る
from errors import classify


def with_retry(fn, max_attempts: int = 4, base: float = 0.5, cap: float = 8.0,
               deadline: float = 20.0, sleep=time.sleep):
    """fn を実行し、一時的な失敗のときだけ、待ち時間を広げながらやり直す。"""
    started = time.monotonic()  # 始めた時刻を覚えておく
    for attempt in range(max_attempts):  # ★ やり直しは最大 max_attempts 回まで
        try:
            return fn()  # 成功したら結果を返して終わる
        except Exception as e:
            _, retryable, _ = classify(e)  # 失敗の種類を調べる
            if not retryable or attempt == max_attempts - 1:  # ★ やり直しても無駄な失敗なら、すぐ諦める
                raise  # 失敗をそのまま呼び出し元へ伝える
            wait = random.uniform(0, min(cap, base * 2 ** attempt))  # ★ 上限を倍々に広げ、その中でランダムに待つ
            if time.monotonic() - started + wait > deadline:  # 全体の制限時間を超えるなら諦める
                raise
            print(f"  {attempt + 1}回目失敗（{e}）→ {wait:.2f}秒待つ")
            sleep(wait)  # 待つ


if __name__ == "__main__":
    from errors import TemporaryError

    random.seed(1)  # 練習用に乱数を固定して、毎回同じ結果にする
    calls = {"n": 0}  # 呼ばれた回数

    def flaky_api():  # 2 回失敗して 3 回目に成功する、調子の悪い API の真似
        calls["n"] += 1
        if calls["n"] < 3:
            raise TemporaryError("503 混雑中")
        return "売上データ"

    print(with_retry(flaky_api, sleep=lambda s: None))  # 練習なので本当には待たない
```

`with_retry` の 3 つの ★ が、表の 3 つの仕組みに対応している。

**1. やり直すのは一時的な失敗だけ。** `classify` で種類を調べ、やり直す価値のない失敗ならすぐに諦める。

**2. Full Jitter で待つ。** `random.uniform(0, 上限)` は「0 から上限までのどれか」という意味だ。上限は `base * 2 ** attempt` で、1 回目 0.5 秒、2 回目 1 秒、3 回目 2 秒と倍々に広がる。

**3. 回数と全体の時間に上限がある。** `max_attempts` を超えるか、次に待つと `deadline` を超えるなら、やり直さずに失敗を伝える。

`sleep` を引数で受け取っているのは、練習やテストのときに本当に待たずに済ませるためだ。実行すると、2 回失敗したあと 3 回目に成功する。

```bash title="実行結果"
$ python retry.py
  1回目失敗（503 混雑中）→ 0.07秒待つ
  2回目失敗（503 混雑中）→ 0.85秒待つ
売上データ
```

> [!CAUTION] リトライは 1 か所だけで行う
> エージェントのループ、Tool の中、Tool が使う通信ライブラリの 3 層が、それぞれ 3 回ずつやり直すと、最悪で 3 × 3 × 3 = 27 回の呼び出しになる。AWS の設計ガイド（Well-Architected Framework）も、やり直しの回数を制限するよう求めている。どの層でやり直すかを 1 つに決め、他の層ではやり直さない。

## やり直しても二重にならない：冪等キー

リトライには落とし穴がある。**処理は成功したのに、返事だけが途中で消えた**場合だ。受注登録の API が注文を登録した直後に通信が切れると、エージェントからは失敗に見える。そこでやり直すと、同じ注文が 2 件登録される。

この問題への定番の答えが**冪等キー（べきとうキー）**だ。冪等とは「同じ操作を何回しても、1 回したのと同じ結果になる」という意味だ。操作ごとに固有のキーを付けて送り、受け取る側は処理済みのキーを覚えておく。同じキーが来たら、処理せずに前回の結果を返す。

```python title="idempotency.py" caption="同じキーの登録は 1 回しか効かない。返事が消えてやり直しても二重にならない"
import random  # 乱数を固定するために使う
from errors import TemporaryError
from retry import with_retry

ORDERS = []  # 受注システムに登録された注文（本番は相手のシステムの DB）
SEEN_KEYS = {}  # ★ 受け付け済みの冪等キー → そのときの結果


def register_order(key: str, customer: str, amount: int, lose_reply: list) -> str:
    """受注を登録する API の真似。同じキーで来たら、登録せずに前回の結果を返す。"""
    if key in SEEN_KEYS:  # ★ このキーは処理済み → 二重に登録しない
        return SEEN_KEYS[key]
    ORDERS.append((customer, amount))  # 登録する
    SEEN_KEYS[key] = f"受注番号 {len(ORDERS)}"  # 結果をキーと一緒に覚えておく
    if lose_reply:  # 登録はできたのに、返事が途中で消えた場合の真似
        lose_reply.pop()
        raise TemporaryError("応答なし（登録されたかどうか分からない）")
    return SEEN_KEYS[key]


random.seed(1)  # 練習用に待ち時間を毎回同じにする
task_id, step_id = "task-42", "s5"  # 第 2 話の State にある、依頼とステップの ID
key = f"{task_id}:{step_id}"  # ★ キーは「どの依頼のどのステップか」で作る。やり直しても同じキーになる
lose_reply = [True]  # 1 回目だけ返事が消える
result = with_retry(lambda: register_order(key, "青葉商事", 120, lose_reply), sleep=lambda s: None)
print(result, "/ 登録件数:", len(ORDERS))  # やり直しても 1 件だけ
```

`register_order` は受注システムの真似で、1 回目だけ「登録はできたのに返事が消える」ように作ってある。エージェントはこれを一時的な失敗と見てやり直すが、同じキーで来たので、2 回目は登録せずに前回の結果を返す。

```bash title="実行結果"
$ python idempotency.py
  1回目失敗（応答なし（登録されたかどうか分からない））→ 0.07秒待つ
受注番号 1 / 登録件数: 1
```

キーの作り方が大事だ。★ の行のように、**「どの依頼のどのステップか」から作る**。第 2 話の State に依頼の ID とステップの ID があるので、処理が落ちて再開しても、同じステップなら同じキーになる。

| キーの作り方 | 問題 |
|---|---|
| 呼び出すたびに乱数で作る | やり直すたびに別のキーになり、二重登録を防げない |
| 注文の中身（顧客と金額）から作る | 同じ顧客に同じ金額で 2 回注文する正当なケースまで弾いてしまう |
| **依頼 ID ＋ステップ ID** | やり直しでは同じ、別の依頼では別になる |

> [!NOTE] 相手のシステムが冪等キーに対応していないとき
> 外部の API が冪等キーを受け付けない場合は、書き込む前に「このステップの登録はもう済んでいるか」を読み取りで確かめる。登録後にも読み取って、本当に登録されたかを確かめる。書き込みの Tool と、確認用の読み取りの Tool を対で用意しておくとよい。

## ログ：1 つの依頼を最初から最後まで追えるようにする

エージェントが間違えたとき、「なぜそうしたのか」を後から追えなければ直せない。エージェントのログで最低限残すべきものは、次のとおりだ。

| 項目 | 何のために | 例 |
|---|---|---|
| 依頼の ID | 1 つの依頼に属する記録をまとめて追う | `run_id: 8715143b` |
| 操作の種類と名前 | LLM を呼んだのか、どの Tool を使ったのか | `execute_tool` / `get_sales` |
| 結果 | 成功か失敗か、失敗の種類 | `error` / `TimeoutError` |
| 処理時間 | 遅い Tool を見つける | `duration_ms: 812.4` |
| トークン数とコスト | 料金の内訳をつかむ | 入力 1,800・出力 250 トークン |
| 取得したデータの範囲 | 誰のどのデータを読んだか（監査） | 顧客 ID・件数（中身そのものは残さない） |

項目名は、OpenTelemetry（ログや処理の追跡を記録する、特定の会社に依存しない標準）の GenAI 向けの規約に寄せておくと、後で監視ツールに載せ替えやすい。この規約では、LLM の呼び出しを `chat`、Tool の実行を `execute_tool`、エージェントの実行全体を `invoke_agent` と呼び、トークン数を `gen_ai.usage.input_tokens` などの名前で記録する。ただし、この規約は 2026 年 9 月時点でまだ開発中（Development）の段階にあり、名前が変わる可能性がある。

```python title="tracing.py" caption="処理 1 つごとに、依頼 ID・種類・結果・時間・コストを 1 行の JSON で残す"
import json, time, uuid  # uuid: 重なりにくい ID を作る道具
from contextlib import contextmanager  # 「始めと終わりに決まった処理を挟む」仕組みを作る道具

LOG_FILE = "agent_log.jsonl"  # 1 行に 1 つの JSON を書くログファイル
PRICE_PER_1M = {"input": 3.0, "output": 15.0}  # ★ 100 万トークンあたりの料金（ドル）。例の値なので自分の契約に合わせる


@contextmanager
def span(run_id: str, operation: str, name: str):
    """処理 1 つ分の記録を取る。with span(...) as rec: の中で起きたことを 1 行に残す。"""
    rec = {"run_id": run_id,  # ★ 1 回の依頼を通して同じ ID。これで 1 つの依頼の流れを追える
           "gen_ai.operation.name": operation,  # chat（LLM 呼び出し）/ execute_tool（Tool 実行）
           "name": name, "status": "ok"}
    started = time.perf_counter()  # 開始時刻
    try:
        yield rec  # ここで with の中身が実行される。中身は rec に項目を書き足せる
    except Exception as e:
        rec["status"], rec["error.type"] = "error", type(e).__name__  # 失敗したら種類を残す
        raise  # 失敗は隠さず、呼び出し元に伝える
    finally:  # 成功しても失敗しても必ず実行する
        rec["duration_ms"] = round((time.perf_counter() - started) * 1000, 1)  # かかった時間（ミリ秒）
        tokens_in = rec.get("gen_ai.usage.input_tokens", 0)  # LLM に渡したトークン数
        tokens_out = rec.get("gen_ai.usage.output_tokens", 0)  # LLM が書いたトークン数
        rec["cost_usd"] = (tokens_in * PRICE_PER_1M["input"] + tokens_out * PRICE_PER_1M["output"]) / 1_000_000
        with open(LOG_FILE, "a", encoding="utf-8") as f:  # "a" は追記。前の記録を消さない
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


run_id = uuid.uuid4().hex[:8]  # この依頼の ID
with span(run_id, "chat", "計画を立てる") as rec:
    rec["gen_ai.usage.input_tokens"], rec["gen_ai.usage.output_tokens"] = 1800, 250  # 本物は LLM の応答から取る
with span(run_id, "execute_tool", "get_customer") as rec:
    rec["gen_ai.tool.name"] = "get_customer"
try:
    with span(run_id, "execute_tool", "get_sales") as rec:
        rec["gen_ai.tool.name"] = "get_sales"
        raise TimeoutError("売上 DB が応答しない")  # 失敗を起こしてみる
except TimeoutError:
    pass  # 練習なので、ここでは失敗を握りつぶして先へ進む
```

`span` は、処理 1 つ分の記録を取る仕組みだ。`with span(...) as rec:` と書くと、その中の処理が始まってから終わるまでの時間を測り、成功か失敗かを判定して、最後に 1 行を書き出す。失敗しても `finally` の部分は必ず実行されるので、**失敗した処理の記録が抜け落ちない**。

★ の付いた `run_id` が、ログの要点だ。1 つの依頼の中で行った LLM 呼び出しと Tool 実行には、すべて同じ ID を付ける。ログを ID で絞り込めば、その依頼で何が起きたかを順に追える。

実行すると、`agent_log.jsonl` に次の 3 行が書かれる（時間と ID は実行ごとに変わる）。

```json title="agent_log.jsonl"
{"run_id": "8715143b", "gen_ai.operation.name": "chat", "name": "計画を立てる", "status": "ok", "gen_ai.usage.input_tokens": 1800, "gen_ai.usage.output_tokens": 250, "duration_ms": 0.0, "cost_usd": 0.00915}
{"run_id": "8715143b", "gen_ai.operation.name": "execute_tool", "name": "get_customer", "status": "ok", "gen_ai.tool.name": "get_customer", "duration_ms": 0.0, "cost_usd": 0.0}
{"run_id": "8715143b", "gen_ai.operation.name": "execute_tool", "name": "get_sales", "status": "error", "gen_ai.tool.name": "get_sales", "error.type": "TimeoutError", "duration_ms": 0.0, "cost_usd": 0.0}
```

> [!CAUTION] ログに顧客データや API キーを残さない
> 調べやすさを優先して、LLM に渡した文章や Tool の結果をまるごとログに残したくなる。しかしそれでは、ログが個人情報と機密の保管庫になってしまう。残すのは件数・ID・種類までにとどめ、中身が必要な調査用のログは、保存期間と見られる人を絞った別の場所に置く。秘密情報を伏せる方法は第 5 話で扱う。

## 監視：数字で「いつもと違う」に気づく

ログは、何かが起きた後に読むものだ。**起きていることに気づく**には、ログを集計して指標にし、いつもの値と比べる。

```python title="metrics.py" caption="ログを読み、Tool ごとの回数・失敗・時間と、全体の失敗率・コストを集計する"
import json
from collections import defaultdict  # 初めて見る名前でも 0 から数え始められる辞書


def summarize(path: str = "agent_log.jsonl") -> dict:
    """ログを読み、Tool ごとの回数・失敗・時間と、全体のコストを集計する。"""
    with open(path, encoding="utf-8") as f:
        records = [json.loads(line) for line in f]  # 1 行ずつ JSON として読む
    by_name = defaultdict(lambda: {"calls": 0, "errors": 0, "ms": 0.0})  # 名前ごとの集計
    for r in records:
        s = by_name[r["name"]]
        s["calls"] += 1  # 呼ばれた回数
        s["errors"] += r["status"] == "error"  # 失敗なら 1 足す（True は 1 として数えられる）
        s["ms"] += r["duration_ms"]  # かかった時間の合計
    return {
        "runs": len({r["run_id"] for r in records}),  # 依頼の件数（ID の種類の数）
        "error_rate": round(sum(r["status"] == "error" for r in records) / len(records), 2),  # ★ 失敗の割合
        "cost_usd": round(sum(r["cost_usd"] for r in records), 4),  # ★ かかった料金の合計
        "by_name": dict(by_name),
    }


if __name__ == "__main__":
    print(json.dumps(summarize(), ensure_ascii=False, indent=1))
```

`summarize` は、ログファイルを 1 行ずつ読み、処理の名前ごとに回数・失敗数・合計時間を数える。全体では、依頼の件数・失敗の割合・コストの合計を出す。

```bash title="実行結果（抜粋）"
$ python metrics.py
{
 "runs": 1,
 "error_rate": 0.33,
 "cost_usd": 0.0092,
 "by_name": {
  "get_sales": {"calls": 1, "errors": 1, "ms": 0.0},
  ...
```

本番で見張る指標と、その値が変わったときに疑うことを表にしておく。

| 指標 | 普段と違うときに疑うこと |
|---|---|
| 依頼ごとの成功率 | 指示文や Tool の説明を変えた、モデルが更新された |
| Tool ごとの失敗率 | その Tool の接続先の障害、入力の形式の変化 |
| 処理時間（遅い方から 5% の値） | 接続先の遅延、リトライの多発 |
| 1 依頼あたりの Tool 呼び出し回数 | 同じ処理の繰り返し（第 2 話）、計画の迷走 |
| 1 依頼あたりのコスト | 文脈の肥大化、ループの暴走 |
| リトライの回数 | 相手の混雑。やり直しが障害を悪化させていないか |

平均だけを見ていると、一部の依頼だけがひどく遅い、といった異常を見逃す。処理時間は、遅い方から 5% にあたる値（95 パーセンタイル）も見るとよい。

## この記事のチェックリスト

| 部品 | 確かめること |
|---|---|
| エラー処理 | 失敗を「一時的・入力の誤り・データがない・恒久的」に分けているか |
| エラー処理 | Tool の失敗でプログラムを止めず、LLM が次の手を決められる形で返しているか |
| エラー処理 | 想定外の失敗は LLM に直させず、人間に渡しているか |
| エラー処理 | LLM に返す文面に、接続情報や他の顧客の情報が入っていないか |
| リトライ | やり直すのは一時的な失敗だけか |
| リトライ | 指数バックオフとジッターを使い、回数と全体の時間に上限があるか |
| リトライ | やり直す層を 1 つに決めているか |
| 冪等性 | 書き込みの Tool に冪等キーを付け、キーを「依頼 ID ＋ステップ ID」で作っているか |
| ログ | すべての記録に依頼 ID を付け、失敗した処理も記録しているか |
| ログ | 顧客データや秘密情報の中身をログに残していないか |
| 監視 | 成功率・失敗率・処理時間・呼び出し回数・コストを集計して見ているか |

次の第 5 話「[AIに「やらせない」設計](2026-09-29-agent-parts-5-guardrails.html)」では、権限管理・Human 承認・セキュリティで、エージェントがしてはいけないことをさせない仕組みを作る。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- AWS Architecture Blog, [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)（2015-03-04 / 2023-05 更新）
- AWS Well-Architected Framework, [REL05-BP03 Control and limit retry calls](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_limit_retries.html)
- Model Context Protocol, [Specification 2026-07-28 / Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- OpenTelemetry, [Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/)（2026）
- OpenTelemetry, [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)（開発中）
- Formation, [Agent Tool Call Idempotency for Safe Retries](https://formation.dev/blog/agent-tool-retry-idempotency)

### 日本語で読める関連記事

- [エージェントのよくある失敗パターンと対策](https://qiita.com/YushiYamamoto/items/ea313b459f04cfc0012c)（Qiita）
- [AIに任せた長時間処理が途中で落ちて全部やり直し ― チェックポイントと冪等性で「再開できる」ジョブを設計する](https://zenn.dev/akira_papa/articles/d4225cbbe36248)（Zenn）
