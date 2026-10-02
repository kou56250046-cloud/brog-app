---
title: 「当時の住所」で集計できるか——現在値と履歴の持ち方と SCD
description: 顧客が引っ越したら、過去の売上はどの地域に数えるのか。現在値と履歴の区別、更新日時・更新者・更新前後・バージョンを残す更新履歴、DWH の定番である SCD（ゆっくり変わる属性の持ち方）のタイプ 0〜3・6 の選び方、有効期間を使った「その時点」の結合と、期間の重なりの検査までを、動く Python で分解する。
date: "2026-10-02"
verified: "2026-10-02"
category: データ設計
tags: [データモデリング, 履歴管理, SCD, DWH, SQL, Python]
level: [practice, advanced]
series: データ設計の基礎
status: published
---

去年の地域別売上を、今日あらためて集計し直した。すると、去年の報告と数字が合わない。原因は、去年東京にいた顧客が今年神奈川に引っ越し、顧客の表の住所が**上書き**されていたことだった。今日集計すると、去年の買い物まで神奈川の売上として数えられる。

どちらの数字が正しいかは、問いによって変わる。「顧客が当時どこにいたか」で集計したいときもあれば、「いまの顧客の分布」で過去を見直したいときもある。大事なのは、**両方の問いに答えられるだけの情報を残しておく**ことだ。上書きしてしまった過去は、後からは取り戻せない。

> [!TIP] この記事で分かること
> - 現在値と履歴を、どの単位で・どの形で持ち分けるか
> - 更新日時・更新者・更新前・更新後・バージョンを残す更新履歴の作り方
> - 同時に更新したときの上書き事故を、バージョン番号で防ぐ方法
> - SCD（Slowly Changing Dimension）のタイプ 0・1・2・3・6 の違いと選び方
> - 有効期間を使って「その時点の属性」で集計する結合
> - 有効期間の重なりと抜けを見つける検査、遅れて届く変更の扱い

前回の[マスターデータとコード体系](2026-10-02-data-design-4-master-data.html)では、マスターを 1 か所で揃えた。今回は、そのマスターの値が**変わる**ことを扱う。

## コードの読み方

コードは Python と SQL で書き、ほぼ全行に日本語の説明を付けた。大事な行には `★` を付けてある。Python に最初から入っている道具だけで動き、上から順に実行すると記事と同じ結果が出る。

| 書き方 | 意味 |
|---|---|
| `# 〜` / `-- 〜` | Python / SQL の説明文（コメント） |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `with con:` | ブロック内の処理をひとまとまりの取引（**トランザクション**）にする。途中で失敗したら全部取り消す |
| `raise 例外(…)` / `try:` 〜 `except` | エラーを起こして処理を止める / 起きたエラーを受け止める |
| `?`（SQL の中） | 値の差し込み口。後ろに渡した値が順に入る。文字列を直接つなげるより安全 |
| `LEAD(列) OVER (PARTITION BY a ORDER BY b)` | `a` ごとに `b` の順に並べたとき、**次の行**の値を取り出す |

## 全体マップ：変化をどこまで残すか

履歴の設計は、「何が変わるのか」「過去のどの時点で集計したいのか」を決めるところから始まる。

```flow caption="この記事の流れ。現在値と履歴を分け、変更を残し、DWH では SCD で持つ"
A([変わる値を洗い出す]) --> B{過去の値で\n集計する必要は?}
B -- ない --> C[上書き＋更新履歴\n誰がいつ変えたか]
B -- ある --> D[有効期間付きの版で持つ\nSCD タイプ 2]:::hl
C --> E([検査\n同時更新・期間の重なり])
D --> F[その時点の版と結合する]
F --> E
```

## 現在値と履歴を区別する

顧客の住所を例にとると、「いま住んでいる住所」と「過去に住んでいた住所」は、使われ方がまるで違う。

| 情報 | 主な使い道 | 求められること |
|---|---|---|
| 現在値 | 発送・請求・画面表示 | 1 つに決まる。すぐ引ける |
| 履歴 | 過去の集計・監査・機械学習の学習データ | 「いつからいつまで」が分かる。消えない |

履歴の持ち方には、いくつかの型がある。

| 型 | どう持つか | 答えられる問い | 向くもの |
|---|---|---|---|
| 上書きのみ | 最新の値だけを持つ | いまの値 | 誤記の訂正、過去を気にしない属性 |
| 上書き＋変更ログ | 現在値の表とは別に、変更の記録を積む | 誰がいつ何を何に変えたか | 監査、問い合わせ対応 |
| 有効期間付きの版 | 変わるたびに新しい行（版）を足し、有効期間を持たせる | ある時点の値。その時点で集計 | DWH のディメンション、契約条件、価格 |
| できごととして持つ | 「住所変更」という出来事の行を積み、現在値は計算で出す | 変更の回数、変更の流れ | 状態が頻繁に変わるもの（注文のステータスなど） |
| 定期的な丸ごとの保存 | 毎日・毎月、表全体の写しを保存する | ある日の全体の状態 | 変更を捉えられない元システムからの取り込み |

業務システム（書き込む側）では「上書き＋変更ログ」、分析基盤（読む側）では「有効期間付きの版」という組み合わせが多い。以下、この 2 つを順に作る。

## 更新履歴：誰が・いつ・何を・何に変えたか

業務システムの表は、現在値を上書きして使うのが普通だ。そのうえで、**変更のたびに記録を残す**。残す項目は次の 5 つだ。

| 項目 | 列の例 | なぜ要るか |
|---|---|---|
| 更新日時 | `updated_at` | いつの時点から値が変わったかを知る。時間帯（日本時間か世界標準時か）も決めて書く |
| 更新者 | `updated_by` | 誤りを見つけたとき、誰に確かめればよいかを知る |
| 更新前 | 変更ログの `before` | 元に戻す。何が間違っていたかを知る |
| 更新後 | 変更ログの `after` | 変更の内容を確かめる |
| バージョン | `version` | 何回目の変更か。同時に更新したときの上書き事故を防ぐ |

**バージョン**には、記録以上の役割がある。2 人が同じ顧客の画面を開いて、別々に住所を直したとする。後から保存した人が、先の人の変更を知らないまま上書きしてしまう。これを防ぐには、「自分が読んだときのバージョンのままなら更新する」という条件を付ける。この方法を**楽観的ロック**と呼ぶ。

```python title="change_log.py" caption="現在値を上書きしつつ、変更ログを残す。読んだときの版でなければ更新を拒否する" {18,19,21,23}
import json, sqlite3  # json は辞書を文字列に変える道具、sqlite3 は小さなデータベース

con = sqlite3.connect(":memory:")  # 使い捨てのデータベース
con.executescript("""
CREATE TABLE customers (                       -- 現在値の表。1 行 = 顧客 1 人
  customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
  version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE change_log (                      -- 変更ログ。1 行 = 変更 1 回。追記だけで、書き換えない
  log_id INTEGER PRIMARY KEY, row_id INTEGER, version INTEGER,
  changed_at TEXT, changed_by TEXT, before TEXT, after TEXT);
INSERT INTO customers VALUES (1, '山田', '東京都港区', 1, '2025-01-10T09:00:00+09:00', 'import');
""")

def update_address(con, customer_id, new_address, read_version, user, now):
    """住所を更新する。read_version は、画面を開いたときに読んだバージョン"""
    with con:                                                    # 以下をひとまとまりの取引にする
        old = con.execute("SELECT address FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()[0]
        cur = con.execute("""UPDATE customers SET address = ?, version = version + 1, updated_at = ?, updated_by = ?
                             WHERE customer_id = ? AND version = ?""",  # ★ 読んだときの版のままなら更新する
                          (new_address, now, user, customer_id, read_version))
        if cur.rowcount == 0:                                    # ★ 1 行も更新されなかった = 誰かが先に更新した
            raise RuntimeError("他の人が先に更新しました。読み直してからやり直してください")
        con.execute("INSERT INTO change_log VALUES (NULL, ?, ?, ?, ?, ?, ?)",  # ★ 更新前と更新後を記録する
                    (customer_id, read_version + 1, now, user,
                     json.dumps({"address": old}, ensure_ascii=False),
                     json.dumps({"address": new_address}, ensure_ascii=False)))

update_address(con, 1, "神奈川県横浜市", 1, "sato", "2026-04-15T10:00:00+09:00")    # 佐藤さんが更新
try:
    update_address(con, 1, "大阪府北区", 1, "suzuki", "2026-04-15T10:01:00+09:00")  # 鈴木さんも版 1 を見て更新
except RuntimeError as e:
    print("拒否:", e)
print(con.execute("SELECT address, version, updated_by FROM customers").fetchone())
print(con.execute("SELECT version, changed_by, before, after FROM change_log").fetchall())
```

```text
拒否: 他の人が先に更新しました。読み直してからやり直してください
('神奈川県横浜市', 2, 'sato')
[(2, 'sato', '{"address": "東京都港区"}', '{"address": "神奈川県横浜市"}')]
```

18〜19 行目の `UPDATE` には、「バージョンが読んだときのままなら」という条件が付いている。佐藤さんの更新でバージョンは 2 になったので、バージョン 1 を見ていた鈴木さんの更新は 21 行目で 0 行と判定され、拒否された。鈴木さんの変更で佐藤さんの変更が黙って消える事故は起きない。

23 行目で、更新前と更新後を変更ログに積んでいる。更新と記録は `with con:` の中にあるので、片方だけが成功することはない。

> [!NOTE]
> 変更ログは、アプリの中で書く以外に、データベースのトリガー（変更を検知して自動で動く処理）や、データベースの変更記録を外へ流す **CDC**（変更データキャプチャ）で取る方法もある。アプリ経由でない変更（管理者が直接直したなど）も逃したくないなら、データベースの側で取るほうが確実だ。CDC は[第 6 回](2026-10-02-data-design-6-architecture.html)の「収集」でも扱う。

## SCD：ゆっくり変わる属性を、DWH でどう持つか

分析基盤のディメンション（顧客・商品・店舗などの切り口）は、注文のように毎秒増えるわけではないが、ときどき値が変わる。こうした属性を **Slowly Changing Dimension**（SCD、ゆっくり変わる属性）と呼び、その持ち方を Kimball の手法では「タイプ」の番号で分類している。

| タイプ | 名前 | どう持つか | 過去の売上の集計 | 向く属性 |
|---|---|---|---|---|
| 0 | 元の値を保持 | 最初の値を変えない | 最初の値で | 生年月日、初回登録日、初回の獲得経路 |
| 1 | 上書き | 新しい値で上書きする | **いまの値で**（過去も書き換わる） | 誤記の訂正、表示名 |
| 2 | 行を追加 | 新しい版の行を足し、有効期間を持たせる | **当時の値で** | 住所、所属部門、顧客区分、価格 |
| 3 | 列を追加 | 「前の値」の列を持つ | 当時の値と 1 つ前の値の両方 | 一斉に切り替わる区分（地域の再編など） |
| 6 | 1＋2＋3 の組み合わせ | タイプ 2 の各版に、上書きで更新する「現在の値」の列も持たせる | 当時の値でも、いまの値でも | 両方の見方が日常的に要る属性 |

タイプ 4・5・7 もあるが、実務でよく使われるのは 0・1・2 だ。迷ったら、**集計の切り口に使う属性はタイプ 2、そうでない属性はタイプ 1** から考えるとよい。

> [!IMPORTANT]
> タイプは**表ごとではなく、列ごとに**決める。同じ顧客ディメンションでも、氏名の誤記訂正はタイプ 1、住所はタイプ 2、初回登録日はタイプ 0、という組み合わせになるのが普通だ。

## タイプ 2 を作る：今の版を閉じて、新しい版を足す

タイプ 2 では、属性が変わるたびに**今の版を閉じて、新しい版を足す**。版ごとに新しいサロゲートキーを振り、業務の顧客番号は版をまたいで同じにする。

| 列 | 意味 |
|---|---|
| `customer_sk` | 版ごとに振る番号（サロゲートキー） |
| `customer_id` | 業務の顧客番号。版をまたいで同じ |
| `valid_from` | この版が有効になった日（**含む**） |
| `valid_to` | この版が無効になった日（**含まない**）。現行版は遠い未来の日付 |
| `is_current` | 現行版なら 1 |

```python title="scd2.py" caption="SCD タイプ 2。値が変わったら今の版を閉じ、新しい版を足す" {7,10,22,26}
con.executescript("""
CREATE TABLE dim_customer (                       -- 顧客ディメンション。1 行 = 顧客の版 1 つ
  customer_sk INTEGER PRIMARY KEY,                -- 版ごとのサロゲートキー
  customer_id INTEGER NOT NULL,                   -- 業務の顧客番号（版をまたいで同じ）
  pref        TEXT NOT NULL,                      -- 都道府県（履歴を残したい属性）
  valid_from  TEXT NOT NULL,                      -- この版の開始日（含む）
  valid_to    TEXT NOT NULL DEFAULT '9999-12-31', -- ★ 終了日（含まない）。現行版は遠い未来
  is_current  INTEGER NOT NULL DEFAULT 1          -- 現行版なら 1
);
CREATE UNIQUE INDEX one_current ON dim_customer (customer_id) WHERE is_current = 1;  -- ★ 現行版は 1 人 1 つ
INSERT INTO dim_customer (customer_id, pref, valid_from)
  VALUES (1, '東京都', '2025-01-01'), (2, '大阪府', '2025-01-01');
""")

def apply_scd2(con, customer_id, new_pref, changed_on):
    """都道府県が変わっていれば、今の版を閉じて新しい版を足す"""
    with con:                                       # 閉じる処理と足す処理を、ひとまとまりにする
        cur = con.execute("""SELECT customer_sk, pref FROM dim_customer
                             WHERE customer_id = ? AND is_current = 1""", (customer_id,)).fetchone()
        if cur and cur[1] == new_pref:              # 値が変わっていなければ何もしない
            return "変化なし"
        if cur:                                     # ★ 今の版を、変更日で閉じる
            con.execute("UPDATE dim_customer SET valid_to = ?, is_current = 0 WHERE customer_sk = ?",
                        (changed_on, cur[0]))
        con.execute("INSERT INTO dim_customer (customer_id, pref, valid_from) VALUES (?, ?, ?)",
                    (customer_id, new_pref, changed_on))  # ★ 新しい版を、変更日から有効にする
        return "新しい版を追加"

print(apply_scd2(con, 1, "神奈川県", "2026-04-15"))   # 山田さんが引っ越した
print(apply_scd2(con, 1, "神奈川県", "2026-05-01"))   # 同じ値がもう一度届いた（変化なし）
for row in con.execute("SELECT * FROM dim_customer ORDER BY customer_id, valid_from"):
    print(row)
```

```text
新しい版を追加
変化なし
(1, 1, '東京都', '2025-01-01', '2026-04-15', 0)
(3, 1, '神奈川県', '2026-04-15', '9999-12-31', 1)
(2, 2, '大阪府', '2025-01-01', '9999-12-31', 1)
```

22〜26 行目で、今の版の終了日を変更日にして閉じ、同じ日から始まる新しい版を足している。顧客 1 の版は「2025-01-01 から 2026-04-15 まで東京都」「2026-04-15 から神奈川県」の 2 行になった。

7 行目のように、期間は**開始日を含み、終了日を含まない**（半開区間）で表す。こうすると、前の版の終了日と次の版の開始日を同じ日付にでき、境目の日がどちらの版に属するかで迷わない。10 行目の一意インデックスは、現行版が 1 人に 2 つできる事故をデータベースに止めさせている。

> [!TIP] 現行版の終了日は NULL か、遠い未来か
> 現行版の `valid_to` を NULL（値なし）にする流儀もある。ただし NULL は比較（`<`）で常に偽になるため、「その時点の版」を探す条件に `OR valid_to IS NULL` を毎回足すことになる。遠い未来の日付（`9999-12-31`）にしておけば、条件が 1 つで済む。分析用の変換ツール dbt のスナップショット機能は既定で NULL を使うが、`dbt_valid_to_current` という設定で任意の値に変えられる。

## 「その時点の属性」で集計する

タイプ 2 の版を使うと、売上を**買ったときの都道府県**で集計できる。売上の日付が、どの版の有効期間に入るかで結合する。

```python title="as_of_join.py" caption="売上の日付が有効期間に入る版と結合すると、当時の都道府県で集計できる" {9,15}
con.executescript("""
CREATE TABLE fct_sales (customer_id INTEGER, sold_on TEXT, amount INTEGER);  -- 売上。1 行 = 購入 1 回
INSERT INTO fct_sales VALUES (1, '2026-03-10', 1000), (1, '2026-04-20', 2000), (2, '2026-04-01', 500);
""")
as_was = con.execute("""
    SELECT d.pref, SUM(f.amount) FROM fct_sales f
    JOIN dim_customer d
      ON d.customer_id = f.customer_id
     AND f.sold_on >= d.valid_from AND f.sold_on < d.valid_to   -- ★ 買った日を含む版と結合する
    GROUP BY d.pref ORDER BY d.pref
""").fetchall()
as_is = con.execute("""
    SELECT d.pref, SUM(f.amount) FROM fct_sales f
    JOIN dim_customer d
      ON d.customer_id = f.customer_id AND d.is_current = 1     -- ★ いまの版と結合する
    GROUP BY d.pref ORDER BY d.pref
""").fetchall()
print("当時の都道府県で:", as_was)
print("いまの都道府県で:", as_is)
```

```text
当時の都道府県で: [('大阪府', 500), ('東京都', 1000), ('神奈川県', 2000)]
いまの都道府県で: [('大阪府', 500), ('神奈川県', 3000)]
```

9 行目は、買った日がどの版の期間に入るかで結合している。3 月の買い物は東京都、4 月 20 日の買い物は神奈川県に数えられる。15 行目は現行版とだけ結合しているので、過去の買い物もすべて神奈川県に数えられる。冒頭の「去年の報告と合わない」は、後者の集計だったということだ。

タイプ 2 で持っていれば、どちらの問いにも答えられる。上書き（タイプ 1）しかしていなければ、前者の数字は二度と出せない。

> [!NOTE]
> Kimball の手法では、売上を取り込むときに**その時点の版の `customer_sk`** をファクト表に書き込んでおくのが定石だ。こうすると、集計のたびに期間の比較をせずに、サロゲートキーの一致だけで当時の版と結合できる。上のコードは仕組みを見せるために、期間で結合している。

## 版の期間を検査する：重なりと抜け

タイプ 2 の表は、手作業の修正や取り込みの不具合で壊れやすい。壊れ方は 2 つある。

| 壊れ方 | 例 | 起きること |
|---|---|---|
| 重なり | 東京都の版が 4/20 まで、神奈川県の版が 4/15 から | 4/15〜4/20 の売上が 2 つの版と結合し、**二重に数えられる** |
| 抜け | 東京都の版が 4/10 まで、神奈川県の版が 4/15 から | 4/10〜4/15 の売上が、どの版とも結合せずに**消える** |

顧客ごとに版を開始日順に並べ、「ある版の終了日」と「次の版の開始日」が一致しているかを見れば、どちらも見つかる。

```python title="check_periods.py" caption="顧客ごとに版を並べ、終了日と次の版の開始日が一致しない箇所を探す" {6,9}
con.execute("""INSERT INTO dim_customer (customer_id, pref, valid_from, valid_to, is_current)
               VALUES (2, '京都府', '2025-06-01', '2025-12-31', 0)""")  # 誤って過去の版を差し込んだ

problems = con.execute("""
    SELECT customer_id, pref, valid_to, next_from,
           CASE WHEN valid_to > next_from THEN '重なり' ELSE '抜け' END    -- ★ 終了日が次の開始日より後なら重なり
    FROM (SELECT customer_id, pref, valid_from, valid_to,
                 LEAD(valid_from) OVER (PARTITION BY customer_id ORDER BY valid_from) AS next_from
          FROM dim_customer)                                               -- ★ 顧客ごとに、次の版の開始日を横に並べる
    WHERE next_from IS NOT NULL AND valid_to <> next_from                  -- 次の版があり、境目が一致しない
""").fetchall()
print(problems)
```

```text
[(2, '大阪府', '9999-12-31', '2025-06-01', '重なり')]
```

9 行目の `LEAD` で、顧客ごとに「次の版の開始日」を横に並べ、6 行目で重なりか抜けかを判定している。差し込んだ京都府の版（2025-06-01 から）は、大阪府の版（2025-01-01 から無期限）と重なっていると判定された。この状態だと、2025 年 6 月〜12 月の顧客 2 の売上は、大阪府と京都府の両方に数えられる。

この検査は、タイプ 2 の表を更新するたびに走らせ、1 件でも見つかったら利用者に出す前に止める。検査を置く場所は[第 6 回](2026-10-02-data-design-6-architecture.html)で扱う。

## 落とし穴：遅れて届く変更と、2 つの時間

### 遅れて届く変更

「4 月 15 日に引っ越していた」という届け出が、5 月 10 日に届くことがある。このとき、上の `apply_scd2` に 4 月 15 日を渡せば正しく版が切り替わる。ところが、もし 5 月 1 日にすでに別の変更（区分の変更など）で新しい版ができていたら、4 月 15 日の変更は**過去の版の途中に割り込む**ことになる。

この場合は、4 月 15 日をまたぐ版を 2 つに分け、それ以降の版すべてに新しい住所を反映し直す必要がある。手順が複雑になるので、遅れて届く変更があり得る属性では、次の 2 つの日付を分けて持つのが安全だ。

| 日付 | 意味 | 例 |
|---|---|---|
| 業務上の日付（有効日） | 現実に変化が起きた日 | 引っ越した日 4/15 |
| 記録した日付（記録日） | システムがその変化を知った日 | 届け出を入力した日 5/10 |

この 2 つを両方持つ設計を**バイテンポラル**（2 つの時間軸）と呼ぶ。「5 月 1 日の時点で、システムは山田さんがどこにいると思っていたか」（当時の報告の再現）と、「4 月 20 日に山田さんは実際にどこにいたか」（事実の訂正後の集計）を区別して答えられる。監査や会計のように、**過去に出した数字の根拠を後から説明する**必要がある領域で効く。

### 機械学習の学習データ

機械学習で「3 月時点の顧客情報から、4 月に解約するかを予測する」学習データを作るとき、いまの住所や区分を使うと、**3 月時点ではまだ分からなかった情報**が混ざる。モデルは試験では良い成績を出すが、本番では外れる。学習データは、上の `as_was` と同じく、その時点の版と結合して作る。

### 個人情報の履歴

履歴を残すほど、個人情報も残る。退会した顧客の個人情報を消すときは、現在値だけでなく**変更ログと過去の版も**対象にする。履歴に残す列を決めるときに、個人情報を含むかどうかと、保存期間も一緒に決めておく。

## 設計チェックリスト

| 段階 | 確かめること |
|---|---|
| 洗い出し | 変わる値を挙げ、過去の値で集計する必要があるかを属性ごとに決めたか |
| 更新履歴 | 更新日時（時間帯を含む）・更新者・更新前・更新後・バージョンを残しているか。更新と記録が同じ取引の中にあるか |
| 同時更新 | 読んだときのバージョンを条件にして、後からの上書き事故を防いでいるか |
| SCD | 列ごとにタイプ（0・1・2・3・6）を決めたか。集計の切り口に使う属性をタイプ 2 にしたか |
| 有効期間 | 開始日を含み終了日を含まない形で揃えたか。現行版の終了日の表し方を決めたか。現行版が 1 つしかないことを制約で守っているか |
| その時点の結合 | 「当時の値」と「いまの値」のどちらで集計するかを、利用者に示しているか |
| 検査 | 版の重なりと抜けを、更新のたびに検査しているか |
| 2 つの時間 | 遅れて届く変更がある属性で、業務上の日付と記録した日付を分けているか |
| 個人情報 | 履歴に残す個人情報と保存期間を決め、削除の対象に履歴も含めているか |

次回は連載の最終回として、ここまでの設計を**データ基盤**の中に配置する。業務システムから集めた生データを Raw 層にそのまま置き、整形層・業務モデル層を経て BI・機械学習・AI へ渡すまでの流れと、各層の責任を扱う。

## 参考文献

- Margy Ross（Kimball Group）, [Design Tip #152 Slowly Changing Dimension Types 0, 4, 5, 6 and 7](https://www.kimballgroup.com/2013/02/design-tip-152-slowly-changing-dimension-types-0-4-5-6-7/)（2013-02-05 / 確認 2026-10-02）
- Kimball Group, [Dimensional Modeling Techniques](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/)（確認 2026-10-02）— タイプ 1・2・3 の定義
- dbt Labs, [Add snapshots to your DAG](https://docs.getdbt.com/docs/build/snapshots)（確認 2026-10-02）— `dbt_valid_from` / `dbt_valid_to`、timestamp と check の 2 つの変更検知
- dbt Labs, [dbt_valid_to_current](https://docs.getdbt.com/reference/resource-configs/dbt_valid_to_current)（確認 2026-10-02）— 現行版の終了日を NULL 以外にする設定
- SQLite, [Window Functions](https://www.sqlite.org/windowfunctions.html)（確認 2026-10-02）
- SQLite, [Partial Indexes](https://www.sqlite.org/partialindex.html)（確認 2026-10-02）

### 日本語で読める関連記事

- クラスメソッド, [SCD Type2 のテーブルを、dbt 標準の incremental model で管理する](https://dev.classmethod.jp/articles/how_to_manage_an_scd_type_2_table_with_dbt_incremental_model/)（DevelopersIO）— スナップショット機能を使わずにタイプ 2 を作る例

※ 記事中の情報は 2026 年 10 月時点で確認したもの。
