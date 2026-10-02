---
title: データはどこで「意味」を持つのか——Raw から DWH までの層設計
description: 業務システムから集めたデータを、そのまま BI や AI に渡してはいけない。収集・Raw・整形・業務モデル・提供の各層が何に責任を持ち、何をしてはいけないかを整理し、Raw を残す理由、層の間の品質の関所、検査に通ったときだけ差し替える公開、Raw からの作り直しまでを、動く小さなパイプラインで確かめる。
date: "2026-10-02"
verified: "2026-10-02"
category: データ設計
tags: [データ基盤, DWH, データパイプライン, データ品質, SQL, Python]
level: [practice, advanced]
series: データ設計の基礎
status: published
---

ダッシュボードの売上が、ある朝から急に増えた。調べると、EC のシステムがキャンセルの表記を `cancelled` から `canceled` に変えていた。集計は `cancelled` だけを除外していたので、キャンセルされた注文が売上に数えられていた。しかも、取り込みのたびに元のデータを加工して上書きしていたため、正しい数字に戻すための元データが残っていなかった。

データ基盤の設計で決めるのは、どのツールを使うかより先に、**データがどの順に、どこで、何をされるか**だ。この記事は連載の最終回として、これまでの回で設計した粒度・キー・正規化・マスター・履歴を、データ基盤の層の中に配置する。

> [!TIP] この記事で分かること
> - 業務システムから BI・機械学習・AI までの、データの流れの全体像
> - Raw・整形・業務モデル・提供の各層が持つ責任と、してはいけないこと
> - 層の呼び名の流儀（Bronze / Silver / Gold、staging / marts など）の対応
> - 収集の方式（全件・差分・変更データキャプチャ）の選び方
> - 層の間に品質の関所を置き、検査に通ったときだけ公開する方法
> - Raw を残しておくと、規則の誤りを後から直せる理由

## コードの読み方

コードは Python と SQL で書き、ほぼ全行に日本語の説明を付けた。大事な行には `★` を付けてある。Python に最初から入っている道具だけで動き、上から順に実行すると記事と同じ結果が出る。

| 書き方 | 意味 |
|---|---|
| `# 〜` / `-- 〜` | Python / SQL の説明文（コメント） |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `json.dumps(値)` | 辞書などを、JSON（データを文字で表す形式）の文字列にする |
| `json_extract(列, '$.名前')` | SQL の中で、JSON の文字列から指定した項目を取り出す |
| `ROW_NUMBER() OVER (PARTITION BY a ORDER BY b DESC)` | `a` ごとに `b` の大きい順で 1, 2, 3… と番号を振る |
| `ALTER TABLE 古い名前 RENAME TO 新しい名前` | 表の名前を変える |

## 全体マップ：業務システムから利用者まで

データ基盤は、業務システムで生まれたデータを、利用者が意思決定に使える形まで段階的に変えていく仕組みだ。

```flow caption="データ基盤の流れ。層ごとに責任が決まっていて、上流ほど元の形に近い"
A([業務システム\n注文・顧客・在庫]) --> B[収集\n全件・差分・CDC]
B --> C[Raw\n届いたまま保存]:::hl
C --> D[整形\n型・名前・コードを揃える]
D --> E[業務モデル\n結合・マスター統合・履歴]
E --> F[提供\nDWH・データマート]
F --> G([BI・分析・機械学習・AI])
```

各層の間には品質の関所を置き、問題のあるデータを下流に流さない。その仕組みは後半で作る。

## 層ごとの責任：何をして、何をしないか

層を分ける目的は、**1 つの層に 1 つの責任だけを持たせる**ことにある。どこで何が起きたかを追えるようにし、規則を直すときに 1 か所を直せば済むようにするためだ。

| 層 | 責任 | してはいけないこと | 粒度 |
|---|---|---|---|
| Raw | 届いたデータを、届いた形のまま保存する。取り込み日時・取り込み元・取り込み回の番号を付ける | 加工・上書き・削除。誤りの修正も Raw ではしない | 届いたまま |
| 整形 | 型を変える、列名を揃える、コードを標準化する、重複を除く。元の表と 1 対 1 | 表どうしの結合、業務の集計 | 元の表と同じ |
| 業務モデル | 結合、マスターの統合（[第 4 回](2026-10-02-data-design-4-master-data.html)）、履歴の版（[第 5 回](2026-10-02-data-design-5-history-scd.html)）、業務ルールの適用 | 特定の利用者だけの都合を入れる | 業務のできごとごとに宣言する |
| 提供 | 利用者の目的に合わせたスタースキーマ・ワイドテーブル・集計表（[第 3 回](2026-10-02-data-design-3-normalization.html)） | 正を持つこと。必ず業務モデルから作り直せるようにする | 用途ごとに宣言する |

整形の層で結合しないのは、ここで業務の解釈を入れると、元のデータとの対応が追えなくなるからだ。分析用の変換ツールとして広く使われる dbt の公式ガイドも、最初の層（staging）は元の表と 1 対 1 にし、列名の変更や型の変換だけを行うよう勧めている。

### 呼び名の対応

層の名前は流儀によって違う。指している責任はほぼ同じなので、対応表で読み替えればよい。

| この記事 | メダリオン構成 | dbt の推奨構成 | 古くからの呼び方 |
|---|---|---|---|
| Raw | Bronze | sources | ランディング |
| 整形 | Silver（の前半） | staging | ステージング、クレンジング |
| 業務モデル | Silver（の後半） | intermediate | DWH（統合層）、コア |
| 提供 | Gold | marts | データマート |

**メダリオン構成**は、Databricks などが広めた、データの品質を Bronze → Silver → Gold と段階的に上げていく構成だ。Databricks の公式ドキュメントは、取り込んだデータを直接 Silver に書き込まないよう勧めている。元のデータの構造の変化や壊れたレコードで取り込みが失敗し、データを失うおそれがあるからだ。

### DWH とレイクハウス

データを置く場所にも、いくつかの型がある。

| 型 | どんなものか | 向くもの |
|---|---|---|
| DWH（データウェアハウス） | 表の形に整えたデータを、SQL で高速に集計するための専用のデータベース | BI・定型レポート・SQL による分析 |
| データレイク | ファイル（CSV・JSON・画像など）を形を問わず安価に大量に置く場所 | 生データの保管、機械学習の素材 |
| レイクハウス | データレイクのファイルの上に、表としての管理（取引の一貫性・スキーマ・履歴）を載せたもの | DWH とデータレイクの両方の用途を 1 か所で |

どれを選んでも、層の考え方は変わらない。Raw はデータレイクに、提供は DWH に、と層ごとに置き場所を分ける構成もよく見られる。

## 収集：どうやって取ってくるか

業務システムからデータを取ってくる方法は、主に 3 つある。

| 方式 | どう取るか | 強み | 弱み |
|---|---|---|---|
| 全件 | 毎回、表を丸ごと取る | 単純。取りこぼしがない | 大きな表では重い。削除や途中の変更は差分として見えない |
| 差分 | 前回以降に更新された行だけ取る（更新日時の列で絞る） | 軽い | 更新日時が正しく付かない変更・物理削除を取りこぼす |
| CDC（変更データキャプチャ） | データベースの変更記録（ログ）を読み、挿入・更新・削除を順に流す | 削除も途中の変更も取れる。業務システムの負荷が小さい | 仕組みが複雑。運用の手間がかかる |

小さなマスターは全件、大きな取引のデータは差分か CDC、という組み合わせが多い。どの方式でも、**取り込んだものは Raw に追記で積む**。

ここから、小さなパイプラインを作っていく。まず、EC の注文を JSON の形のまま Raw に積む。

```python title="ingest_raw.py" caption="届いたデータを加工せずに Raw へ追記し、取り込みの情報を付ける" {12,21}
import json, sqlite3  # json はデータを文字で表す形式を扱う道具、sqlite3 は小さなデータベース

con = sqlite3.connect(":memory:")  # 使い捨てのデータベース
con.execute("""CREATE TABLE raw_orders (       -- Raw 層。1 行 = 届いたレコード 1 つ
                 payload    TEXT,              -- 届いた中身。そのままの文字列で持つ
                 _source    TEXT,              -- どこから来たか
                 _batch_id  INTEGER,           -- 何回目の取り込みか
                 _loaded_at TEXT)""")          # いつ取り込んだか

def ingest(con, records, source, batch_id, loaded_at):
    """届いたレコードを、加工せずに Raw へ追記する"""
    with con:                                  # ★ 1 回分の取り込みは、全部入るか全部入らないか
        con.executemany("INSERT INTO raw_orders VALUES (?, ?, ?, ?)",
                        [(r if isinstance(r, str) else json.dumps(r), source, batch_id, loaded_at)
                         for r in records])    # 辞書は JSON の文字列に。壊れた文字列もそのまま

ingest(con, [{"id": 1, "date": "2026-04-01", "amt": "1000", "status": "ordered"},
             {"id": 2, "date": "2026-04-01", "amt": "2500", "status": "ordered"}],
       "ec", 1, "2026-04-01T23:00:00+09:00")   # 1 日目の取り込み
ingest(con, [{"id": 1, "date": "2026-04-01", "amt": "1000", "status": "SHIPPED"},   # 注文 1 が出荷された
             {"id": 3, "date": "2026-04-02", "amt": "800", "status": "canceled"},   # ★ 表記の違うキャンセル
             '{"id": 4, "date": "2026-04-02", "amt":'],                              # 途中で切れた壊れたデータ
       "ec", 2, "2026-04-02T23:00:00+09:00")   # 2 日目の取り込み
print(con.execute("SELECT COUNT(*), COUNT(DISTINCT _batch_id) FROM raw_orders").fetchone())
```

```text
(5, 2)
```

12 行目のように、1 回分の取り込みは全部入るか全部入らないかのどちらかにする。途中で失敗して半分だけ入ると、どこまで入ったかを調べる手間が生まれる。

Raw には、2 日分・5 件のレコードがそのまま入った。注文 1 は「受注」と「出荷」の 2 つの状態で 2 回現れ、21 行目のキャンセルは `canceled` という別の表記で届いている。最後のレコードは途中で切れていて、JSON として読めない。**Raw の段階では、これらを直さない**。

> [!WARNING] Raw に置くものに気をつける
> Raw は加工しない層だが、個人情報や機密情報もそのまま入ることになる。誰が Raw を読めるかは、ほかの層より狭くしておく。マイナンバーやカード番号のように、そもそも基盤に持ち込むべきでない情報は、収集の段階で取らない・伏せる（マスキングする）ように決めておく。

## 整形：型・名前・コードを揃え、最新の 1 件に絞る

整形の層では、Raw を読んで、型の変換・列名の統一・コードの標準化・重複の除去を行う。読めないレコードは捨てずに**隔離**して、件数を見えるようにする。

```python title="build_staging.py" caption="Raw から整形層を作り直す。壊れた行は隔離し、注文ごとに最新の 1 件に絞る" {7,9,17,20,27}
def build_staging(con, status_map):
    """Raw から整形層を作り直す。status_map は、届いた表記 → 標準のステータス"""
    con.execute("DROP TABLE IF EXISTS status_map")
    con.execute("CREATE TABLE status_map (raw TEXT PRIMARY KEY, status TEXT)")   # 対応表を表にする
    con.executemany("INSERT INTO status_map VALUES (?, ?)", status_map.items())
    con.executescript("""
    DROP TABLE IF EXISTS quarantine;                -- ★ 毎回作り直す。何度実行しても同じ結果になる
    CREATE TABLE quarantine AS                      -- 隔離。JSON として読めなかった行
      SELECT * FROM raw_orders WHERE NOT json_valid(payload);   -- ★

    DROP TABLE IF EXISTS stg_orders;
    CREATE TABLE stg_orders AS                      -- 整形層。1 行 = 注文 1 件（最新の状態）
      SELECT order_id, ordered_on, amount, status, _loaded_at FROM (
        SELECT CAST(json_extract(payload, '$.id') AS INTEGER)  AS order_id,     -- 型を整数に
               json_extract(payload, '$.date')                 AS ordered_on,   -- 列名を揃える
               CAST(json_extract(payload, '$.amt') AS INTEGER) AS amount,       -- 文字列の金額を整数に
               COALESCE(m.status, 'unknown')                   AS status,       -- ★ 対応表にない表記は unknown
               r._loaded_at,
               ROW_NUMBER() OVER (PARTITION BY json_extract(payload, '$.id')
                                  ORDER BY r._loaded_at DESC) AS rn             -- ★ 注文ごとに新しい順の番号
        FROM raw_orders r
        LEFT JOIN status_map m ON m.raw = lower(json_extract(r.payload, '$.status'))  -- 小文字に揃えて引く
        WHERE json_valid(r.payload)                 -- 読めた行だけを使う
      ) WHERE rn = 1;                               -- 最新の 1 件だけ残す
    """)

STATUS_MAP_V1 = {"ordered": "ordered", "shipped": "shipped", "cancelled": "cancelled"}  # ★ 最初の対応表
build_staging(con, STATUS_MAP_V1)
print("整形:", con.execute("SELECT order_id, amount, status FROM stg_orders ORDER BY order_id").fetchall())
print("隔離:", con.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0], "件")
```

```text
整形: [(1, 1000, 'shipped'), (2, 2500, 'ordered'), (3, 800, 'unknown')]
隔離: 1 件
```

7 行目のように、整形層は毎回**消してから作り直す**。追記ではないので、何度実行しても結果は同じになる。9 行目で、JSON として読めない行を隔離の表へ分けた。捨てずに残しておけば、取り込み元に問い合わせるときの証拠になる。

20 行目の `ROW_NUMBER` で、注文ごとに新しい順の番号を振り、1 番だけを残している。注文 1 は 2 回届いたが、最新の「出荷済み」だけが残った。17 行目では、対応表にないステータスを `unknown` にしている。27 行目の最初の対応表には `canceled` がないので、注文 3 は `unknown` になった。推測で `cancelled` に寄せたりはしない。

## 関所：検査に通ったときだけ公開する

提供の層は、利用者が直接見る表だ。ここに壊れたデータが出ると、その数字で意思決定が行われてしまう。そこで、新しい表を**いったん別名で作り、検査に通ったときだけ公開中の表と差し替える**。検査に落ちたら、利用者は前回の正しい表を見続ける。

検査の中身は、これまでの回で作ってきたものだ。

| 検査 | 何を見るか | 回 |
|---|---|---|
| 粒度 | 宣言したキーで重複がない | [第 1 回](2026-10-02-data-design-1-purpose-grain.html) |
| 参照整合性 | 孤児の行がない | [第 2 回](2026-10-02-data-design-2-entity-keys.html) |
| 突き合わせ | 件数・合計が上流と一致する | [第 3 回](2026-10-02-data-design-3-normalization.html) |
| 未登録のコード | 対応表にない値がない | [第 4 回](2026-10-02-data-design-4-master-data.html) |
| 版の期間 | 有効期間の重なり・抜けがない | [第 5 回](2026-10-02-data-design-5-history-scd.html) |
| 鮮度 | 最後の取り込みが想定より古くない | この回 |

```python title="publish.py" caption="提供用の表を別名で作り、検査に通ったときだけ差し替える" {4,13,24,26}
def build_mart(con):
    """整形層から、日別の売上の表を「次の版」として作る"""
    con.executescript("""
    DROP TABLE IF EXISTS fct_daily_sales__next;   -- ★ 公開中の表とは別の名前で作る
    CREATE TABLE fct_daily_sales__next AS         -- 1 行 = 1 日
      SELECT ordered_on AS sales_date, SUM(amount) AS amount, COUNT(*) AS orders
      FROM stg_orders WHERE status <> 'cancelled' GROUP BY ordered_on;
    """)

CHECKS = {  # 検査の名前 → 問題のある行を数える SQL。0 なら合格
    "粒度: 日付の重複":     "SELECT COUNT(*) - COUNT(DISTINCT sales_date) FROM fct_daily_sales__next",
    "未登録のステータス":   "SELECT COUNT(*) FROM stg_orders WHERE status = 'unknown'",
    "隔離された行":         "SELECT COUNT(*) FROM quarantine",                         # ★ 壊れた行も知らせる
    "鮮度: 最終取り込み":   """SELECT COUNT(*) FROM (SELECT MAX(_loaded_at) AS t FROM raw_orders)
                               WHERE t < '2026-04-02T00:00:00+09:00'""",               # 前日分が来ていなければ不合格
}
BLOCKING = {"粒度: 日付の重複", "未登録のステータス", "鮮度: 最終取り込み"}  # 不合格なら公開を止める検査

def publish(con):
    """次の版を作り、止める検査がすべて合格したときだけ公開中の表と差し替える"""
    build_mart(con)
    failed = {name: n for name, sql in CHECKS.items() if (n := con.execute(sql).fetchone()[0])}
    print("不合格:", failed or "なし")
    if BLOCKING & failed.keys():                    # ★ 止める検査が 1 つでも落ちたら差し替えない
        return "公開を見送り（前回の表のまま）"
    with con:                                       # ★ 古い表を消し、次の版を公開名に変える
        con.execute("DROP TABLE IF EXISTS fct_daily_sales")
        con.execute("ALTER TABLE fct_daily_sales__next RENAME TO fct_daily_sales")
    return "公開しました"

print(publish(con))
```

```text
不合格: {'未登録のステータス': 1, '隔離された行': 1}
公開を見送り（前回の表のまま）
```

4 行目で、提供用の表を公開中の名前とは別の名前（`__next`）で作っている。24 行目で、止める検査が 1 つでも落ちていたら差し替えない。今回は未登録のステータス（`canceled`）が 1 件あったので、公開は見送られた。冒頭の「キャンセルが売上に数えられた」事故は、ここで止まる。

13 行目の「隔離された行」は、落ちても公開は止めない検査として扱っている。壊れた 1 件のために全体の公開を止めるかどうかは、業務と相談して決める。止めない場合でも、件数は必ず担当者に知らせる。26〜28 行目は、検査に通ったときだけ、古い表を消して次の版を公開名に変える。利用者から見ると、表は一瞬で新しい版に切り替わる。

> [!NOTE]
> 本格的なデータ基盤では、この「別名で作って差し替える」をツールやデータベースの機能が担う。表の差し替えを一瞬で行う機能や、版を持つ表形式（いつの版でも読み出せる表）を使う方法がある。考え方は同じで、**検査に落ちた版を利用者に見せない**ことだ。

## Raw があるから、規則の誤りを後から直せる

未登録のステータスを調べた担当者が、`canceled` は `cancelled` と同じ意味だと確認した。ここで直すのは対応表、つまり**規則**だ。Raw には届いたままのデータが残っているので、規則を直して整形層から作り直せば、過去のデータにも新しい規則が当たる。

```python title="reprocess.py" caption="対応表を直し、Raw から整形層と提供層を作り直す" {1,3}
STATUS_MAP_V2 = {**STATUS_MAP_V1, "canceled": "cancelled"}   # ★ 規則を直す（米国式のつづりを追加）

build_staging(con, STATUS_MAP_V2)                           # ★ Raw から整形層を作り直す
print(publish(con))                                         # 提供層を作り直し、検査して公開する
print(con.execute("SELECT * FROM fct_daily_sales ORDER BY sales_date").fetchall())
```

```text
不合格: {'隔離された行': 1}
公開しました
[('2026-04-01', 3500, 2)]
```

1 行目で対応表に 1 行を足し、3 行目で Raw から作り直しただけで、注文 3 はキャンセルとして正しく除外された。4 月 1 日の売上は、注文 1（出荷済み）と注文 2 の 3,500 円・2 件だ。

冒頭の事故で数字を戻せなかったのは、取り込みのたびに元のデータを加工して上書きしていたからだ。Raw が残っていれば、規則の誤りは「規則を直して作り直す」だけで済む。**Raw を加工しない**という約束は、この作り直しを可能にするためにある。

> [!TIP] 作り直せることを、普段から確かめておく
> 作り直しは、普段使っていないと、いざというときに動かない。整形層と提供層を毎回「消してから作る」形で書いておけば、日々の実行そのものが作り直しの練習になる。データ量が増えて毎回の全件作り直しが重くなったら、差分だけを処理する形に変えるが、そのときも全件で作り直す手段は残しておく。

## 連載のまとめ：データ設計チェックリスト

6 回で扱った設計を、1 枚にまとめる。新しい表やデータ基盤を作るとき、上から順に確かめる。

| 回 | 段階 | 確かめること |
|---|---|---|
| 1 | 目的 | 誰が何を決めるためのデータか。BI・分析・機械学習・AI のどれに使うか |
| 1 | 業務 | 業務の流れ・用語・発生と更新のタイミング・責任者を調べたか |
| 1 | 意味 | 列ごとに意味・単位・集計方法・更新頻度・適用範囲があるか |
| 1 | 粒度 | 表ごとに「1 行 = 何か」を宣言し、重複の検査をしているか。結合の前に粒度を揃えているか |
| 2 | エンティティ | 管理対象を表に分け、関係（1 対多・多対多・親子）を表の形に落としたか |
| 2 | キー | 主キーは一意・安定・NULL なしか。自然キーに一意制約を付けたか |
| 2 | 参照整合性 | 外部キーか検査で孤児を防いでいるか。削除時の挙動を関係ごとに決めたか |
| 3 | 正規化 | 1 つの事実を 1 か所に置いたか。その時点で決まった事実を区別したか |
| 3 | 非正規化 | 崩す理由と利用者を言えるか。正の表から作り直し、突き合わせているか |
| 4 | マスター | 情報ごとに唯一の正と責任者が決まっているか。コード体系の約束事を守っているか |
| 4 | 揃え方 | 表記の揺れを対応表で揃え、未登録を推測で埋めずに知らせているか。名寄せの結果を対応表で残しているか |
| 5 | 履歴 | 現在値と履歴を区別したか。更新日時・更新者・更新前後・バージョンを残しているか |
| 5 | SCD | 列ごとにタイプを決めたか。有効期間の重なりと抜けを検査しているか |
| 6 | 層 | 各層の責任が決まっているか。Raw を加工していないか |
| 6 | 関所 | 検査に通ったときだけ公開しているか。隔離した行の件数を知らせているか |
| 6 | 作り直し | 規則を直したとき、Raw から作り直せるか |

データ設計の多くは、**後から取り戻せないものを、最初に残しておく**ための判断だ。生のデータ、過去の値、変更の記録、名寄せの根拠。どれも、失ってから必要になる。

AI エージェントや RAG にデータを渡すときに、この上で追加で考えることは、連載「AIエージェントのデータ設計」の[AIエージェントは「データの意味」を推測できない](2026-09-29-ai-agent-data-design-1-structured.html)から読める。

## 参考文献

- Databricks, [What is the medallion lakehouse architecture?](https://docs.databricks.com/aws/en/lakehouse/medallion)（2026-09-11 更新 / 確認 2026-10-02）— Bronze・Silver・Gold の役割、取り込みから直接 Silver に書かない理由
- dbt Labs, [How we structure our dbt projects](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview)（確認 2026-10-02）— staging・intermediate・marts と、元の形から業務の形への変換
- Michael Armbrust ほか, [Lakehouse: A New Generation of Open Platforms that Unify Data Warehousing and Advanced Analytics](https://vldb.org/cidrdb/2021/lakehouse-a-new-generation-of-open-platforms-that-unify-data-warehousing-and-advanced-analytics.html)（CIDR 2021, 2021-01）— レイクハウスの提案
- Kimball Group, [Kimball Data Warehouse Bus Architecture](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/kimball-data-warehouse-bus-architecture/)（確認 2026-10-02）
- SQLite, [JSON Functions And Operators](https://www.sqlite.org/json1.html)（確認 2026-10-02）

### 日本語で読める関連記事

- tenajima, ["How we structure our dbt projects"を読む](https://zenn.dev/tenajima/articles/6b7fbaffe842e2)（Zenn, 2022-03-04）— sources・staging・marts の 3 段階と `fct_` / `dim_` の命名を日本語で整理している。欲しいダッシュボードから逆算して設計する、という指摘もある

※ 記事中の情報は 2026 年 10 月時点で確認したもの。
