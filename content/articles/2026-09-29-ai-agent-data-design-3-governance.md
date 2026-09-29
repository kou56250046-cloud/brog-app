---
title: 「なぜこの回答？」に答えられるエージェントを作る——権限・系譜・根拠の追跡
description: 答えが正しくても、根拠を示せず、見せてはいけない人に見せていたら業務では使えない。データの分類、検索の前に絞る権限、列の伏せ字、データの系譜、回答と根拠の記録、監査ログ、利用ルールまで、エージェントのデータのガバナンスを動く Python で分解する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, データ設計, ガバナンス, アクセス制御, データリネージ, Python]
level: [practice, advanced]
series: AIエージェントのデータ設計
status: published
---

「このお客様に追加の融資を案内できますか」とエージェントに聞き、もっともらしい答えが返ってきたとする。その答えを業務に使ってよいかは、答えの正しさだけでは決まらない。**どの規程の、どの版を根拠にしたのか**。**その規程を、この担当者に見せてよかったのか**。半年後に監査で聞かれたとき、それを示せるかで決まる。

この記事は「AIエージェントのデータ設計」連載の最終回だ。[1 回目](2026-09-29-ai-agent-data-design-1-structured.html)で表のデータに意味を持たせ、[2 回目](2026-09-29-ai-agent-data-design-2-rag.html)で文書に版と有効期間を持たせた。今回はその上に、**誰に何を見せるか**と、**なぜその回答になったかを後から追えるか**を作る。

> [!TIP] この記事で分かること
> - データの分類が、権限・伏せ字・ログの前提になる理由
> - 利用者・エージェント・データの 3 つの軸で権限を決め、**検索の前に**絞る方法
> - 表の行と列を、権限に合わせて絞り、伏せる方法
> - データの系譜（どこから来て、どう加工されたか）を記録してさかのぼる方法
> - 回答ごとに根拠（文書の版・データの時点）を残し、後から説明する方法
> - 中身を残さずに「誰が・いつ・何を・何のために」を残す監査ログ

## コードの読み方

コードは Python で書き、ほぼ全行に日本語の説明を付けた。特に大事な行には `★` を付けてある。前の 2 回で作った部品（練習用のデータベース、文書のチャンク、検索関数）をそのまま使う。AI サービスの契約も API キーも要らない。

| 書き方 | 意味 |
|---|---|
| `# 〜` | 説明文（コメント）。プログラムとしては無視される |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `return 値` | 関数の結果として、その値を返して終わる |
| `if 条件:` / `for x in 並び:` | 条件に合うときだけ実行 / 並びの中身を 1 つずつ取り出して繰り返す |
| `[a, b]` / `{"名前": 値}` / `{a, b}` | リスト（順番のある入れ物） / 辞書（名前と値の組） / 集合（重複の無い集まり） |
| `@dataclass` + `class 名前:` | 決まった項目を持つ「データの入れ物」の設計図 |
| `try:` 〜 `except:` 〜 `finally:` | 失敗したときの処理と、成功しても失敗しても必ず行う処理を書く |

## 全体マップ：回答の前後に置く 4 つの仕組み

エージェントが答えるまでの流れに、4 つの仕組みを差し込む。

```flow caption="権限で絞ってから検索し、回答と根拠を記録し、すべての操作をログに残す"
A([利用者の質問]) --> B[権限を確かめる\n利用者×エージェント×データ]:::hl
B --> C[見てよいデータだけを\n検索・取得する]
C --> D(LLM が答える)
D --> E[回答と根拠を記録する\n文書の版・データの時点]:::hl
E --> F([利用者へ回答])
C -.-> G[監査ログ\n誰が・いつ・何を・何のために]
H[データの系譜\nどこから来たか] -.-> C
```

| 仕組み | 答える問い | 章 |
|---|---|---|
| 分類と権限 | この人に、このデータを見せてよいか | 分類・権限・伏せ字 |
| 系譜 | この数字は、どのデータをどう加工したものか | 系譜 |
| 回答の記録 | この回答は、何を根拠にしたのか | 根拠の追跡 |
| 監査ログ | 誰が、いつ、何を、何のために使ったか | 監査ログ |

## データを分類する：すべての仕組みの前提

権限もログも、「このデータはどのくらい大事か」が決まっていないと設計できない。そこで最初に、データを分類する。

| 分類 | 例 | エージェントでの扱い |
|---|---|---|
| 公開 | 商品の案内、公開している金利 | 誰の質問にも使ってよい |
| 社内 | 事務規程、契約書のひな形 | 社員の質問にだけ使う |
| 機密 | 審査会の議事録、経営の資料 | 所管の部門の人にだけ使う |
| 個人情報 | 氏名、年収、口座番号 | 担当者にだけ、必要な項目だけを見せる。伏せて返すこともある |

2 回目の記事で、文書のチャンクに**機密区分**のメタデータを付けた。表のデータでは、**列ごと**に分類を付ける。「顧客の表は個人情報」と表ごとにまとめると、顧客番号のような個人情報でない列まで見られなくなり、エージェントが何もできなくなる。

分類は、データを作るときか取り込むときに付ける。後から付けようとすると、すでにエージェントが読んでいる。

## 権限：AI にすべてを見せない

エージェントにデータベースの管理者権限を渡し、「見せてはいけない情報は答えないで」と指示文で頼む作りは危ない。LLM は指示を破ることがあるし、読んだ文書に仕込まれた指示に従ってしまうこともある（プロンプトインジェクション。[エージェントの基礎の記事](2026-09-29-ai-agent-design-fundamentals.html)で扱った）。**見せてはいけないデータは、そもそも LLM に届けない**。

権限は、3 つの軸で決める。

| 軸 | 決めること | 例 |
|---|---|---|
| 利用者 | その人が見てよい範囲 | 窓口担当は「社内」まで、審査担当は融資部の「機密」まで |
| エージェント | そのエージェントに許す範囲 | 融資サポートは融資部の文書まで。人事の文書は目的の外 |
| データ | そのデータを見てよい条件 | 機密区分、所管の部門、担当している顧客か |

利用者とエージェントの**両方**が見てよいデータだけを使う。エージェントに広い権限を持たせても、窓口担当が使うときは窓口担当の範囲に狭まる。逆に、部長が使っても、融資サポートのエージェントが人事の文書を読むことはない。

```python title="access.py" caption="利用者とエージェントの両方が見てよいチャンクだけを、検索の前に絞る"
from dataclasses import dataclass
from search import search  # 前回作った検索関数

# ★ 機密区分に順位を付ける。数字が大きいほど見られる人が少ない
LEVELS = {"公開": 0, "社内": 1, "機密": 2}


@dataclass
class Principal:
    """データを見ようとしている主体（人、またはエージェント）。"""
    name: str
    clearance: str          # 見てよい機密区分の上限
    departments: set[str]   # 機密の文書を見てよい部門（set は重複の無い集まり）


def can_read(chunk, user: Principal, agent: Principal) -> bool:
    """★ 利用者とエージェントの「両方」が見てよいチャンクだけを通す。"""
    level = LEVELS[chunk.confidentiality]  # このチャンクの機密区分の順位
    for p in (user, agent):                # 利用者とエージェントを順に確かめる
        if level > LEVELS[p.clearance]:    # 上限を超える区分なら見せない
            return False
        # 機密の文書は、所管の部門に属していなければ見せない
        if chunk.confidentiality == "機密" and chunk.department not in p.departments:
            return False
    return True  # どちらの確認も通ったら見せてよい


def secure_search(question, chunks, user, agent, as_of, k=3):
    """★ 検索の「前」に、見てよいチャンクだけに絞る。"""
    allowed = [c for c in chunks if can_read(c, user, agent)]  # 見てはいけないものは検索の候補にすら入れない
    return search(question, allowed, as_of=as_of, k=k)
```

同じ質問を、窓口担当と審査担当が聞いてみる。

```python title="access_demo.py" caption="同じ質問でも、聞く人によって検索の候補が変わる"
from datetime import date
from docs_data import DOCUMENTS
from chunk_model import make_chunks
from access import Principal, secure_search

chunks = [c for doc in DOCUMENTS for c in make_chunks(doc)]

# 融資サポートエージェント自身の権限。融資部の機密まで読める設定
agent = Principal("融資サポートエージェント", clearance="機密", departments={"融資部"})
# 2 人の利用者。窓口の担当者は「社内」まで、融資部の審査担当は「機密」まで
teller = Principal("窓口担当", clearance="社内", departments=set())
reviewer = Principal("融資部 審査担当", clearance="機密", departments={"融資部"})

question = "カードローンの延滞にどう対応する？"
for user in (teller, reviewer):  # 同じ質問を 2 人がする
    hit = secure_search(question, chunks, user, agent, as_of=date(2026, 9, 29), k=1)[0]
    print(f"{user.name}: {hit['text'][:25]}… | {hit['cite']}")
```

```text
窓口担当: 返済が 3 か月以上遅れた場合、残額を一括で返済す… | 住宅ローン契約書 ひな形 2025年版 第15条（期限の利益の喪失）（契約書/住宅ローン契約書_2025.docx）
融資部 審査担当: カードローンの延滞が前年より増えた。督促の開始を … | 融資審査会 議事録 確定版 議題1（カードローンの延滞）（議事録/2026-09-10_融資審査会.docx）
```

審査担当には、機密の議事録から「督促の開始を 5 日早める」が返る。窓口担当には議事録が候補に入らないので、契約書の条文が返る。

### 検索の後ではなく、前に絞る

`secure_search` は、検索する**前**に見てよいチャンクだけに絞っている。検索した**後**で見てはいけないものを捨てる作りにすると、2 つの問題が起きる。

| 絞る時点 | 起きること |
|---|---|
| 検索の後 | 上位 3 件がすべて機密だと、捨てた後に何も残らない。LLM に渡してから捨てる作りだと、要約や言い換えを通して中身が漏れる |
| 検索の前 | 見てはいけないものは、候補にすら入らない。LLM が読むことはない |

データベースで検索するなら、権限の条件を検索の SQL の `WHERE` に入れる。ベクトル検索の多くの仕組みにも、メタデータで絞ってから近いものを探す機能がある。

> [!WARNING] 「見つからない」と「見せられない」を区別する
> 窓口担当への答えは、質問とずれた契約書の条文になった。権限で絞った結果、関係のある文書が残らなかったためだ。このまま LLM に渡すと、ずれた条文から無理に答えを作る。点数が低いときは「あなたの権限の範囲では該当する資料が見つかりません」と返すようにする。ただし「機密の議事録にあります」とまで言うと、機密の文書があること自体を漏らすことになる。どこまで伝えるかは、組織のルールで決める。

### 表のデータ：行と列の両方で絞る

表のデータでは、**行**（どの顧客か）と**列**（どの項目か）の 2 方向で絞る。

```python title="masking.py" caption="担当外の顧客は返さず、個人情報の列は伏せて返す"
# ★ 列ごとの分類。個人情報の列は、権限の無い人には伏せて返す
COLUMN_CLASS = {"customer_id": "社内", "name": "個人情報", "annual_income": "個人情報",
                "income_year": "社内", "updated_at": "社内"}


def mask(col: str, value):
    """列の種類に合わせて値を伏せる。何の値かは分かるが、中身は分からない形にする。"""
    if value is None:
        return None
    if col == "name":
        return value[0] + "＊＊"  # 姓の 1 文字目だけ残す
    if col == "annual_income":
        return f"{value // 1_000_000 * 100}万円台"  # ★ 正確な額ではなく幅で返す（// は割り算の切り捨て）
    return "＊＊＊"


def get_customer_for(db, customer_id: str, user: dict) -> dict:
    """利用者の権限に合わせて、顧客の情報を行と列の両方で絞って返す。"""
    # ★ 行の絞り込み: 担当している顧客でなければ、そもそも返さない
    if customer_id not in user["assigned_customers"]:
        return {"error": f"顧客 {customer_id} は担当外のため参照できません。担当者に確認してください。"}
    row = db.execute("SELECT * FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()
    if row is None:
        return {"error": f"顧客 {customer_id} はいません。"}
    result = {}
    for col in row.keys():  # 列を 1 つずつ見る
        if COLUMN_CLASS[col] == "個人情報" and not user["can_view_pii"]:
            result[col] = mask(col, row[col])  # ★ 列の絞り込み: 個人情報を見られない人には伏せる
        else:
            result[col] = row[col]
    result["masked"] = not user["can_view_pii"]  # 伏せたことを明示する（黙って伏せない）
    return result


if __name__ == "__main__":
    from bank_db import create_db
    db = create_db()
    teller = {"assigned_customers": {"C001", "C002"}, "can_view_pii": False}  # 窓口担当
    print(get_customer_for(db, "C001", teller))
    print(get_customer_for(db, "C003", teller))
```

```text
{'customer_id': 'C001', 'name': '山＊＊', 'annual_income': '600万円台', 'income_year': 2025, 'updated_at': '2026-09-01', 'masked': True}
{'error': '顧客 C003 は担当外のため参照できません。担当者に確認してください。'}
```

窓口担当は、担当外の鈴木さん（C003）の情報を取れない。担当の山田さん（C001）の情報は取れるが、氏名と年収は伏せられる。年収は正確な額の代わりに「600 万円台」という幅で返しているので、「返済負担率の上限に収まりそうか」の目安には使える。**伏せるときも、判断に要る粒度は残す**のがコツだ。

`"masked": True` で、伏せたことを明示している。黙って伏せると、エージェントは「山＊＊」を本当の名前だと思って回答に書く。

## データの系譜：その数字はどこから来たか

エージェントが「残高は 2,970 万円です」と答えたとき、その数字は 1 つの表から直接来たわけではない。基幹システムの返済明細を取り込み、契約台帳と突き合わせ、計算した結果だ。途中のどこかで取り込みが漏れていれば、数字は間違う。

**データの系譜**（データリネージ）は、データが**どこから来て、どの処理を経て作られたか**の記録だ。系譜があれば、おかしな数字を見つけたときに原因をさかのぼれる。

```flow caption="残高の数字の系譜。元のシステムから、取り込みと計算を経て指標になる"
direction LR
A[基幹\n返済明細] --> B[返済の取り込み]
B --> C[分析用\n返済]
D[基幹\n契約台帳] --> E[契約の取り込み]
E --> F[分析用\n契約]
C --> G[残高の計算]:::hl
F --> G
G --> H([指標\n融資残高])
```

系譜の記録には、オープンな標準（OpenLineage）もある。「実行」「処理（ジョブ）」「データセット」の 3 つと、それに付ける追加の情報（スキーマ・統計・品質の検査結果など）で系譜を表す。考え方を小さく真似すると、次のようになる。

```python title="lineage.py" caption="処理のたびに「何を読んで何を作ったか」を記録し、さかのぼる"
from dataclasses import dataclass, field
from datetime import datetime

LINEAGE = []  # 系譜の記録をためておく場所（本物ならデータベースやファイル）


@dataclass
class LineageEvent:
    """「どの処理が、何を読んで、何を作ったか」の記録 1 件。"""
    job: str               # 処理の名前（例: 残高の計算）
    inputs: list[str]      # 読んだデータ
    outputs: list[str]     # 作ったデータ
    code_version: str      # ★ どの版のプログラムで作ったか。計算方法が変わったときに追える
    ran_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))  # 実行した日時


def record(job: str, inputs: list[str], outputs: list[str], code_version: str) -> None:
    """処理を 1 回実行するたびに呼び、系譜を記録する。"""
    LINEAGE.append(LineageEvent(job, inputs, outputs, code_version))


def trace(dataset: str, depth: int = 0) -> None:
    """★ データ dataset がどこから来たかを、元のデータまでさかのぼって表示する。"""
    for ev in LINEAGE:
        if dataset in ev.outputs:  # このデータを作った処理を探す
            print("  " * depth + f"{dataset} ← [{ev.job} {ev.code_version}] ← {', '.join(ev.inputs)}")
            for src in ev.inputs:  # 読んだデータについても、同じようにさかのぼる
                trace(src, depth + 1)


if __name__ == "__main__":
    # 夜間の処理が、実行のたびに記録を残していく
    record("返済の取り込み", ["基幹.返済明細"], ["分析.repayments"], "v1.4")
    record("契約の取り込み", ["基幹.契約台帳"], ["分析.loan_contracts"], "v1.2")
    record("残高の計算", ["分析.loan_contracts", "分析.repayments"], ["指標.outstanding_balance"], "v2.0")
    trace("指標.outstanding_balance")  # 残高の数字がどこから来たかをたどる
```

```text
指標.outstanding_balance ← [残高の計算 v2.0] ← 分析.loan_contracts, 分析.repayments
  分析.loan_contracts ← [契約の取り込み v1.2] ← 基幹.契約台帳
  分析.repayments ← [返済の取り込み v1.4] ← 基幹.返済明細
```

`trace` を呼ぶだけで、残高が契約台帳と返済明細から来ていることが分かる。

記録には `code_version`（どの版のプログラムで作ったか）を入れている。残高の計算方法を v2.0 に変えた日から数字が変わったなら、原因は計算方法の変更だと分かる。1 回目の記事で指標を 1 か所で定義したのは、この版を 1 つに決めるためでもある。

> [!NOTE] 系譜は手で書かない
> 系譜の図を資料として手で描くと、処理が変わったときに古くなる。例のように、**処理を実行するたびに記録が残る**作りにする。データ基盤の製品の多くは、この記録を自動で集める機能を持っている。

## 回答の根拠を残す：なぜこの回答になったのか

系譜は「データがどこから来たか」だった。回答の根拠は、その先の「**回答がどのデータから来たか**」だ。エージェントが答えるたびに、次のことを記録する。

| 記録すること | 例 | 後から答えられる問い |
|---|---|---|
| 参照した文書のチャンクと版 | 融資事務規程 第3版 第5条 | どの規程を根拠にしたか。当時の版は何か |
| 呼んだツールと引数 | `get_loan_status(contract_id='L-001')` | どのデータを見たか |
| データの時点 | 2026-09-27 時点 | いつの情報で判断したか |
| 計算方法の版 | 残高の計算 v2.0 | どの定義の数字か |
| LLM と指示文の版 | loan-support-v7 | 同じ条件で再現できるか |

```python title="answer_record.py" caption="回答 1 回ぶんの記録と、後から根拠を表示する関数"
import json
from dataclasses import dataclass, field, asdict  # asdict は入れ物を辞書に変える道具


@dataclass
class Evidence:
    """回答の根拠 1 つ。文書のチャンクか、ツールで取ったデータ。"""
    kind: str              # "chunk"（文書）か "tool"（ツールの結果）
    ref: str               # ★ チャンク番号、またはツール名と引数。後から同じものを引ける番号
    version: str           # 文書の版、または計算方法の版
    data_as_of: str        # ★ そのデータがいつ時点のものか


@dataclass
class AnswerRecord:
    """回答 1 回ぶんの記録。「なぜこの回答か」を後から説明するために残す。"""
    answer_id: str
    asked_at: str
    user: str              # 誰が聞いたか（氏名ではなく利用者の番号）
    question: str
    answer: str
    evidence: list[Evidence] = field(default_factory=list)  # 参照した根拠の一覧
    model: str = ""        # 使った LLM の名前と版
    prompt_version: str = ""  # 指示文の版。指示文を変えたら上げる


def save(rec: AnswerRecord, path: str = "answers.jsonl") -> None:
    """記録を 1 行の JSON としてファイルの末尾に足す（消したり書き換えたりしない）。"""
    with open(path, "a", encoding="utf-8") as f:  # "a" は追記モード
        f.write(json.dumps(asdict(rec), ensure_ascii=False) + "\n")


def explain(answer_id: str, path: str = "answers.jsonl") -> None:
    """★ 回答の番号から、何を根拠にした回答だったかを表示する。"""
    with open(path, encoding="utf-8") as f:
        for line in f:                     # 1 行ずつ読む
            rec = json.loads(line)         # JSON の文字を辞書に戻す
            if rec["answer_id"] != answer_id:
                continue
            print(f"質問: {rec['question']}\n回答: {rec['answer']}")
            for ev in rec["evidence"]:
                print(f"  根拠[{ev['kind']}] {ev['ref']}（版 {ev['version']} / {ev['data_as_of']} 時点）")
```

エージェントが答えたときに記録を作り、後日「なぜこの回答？」と聞かれたときに呼び出す。

```python title="answer_demo.py" caption="回答を根拠と一緒に記録し、後から説明する"
import os
from answer_record import AnswerRecord, Evidence, save, explain

if os.path.exists("answers.jsonl"):
    os.remove("answers.jsonl")  # 練習のため、前回の記録を消してから始める

# エージェントが 1 回答えるたびに、根拠と一緒に記録を作って保存する
rec = AnswerRecord(
    answer_id="A-20260929-0001", asked_at="2026-09-29T10:15:00", user="U-0042",
    question="C001 の住宅ローンに、追加で融資を案内できる？",
    answer="返済負担率の上限（30%）の確認が必要です。現在の残高は 29,700,000 円です。",
    evidence=[
        # ★ 文書の根拠: 前回作った安定したチャンク番号と版
        Evidence("chunk", "RULE-LOAN:第3版:第5条（返済負担率）", "第3版", "2026-02-20"),
        # ★ データの根拠: どのツールをどの引数で呼び、どの計算方法の版だったか
        Evidence("tool", "get_loan_status(contract_id='L-001')", "残高の計算 v2.0", "2026-09-27"),
    ],
    model="（使った LLM の名前と版）", prompt_version="loan-support-v7",
)
save(rec)                      # 記録を保存する
explain("A-20260929-0001")     # 後日、「なぜこの回答？」と聞かれたときに呼ぶ
```

```text
質問: C001 の住宅ローンに、追加で融資を案内できる？
回答: 返済負担率の上限（30%）の確認が必要です。現在の残高は 29,700,000 円です。
  根拠[chunk] RULE-LOAN:第3版:第5条（返済負担率）（版 第3版 / 2026-02-20 時点）
  根拠[tool] get_loan_status(contract_id='L-001')（版 残高の計算 v2.0 / 2026-09-27 時点）
```

ここで 2 回目の記事の設計が効いてくる。チャンクの番号 `RULE-LOAN:第3版:第5条（返済負担率）` は、取り込み直しても変わらない。旧版の規程も消さずに残してある。だから半年後に規程が第 4 版になっていても、**当時の回答が第 3 版のどの条文を根拠にしたか**を開いて確かめられる。

記録はファイルの末尾に足していくだけで、書き換えない。書き換えられる記録は、監査の証拠にならない。

> [!IMPORTANT] 根拠を回答にも表示する
> 記録を残すだけでなく、利用者への回答にも出典（文書名・版・条）とデータの時点を添える。利用者が根拠を開いて確かめられれば、エージェントの読み違いにその場で気づける。後から追えることと、その場で確かめられることは両方要る。

## 監査ログ：中身を残さずに「誰が・何を」を残す

回答の記録は「回答ごと」だった。監査ログは、**ツールの呼び出しごと**に、誰が・いつ・何を・何のために使ったかを残す。エージェントが答えを出さずに終わった操作や、権限で断られた操作も残るので、不審な使い方を見つけられる。

監査ログで気をつけるのは、**ログ自体に個人情報を書かない**ことだ。ツールの引数や結果をそのまま記録すると、ログが個人情報の塊になり、ログを見られる人が個人情報を見られてしまう。

```python title="audit.py" caption="ツールを包んで、呼ばれるたびに監査ログを残す"
import hashlib                 # 値を元に戻せない短い文字列（ハッシュ）に変える道具
import json
from datetime import datetime

AUDIT_FILE = "audit.jsonl"  # 監査ログのファイル。追記だけして、書き換えない


def fingerprint(args: dict) -> str:
    """★ 引数の中身ではなく「指紋」だけを残す。同じ引数なら同じ指紋になるので突き合わせはできる"""
    text = json.dumps(args, sort_keys=True, ensure_ascii=False)  # 順番を揃えて文字にする
    return hashlib.sha256(text.encode()).hexdigest()[:12]         # 先頭 12 文字だけ使う


def audited(tool_name: str, tool_fn, user_id: str, agent: str, purpose: str):
    """ツールを包み、呼ばれるたびに「誰が・いつ・何を・何のために」を記録する。"""
    def wrapper(**args):
        entry = {
            "at": datetime.now().isoformat(timespec="seconds"),  # いつ
            "user": user_id, "agent": agent,                     # 誰が（人とエージェントの両方）
            "tool": tool_name, "args_fp": fingerprint(args),      # 何を（中身は残さない）
            "purpose": purpose,                                   # 何のために
        }
        try:
            result = tool_fn(**args)                         # 本来のツールを実行する
            denied = isinstance(result, dict) and "error" in result
            entry["outcome"] = "denied_or_error" if denied else "ok"
            return result
        except Exception as exc:
            entry["outcome"] = f"exception: {type(exc).__name__}"  # 失敗も記録する
            raise
        finally:  # ★ 成功しても失敗しても、必ず記録を書く
            with open(AUDIT_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return wrapper
```

`fingerprint` は、引数の中身の代わりに**指紋**（ハッシュ値）を残す。同じ引数なら同じ指紋になるので、「この 2 つの操作は同じ顧客に対するものか」は突き合わせられるが、ログから顧客番号は読めない。

担当の顧客と担当外の顧客を 1 回ずつ調べてみる。

```python title="audit_demo.py" caption="担当の顧客と担当外の顧客を調べ、監査ログを表示する"
import os
from bank_db import create_db
from masking import get_customer_for
from audit import audited, AUDIT_FILE

if os.path.exists(AUDIT_FILE):
    os.remove(AUDIT_FILE)  # 練習のため、前回のログを消してから始める

db = create_db()
teller = {"assigned_customers": {"C001", "C002"}, "can_view_pii": False}

# ツールを監査ログ付きに包む。エージェントにはこの包んだ方だけを渡す
tool = audited("get_customer_info", lambda customer_id: get_customer_for(db, customer_id, teller),
               user_id="U-0042", agent="融資サポートエージェント", purpose="追加融資の相談対応")

tool(customer_id="C001")  # 担当の顧客
tool(customer_id="C003")  # 担当外の顧客（断られる）

with open(AUDIT_FILE, encoding="utf-8") as f:
    print(f.read().strip())  # 記録された監査ログを表示する
```

```text
{"at": "2026-09-29T22:43:03", "user": "U-0042", "agent": "融資サポートエージェント", "tool": "get_customer_info", "args_fp": "93de9f9e94a9", "purpose": "追加融資の相談対応", "outcome": "ok"}
{"at": "2026-09-29T22:43:03", "user": "U-0042", "agent": "融資サポートエージェント", "tool": "get_customer_info", "args_fp": "e81145ebfa30", "purpose": "追加融資の相談対応", "outcome": "denied_or_error"}
```

担当外の C003 への問い合わせは `denied_or_error` として残る。同じ利用者が担当外の顧客を何度も調べていれば、ログから気づける。

> [!WARNING] 指紋も万能ではない
> 顧客番号のように取りうる値が少ないものは、すべての番号の指紋を計算して照らし合わせれば元に戻せてしまう。本番では、秘密の鍵を混ぜて指紋を作る方法（HMAC）を使い、鍵はログとは別の場所で管理する。

## ガバナンス：仕組みを「ルール」として回す

ここまでの仕組みは、ルールとして決め、誰かが責任を持って回さなければ形だけになる。エージェントのデータについて、決めておくことをまとめる。

| 項目 | 決めること | 決めないと起きること |
|---|---|---|
| データの分類 | 分類の種類と、分類を付ける人・時点 | 新しいデータが分類されないままエージェントに届く |
| 個人情報 | エージェントに渡してよい項目、伏せ方、保存してよい期間 | 回答やログに個人情報が残り続ける |
| 機密情報 | 機密の文書を読めるエージェントと部門 | 1 つのエージェントが全部門の機密を読める |
| アクセス制御 | 3 つの軸の組み合わせ、権限の見直しの周期 | 異動した人が前の部署のデータを使い続ける |
| 監査ログ | 残す項目、保存期間、誰が見るか、見直しの周期 | ログはあるが誰も見ていない |
| データの利用ルール | 目的の外で使わない、外部のサービスへ送ってよいデータ、AI の学習に使ってよいか | 便利さから目的の外の使い方が広がる |
| 持ち主 | データ・指標・権限ごとの責任者 | 誰も直さないまま定義が古くなる |

最後の「持ち主」が抜けやすい。1 回目で作ったカタログも指標の定義も、2 回目の有効期間も、この回の権限も、変更があれば誰かが直さなければならない。持ち主の決まっていない定義は、少しずつ現実とずれていく。

### 自分で作る部分と、基盤に任せる部分

この連載では、仕組みを理解するためにすべてを標準ライブラリで書いた。本番では、データ基盤の製品が持つ機能に任せられる部分が多い。

| 仕組み | 基盤に任せやすい | 自分で作る必要が残りやすい |
|---|---|---|
| データカタログ・列の説明 | 表と列の説明を登録・検索する機能 | 業務の定義（何を売上とするか）を書く作業そのもの |
| 指標の定義 | 指標を定義して名前で引く機能 | どの指標を作るかの判断 |
| 権限 | 行と列の単位の権限、伏せ字の機能 | エージェント自身の権限の範囲、利用者との組み合わせ方 |
| 系譜 | 処理の実行から系譜を自動で集める機能 | 基盤の外（表計算ソフト・手作業）を通るデータの記録 |
| 監査ログ | データへのアクセスの記録 | 「何のために」（目的）の記録、回答と根拠のひも付け |

右の列に残るのは、**エージェントと業務に固有の部分**だ。基盤は「誰がどの表を読んだか」は記録できても、「その表をどの回答の根拠にしたか」までは知らない。回答の記録は、エージェントを作る側が残す。

## 手作りのメタデータは、いつまで要るのか

この連載で作ったカタログ・指標の定義・メタデータは、モデルが賢くなれば要らなくなるのではないか。そう考える立場もある。

2026 年 9 月に公開された論文は、「汎用の計算量の増加が、人手で作り込んだ仕組みに最終的に勝つ」という経験則（The Bitter Lesson、苦い教訓）を引いてこの問題を論じている。論文の主張は、**モデルの弱さを補うために作られた仕組みの多くは、モデルが良くなるにつれてモデル自身に吸収されていく**、というものだ（Patel、Zaharia ほか）。

ただし同じ論文は、すべてが要らなくなるとは言っていない。価値が残るものとして挙げているのは、**データの環境について整理された知識を、質問をまたいで持ち続ける「持続的な意味の文脈」**だ。その保存の仕方や、内容の一貫性を保つ方法を、これからの研究課題としている。

列名から意味を推測する力、探りの SQL を投げて表の中身を理解する力は、モデルの世代ごとに上がっている。1 回目で紹介した研究でも、大きなモデルほど説明の恩恵をうまく使えていた。推測を助けるための工夫は、いずれ要らなくなるかもしれない。

それでも残るものを分けて考える。

| モデルが強くなると要らなくなりうるもの | モデルがどれだけ強くても要るもの |
|---|---|
| 列名を読みやすく言い換えた説明 | データの中に書かれていない業務の定義（割引前か後か、キャンセルを含むか） |
| 表どうしのつながりの推測 | 有効期間（どの版が今の決まりか。本文だけでは判断できない） |
| 探りの SQL の手間 | 権限（誰に見せてよいかは、データの外で決まる） |
| | 系譜と根拠の記録（後から説明する責任は、モデルの賢さと関係ない） |

右の列は、**データの中にもモデルの中にも無い情報**だ。「売上は割引後の金額で数える」は組織が決めたことで、データベースのどこにも書かれていない。どれほど賢いモデルでも、書かれていないことは推測するしかない。推測で動いてよい業務と、そうでない業務がある。

## 連載のまとめ：エージェントのデータ設計チェックリスト

3 回分の内容を、エージェントの行動の流れに沿って並べ直す。

| 段階 | 確かめること | 回 |
|---|---|---|
| 目的 | 何を判断・回答・実行するかを決め、行動（検索・比較・計算・判断・登録）から必要なデータを逆算したか | 1 |
| 粒度と構造 | 表ごとに「1 行 = 何か」が決まっているか。曖昧な名前・略語・重複した置き場所が無いか | 1 |
| 意味 | 列ごとに定義・単位・期間があるか。よく聞かれる数字を指標として 1 か所で定義したか | 1 |
| 品質 | 欠損・重複・不整合・古さ・異常値・マスタ不整合を、エージェントに渡す前に検査しているか | 1 |
| 窓口 | 行動に合った窓口（SQL・関数・検索）を選び、返り値に単位・意味・時点を付けたか | 1 |
| 文書 | 構造に沿って切り、すべてのチャンクにメタデータを付けたか。チャンクの番号は安定しているか | 2 |
| 鮮度 | 検索の前に有効期間で絞っているか。旧版を消さずに期間を閉じているか | 2 |
| 検索精度 | 質問と正解の組で再現率を測り、直すたびに測り直しているか | 2 |
| 分類と権限 | データ・列ごとに分類があり、利用者とエージェントの両方の権限で、検索の前に絞っているか | 3 |
| 系譜 | 処理のたびに系譜が記録され、数字の出どころをさかのぼれるか | 3 |
| 根拠 | 回答ごとに、参照したチャンクと版・ツールと引数・データの時点を記録しているか | 3 |
| 監査とルール | 誰が・いつ・何を・何のためにを、中身を残さずに記録しているか。データごとに持ち主がいるか | 3 |

エージェントの答えがおかしいとき、最初に疑うのはモデルではなく、エージェントが読んだデータだ。**意味が書かれているか、今有効な版か、見てよいものか、後から追えるか**。この 4 つを揃えたデータは、エージェントだけでなく、人間にとっても使いやすいデータになっている。

## 参考文献

- Pramod Sadalage, Prem Chandrasekaran, [Making Data Ready for Agentic AI](https://martinfowler.com/articles/making-data-ready-for-agentic-ai.html)（martinfowler.com, 2026-08-27）
- OpenLineage, [Object Model](https://openlineage.io/docs/spec/object-model/)（2026-09 確認）
- Liana Patel, Siddharth Jha, Negar Arabzadeh, Carlos Guestrin, Ion Stoica, Matei Zaharia, [What Happens When the Model Eats the Stack? Rethinking the Research Agenda for Data Agents to Withstand the Bitter Lesson](https://arxiv.org/abs/2609.03141)（arXiv, 2026-09-02）
- Model Context Protocol, [Specification 2026-07-28 / Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)（ツールの利用を監査のためにログに残すこと、ツールへの入力を送信前に利用者へ見せることを推奨している）
- Pinecone, [RAG with Access Control](https://www.pinecone.io/learn/rag-access-control/)（検索の前に権限で絞る設計の解説）

### 日本語で読める関連記事

- Tetsuki, [AIエージェントが真価を発揮するデータ基盤へ -メダリオンアーキテクチャ 2.0 と "プラチナレイヤー" を考える](https://zenn.dev/google_cloud_jp/articles/ff74bf18e44f97)（Zenn, 2025-07-01）— 意味・関係・ガバナンス（どの AI がどのデータを何のために使ったかの記録）をデータ基盤の層として整理している
- takanorisuzuki, [AIエージェントが毎回データを取りに行く設計の限界](https://zenn.dev/knowledge_graph/articles/kg-agent-memory-first-design)（Zenn, 2026-05-24）— 複数のシステムで「顧客」の識別が揃っていないと何が起きるかを論じている

※ 記事中の仕様は 2026 年 9 月時点で確認したもの。
