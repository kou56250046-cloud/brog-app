---
title: 固定できる所は固定し、判断が要る所だけエージェントにする——ハイブリッド設計と制約
description: 実務の AI システムの多くは、Workflow とエージェントを組み合わせて作る。障害調査を題材に、受付・検証・報告を Workflow、原因調査だけをエージェントにする構成を、予算・権限・承認・停止・記録の 5 つの制約と合わせて動くコードで組み立てる。本番で AI の自由度を絞っていく考え方と、最終的な判断のフローまでを扱う。
date: "2026-10-05"
verified: "2026-10-05"
category: AIエージェント
tags: [AIエージェント, ワークフロー, LLM, 設計判断, Human-in-the-loop, Python]
level: [practice, advanced]
series: WorkflowとAIエージェントの使い分け
status: published
---

[第 2 回](2026-10-05-workflow-vs-agent-2-use-cases.html)で 8 つの業務を見ると、エージェントを選んだ業務でも、受付・結論・送信は別の仕組みに任せていた。業務全体の手順は決まっていて、その中の一部の工程だけに、状況を見た判断や試行錯誤が要る。実務では、この形がいちばん多い。

連載の最終回では、**固定できる所は Workflow、判断が要る所だけエージェント**にする組み合わせ方を、障害調査を題材にコードで組み立てる。あわせて、エージェントを動かすときに必ず付ける制約と、本番で AI の自由度を絞っていく考え方を扱う。

> [!TIP] この記事で分かること
> - Workflow とエージェントを組み合わせる構成と、工程ごとの役割分担
> - エージェントに付ける 11 の制約を、予算・権限・承認・停止・記録の 5 群に整理する方法
> - 回数・費用・時間の上限と、書き込みの承認待ちを 1 か所で守らせるコード
> - エージェントの結論を、根拠と突き合わせてから報告に回す Workflow のコード
> - 本番で AI の自由度を絞るときの 3 つの原則と、最終的な判断のフロー

## コードの読み方

コードは Python で、外部のライブラリを使わずに動く。本物の LLM の代わりに**決まった返事をする練習用の偽物**を使う。この記事のコードは 3 つのファイルに分かれていて、同じフォルダに置くと `pipeline.py` から全体が動く。

| 書き方 | 意味 |
|---|---|
| `# 〜` | 説明文（コメント）。プログラムとしては無視される |
| `class 名前:` | 「クラス」の定義。データと、それを扱う関数をひとまとめにした型 |
| `raise 例外` | 処理を中断して、上の呼び出し元に「止まった理由」を投げる |
| `try:` 〜 `except 例外:` | 中断が起きたら、`except` の下で受け止めて処理を続ける |
| `from ファイル名 import 名前` | 別のファイルで作った関数やクラスを使えるようにする |

## 実務の多くはハイブリッドになる

障害調査を、工程に分けて考える。第 1 回のチェックリストで判定すると、エージェントが要るのは原因調査だけで、受付・検証・報告・通知は手順の決まった Workflow だった。

```flow caption="障害調査のハイブリッド構成。エージェントは真ん中の 1 工程だけ"
A([調査依頼の受付\nWorkflow]) --> B(原因調査\nAIエージェント):::hl
B --> C{調査結果の検証\nWorkflow}
C -- 合格 --> D[報告書の作成・保存\nWorkflow]
D --> E([関係者へ通知\nWorkflow])
C -- 不合格 --> F([担当者へエスカレーション])
```

エスカレーションは、自動では片付かない案件を、上位の担当者や人間に引き継ぐことだ。

| 工程 | 方式 | 理由 |
|---|---|---|
| 入力のチェック | Workflow | 必須項目を確実に確かめる |
| 調査方針の決定 | エージェント | 状況に応じた判断が要る |
| ログ・DB の検索 | 道具（呼び出しはエージェント、範囲は Workflow が決める） | 権限と実行範囲を管理する |
| 調査結果の評価 | エージェント＋プログラムの検証 | 柔軟な判断と、客観的な確認を組み合わせる |
| 本番の設定変更 | Workflow＋人間の承認 | 誤操作の影響を抑える |
| 報告書の保存 | Workflow | 確実に行う必要がある |
| 通知 | Workflow | 実行の条件がはっきりしている |

業務が大きくなると、Workflow → エージェント → Workflow → エージェント → Workflow のように、固定の工程と判断の工程が交互に並ぶこともある。どの場合も、**全体の流れはプログラムが持ち、エージェントはその中の 1 工程として呼ばれる**。

この考え方は、複数の作り手が別々に書いている。HumanLayer が公開した「12-Factor Agents」は、うまくいっている AI 製品の多くは「ほぼ決定的なコードに、LLM の工程を要所だけ散りばめたもの」だとし、制御の流れは自分で持つ（Own your control flow）ことを原則の 1 つにしている。エージェント用のフレームワークにも、決まった手順の工程と LLM が判断する工程を 1 つの図の中で混ぜて組めるものがある。

## エージェントに付ける制約は 5 つの群に分ける

エージェントは自由度が高い。そのぶん、**無制限に動かさない**ことが大切だ。最低限必要な制約は 11 ある。数が多いので、何を防ぐかで 5 つの群に分けると、抜けがないかを確かめやすい。

| 群 | 制約 | 防ぐこと |
|---|---|---|
| 予算 | 最大ステップ数、最大ツール呼び出し回数、タイムアウト、トークン・費用の上限 | 終わらないループ、費用の青天井 |
| 権限 | 読み取り専用の権限、書き込み権限の分離、本番環境へのアクセス制限 | 調べるだけのはずが、何かを壊す |
| 承認 | 重要な操作への人間の承認 | 取り消せない操作を AI だけで実行する |
| 停止 | エラー時の停止条件、情報が集まらないときのエスカレーション | 失敗を抱えたまま進む、根拠のない結論を出す |
| 記録 | 実行ログ・監査ログ | あとで何が起きたか追えない |

OpenAI の構築ガイドも、人間が介入すべき場面として 2 つを挙げている。1 つは**失敗が決めた回数を超えたとき**（何度試しても依頼の意図が分からないなど）。もう 1 つは**取り消せない、または影響の大きい操作**（注文の取り消し、高額の返金、支払いなど）で、こちらは「信頼が育つまで」人間の確認を求めるとしている。

この 5 群のうち、予算・権限・承認・記録を 1 つのクラスにまとめたのが次のコードだ。停止は、上限を超えたときに投げる `Stop` で表す。

```python title="guard.py" caption="予算・権限・承認・記録を 1 か所で守らせる。止めるかどうかは LLM ではなくプログラムが決める"
import time  # 経過時間を測る道具


class Stop(Exception):
    """★ エージェントを止める合図。理由を持たせて、上の工程（Workflow）に返す。"""


class Guard:
    """エージェントに渡す「予算」と「権限」。LLM ではなくプログラムが守らせる。"""

    def __init__(self, max_steps=8, max_tool_calls=6, timeout_sec=60, max_cost=30,
                 read_tools=(), write_tools=()):
        self.max_steps, self.max_tool_calls = max_steps, max_tool_calls  # 回数の上限
        self.timeout_sec, self.max_cost = timeout_sec, max_cost  # 時間と費用（円）の上限
        self.read_tools = set(read_tools)  # 読むだけの道具。自由に使ってよい
        self.write_tools = set(write_tools)  # 書き換える道具。★ 人間の承認が要る
        self.steps = self.tool_calls = self.cost = 0  # ここまでの使用量
        self.started = time.monotonic()  # 開始時刻
        self.log = []  # ★ 監査ログ。何をしたかをすべて残す

    def on_step(self, llm_cost):
        """LLM に 1 回考えさせるたびに呼ぶ。上限を超えたら止める。"""
        self.steps += 1
        self.cost += llm_cost
        if self.steps > self.max_steps:
            raise Stop("最大ステップ数に達した")
        if self.cost > self.max_cost:
            raise Stop(f"費用が上限 {self.max_cost} 円を超えた")
        if time.monotonic() - self.started > self.timeout_sec:
            raise Stop("時間切れ")

    def allow_tool(self, name):
        """道具を使う前に呼ぶ。'ok' / 'approval'（承認待ち）を返すか、止める。"""
        if name in self.write_tools:  # ★ 書き込みは実行せず、承認待ちとして記録する
            self.log.append(("承認待ち", name))
            return "approval"
        if name not in self.read_tools:  # 一覧に無い道具は使わせない（許可リスト方式）
            raise Stop(f"許可されていない道具: {name}")
        self.tool_calls += 1
        if self.tool_calls > self.max_tool_calls:
            raise Stop("道具の呼び出し回数が上限に達した")
        self.log.append(("実行", name))
        return "ok"
```

`Guard` は、エージェントのループの中で 2 か所から呼ばれる。LLM に考えさせるたびに `on_step` を、道具を使う前に `allow_tool` を呼ぶ。

`on_step` は、回数・費用・時間のどれかが上限を超えたら `Stop` を投げる。費用の上限を 5 円にして、1 回 3 円で考えさせてみる。

```python title="try_guard.py" caption="費用の上限を超えると、2 回目で止まる"
from guard import Guard, Stop  # 上で作った予算と権限

guard = Guard(max_cost=5)  # 費用の上限を 5 円にする
try:
    for _ in range(5):  # 5 回考えさせようとする
        guard.on_step(llm_cost=3)  # 1 回 3 円。2 回目で合計 6 円になる
except Stop as e:  # ★ 上限を超えたら、ここで受け止める
    print("止まった:", e)
```

```text
止まった: 費用が上限 5 円を超えた
```

`allow_tool` は、道具を 3 種類に分ける。読み取りの道具は回数を数えながら通す。書き込みの道具は**実行せずに「承認待ち」として記録する**。どちらの一覧にも無い道具は止める。

最後の「一覧に無いものは止める」が大事だ。使ってはいけない道具を並べる除外リスト方式では、新しく道具を足したときに書き忘れると、その道具が無制限に使えてしまう。**使ってよいものだけを並べる許可リスト方式**にしておけば、書き忘れは「使えない」側に倒れる。

> [!WARNING] 制約をプロンプトに書くだけでは守られない
> 「本番の設定は変更しないでください」とプロンプトに書いても、それは LLM へのお願いでしかない。守られる保証はない。予算・権限・承認は、`Guard` のように**LLM の外側のプログラム**で守らせる。権限そのものを読み取り専用のアカウントに絞っておけば、さらに確実になる。権限と承認の詳しい作り方は、連載「AIエージェントの構成要素」の[第 5 回](2026-09-29-agent-parts-5-guardrails.html)で扱った。

## ハイブリッド構成をコードで組む

`Guard` を使って、障害調査のハイブリッド構成を組む。まず、真ん中のエージェントの工程だ。

```python title="investigator.py" caption="エージェントの工程。Guard の予算の中で調べ、結論と根拠 ID を返す"
from guard import Guard, Stop  # 前のコードで作った予算と権限

FINDINGS = {  # 道具を使うと返ってくる結果（練習用）。ID は根拠として引用するための番号
    "決済API": {"search_logs": ("L1", "決済サービス呼び出しのタイムアウトが急増"),
                "get_metrics": ("M1", "決済サービスの応答が 0.3 秒 → 8 秒")},
    "会員登録": {"search_logs": ("L2", "目立ったエラーなし"),
                 "get_metrics": ("M2", "どの数値も平常どおり")},
}


def fake_llm(seen):
    """次の一手を決める偽 LLM。返すのは (行動, 中身)。"""
    if "search_logs" not in seen:
        return ("tool", "search_logs")
    if "get_metrics" not in seen:
        return ("tool", "get_metrics")
    if "タイムアウト" in " ".join(t for _, t in seen.values()):  # 原因の手がかりがあれば
        return ("tool", "restart_service")  # ★ 再起動を試したがる（書き込み操作）
    return ("answer", None)


def investigate(system):
    """★ エージェントの工程。予算の中で調べ、結論と根拠 ID を返す。"""
    guard = Guard(read_tools={"search_logs", "get_metrics"}, write_tools={"restart_service"})
    seen = {}  # 使った道具 → (根拠ID, 結果)
    try:
        while True:  # 終わりは LLM の answer か、Guard の Stop で決まる
            guard.on_step(llm_cost=3)  # 1 回考えるごとに 3 円かかる想定
            kind, name = fake_llm(seen)
            if kind == "answer":
                break
            if guard.allow_tool(name) == "approval":  # 書き込みは実行しない
                break  # 提案だけ残して調査を終える
            seen[name] = FINDINGS[system][name]  # 読み取りの道具を実行する
    except Stop as e:
        return {"status": "stopped", "reason": str(e), "log": guard.log}
    # 手がかりにならなかった結果を除く（本物では、この選別も LLM が行う）
    hits = {k: v for k, v in seen.items() if "なし" not in v[1] and "平常" not in v[1]}
    return {"status": "done", "evidence": [v[0] for v in hits.values()],  # 根拠 ID の一覧
            "cause": " / ".join(v[1] for v in hits.values()), "log": guard.log}
```

`investigate` の `while True` は、それだけ見ると終わらないループだ。終わらせているのは、LLM が「答える」と判断したときと、`Guard` が `Stop` を投げたときの 2 つしかない。**ループの出口のうち 1 つを、必ずプログラムが握っている**のがポイントだ。

偽 LLM は、タイムアウトの手がかりを見つけると、サービスの再起動 `restart_service` を試そうとする。人間の運用担当者もよくやる対処だが、本番の操作だ。`Guard` は書き込みの道具として登録されているので実行せず、承認待ちとして記録する。

返り値の `evidence` は、結論の根拠になった結果の ID の一覧だ。エージェントに「なぜそう言えるのか」を ID で示させておくと、次の Workflow の工程で機械的に確かめられる。

次が、全体の流れを持つ Workflow だ。

```python title="pipeline.py" caption="全体の流れ。受付・検証・報告は Workflow で、調査だけエージェントを呼ぶ"
from investigator import investigate, FINDINGS  # エージェントの工程と、道具の結果


def intake(request):
    """[Workflow] 受付。必須項目がそろっているかを確実に確かめる。"""
    missing = [k for k in ("system", "symptom", "reporter") if not request.get(k)]
    if missing:
        raise ValueError(f"必須項目が足りない: {missing}")
    if request["system"] not in FINDINGS:  # 調査対象として登録されたシステムか
        raise ValueError(f"対象外のシステム: {request['system']}")
    return request


def verify(result, system):
    """★ [Workflow] 検証。エージェントの結論を、記録に残った根拠と突き合わせる。"""
    if result["status"] != "done":  # 予算切れなどで止まった
        return f"エスカレーション: {result['reason']}"
    known = {v[0] for v in FINDINGS[system].values()}  # 実際に道具が返した根拠 ID
    if not result["evidence"]:  # ★ 根拠が 1 つも無い結論は採用しない
        return "エスカレーション: 原因を示す根拠が集まらなかった"
    if not set(result["evidence"]) <= known:  # 根拠 ID が実在するか
        return "エスカレーション: 実在しない根拠を引用している"
    return None  # 問題なし


def handle(request):
    req = intake(request)  # 1. 受付（Workflow）
    result = investigate(req["system"])  # 2. 調査（エージェント）
    problem = verify(result, req["system"])  # 3. 検証（Workflow）
    pending = [name for kind, name in result["log"] if kind == "承認待ち"]
    if problem:
        return f"[{req['system']}] {problem} → 担当 {req['reporter']} へ"  # 4a. 人間へ
    report = f"[{req['system']}] 原因: {result['cause']}（根拠 {', '.join(result['evidence'])}）"
    if pending:  # 書き込みの提案は、報告に「承認待ち」として載せるだけ
        report += f" / 承認待ちの操作: {', '.join(pending)}"
    return report  # 4b. 報告書の保存と通知（Workflow）。ここでは文字列で代用


for req in [{"system": "決済API", "symptom": "注文が遅い", "reporter": "sato"},
            {"system": "会員登録", "symptom": "登録が遅い", "reporter": "suzuki"}]:
    print(handle(req))
```

```text
[決済API] 原因: 決済サービス呼び出しのタイムアウトが急増 / 決済サービスの応答が 0.3 秒 → 8 秒（根拠 L1, M1） / 承認待ちの操作: restart_service
[会員登録] エスカレーション: 原因を示す根拠が集まらなかった → 担当 suzuki へ
```

`handle` の 4 行が、冒頭の図そのものになっている。受付 → 調査 → 検証 → 報告の順番は、どの依頼でも変わらない。変わるのは、`investigate` の中でエージェントがたどる道筋だけだ。

決済 API の依頼では、エージェントがログと数値から原因を見つけ、根拠 L1・M1 を付けて返した。`verify` は、その ID が実際に道具の返した結果にあることを確かめて合格にした。エージェントが提案した再起動は、実行されずに「承認待ちの操作」として報告に載っている。

会員登録の依頼では、ログにも数値にも手がかりが無かった。エージェントは「答える」と判断したが、根拠が 1 つも無い。`verify` はこの結論を採用せず、担当者にエスカレーションした。**エージェントが答えを出したことと、その答えを使ってよいことは別**で、それを決めるのが後ろの Workflow だ。

> [!WARNING] 検証で確かめているのは「根拠があること」だけ
> `verify` は、根拠の ID が実在するかを見ている。根拠から結論への推論が正しいかまでは見ていない。タイムアウトの急増は事実でも、本当の原因は別にあるかもしれない。推論の正しさを確かめるには、別の観点からの検証（反証を探す、人間が確認する）が要る。根拠と結論の突き合わせ方は、連載「レビューエージェントの設計」の[第 1 回](2026-09-29-review-agent-1-verification.html)で詳しく書いた。

## 本番では AI の自由度を絞っていく

第 2 回で、エージェントで作ったものが運用のうちに Workflow へ寄っていく例を紹介した。Finatext は Zenn の記事で、そのときの設計の原則を 3 つにまとめている。

| 原則 | やること | このコードでいうと |
|---|---|---|
| LLM に実行対象を自由に作らせない | 対象の候補はコードが集め、LLM には ID で選ばせる | 道具は `Guard` の一覧から選ばせる |
| LLM の出力を確かめられる形に絞る | ID・形式・範囲の検証はコードで行う | 結論に根拠 ID を付けさせ、`verify` で照合する |
| 観測の単位を、改善したい単位で切る | 工程ごとに入出力・時間・費用を記録する | `Guard.log` に工程ごとの行動を残す |

3 つとも、AI の判断を消すのではなく、**判断の幅を、確かめられる範囲に収める**ための工夫だ。Finatext は、この見直しで費用が約 4 分の 1 になったと報告している。

ただし、絞りすぎると、エージェントにした意味が失われる。想定外の状況に対応できることがエージェントの価値だった。絞るときは、**想定外のときの出口**を残しておく。

- 候補から選ばせるなら、「どれにも当たらない」という選択肢を用意し、その場合はエスカレーションする
- Workflow に移した工程でも、検証で落ちた案件はエージェントか人間に回す
- エージェントの行動の記録を見続け、新しい型が見えたら Workflow を作り直す

## 最後に判断するときのフロー

3 回の内容を 1 枚の図にまとめる。

```flow caption="Workflow・エージェント・ハイブリッドを選ぶ流れ"
A([新しい業務]) --> B{何を・どの順で・どの条件で\n実行するか全部決まる?}
B -- はい --> C([Workflow]):::hl
B -- いいえ --> D{決められないのは\n一部の工程だけ?}
D -- はい --> E([ハイブリッド]):::hl
D -- いいえ --> F([エージェント]):::hl
E --> G[エージェントの部分に\n予算・権限・承認・停止・記録を付ける]
F --> G
```

| 方式 | 選ぶ条件 | 例 |
|---|---|---|
| Workflow | 何を、どの順番で、どの条件で実行するかを、事前に決められる | 定型のデータ処理、ETL、定型レポート、請求処理、定型の API 連携、定型テスト、承認フロー |
| エージェント | 目的は決まっているが、そこに到達する具体的な手順を事前に決めきれない | 障害調査、複雑な問い合わせ、コードの調査、原因分析、複数資料の調査、リサーチ |
| ハイブリッド | 業務全体の手順は固定できるが、一部の工程に状況判断や試行錯誤が要る | 実務の多くはこれ。障害調査システム全体、問い合わせ対応システム全体 |

ETL は、データを取り出し（Extract）、変換し（Transform）、保存先に読み込む（Load）処理のことだ。

一言で言えば、次のようになる。

| 手順が | 選ぶもの |
|---|---|
| 決まっている | Workflow |
| 決まっていない | エージェント |
| 一部だけ決まっていない | Workflow＋エージェント |

さらに突き詰めると、この判断は**「処理の自由度を、AI にどこまで与えるか」**という問題だ。

| 対象 | 扱い方 |
|---|---|
| 固定できるもの | できるだけ Workflow・プログラムで固定する |
| 判断が要るもの | AI に判断させる |
| 重要な操作 | ルール・権限・人間の承認で制御する |

**AI に全部をやらせるのではなく、AI に判断させる価値がある部分だけをエージェントにする。**それが、実用的なエージェント設計の基本方針だ。

## 連載全体のチェックリスト

| 回 | 確かめること |
|---|---|
| 1 | 「AI を使うか」ではなく「流れを誰が決めるか」で考えた |
| 1 | if 文の数ではなく性質で判断した。線がはっきりした判断はプログラムに残した |
| 1 | システム全体ではなく、工程ごとに判定した |
| 2 | Workflow の中で AI を使う工程の後ろに、プログラムの検証を置いた |
| 2 | エージェントの行動を記録し、型が見えたら Workflow に移すつもりでいる |
| 3 | 全体の流れはプログラムが持ち、エージェントは 1 工程として呼んでいる |
| 3 | 予算・権限・承認・停止・記録の 5 群の制約を、LLM の外のプログラムで守らせている |
| 3 | 書き込みの操作は実行せず、承認待ちとして人間に渡している |
| 3 | エージェントの結論を、根拠と突き合わせてから使っている |
| 3 | 自由度を絞っても、想定外のときの出口を残している |

## 参考文献

情報はすべて 2026-10-05 時点で確認した。

- Anthropic, [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）
- OpenAI, [A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)（2025-04）
- HumanLayer, [12-Factor Agents](https://www.humanlayer.dev/blog/12-factor-agents)（2025）
- LangChain, [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- Finatext, [LLMの自由度を設計する：本番AIエージェントのコスト・再現性・観測性](https://zenn.dev/finatext/articles/77560a30ecf3f0)（Zenn, 2026-06-18）
- ログラス, [万能なエージェントより、確実なワークフローを —自律性と信頼性のトレードオフ](https://zenn.dev/loglass/articles/08a238976938a9)（Zenn, 2025-12-14）
