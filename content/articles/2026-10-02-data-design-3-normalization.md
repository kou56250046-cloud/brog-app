---
title: 正規化は守り、非正規化は攻め——表を意図して崩すための判断基準
description: 同じ情報を何か所にも持つと、更新のたびにどこかが食い違う。正規化で守るものを更新異常の再現で確かめ、そのうえで分析・性能・使いやすさ・AI 検索のために、どこまで・どう崩すか（スタースキーマ、ワイドテーブル）を、作り直しと突き合わせの仕組みとセットで設計する。
date: "2026-10-02"
verified: "2026-10-02"
category: データ設計
tags: [データモデリング, 正規化, スタースキーマ, SQL, Python]
level: [practice]
series: データ設計の基礎
status: published
---
```hero
title 正規化して守り、目的があるときだけ崩す
SRC([業務のデータ]):::code
group truth 正（正規化した表）
  N[正規化した表\n1 事実 1 か所]:::data:::hl
end
group derived 用途ごとに崩した形
  ST[スタースキーマ\n分析の切り口]:::data
  WT[ワイドテーブル\n1 枚で完結]:::data
  DOC[検索用の文書\nAI 検索]:::data
end
SRC --> N
N --> ST
N --> WT
N --> DOC
note N 正規化しないと、更新・挿入・削除の 3 つの異常が起きる
note DOC AI 検索には、番号を言葉に戻した文書を作る
note WT 崩した表は、正と食い違わないよう検査し続ける
```


顧客が引っ越したので、注文表の住所を書き換えた。ところが書き換えたのは最新の注文の行だけで、過去の注文の行には古い住所が残った。同じ顧客なのに、行によって住所が違う。どちらが正しいかは、もう表を見ても分からない。

これを防ぐのが**正規化**、つまり同じ情報を 1 か所にだけ持つように表を分けることだ。ただし、分けすぎた表は分析で使いにくい。現場では「正規化したうえで、目的に合わせて意図して崩す（**非正規化**する）」のが定石になっている。この記事は、何を守るために分け、どんなときにどう崩すかを扱う。

> [!TIP] この記事で分かること
> - 正規化しないと起きる 3 つの更新異常と、その再現
> - 第 1〜第 3 正規形を、何を分ける規則なのかという視点で読む方法
> - 非正規化する 4 つの理由（分析・性能・使いやすさ・AI 検索）と、その手段の比較
> - スタースキーマとワイドテーブルの作り方
> - 非正規化した表を、正の表と食い違わせないための仕組み

前回の[孤児レコードを作らないテーブル設計](2026-10-02-data-design-2-entity-keys.html)で、エンティティとキーを決めた。今回は、その表をどこまで分けるかを決める。

## コードの読み方

コードは Python と SQL で書き、ほぼ全行に日本語の説明を付けた。大事な行には `★` を付けてある。Python に最初から入っている `sqlite3` だけで動き、上から順に実行すると記事と同じ結果が出る。

| 書き方 | 意味 |
|---|---|
| `# 〜` / `-- 〜` | Python / SQL の説明文（コメント） |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `CREATE VIEW 名前 AS SELECT …` | **ビュー**。保存された問い合わせ。表のように使えるが、中身は毎回元の表から作られる |
| `CREATE TABLE 名前 AS SELECT …` | 問い合わせの結果を、新しい表として保存する |
| `assert 条件, "メッセージ"` | 条件が成り立たなければ、メッセージを出して止まる |

## 全体マップ：分けて守り、目的に合わせて組み直す

正規化と非正規化は、対立するものではない。**データの正は正規化された表に置き、利用者の目的に合わせた形をそこから作る**、という 2 段の関係にある。

```flow caption="正規化された表を正とし、用途ごとの非正規化した形をそこから作り直す"
A([業務のデータ]) --> B[正規化した表\n同じ情報は 1 か所]:::hl
B --> C[スタースキーマ\n分析の切り口ごとに整理]
B --> D[ワイドテーブル\n1 枚で完結]
B --> E[集計表\n日別・月別]
B --> F[検索用の文書\nAI 検索向け]
C -.-> G([突き合わせの検査\n正と一致するか])
D -.-> G
```

## 正規化しないと何が壊れるか：3 つの更新異常

1 枚の表に何でも入れると、同じ情報が何度も現れる。その状態で書き換えや削除をすると、**更新異常**と呼ばれる 3 種類の不具合が起きる。

| 異常 | 何が起きるか | 例 |
|---|---|---|
| 更新異常 | 同じ情報の一部だけが書き換わり、食い違う | 顧客の住所を 1 行だけ直し、他の行は古いまま |
| 挿入異常 | ある情報を、別の情報なしには登録できない | まだ売れていない新商品の価格を登録する場所がない |
| 削除異常 | ある行を消すと、関係ない情報まで消える | 商品の最後の注文を取り消すと、商品名と価格も消える |

注文・顧客・商品を 1 枚にまとめた表で、実際に起こしてみる。

```python title="anomalies.py" caption="1 枚の表に詰め込むと、住所の食い違いと商品情報の消失が起きる" {13,17,22}
import sqlite3  # Python に最初から入っている小さなデータベース

con = sqlite3.connect(":memory:")  # メモリ上に使い捨てのデータベースを作る
con.executescript("""
-- 正規化していない表。1 行 = 注文明細 1 つだが、顧客と商品の情報も毎回持つ
CREATE TABLE flat_orders (
  order_id INTEGER, customer_name TEXT, customer_address TEXT,
  product_name TEXT, unit_price INTEGER, qty INTEGER
);
INSERT INTO flat_orders VALUES
  (1, '山田', '東京都港区', 'ノート', 300, 3),
  (2, '山田', '東京都港区', 'ペン',   150, 1),
  (3, '佐藤', '大阪府北区', '手帳',   1200, 1);    -- ★ 手帳を買ったのはこの 1 件だけ
""")

# 更新異常：山田さんの住所を、注文 2 の行だけで直してしまう
con.execute("UPDATE flat_orders SET customer_address = '神奈川県横浜市' WHERE order_id = 2")  # ★
print(con.execute("""SELECT DISTINCT customer_address FROM flat_orders
                     WHERE customer_name = '山田'""").fetchall())  # 山田さんの住所が何通りあるか

# 削除異常：手帳の唯一の注文を取り消すと、手帳の価格もどこにも残らない
con.execute("DELETE FROM flat_orders WHERE order_id = 3")  # ★
print(con.execute("SELECT unit_price FROM flat_orders WHERE product_name = '手帳'").fetchall())
```

```text
[('東京都港区',), ('神奈川県横浜市',)]
[]
```

17 行目では、山田さんの住所を 1 行だけ書き換えた。結果、山田さんの住所が 2 通り存在する状態になった。22 行目では、手帳の唯一の注文（13 行目）を取り消した。注文と一緒に手帳の価格 1,200 円もこの世から消えている。

どちらも、**1 つの事実（山田さんの住所、手帳の価格）が、注文の数だけ複製されている**ことが原因だ。

## 正規形は「1 つの事実を 1 か所に」の段階表

正規化には第 1〜第 5 正規形などの段階がある。実務でまず押さえるのは第 3 正規形までだ。どれも「何をどの表へ分けるか」の規則として読むと分かりやすい。

| 段階 | 規則 | 違反の例 | 直し方 |
|---|---|---|---|
| 第 1 正規形 | 1 つのマスに値は 1 つ。繰り返しの列を作らない | `products = "ノート,ペン"`、`item1` `item2` `item3` 列 | 明細の表に分け、1 品目 = 1 行にする |
| 第 2 正規形 | 複合キーの**一部だけ**で決まる列を、別の表へ | 明細（注文番号＋明細番号）に、注文番号だけで決まる注文日がある | 注文日は注文の表へ |
| 第 3 正規形 | キー以外の列で決まる列を、別の表へ | 注文の表に、顧客番号で決まる顧客の住所がある | 住所は顧客の表へ |

覚え方として、「すべての列は、**キーに、キー全体に、キー以外の何物でもなく**依存する」という言い回しがよく使われる（William Kent が 1983 年の解説論文で示した表現がもとになっている）。上の表の第 1〜第 3 正規形に、それぞれ対応する。

正規化した表で、さっきの操作をやり直してみる。

```python title="normalized.py" caption="正規化すると、住所の変更は 1 か所、商品の価格は注文と独立に残る" {4,7,20,24}
con.executescript("""
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT, address TEXT);
CREATE TABLE products  (product_id  INTEGER PRIMARY KEY, name TEXT, unit_price INTEGER);
CREATE TABLE orders    (order_id    INTEGER PRIMARY KEY,           -- ★ 注文は顧客を番号で指すだけ
                        customer_id INTEGER REFERENCES customers, ordered_on TEXT);
CREATE TABLE order_lines (order_id INTEGER REFERENCES orders, line_no INTEGER,
                          product_id INTEGER REFERENCES products,  -- ★ 明細は商品を番号で指すだけ
                          qty INTEGER, PRIMARY KEY (order_id, line_no));
INSERT INTO customers VALUES (1, '山田', '東京都港区'), (2, '佐藤', '大阪府北区');
INSERT INTO products  VALUES (1, 'ノート', 300), (2, 'ペン', 150), (3, '手帳', 1200);
INSERT INTO orders VALUES (1, 1, '2026-04-01'), (2, 1, '2026-04-03'), (3, 2, '2026-04-05');
INSERT INTO order_lines VALUES (1, 1, 1, 3), (2, 1, 2, 1), (3, 1, 3, 1);
""")

con.execute("UPDATE customers SET address = '神奈川県横浜市' WHERE customer_id = 1")  # 住所は 1 行だけ直せばよい
con.execute("DELETE FROM order_lines WHERE order_id = 3")                            # 手帳の注文を取り消す
con.execute("DELETE FROM orders WHERE order_id = 3")

rows = con.execute("""
    SELECT o.order_id, c.address                       -- ★ 住所は顧客の表から毎回引く
    FROM orders o JOIN customers c ON c.customer_id = o.customer_id
""").fetchall()
print(rows)                                                                          # どの注文も同じ住所になる
print(con.execute("SELECT unit_price FROM products WHERE name = '手帳'").fetchall())  # ★ 手帳の価格は残る
```

```text
[(1, '神奈川県横浜市'), (2, '神奈川県横浜市')]
[(1200,)]
```

4 行目と 7 行目で、注文と明細は顧客や商品を**番号で指すだけ**にした。住所や価格は持たない。20 行目のように住所は毎回顧客の表から引くので、2 件の注文で住所が食い違うことは起こりえない。24 行目のとおり、注文を取り消しても商品の価格は残る。

> [!WARNING] 「注文時の価格」は、商品の価格とは別の事実
> 上のコードは説明を単純にするため、明細に価格を持たせていない。実際には、商品の価格は値上げで変わるが、**注文したときの価格**は変わってはいけない。これは商品の属性ではなく「その注文で決まった事実」なので、明細の表に `unit_price` として持つのが正しい。正規化は「何でも別の表へ」ではない。**その値が何によって決まるか**で置き場所を決める。

## なぜ、あえて崩すのか：非正規化の 4 つの理由

正規化した表は、書き込みには強いが、読むときに結合が増える。分析では「顧客の地域別・商品カテゴリー別・月別の売上」のように、たくさんの表をまたぐ問いが多い。そこで、読む目的に合わせて**意図して**崩す。

| 理由 | 困りごと | 崩し方 |
|---|---|---|
| 分析のしやすさ | 切り口（顧客・商品・日付）が何段もの結合の先にある | スタースキーマにまとめる |
| クエリ性能 | 大きな表どうしの結合や、毎回の集計が重い | 集計表を作る。結合済みの表を保存する |
| 利用者の使いやすさ | SQL に慣れない利用者が、正しい結合を書けない | 結合済みのワイドテーブル（1 枚の大きな表）を渡す |
| AI 検索の性能 | 番号だけの行は、文章として検索しても意味が通じない | 名前や説明を展開した、検索用の文書を作る |

崩し方には段階がある。

| 形 | どんな形か | 向くもの | 弱み |
|---|---|---|---|
| 正規化した表 | 1 つの事実を 1 か所に | 業務システムの書き込み。データの正 | 分析のたびに多数の結合が要る |
| スタースキーマ | 数値の表（ファクト）を中心に、切り口の表（ディメンション）を周りに置く | BI・定型分析。切り口を組み替える分析 | ディメンションの中は重複を許す |
| ワイドテーブル | 必要な列を全部結合した 1 枚の表 | 特定の用途、表計算や BI への受け渡し、機械学習の特徴量 | 用途が変わるたびに作り直し。列が増え続けやすい |
| 集計表 | 日別・月別などに集計済みの表 | ダッシュボードの高速表示 | 細かい単位には戻れない |

> [!NOTE]
> ワイドテーブルを全社で 1 枚に寄せる「One Big Table（OBT）」という流儀もある。列指向のデータウェアハウスでは使わない列を読まずに済むので、横に広い表でも性能が出やすい。一方、粒度の違うデータを 1 枚に詰めると[第 1 回](2026-10-02-data-design-1-purpose-grain.html)の二重計上がそのまま起きる。どの形でも、**粒度を 1 つに決める**ことだけは崩さない。

## スタースキーマ：数値と切り口を分けて並べる

**スタースキーマ**は、分析のための非正規化の代表的な形だ。中心に「起きたことの数値」を持つ**ファクト表**を置き、周りに「切り口」を持つ**ディメンション表**を置く。図にすると星形に見えるのが名前の由来だ。

```flow caption="スタースキーマ。ファクト表の 1 行から、各ディメンションへ 1 本ずつ線が出る"
direction LR
C[dim_customer\n顧客・地域] --> F[fct_order_lines\n1 行 = 注文明細\n数量・金額]:::hl
P[dim_product\n商品・カテゴリー] --> F
D[dim_date\n日付・月・曜日] --> F
```

ディメンションの中では、正規化を崩してよい。たとえば商品のディメンションには、カテゴリー名を（カテゴリーの表へ分けずに）直接持たせる。分析する人は、結合を 1 段たどるだけで「カテゴリー別」の集計ができる。

```python title="star_schema.py" caption="正規化した表からスタースキーマを作り、分析用のビューを用意する" {5,10,16,21}
con.executescript("""
ALTER TABLE products ADD COLUMN category TEXT;           -- 商品にカテゴリーを足す
UPDATE products SET category = CASE WHEN product_id = 3 THEN '手帳類' ELSE '筆記具' END;

CREATE TABLE dim_product AS                              -- ★ 商品の切り口。カテゴリーを直接持つ
  SELECT product_id, name AS product_name, category FROM products;
CREATE TABLE dim_customer AS                             -- 顧客の切り口。住所から都道府県を取り出す
  SELECT customer_id, name AS customer_name,
         substr(address, 1, max(instr(address, '都'), instr(address, '道'),
                                instr(address, '府'), instr(address, '県'))) AS prefecture  -- ★ 簡易版
  FROM customers;
CREATE TABLE dim_date AS                                 -- 日付の切り口。月や曜日を先に計算しておく
  SELECT DISTINCT ordered_on AS date_key, substr(ordered_on, 1, 7) AS month,
         strftime('%w', ordered_on) AS weekday           -- 0 = 日曜 … 6 = 土曜
  FROM orders;
CREATE TABLE fct_order_lines AS                          -- ★ ファクト。1 行 = 注文明細 1 つ
  SELECT l.order_id, l.line_no, o.customer_id, l.product_id, o.ordered_on AS date_key,
         l.qty, l.qty * p.unit_price AS amount           -- 数量と金額（円・税抜）
  FROM order_lines l JOIN orders o USING (order_id) JOIN products p USING (product_id);

CREATE VIEW sales_by_category AS                         -- ★ 分析用のビュー。結合はここに 1 回だけ書く
  SELECT d.month, c.prefecture, p.category, SUM(f.amount) AS amount
  FROM fct_order_lines f
  JOIN dim_date d USING (date_key) JOIN dim_customer c USING (customer_id)
  JOIN dim_product p USING (product_id)
  GROUP BY d.month, c.prefecture, p.category;
""")
print(con.execute("SELECT * FROM sales_by_category").fetchall())
```

```text
[('2026-04', '神奈川県', '筆記具', 1050)]
```

5 行目の商品ディメンションは、カテゴリーを列として直接持つ。9〜10 行目では、住所の先頭から「都・道・府・県」までを切り出して都道府県の列にしている（簡易版。実務では都道府県を最初から別の列で持つ）。分析のたびに文字列を加工しなくて済むように、切り口は**先に計算して列にしておく**のがディメンションの作法だ。

16 行目のファクト表は、明細の粒度のまま数量と金額を持つ。21 行目のビューに結合を 1 回だけ書いておけば、利用者は `SELECT * FROM sales_by_category` だけで集計を得られる。手帳の注文は前の章で取り消したので、残るのはノート 900 円とペン 150 円の計 1,050 円だ。

> [!TIP] 名前の付け方で、表の役割を示す
> `fct_`（ファクト）、`dim_`（ディメンション）のような接頭辞を付けると、表の一覧を見ただけで役割が分かる。分析用の変換ツールとして広く使われる dbt の公式ガイドも、この命名を勧めている。

## 崩した表を、正の表と食い違わせない

非正規化した表は、**正の表のコピー**だ。コピーには必ず「元が変わったのにコピーが古いまま」という危険がつきまとう。守るためのルールは 3 つある。

1. **非正規化した表を、手で書き換えない**。直すときは正の表を直し、そこから作り直す
2. **作り直しを、何度実行しても同じ結果になる形で書く**。「消してから作る」「置き換える」で書き、追記で書かない
3. **正の表と突き合わせる検査を置く**。合計・件数が一致しなければ、利用者に出す前に止める

```python title="rebuild_and_reconcile.py" caption="ワイドテーブルを作り直し、正の表と合計・件数を突き合わせる" {4,5,18,19}
def rebuild_wide(con):
    """正規化した表から、明細のワイドテーブルを作り直す"""
    con.executescript("""
    DROP TABLE IF EXISTS wide_order_lines;              -- ★ 古いコピーを消してから
    CREATE TABLE wide_order_lines AS                    -- ★ 正の表から作り直す（何度実行しても同じ結果）
      SELECT o.order_id, o.ordered_on, c.name AS customer_name, c.address,
             p.name AS product_name, p.category, l.qty, l.qty * p.unit_price AS amount
      FROM order_lines l
      JOIN orders o USING (order_id) JOIN customers c USING (customer_id)
      JOIN products p USING (product_id);
    """)

def reconcile(con):
    """ワイドテーブルと正の表で、件数と金額の合計が一致するかを確かめる"""
    src = con.execute("""SELECT COUNT(*), SUM(l.qty * p.unit_price)
                         FROM order_lines l JOIN products p USING (product_id)""").fetchone()
    dst = con.execute("SELECT COUNT(*), SUM(amount) FROM wide_order_lines").fetchone()
    assert src == dst, f"食い違い: 正={src} コピー={dst}"  # ★ 一致しなければここで止まる
    return dst                                           # ★ 一致したら件数と合計を返す

rebuild_wide(con)                                              # 作り直す
print("一致:", reconcile(con))                                  # 突き合わせる
con.execute("UPDATE customers SET address = '東京都港区' WHERE customer_id = 1")  # 正の表を変更
rebuild_wide(con)                                              # 作り直せば変更が反映される
print(con.execute("SELECT DISTINCT address FROM wide_order_lines").fetchall())
```

```text
一致: (2, 1050)
[('東京都港区',)]
```

4〜5 行目は、古い表を消してから正の表で作り直している。追記ではないので、何度実行しても結果は同じだ。18 行目で、正の表とワイドテーブルの件数・合計を比べ、食い違えばその場で止める。最後の 3 行は、顧客の住所を正の表で直してから作り直すと、ワイドテーブルにも反映されることを示している。

突き合わせは件数と合計だけでも効果が大きい。結合の条件を間違えて行が増えた（ファンアウト）、または結合できずに行が消えた（孤児）という事故の多くが、ここで見つかる。

## AI 検索のための非正規化：番号を言葉に戻す

AI に表を検索させたり、RAG（文書を検索して回答に使う仕組み）に商品情報を入れたりするときも、非正規化が効く。`product_id = 3, category_id = 7` のような番号だけの行は、文章として検索しても意味が通じない。名前や説明を展開して、**1 行で意味が完結する文書**にしてから検索の対象にする。

```python title="search_docs.py" caption="商品ごとに、名前・カテゴリー・価格を展開した検索用の文書を作る" {4}
docs = con.execute("""
    SELECT product_id,
           name || '（カテゴリー: ' || category || '、価格: '
           || unit_price || ' 円・税抜）' AS doc                 -- ★ 番号でなく言葉で 1 行を完結させる
    FROM products ORDER BY product_id
""").fetchall()
for product_id, doc in docs:   # 1 件ずつ取り出して
    print(product_id, doc)     # 番号と、検索用の文書を表示
```

```text
1 ノート（カテゴリー: 筆記具、価格: 300 円・税抜）
2 ペン（カテゴリー: 筆記具、価格: 150 円・税抜）
3 手帳（カテゴリー: 手帳類、価格: 1200 円・税抜）
```

4 行目のように、単位まで含めた言葉で 1 行を完結させる。この文書も非正規化したコピーなので、前の章と同じく正の表から作り直し、手で直さない。文書を検索用に切り分ける方法やメタデータの付け方は、[文書は「切って、身元を付けて」初めて検索できる](2026-09-29-ai-agent-data-design-2-rag.html)で扱った。

## 設計チェックリスト

| 段階 | 確かめること |
|---|---|
| 正の置き場所 | 1 つの事実（住所・価格など）が、正規化された表の 1 か所にだけあるか |
| 正規形 | 1 マスに 1 つの値か。キーの一部やキー以外の列で決まる列を、別の表へ分けたか |
| 事実の時点 | 「注文時の価格」のように、その時点で決まった事実を、変わりうる属性と区別して持っているか |
| 崩す理由 | 非正規化した表ごとに、理由（分析・性能・使いやすさ・AI 検索）と利用者を言えるか |
| 粒度 | 非正規化した表も、粒度を 1 つに決めているか |
| 作り直し | 非正規化した表を、正の表から何度でも同じ結果で作り直せるか。手で直していないか |
| 突き合わせ | 件数・合計を正の表と比べる検査があり、食い違えば利用者に出す前に止まるか |

次回は、正の置き場所をシステムをまたいで考える。営業システムと会計システムがそれぞれ「顧客」を持っているとき、どちらを正とし、「東京」「Tokyo」「13」のように揃っていないコードをどう 1 つにするかを扱う。

## 参考文献

- Kimball Group, [Dimensional Modeling Techniques](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/)（確認 2026-10-02）— ファクト表・ディメンション表・スタースキーマ
- dbt Labs, [How we structure our dbt projects](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview)（確認 2026-10-02）— `fct_` / `dim_` の命名と層の分け方
- Gowtham Potureddi, [One Big Table (OBT) vs Star Schema: Denormalization Trade-offs in the Modern Warehouse](https://dev.to/gowthampotureddi/one-big-table-obt-vs-star-schema-denormalization-trade-offs-in-the-modern-warehouse-3p6k)（DEV Community, 確認 2026-10-02）
- SQLite, [CREATE VIEW](https://www.sqlite.org/lang_createview.html)（確認 2026-10-02）

### 日本語で読める関連記事

- Masaru, [MySQLで正規化を行ってみた](https://zenn.dev/masaruxstudy/articles/333f8fe395ef2e)（Zenn, 2022-10-29）— 成績表を例に、第 1〜第 3 正規形まで手を動かして分ける
- つくだー, [DB 正規化について](https://zenn.dev/bizlink/articles/40138181a2ed9e)（Zenn, 2024-06-11）— 冗長な表を顧客・商品・注文に分ける例で、第 1〜第 3 正規形を整理している

※ 記事中の情報は 2026 年 10 月時点で確認したもの。
