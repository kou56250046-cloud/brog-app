---
title: AIエージェントは「データの意味」を推測できない——目的から逆算する構造化データの設計
description: エージェントに社内データを渡しても、列名だけでは意味は伝わらない。目的と行動からの逆算、粒度、意味の定義（セマンティックレイヤー）、誤解しにくい構造、品質の関所、アクセスの窓口までを、架空の融資データと動く Python で分解する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, データ設計, セマンティックレイヤー, SQL, Python]
level: [basic, practice]
series: AIエージェントのデータ設計
status: published
---
```hero
title AI はデータの意味を推測できない。目的から逆算して意味を付ける
group purpose 目的（人が決める）
  G([目的と行動]):::human
end
group data データ設計
  GR[粒度を揃える\n1 行 = 何か]:::data
  SEM[意味を定義\n単位・期間・定義]:::data:::hl
  Q{品質の関所}:::code
end
group access 窓口
  API([SQL・関数\n検索]):::code
end
G --> GR --> SEM --> Q --> API
note GR 粒度を混ぜると、合計が黙って膨らむ
note SEM 指標は 1 か所で定義する（セマンティックレイヤー）
note Q 汚れたデータは、エージェントに渡す前に止める
```


人間の担当者は、怪しいデータを見ると手を止める。「年収 -1 円？入力ミスだろう」「この表の金額、税込みだっけ？」と気づいて、誰かに確かめる。AI エージェントは、そのデータをそのまま使って答えを出す。

エージェントの答えの質は、モデルの賢さだけでは決まらない。**エージェントが読むデータが、意味を取り違えようのない形になっているか**で決まる部分が大きい。この記事は、そのためのデータ設計を 3 回に分けて扱う連載の 1 回目だ。

> [!TIP] この記事で分かること
> - エージェントの目的と行動から、必要なデータを逆算する手順
> - 「1 行が何を表すか（粒度）」を揃えないと、合計が黙って膨らむ理由
> - 列に単位・期間・定義を持たせる方法と、指標を 1 か所で定義する考え方（セマンティックレイヤー）
> - AI が誤解しやすいデータ構造と、その直し方
> - データ品質の 6 つの問題を、エージェントに渡す前に止める方法
> - SQL・関数呼び出しなど、データへの窓口の選び方

連載の全体は次のとおりだ。この記事では、表の形をした**構造化データ**（データベースの表や CSV）を扱う。

| 回 | 扱うデータ | 主な話題 |
|---|---|---|
| 1（この記事） | 構造化データ | 目的からの逆算・粒度・意味の定義・品質・アクセスの窓口 |
| 2 | 文書（PDF・規程・議事録など） | チャンク分割・メタデータ・鮮度と有効期間・検索精度 |
| 3 | 両方 | 権限・データの系譜・ガバナンス・回答根拠の追跡 |

エージェントそのものの仕組み（ループ・ツール・文脈）は、[AIエージェントは「賢さ」より「設計」で決まる](2026-09-29-ai-agent-design-fundamentals.html)で扱った。この記事はその続きとして、エージェントに**何を読ませるか**に絞る。

## コードの読み方

コードは Python と SQL で書き、ほぼ全行に日本語の説明を付けた。特に大事な行には `★` を付けてある。すべて Python に最初から入っている道具だけで動き、AI サービスの契約も API キーも要らない。

| 書き方 | 意味 |
|---|---|
| `# 〜` | Python の説明文（コメント）。プログラムとしては無視される |
| `-- 〜` | SQL の説明文。同じく無視される |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの。**引数**はその手順に渡す材料 |
| `return 値` | 関数の結果として、その値を返して終わる |
| `if 条件:` / `for x in 並び:` | 条件に合うときだけ実行 / 並びの中身を 1 つずつ取り出して繰り返す |
| `[a, b]` / `{"名前": 値}` | リスト（順番のある入れ物） / 辞書（名前と値の組の入れ物） |
| `"""…"""` | 複数行にわたる文字列。この記事では中に SQL を書いている |

**SQL** は、データベースに「この条件の行を取り出して」「合計して」と命令するための言語だ。`SELECT 列 FROM 表 WHERE 条件` で「表から、条件に合う行の、その列を取り出す」と読めばよい。

## 全体マップ：目的から逆算してデータを整える

データ設計は「持っているデータをどう見せるか」から始めない。**エージェントに何をさせたいか**から始めて、必要なデータとその形を逆算する。

```flow caption="この記事の流れ。目的から逆算し、最後にエージェントへの窓口を作る"
A([エージェントの目的]) --> B[行動に分解する\n検索・比較・計算・判断・登録]
B --> C[必要なデータと粒度を決める]
C --> D[意味を定義する\n単位・期間・計算方法]:::hl
D --> E[誤解しにくい構造に直す]
E --> F[品質の関所を置く]
F --> G([アクセスの窓口を作る\nSQL・関数・検索])
```

## 何をするエージェントかを先に決める

「社内のデータを全部つなげば、AI が何でも答えてくれる」という期待から始めると失敗しやすい。データが多いほどエージェントは迷い、関係のない表から、もっともらしい間違いを作る。

先に決めるのは次の 3 つだ。

1. **目的**：何を判断・回答・実行するエージェントか
2. **行動**：その目的のために、どんな操作を何回するか
3. **データ**：その行動に、どのデータがどの形で必要か

この記事では、架空の金融会社の**融資サポートエージェント**を例にする。窓口の担当者から「山田さんの住宅ローンの残高は？」「延滞している契約はある？」と聞かれて答えるエージェントだ。

| 行動 | 例 | 必要なデータ | 必要な形 |
|---|---|---|---|
| 検索する | 山田さんの契約を探す | 顧客・契約 | 顧客番号から契約の一覧を引ける |
| 比較する | 今年と去年の年収を比べる | 年収の履歴 | 値ごとに「何年の値か」が付いている |
| 計算する | 住宅ローンの残高を出す | 元本・返済 | 計算方法が 1 か所で決まっている |
| 判断する | 追加の融資を案内できるか | 年収・残高・延滞の有無 | 判断に使う値が最新で、欠けていない |
| 別システムへ登録する | 面談の記録を残す | 顧客・契約・記録 | 登録先の項目と取りうる値が決まっている |

表の右端の「必要な形」が、この記事で設計していく内容だ。行動から逆算すると、**持っているが要らないデータ**と、**要るのに形が足りないデータ**の両方が見えてくる。

> [!IMPORTANT] 目的の外のデータは渡さない
> 融資サポートに人事評価のデータは要らない。要らないデータを見せないことは、精度だけでなく安全のためでもある。権限の設計は連載の 3 回目で扱う。

## 粒度：1 行が何を表すかを揃える

**粒度**（グラニュラリティ）とは、表の 1 行が何を表すかのことだ。「1 行 = 顧客 1 人」「1 行 = 契約 1 件」「1 行 = 返済 1 回」のように言える。AI が扱いやすいのは、粒度が表ごとに 1 つに決まっていて、それが明記されている状態だ。

```flow caption="融資データの粒度。1 人の顧客が複数の契約を持ち、1 件の契約に複数の返済がある"
direction LR
A[顧客\n1 行 = 1 人] -- 1 対 多 --> B[融資契約\n1 行 = 1 件]
B -- 1 対 多 --> C[返済\n1 行 = 1 回]
```

練習用のデータベースを作る。まず表の定義だ。

```python title="bank_schema.py" caption="表の定義。表ごとに粒度を 1 つに決める"
# 表の定義。SQL（データベースに命令するための言語）で書く。-- から後ろは SQL の説明文
# ★ 表を 3 つに分け、1 行が何を表すか（粒度）を表ごとに 1 つに決める
SCHEMA = """
    CREATE TABLE customers (               -- 1 行 = 顧客 1 人
        customer_id   TEXT PRIMARY KEY,    -- 顧客番号（重複を許さない）
        name          TEXT NOT NULL,       -- 氏名（空を許さない）
        annual_income INTEGER,             -- 年収（円）。未申告なら空
        income_year   INTEGER,             -- 何年の年収か
        updated_at    TEXT NOT NULL        -- この行を最後に更新した日
    );
    CREATE TABLE loan_contracts (          -- 1 行 = 融資契約 1 件
        contract_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,         -- どの顧客の契約か
        product     TEXT NOT NULL CHECK (product IN ('housing', 'car', 'card')),       -- 取りうる値を限定
        principal   INTEGER NOT NULL CHECK (principal > 0),                          -- 借入元本（円）
        status      TEXT NOT NULL CHECK (status IN ('active', 'completed', 'overdue')),
        start_date  TEXT NOT NULL
    );
    CREATE TABLE repayments (              -- 1 行 = 返済 1 回
        repayment_id INTEGER PRIMARY KEY,
        contract_id  TEXT NOT NULL,        -- どの契約への返済か
        paid_on      TEXT NOT NULL,        -- 返済した日
        amount       INTEGER NOT NULL      -- 返済した元本（円）
    );
    """
```

`CHECK (product IN (...))` は、その列に入れてよい値を限定する指定だ。`'housing'` 以外に「住宅」「Housing」などの揺れた値が入るのを、データベースの側で防ぐ。

次に、この定義で表を作り、サンプルのデータを入れる関数を用意する。

```python title="bank_db.py" caption="練習用のデータベースを作り、サンプルのデータを入れる"
import sqlite3  # Python に最初から入っている小さなデータベース
from bank_schema import SCHEMA  # 表の定義


def create_db() -> sqlite3.Connection:
    """練習用のデータベースをメモリ上に作り、サンプルのデータを入れて返す。"""
    db = sqlite3.connect(":memory:")  # ファイルを作らず、メモリの中だけに作る
    db.row_factory = sqlite3.Row      # 結果を「列名で取り出せる形」で受け取る
    db.executescript(SCHEMA)  # ★ bank_schema.py の表の定義を実行して、空の表を作る
    # サンプルのデータを入れる（executemany は「同じ形の行をまとめて入れる」）
    db.executemany("INSERT INTO customers VALUES (?, ?, ?, ?, ?)", [
        ("C001", "山田 太郎", 6_200_000, 2025, "2026-09-01"),
        ("C002", "佐藤 花子", 4_800_000, 2025, "2026-08-15"),
        ("C003", "鈴木 一郎", None, None, "2024-03-10"),  # 年収が未申告で、更新も古い顧客
    ])
    db.executemany("INSERT INTO loan_contracts VALUES (?, ?, ?, ?, ?, ?)", [
        ("L-001", "C001", "housing", 30_000_000, "active", "2020-04-01"),
        ("L-002", "C001", "car", 2_400_000, "completed", "2021-06-01"),
        ("L-003", "C002", "card", 500_000, "overdue", "2025-01-10"),
    ])
    db.executemany("INSERT INTO repayments (contract_id, paid_on, amount) VALUES (?, ?, ?)", [
        ("L-001", "2026-07-27", 100_000), ("L-001", "2026-08-27", 100_000), ("L-001", "2026-09-27", 100_000),
        ("L-002", "2022-06-01", 1_200_000), ("L-002", "2023-06-01", 1_200_000),
        ("L-003", "2025-03-10", 50_000),
    ])
    return db
```

`6_200_000` の `_` は桁の区切りで、Python では `6200000` と同じ意味になる。`None` は「値が無い」を表す。

### 粒度が混ざると、合計が黙って膨らむ

粒度の違う表をつなぐと何が起きるかを見る。「山田さん（C001）の借入総額は？」を、契約と返済の表をつないでから合計してみる。

```python title="granularity_trap.py" caption="粒度の違う表をつないでから合計すると、金額が膨らむ"
from bank_db import create_db  # さっきの練習用データベース

db = create_db()  # データベースを作る

# 「山田さん（C001）の借入総額は？」を、表をつないでから合計すると……
wrong = db.execute("""
    SELECT SUM(c.principal)                 -- 契約の元本を合計する
    FROM loan_contracts AS c
    JOIN repayments AS r                    -- ★ 返済の表をつなぐと、契約 1 件が返済の回数だけ増える
      ON r.contract_id = c.contract_id
    WHERE c.customer_id = 'C001'
""").fetchone()[0]  # 結果の 1 行目の 1 列目を取り出す

# 契約の表だけで合計すると……
right = db.execute("""
    SELECT SUM(principal) FROM loan_contracts WHERE customer_id = 'C001'
""").fetchone()[0]

print(f"表をつないでから合計: {wrong:,} 円")   # {値:,} は 3 桁ごとにカンマを入れる書き方
print(f"契約の単位で合計:     {right:,} 円")
```

実行結果はこうなる。

```text
表をつないでから合計: 94,800,000 円
契約の単位で合計:     32,400,000 円
```

住宅ローン L-001 には返済が 3 回あるので、つないだ結果では L-001 の行が 3 行に増える。その 3 行それぞれの元本 3,000 万円を合計するので、3 倍に膨らむ。

怖いのは、**SQL としては正しく、エラーも出ない**ことだ。エージェントに SQL を書かせると、この種の間違いを気づかずに作ることがある。人間の担当者なら「借入が 9,480 万円？ 多すぎる」と気づくが、エージェントはそのまま答える。

> [!WARNING] 粒度の違う表を 1 つの大きな表にまとめない
> 分析の便利さのために、顧客・契約・返済を 1 枚の横長の表にまとめることがある。人間が見る分には便利だが、どの列を合計してよいかが分からなくなる。まとめるなら、その表の粒度（例: 1 行 = 返済 1 回）を明記し、上の粒度の値（元本など）を合計してはいけないことをカタログに書く。

## 列に意味を持たせる：セマンティックレイヤー

`annual_income` という列名を見て、AI はそれが年収らしいと推測できる。しかし次のことは列名からは分からない。

| 分からないこと | ありうる答え | 取り違えると |
|---|---|---|
| 単位 | 円 / 千円 / 万円 | 年収が 1,000 倍ずれる |
| 期間 | 直近年度 / 申込時点 / 見込み | 古い年収で審査の目安を出す |
| 定義 | 税引前の総支給額 / 手取り | 返済負担率がずれる |
| 空の意味 | 未申告 / 収入 0 円 | 未申告の人を「収入なし」と判断する |

こうした「データが何を意味するか」の定義を、データそのものとは別の層にまとめたものを**セマンティックレイヤー**（意味の層）と呼ぶ。特別な製品が無くても、考え方は辞書 1 つで始められる。

### データカタログ：表と列の意味を書いておく

```python title="catalog.py" caption="表と列の意味を書いたデータカタログと用語集"
# データカタログ。表と列が「何を意味するか」を、人と AI の両方が読める形で書いておく
CATALOG = {
    "customers": {
        "grain": "1 行 = 顧客 1 人",  # ★ 粒度（1 行が何を表すか）を必ず書く
        "columns": {
            "customer_id": {"meaning": "顧客番号。C で始まる 4 文字"},
            "annual_income": {
                "meaning": "年収（税引前の総支給額）",  # ★ 定義: 手取りなのか総額なのか
                "unit": "円",                        # ★ 単位: 円なのか千円なのか
                "period": "income_year の 1 年間",    # ★ 期間: いつの年収なのか
                "note": "未申告なら空。0 円とは区別する",  # 空と 0 の違いを明記する
            },
            "income_year": {"meaning": "annual_income が何年の年収か", "unit": "西暦年"},
            "updated_at": {"meaning": "この行を最後に更新した日", "unit": "YYYY-MM-DD"},
        },
    },
    "loan_contracts": {
        "grain": "1 行 = 融資契約 1 件",
        "columns": {
            "product": {"meaning": "融資の種類",
                        "values": {"housing": "住宅ローン", "car": "自動車ローン", "card": "カードローン"}},
            "principal": {"meaning": "契約時の借入元本", "unit": "円",
                          "note": "返済しても減らない。残高は指標 outstanding_balance を使う"},
            "status": {"meaning": "契約の状態",
                       "values": {"active": "返済中", "completed": "完済", "overdue": "延滞中"}},
        },
    },
}

# 用語集。社内で使う言葉を、データの言葉に言い換える
GLOSSARY = {
    "残高": "元本から返済済みの元本を引いた額。返済中・延滞中の契約だけを数える",
    "延滞先": "status が overdue の契約を 1 件以上持つ顧客",
}
```

用語集（`GLOSSARY`）は、利用者が使う言葉とデータの言葉の橋渡しだ。窓口の担当者は「延滞先」と言うが、データには `overdue` としか書かれていない。

カタログから、LLM に渡す説明文を組み立てる関数を書く。

```python title="catalog_prompt.py" caption="カタログから LLM に渡す説明文を組み立てる"
from catalog import CATALOG  # さっき書いたデータカタログ


def describe_for_llm(table: str) -> str:
    """カタログから、LLM に渡す説明文を組み立てる。"""
    t = CATALOG[table]                         # 表の説明を取り出す
    lines = [f"## {table}（{t['grain']}）"]    # 見出しに粒度を入れる
    for col, c in t["columns"].items():        # 列を 1 つずつ説明文にする
        parts = [c["meaning"]]
        if "unit" in c:
            parts.append(f"単位: {c['unit']}")
        if "period" in c:
            parts.append(f"期間: {c['period']}")
        if "values" in c:  # 取りうる値と、その意味を並べる
            parts.append("値: " + ", ".join(f"{k}={v}" for k, v in c["values"].items()))
        if "note" in c:
            parts.append(f"注意: {c['note']}")
        lines.append(f"- {col}: " + " / ".join(parts))  # 「 / 」でつないで 1 行にする
    return "\n".join(lines)  # 行を改行でつないで 1 つの文章にする


if __name__ == "__main__":
    print(describe_for_llm("customers"))
```

実行すると、LLM に渡す説明文がこう組み立てられる。

```text
## customers（1 行 = 顧客 1 人）
- customer_id: 顧客番号。C で始まる 4 文字
- annual_income: 年収（税引前の総支給額） / 単位: 円 / 期間: income_year の 1 年間 / 注意: 未申告なら空。0 円とは区別する
- income_year: annual_income が何年の年収か / 単位: 西暦年
- updated_at: この行を最後に更新した日 / 単位: YYYY-MM-DD
```

カタログは Python の辞書で書いたが、形式は何でもよい。大事なのは、**1 か所に書き、人間の資料と AI への説明の両方をそこから作る**ことだ。別々に書くと、片方だけ直されてずれていく。

説明を足す効果は、研究でも確かめられている。Text-to-SQL（自然文から SQL を作らせる課題）のベンチマークで列の説明を足すと、ある大型モデルの正解率は 30.1% から 36.8% に上がった。列名が意味をなさない列では 20% を超える改善があった（Wretblad ほか、2024）。興味深いことに、人間が「余計な情報が多い」と評した詳しめの説明の方が、成績が良かった。

日本語の実践例では、AWS のソリューションアーキテクトが、略語や数値のステータスコードを含む EC サイトのデータベースで検証している。カタログを持たないエージェントは、割引前の金額で売上を計算し、キャンセルされた注文も含めてしまい、約 13% 多い売上を「もっともらしく」答えた。LLM の呼び出し回数も、カタログありの 3 回に対してなしでは 7 回かかった。意味を推測するために、探りの SQL を何度も投げたためだ（池田、2026）。

### 指標は 1 か所で定義し、名前で頼ませる

列の意味を書いても、まだ問題は残る。「残高」を出す SQL をエージェントに毎回書かせると、完済した契約を含めたり、先ほどの粒度の罠を踏んだりする。そこで、**よく使う計算（指標）は人間が 1 回だけ正しく定義し、エージェントには名前で頼ませる**。

```python title="metrics.py" caption="指標の定義を 1 か所に置き、エージェントには名前で頼ませる"
from bank_db import create_db  # 練習用のデータベース

# ★ 指標の定義を 1 か所に置く。エージェントは SQL を書かず、名前で頼む
METRICS = {
    "outstanding_balance": {
        "description": "融資残高（円）。返済中・延滞中の契約の、元本 − 返済済み元本の合計",
        "sql": """
            SELECT c.customer_id, SUM(c.principal - COALESCE(r.paid, 0)) AS value
            FROM loan_contracts AS c
            LEFT JOIN (                               -- ★ 返済は先に「契約ごと」にまとめてからつなぐ
                SELECT contract_id, SUM(amount) AS paid FROM repayments GROUP BY contract_id
            ) AS r ON r.contract_id = c.contract_id
            WHERE c.status IN ('active', 'overdue')   -- 完済した契約は数えない
            GROUP BY c.customer_id
        """,
    },
    "overdue_contracts": {
        "description": "延滞中の契約の件数",
        "sql": "SELECT customer_id, COUNT(*) AS value FROM loan_contracts "
               "WHERE status = 'overdue' GROUP BY customer_id",
    },
}


def get_metric(db, name: str, customer_id: str) -> dict:
    """指標 name を、顧客 customer_id について計算して返す。"""
    if name not in METRICS:
        # ★ 知らない指標を頼まれたら、使える指標の一覧を返して選び直させる
        return {"error": f"指標 '{name}' はありません。使える指標: {', '.join(METRICS)}"}
    rows = db.execute(METRICS[name]["sql"]).fetchall()                # 定義どおりの SQL を実行する
    values = {row["customer_id"]: row["value"] for row in rows}      # 顧客番号 → 値 の辞書にする
    return {
        "metric": name,
        "definition": METRICS[name]["description"],  # ★ 値と一緒に定義も返す（何の数字かを取り違えない）
        "customer_id": customer_id,
        "value": values.get(customer_id, 0),          # 該当が無ければ 0（契約が無い）
    }


if __name__ == "__main__":
    print(get_metric(create_db(), "outstanding_balance", "C001"))
    print(get_metric(create_db(), "loan_balance", "C001"))
```

```text
{'metric': 'outstanding_balance', 'definition': '融資残高（円）。返済中・延滞中の契約の、元本 − 返済済み元本の合計', 'customer_id': 'C001', 'value': 29700000}
{'error': "指標 'loan_balance' はありません。使える指標: outstanding_balance, overdue_contracts"}
```

ポイントは 3 つある。

1. **粒度の罠を定義の中で潰している。** 返済を先に契約ごとに合計（`GROUP BY contract_id`）してから契約とつなぐので、行が増えない
2. **値と一緒に定義を返す。** エージェントが「残高 2,970 万円」を回答に書くとき、それが何を含む数字かも手元にある
3. **無い指標を頼まれたら、選択肢を返す。** エージェントは `loan_balance` という名前を推測で作ることがある。エラーではなく「使える指標」を返せば、次の一手で正しい名前を選び直せる

`COALESCE(r.paid, 0)` は「返済が 1 回も無ければ 0 として扱う」という意味だ。これが無いと、返済の無い契約の残高が空になり、合計から消える。

### SQL を書かせる方式との違い

| 観点 | エージェントに SQL を書かせる | 定義済みの指標を名前で頼ませる |
|---|---|---|
| 答えられる範囲 | 広い（表にあることなら何でも） | 定義した指標だけ |
| 間違え方 | **もっともらしい誤答を黙って返す** | 範囲外なら「その指標は無い」と失敗する |
| 定義のずれ | 聞くたびに計算方法が変わりうる | 全員が同じ定義を使う |
| 準備の手間 | 少ない（カタログは要る） | 指標ごとに定義を書く |

データ変換ツールを作る企業が 2026 年に公開した比較では、15 表・11 問の保険データを各 20 回解かせ、SQL を書かせる方式の正解率が 84〜90% だったのに対し、指標の層を通す方式は 98〜100% だった。ただしこれは問題数の少ない、自社の仕組みの評価で、指標の層の側は比較のために整備を足した条件だ。数字そのものより、同じ記事が指摘する**間違え方の違い**の方が重要だ。SQL を書かせる方式は失敗の合図なしにもっともらしい誤答を返し、指標の層は範囲外の質問に「答えられない」と失敗する。

> [!NOTE] 両方を組み合わせる
> 実務では、よく聞かれる指標（残高・延滞件数・売上など）は定義済みの窓口で答え、それ以外の探索的な質問だけ SQL を書かせる、という組み合わせが現実的だ。SQL を書かせる場合も、カタログを渡し、読み取り専用の権限で実行する。

## AI が誤解しにくいデータ構造にする

カタログで説明を足すのは後から補う方法だ。データの構造そのものを誤解しにくくできるなら、その方がよい。よくある問題と直し方を並べる。

| 問題 | 悪い例 | 良い例 |
|---|---|---|
| 曖昧な項目名 | `amt`、`date`、`flag` | `principal`、`paid_on`、`is_guaranteed` |
| 略語・社内用語 | `acct_st`、`jyuko_kbn` | `account_status`（略すならカタログと用語集に書く） |
| 意味の無いコード値 | `status = 3` | `status = 'overdue'`、または意味の表を別に持つ |
| 単位が名前にも説明にも無い | `income` | `annual_income_yen`、または説明に「円」 |
| 同じ意味のデータが複数ある | 顧客の表にも契約の表にも `address` | 住所は顧客の表だけに置き、他は顧客番号でたどる |
| 同じ言葉が場所によって違う意味 | 部署 A の「売上」は税込、部署 B は税抜 | 指標として 1 つずつ別の名前で定義する |
| 空と 0 と「該当なし」が混ざる | 年収 0 が未申告の意味でも使われる | 空（`NULL`）と 0 を使い分け、カタログに書く |

特に効くのは、**同じ意味のデータを 1 か所に置く**ことだ。顧客の住所が 3 つの表にあると、どれが最新かをエージェントは判断できない。人間なら「顧客マスタが正」と知っているが、それはどこにも書かれていない知識だ。

> [!TIP] 既存の表は直さず、読ませる用の見せ方を作る
> 動いているシステムの列名を変えるのは影響が大きい。その場合は、分かりやすい名前と値に直した**ビュー**（元の表を加工して見せる、仮想の表）を作り、エージェントにはビューだけを見せる。元の表の変更は要らない。

## データ品質：AI は汚いデータを直してくれない

「AI なら多少汚いデータでも何とかしてくれる」という期待は外れる。エージェントは欠けた値を推測で埋め、重複した返済を 2 回数え、古い年収で判断する。しかも、それを自信のある文章で答える。

データ品質の問題は、次の 6 つに整理できる。

| 問題 | 例 | エージェントが起こす誤り |
|---|---|---|
| 欠損 | 年収が空 | 推測で埋める、または「収入なし」と扱う |
| 重複 | 同じ返済が 2 回取り込まれた | 残高を少なく計算する |
| 不整合 | 「完済」なのに返済が元本に届かない | どちらを信じるかを勝手に決める |
| 古いデータ | 2 年前から更新されていない年収 | 古い値で今の判断をする |
| 異常値 | 年収 -1 円 | そのまま計算に使う |
| マスタ不整合 | 契約の顧客番号が顧客の表に無い | 契約者不明のまま集計する |

これらを検査する関数を作る。

```python title="quality.py" caption="6 種類の品質の問題を探す"
from datetime import date  # 日付を扱う道具

STALE_DAYS = 365  # 1 年以上更新されていなければ「古い」とみなす


def check_quality(db, today: date) -> list[str]:
    """6 種類の品質の問題を探し、見つかったものを文章のリストで返す。"""
    issues = []  # 見つかった問題をためておくリスト
    q = db.execute  # 何度も使うので短い名前を付ける

    # 1. 欠損: 必要な値が空
    for r in q("SELECT customer_id FROM customers WHERE annual_income IS NULL"):
        issues.append(f"欠損: {r['customer_id']} の年収が空")
    # 2. 重複: 同じ日・同じ額の返済が 2 件以上ある
    for r in q("SELECT contract_id, paid_on, COUNT(*) AS n FROM repayments "
               "GROUP BY contract_id, paid_on, amount HAVING n > 1"):
        issues.append(f"重複: {r['contract_id']} の {r['paid_on']} の返済が {r['n']} 件")
    # 3. 不整合: 「完済」なのに返済の合計が元本に届かない
    for r in q("SELECT c.contract_id, COALESCE(SUM(r.amount), 0) AS paid, c.principal FROM loan_contracts AS c "
               "LEFT JOIN repayments AS r ON r.contract_id = c.contract_id "
               "WHERE c.status = 'completed' GROUP BY c.contract_id HAVING paid < c.principal"):
        issues.append(f"不整合: {r['contract_id']} は完済なのに返済が {r['paid']:,} 円しかない")
    # 4. 古いデータ: 最後の更新から STALE_DAYS 日を超えている
    for r in q("SELECT customer_id, updated_at FROM customers"):
        if (today - date.fromisoformat(r["updated_at"])).days > STALE_DAYS:  # 日付の引き算で経過日数を出す
            issues.append(f"古い: {r['customer_id']} は {r['updated_at']} から更新されていない")
    # 5. 異常値: ありえない範囲の値
    for r in q("SELECT customer_id, annual_income FROM customers "
               "WHERE annual_income < 0 OR annual_income > 1000000000"):
        issues.append(f"異常値: {r['customer_id']} の年収が {r['annual_income']:,} 円")
    # 6. マスタ不整合: 契約の顧客番号が、顧客の表（マスタ）に無い
    for r in q("SELECT contract_id, customer_id FROM loan_contracts "
               "WHERE customer_id NOT IN (SELECT customer_id FROM customers)"):
        issues.append(f"マスタ不整合: {r['contract_id']} の顧客 {r['customer_id']} が存在しない")
    return issues
```

本物のシステムで起きがちな問題をわざと足して、検査を通してみる。

```python title="quality_gate.py" caption="問題のあるデータを足して検査し、エージェントに渡す前に止める"
from datetime import date
from bank_db import create_db
from quality import check_quality

db = create_db()
# わざと問題のあるデータを足す（本物のシステムでよく起きるもの）
db.execute("INSERT INTO repayments (contract_id, paid_on, amount) VALUES ('L-001', '2026-09-27', 100000)")  # 二重に取り込んだ返済
db.execute("INSERT INTO loan_contracts VALUES ('L-004', 'C002', 'car', 1000000, 'completed', '2024-05-01')")  # 返済記録の無い「完済」
db.execute("INSERT INTO customers VALUES ('C004', '高橋 次郎', -1, 2025, '2026-09-10')")  # 入力ミスの年収
db.execute("INSERT INTO loan_contracts VALUES ('L-005', 'C999', 'card', 300000, 'active', '2026-01-05')")  # 存在しない顧客

issues = check_quality(db, today=date(2026, 9, 29))  # 今日の日付を渡して検査する
for issue in issues:
    print(issue)

# ★ 関所: 問題が 1 つでもあれば、エージェントにデータを渡す前に止める
if issues:
    print(f"→ {len(issues)} 件の問題があるため、このデータはエージェントに渡しません")
```

```text
欠損: C003 の年収が空
重複: L-001 の 2026-09-27 の返済が 2 件
不整合: L-004 は完済なのに返済が 0 円しかない
古い: C003 は 2024-03-10 から更新されていない
異常値: C004 の年収が -1 円
マスタ不整合: L-005 の顧客 C999 が存在しない
→ 6 件の問題があるため、このデータはエージェントに渡しません
```

マスタ不整合が入り込めたのは、この練習用データベースが外部キー（「契約の顧客番号は、顧客の表に必ずある」という制約）を強制していないためだ。**データベースの制約で防げるものは制約で防ぎ、防げないものを検査で拾う**、という二段構えにする。

> [!WARNING] 全部止めるか、問題の行だけ外すか
> 例では問題が 1 つでもあれば全体を止めたが、実務では厳しすぎることが多い。問題のある行だけを隔離して、エージェントには「C003 の年収は品質の問題で使えない」と伝える方法もある。黙って外すと、エージェントは「C003 には年収のデータが無い」と誤解する。**外したことを伝える**のが要点だ。

## データへの窓口を設計する

最後に、エージェントがデータを取りに行く**窓口**を作る。窓口の作り方には幅がある。

| 窓口 | エージェントに任せる範囲 | 向いている場面 | 気をつけること |
|---|---|---|---|
| 生の SQL を書かせる | 広い（何でも聞ける） | 探索的な分析 | 誤答が静か。読み取り専用・件数の上限・カタログが必須 |
| 定義済みの指標 | 狭い（名前で頼むだけ） | よく聞かれる数字 | 定義の外は答えられない |
| 決まった関数（API・関数呼び出し） | 中くらい（引数だけ選ぶ） | 決まった業務の照会・登録 | 関数の数を増やしすぎない |
| ベクトル検索 | 検索語を決める | 文書（規程・議事録など） | 連載の 2 回目で扱う |
| ファイル検索 | 検索語と場所を決める | 共有フォルダの資料 | 古い版・重複した資料が混ざる |
| 外部システム | 呼ぶ順番と引数を決める | 他社や他部署のサービス | 遅延・失敗・二重の登録。書き込みは承認を挟む |

どれを選ぶかは、冒頭の「行動」から決める。融資サポートの「検索する」「計算する」には、決まった関数が合う。LLM が関数を選び、引数を埋めて呼ぶ仕組みは、サービスによって Function Calling や Tool use と呼ばれるが、中身は同じだ（詳しくは[前回の記事](2026-09-29-ai-agent-design-fundamentals.html)）。

関数の数は、行動の数に合わせて少なく保つ。システムの画面や API の数だけ関数を並べると、エージェントはどれを使うかで迷う。

### ツールの説明書：何が返るかまで書く

融資サポートのための 3 つのツールを定義する。

```python title="loan_tools_schema.py" caption="LLM に渡すツールの説明書。行動ごとに 1 つ用意する"
# LLM に渡す「ツールの説明書」。エージェントの行動（調べる・比べる）ごとに 1 つ用意する
LOAN_TOOLS = [
    {
        "name": "get_customer_info",
        # ★ 何が返るか・単位・何年時点かまで説明に書く
        "description": "顧客番号から顧客の基本情報を取る。年収は円・税引前で、何年の年収かも返す。"
                       "data_as_of はデータの更新日。",
        "parameters": {
            "type": "object",
            "properties": {"customer_id": {"type": "string", "description": "顧客番号。例: C001"}},
            "required": ["customer_id"],
        },
    },
    {
        "name": "get_loan_status",
        "description": "契約番号から、融資の状態と残高（円）を取る。残高は元本 − 返済済み元本。",
        "parameters": {
            "type": "object",
            "properties": {"contract_id": {"type": "string", "description": "契約番号。例: L-001"}},
            "required": ["contract_id"],
        },
    },
    {
        "name": "search_contract",
        "description": "顧客の契約を一覧する。契約番号が分からないときに最初に使う。最大 20 件。",
        "parameters": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string"},
                # ★ 状態は選択肢で渡させる。「延滞」「滞納」などの言い換えで迷わない
                "status": {"type": "string", "enum": ["active", "completed", "overdue", "all"]},
            },
            "required": ["customer_id"],
        },
    },
]
```

説明文には「いつ使うか」（契約番号が分からないときに最初に使う）と「何が返るか」（円・税引前・何年の年収か）を書いた。LLM はこの説明書だけを読んで、どのツールをどう使うかを決める。

### ツールの中身：AI が次に使う形で返す

```python title="loan_tools.py" caption="ツールの中身。値に意味を添え、計算は済ませてから返す"
from catalog import CATALOG  # 値の意味（active → 返済中 など）を引くためのカタログ

LABELS = {col: CATALOG["loan_contracts"]["columns"][col]["values"] for col in ("product", "status")}


def get_customer_info(db, customer_id: str) -> dict:
    row = db.execute("SELECT * FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()  # ? に値を安全に埋める
    if row is None:  # 見つからなければ、次にやることを伝える
        return {"error": f"顧客 {customer_id} はいません。顧客番号は C で始まる 4 文字です。"}
    return {
        "customer_id": row["customer_id"],
        "name": row["name"],
        # ★ 数字だけでなく、単位と「何年の値か」を一緒に返す
        "annual_income": {"yen": row["annual_income"], "year": row["income_year"]},
        "data_as_of": row["updated_at"],  # ★ いつ時点のデータか
    }


def get_loan_status(db, contract_id: str) -> dict:
    row = db.execute("""
        SELECT c.*, COALESCE(SUM(r.amount), 0) AS paid, MAX(r.paid_on) AS last_paid_on
        FROM loan_contracts AS c LEFT JOIN repayments AS r ON r.contract_id = c.contract_id
        WHERE c.contract_id = ? GROUP BY c.contract_id
    """, (contract_id,)).fetchone()
    if row is None:
        return {"error": f"契約 {contract_id} はありません。search_contract で契約番号を調べてください。"}
    return {
        "contract_id": row["contract_id"],
        "product": LABELS["product"][row["product"]],  # ★ 'housing' ではなく「住宅ローン」で返す
        "status": LABELS["status"][row["status"]],      # 'overdue' ではなく「延滞中」
        "principal_yen": row["principal"],
        "balance_yen": row["principal"] - row["paid"],  # ★ 残高は計算済みで返す（LLM に計算させない）
        "last_paid_on": row["last_paid_on"],
    }


def search_contract(db, customer_id: str, status: str = "all") -> list[dict]:
    sql, params = "SELECT contract_id, product, status, start_date FROM loan_contracts WHERE customer_id = ?", [customer_id]
    if status != "all":  # 状態の指定があれば絞り込む
        sql, params = sql + " AND status = ?", params + [status]
    rows = db.execute(sql + " ORDER BY start_date DESC LIMIT 20", params).fetchall()  # 新しい順に最大 20 件
    return [{"contract_id": r["contract_id"], "product": LABELS["product"][r["product"]],
             "status": LABELS["status"][r["status"]], "start_date": r["start_date"]} for r in rows]
```

3 つのツールを呼んでみる。

```python title="loan_tools_demo.py" caption="3 つのツールを呼んで、返り値を確かめる"
from bank_db import create_db
from loan_tools import search_contract, get_loan_status, get_customer_info

db = create_db()
print(search_contract(db, "C001"))        # 山田さんの契約の一覧
print(get_loan_status(db, "L-001"))       # 住宅ローンの状態と残高
print(get_customer_info(db, "C003"))      # 年収が未申告で、更新も古い鈴木さん
```

```text
[{'contract_id': 'L-002', 'product': '自動車ローン', 'status': '完済', 'start_date': '2021-06-01'}, {'contract_id': 'L-001', 'product': '住宅ローン', 'status': '返済中', 'start_date': '2020-04-01'}]
{'contract_id': 'L-001', 'product': '住宅ローン', 'status': '返済中', 'principal_yen': 30000000, 'balance_yen': 29700000, 'last_paid_on': '2026-09-27'}
{'customer_id': 'C003', 'name': '鈴木 一郎', 'annual_income': {'yen': None, 'year': None}, 'data_as_of': '2024-03-10'}
```

この窓口には、ここまでの章の内容が詰まっている。

| 工夫 | どこで | 章 |
|---|---|---|
| 粒度の罠を窓口の中で潰す | 返済を契約ごとに合計してから残高を出す | 粒度 |
| 値に意味を添える | `'overdue'` → 「延滞中」、年収に年と単位 | 意味の定義 |
| 計算は済ませてから返す | `balance_yen` | 指標の定義 |
| いつ時点かを返す | `data_as_of` | 品質（古いデータ） |
| 見つからないときに次の手を返す | `search_contract で調べてください` | 窓口 |

鈴木さん（C003）の結果を見ると、年収が空（`None`）で、データは 2024 年 3 月のものだと分かる。エージェントはこれを見て、「年収が未申告で、情報も 2 年以上前のものです」と答えられる。**空であることと古いことを隠さずに返す**から、推測で埋めずに済む。

`?` を使って値を埋めているのは、SQL インジェクション（値に紛れ込ませた命令で、データベースを操作される攻撃）を防ぐためだ。LLM が作った引数も、利用者が入力した値と同じく信頼せずに扱う。

## 設計チェックリスト

構造化データをエージェントに渡す前に、順に確かめる。

| 段階 | 確かめること |
|---|---|
| 目的 | 何を判断・回答・実行するかを言えるか。行動（検索・比較・計算・判断・登録）に分解したか |
| 必要なデータ | 行動ごとに必要なデータを挙げたか。目的の外のデータを渡していないか |
| 粒度 | 表ごとに「1 行 = 何か」が決まり、カタログに書いてあるか。粒度の違う表をつないで合計していないか |
| 意味 | 列ごとに定義・単位・期間・空の意味が書いてあるか。社内用語の用語集があるか |
| 指標 | よく聞かれる数字を 1 か所で定義し、名前で頼めるようにしたか |
| 構造 | 曖昧な名前・略語・意味の無いコード値が無いか。同じ意味のデータが 1 か所にあるか |
| 品質 | 欠損・重複・不整合・古さ・異常値・マスタ不整合を検査しているか。外した行があることを伝えているか |
| 窓口 | 行動に合った窓口を選んだか。返り値に単位・意味・時点が付いているか。見つからないときに次の手を返すか |

次回は、PDF・規程・議事録のような**文書**を、エージェントが検索して根拠付きで答えられる形に整える。表のデータで「列の意味」を定義したのと同じように、文書にも「いつの、どの版の、誰向けの文書か」というメタデータを持たせることになる。

## 参考文献

- Niklas Wretblad ほか, [Synthetic SQL Column Descriptions and Their Impact on Text-to-SQL Performance](https://arxiv.org/abs/2408.04691)（arXiv, 2024-11-05 改訂版）
- dbt Labs, [Semantic Layer vs. Text-to-SQL: 2026 Benchmark Update](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026)（2026-04-07）
- Pramod Sadalage, Prem Chandrasekaran, [Making Data Ready for Agentic AI](https://martinfowler.com/articles/making-data-ready-for-agentic-ai.html)（martinfowler.com, 2026-08-27）
- Anthropic, [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)（2025-09-11）

### 日本語で読める関連記事

- 池田 貴之, [AIエージェントのデータ分析にビジネスデータカタログは必要か？ 検証してみた](https://zenn.dev/aws_japan/articles/88d99d2df3f289)（Zenn, 2026-03-28）— カタログの有無で、売上の誤差と LLM の呼び出し回数がどう変わるかを実測している
- Shiro Kobayashi, [oracle-ai-ready-data Skill で Oracle Database のスキーマを AI Ready Data 評価してみてみた](https://qiita.com/shirok/items/3b9ccefff059ff1ab40d)（Qiita, 2026-06-23）— スキーマを「構造の信頼性・文脈・鮮度・追跡性」などの観点で採点する例

※ 記事中の数値・仕様は 2026 年 9 月時点で確認したもの。
