---
title: 孤児レコードを作らないテーブル設計——エンティティ・関係・キー・参照整合性
description: 顧客・商品・注文といった管理対象（エンティティ）をどう切り出し、1 対多・多対多・親子の関係をどう表に落とし、主キーと外部キーで何を守るのか。存在しない顧客を参照する注文が生まれる瞬間と、それを止める制約を、動く SQLite で確かめる。
date: "2026-10-02"
verified: "2026-10-02"
category: データ設計
tags: [データモデリング, データ設計, 主キー, 外部キー, SQL, Python]
level: [basic, practice]
series: データ設計の基礎
status: published
---

注文の一覧を顧客の表とつないだら、何件かの注文が消えた。調べると、その注文が指す顧客番号は顧客の表のどこにもない。顧客を消したときに、注文だけが残っていたのだ。こうした、親を失った行を**孤児レコード**と呼ぶ。

孤児レコードは、集計を黙って狂わせる。内部結合（`JOIN`）では消え、外部結合（`LEFT JOIN`）では「顧客名なし」の行として残る。どちらの数字を正とするかで、部署ごとに売上が変わる。この記事では、表と表の関係を設計し、こうした行がそもそも入らないようにする方法を扱う。

> [!TIP] この記事で分かること
> - 何を「エンティティ」（管理対象）として独立した表にするかの見分け方
> - 1 対 1・1 対多・多対多・親子・依存の関係を、表の形に落とす方法
> - 主キーに求められる性質と、自然キー・サロゲートキー・複合キーの選び方
> - 外部キーで孤児レコードを止める方法と、削除したときの挙動の決め方
> - すでにできてしまった孤児レコードの見つけ方

前回の[「1 行が何を表すか」から始める](2026-10-02-data-design-1-purpose-grain.html)では、1 行が何を表すか（粒度）を決めた。今回はその表どうしを結ぶ。

## コードの読み方

コードは Python と SQL で書き、ほぼ全行に日本語の説明を付けた。大事な行には `★` を付けてある。Python に最初から入っている `sqlite3` だけで動く。上から順に貼り付けて実行すると、記事と同じ結果が出る。

| 書き方 | 意味 |
|---|---|
| `# 〜` / `-- 〜` | Python / SQL の説明文（コメント） |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `try:` 〜 `except 種類 as e:` | 失敗するかもしれない処理を試し、失敗したら `except` の中を実行する |
| `CREATE TABLE 表 (列 型 制約, …)` | 表を作る SQL。**制約**は、その列に入れてよい値のルール |
| `REFERENCES 表(列)` | 「この列の値は、あちらの表のこの列に必ずある値」という約束（外部キー） |

## 全体マップ：名詞を表に、関係をキーに

設計は、業務の説明に出てくる**名詞**を拾うところから始まる。名詞を表にし、名詞どうしの関係を**キー**（行を指し示す値）で結ぶ。

```flow caption="この記事の流れ。エンティティを切り出し、関係を決め、キーと制約で守る"
A([業務の説明から名詞を拾う]) --> B[エンティティを決める\n顧客・商品・注文…]
B --> C[関係を決める\n1 対多・多対多・親子]
C --> D[主キーを決める\n一意・安定・NULL なし]:::hl
D --> E[外部キーで結ぶ\n孤児を作らない]:::hl
E --> F([削除・更新時の挙動を決める])
```

## エンティティ：「何を管理するデータか」を切り出す

**エンティティ**とは、業務で独立して管理したい「もの」や「できごと」のことだ。顧客・商品・注文・契約・従業員・取引などがこれにあたる。エンティティごとに 1 つの表を作るのが基本になる。

難しいのは、ある情報を**独立したエンティティにするか、別のエンティティの属性（列）にするか**の判断だ。次の問いで見分ける。

| 問い | はい → エンティティにする | いいえ → 属性にとどめる |
|---|---|---|
| それ自体に複数の情報があるか | 店舗（住所・電話・営業時間…） | 色（「赤」だけ） |
| ほかの複数のものから参照されるか | 商品（注文からも在庫からも見る） | 注文メモ（その注文だけのもの） |
| 単独で増えたり変わったりするか | 部門（統廃合がある） | 生年月日（変わらない） |
| 業務の人がその言葉で数えるか | 「契約は何件？」 | 「住所は何件？」とは言わない |

エンティティには、大きく分けて 2 種類ある。

| 種類 | 何を表すか | 例 | 行の増え方 |
|---|---|---|---|
| もの（マスター） | 業務で繰り返し使う対象 | 顧客・商品・店舗・従業員 | ゆっくり増える。属性が時々変わる |
| できごと（トランザクション） | ある時点で起きた事実 | 注文・入金・出荷・ログイン | 毎日大量に増える。原則として書き換えない |

この区別は、[第 4 回](2026-10-02-data-design-4-master-data.html)のマスターデータ設計と、[第 5 回](2026-10-02-data-design-5-history-scd.html)の履歴設計の土台になる。

## 関係：1 対多・多対多・親子を表の形にする

エンティティどうしの関係は、**相手の行が何行つながるか**で分類する。通販の例で描くと次のようになる。

```flow caption="通販の例のエンティティと関係。矢印のラベルが「何対何」か"
direction LR
C[顧客] -- 1 対多 --> O[注文]
O -- 1 対多 --> L[注文明細]
K[キャンペーン] -- 多対多 --> P[商品]
P -- 1 対多 --> L
U[上位部門] -.->|親子| D[部門]
```

関係の種類ごとに、表への落とし方が決まっている。

| 関係 | 例 | 表への落とし方 |
|---|---|---|
| 1 対 1 | 従業員と社員証 | 片方の表に相手のキーを持たせ、`UNIQUE` を付ける。同じ表にまとめてよいことも多い |
| 1 対多 | 顧客と注文 | 「多」の側（注文）に「1」の側のキー（顧客番号）を持たせる |
| 多対多 | 商品とキャンペーン | 両者のキーの組を持つ**中間テーブル**を作る |
| 親子（自己参照） | 部門と上位部門 | 同じ表の中に、親の行を指す列（`parent_id`）を持たせる |
| 依存 | 注文と注文明細 | 子は親なしに存在できない。子のキーに親のキーを含める（複合キー） |

多対多の関係を、1 つの列にカンマ区切りで入れる（`campaigns = "1,2"`）のはよくある失敗だ。検索も集計も文字列の分解が必要になり、存在しないキャンペーン番号が入っても誰も気づけない。中間テーブルにすれば、組み合わせ 1 つが 1 行になる。

次のコードで、この関係をすべて表にする。

```python title="schema.py" caption="通販の例のテーブル定義。主キー・外部キー・中間テーブルを含む" {4,16,21,26,32}
import sqlite3  # Python に最初から入っている小さなデータベース

con = sqlite3.connect(":memory:")        # メモリ上に使い捨てのデータベースを作る
con.execute("PRAGMA foreign_keys = ON")  # ★ SQLite は既定で外部キーを検査しない。接続ごとに有効にする
con.executescript("""
CREATE TABLE customers (                 -- 顧客。1 行 = 顧客 1 人
  customer_id   INTEGER PRIMARY KEY,     -- サロゲートキー（システムが振る番号）
  customer_code TEXT NOT NULL UNIQUE,    -- 業務で使う顧客コード（自然キー）。重複を禁じる
  name          TEXT NOT NULL            -- 氏名。空を許さない
);
CREATE TABLE products (                  -- 商品。1 行 = 商品 1 つ
  product_id INTEGER PRIMARY KEY, name TEXT NOT NULL
);
CREATE TABLE orders (                    -- 注文。1 行 = 注文 1 件
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT, -- ★ 1 対多
  ordered_on  TEXT NOT NULL
);
CREATE TABLE order_lines (               -- 注文明細。1 行 = 明細 1 つ（注文に依存する）
  order_id   INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL,           -- ★ 注文の中での明細番号
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  qty        INTEGER NOT NULL CHECK (qty > 0),  -- 数量は 1 以上でなければ入れさせない
  PRIMARY KEY (order_id, line_no)        -- 複合キー。前回宣言した粒度そのもの
);
CREATE TABLE campaigns (                 -- ★ キャンペーン。商品と多対多
  campaign_id INTEGER PRIMARY KEY, name TEXT NOT NULL
);
CREATE TABLE campaign_products (         -- 多対多をつなぐ中間テーブル。1 行 = 組み合わせ 1 つ
  campaign_id INTEGER NOT NULL REFERENCES campaigns(campaign_id),
  product_id  INTEGER NOT NULL REFERENCES products(product_id),
  PRIMARY KEY (campaign_id, product_id)  -- ★ 同じ組を 2 回登録させない
);
""")
```

4 行目が要点だ。SQLite は古い版との互換のため、外部キーの検査を**既定で無効**にしている。公式ドキュメントでも、接続を開くたびに `PRAGMA foreign_keys = ON` を実行するよう求めている。忘れると、`REFERENCES` を書いても何も検査されない。

16 行目の注文は、顧客を指す列を持つ「多」の側だ。21 行目と 24 行目の明細は、注文番号と明細番号の組を主キーにしている。注文なしでは存在できない「依存」の関係を、キーの形で表している。26〜33 行目は多対多で、中間テーブルの主キーを 2 つの番号の組にして、同じ組み合わせの二重登録を防ぐ。

試しにデータを入れ、中間テーブルを通して「どの商品がどのキャンペーンに入っているか」を引いてみる。

```python title="many_to_many.py" caption="中間テーブルを 2 回結合して、商品とキャンペーンの組を引く" {13,14}
con.executescript("""
INSERT INTO customers VALUES (1, 'C001', '山田'), (2, 'C002', '佐藤');
INSERT INTO products  VALUES (1, 'ノート'), (2, 'ペン'), (3, '手帳');
INSERT INTO orders    VALUES (1, 1, '2026-04-01'), (2, 2, '2026-04-02');
INSERT INTO order_lines VALUES (1, 1, 1, 3), (1, 2, 2, 1), (2, 1, 1, 1);
INSERT INTO campaigns VALUES (1, '新学期'), (2, '年末');
INSERT INTO campaign_products VALUES (1, 1), (1, 2), (2, 1), (2, 3);
""")

rows = con.execute("""
    SELECT p.name, group_concat(c.name, '・')        -- 商品名と、入っているキャンペーン名を「・」でつなげる
    FROM products p
    JOIN campaign_products cp ON cp.product_id = p.product_id   -- ★ 商品 → 中間テーブル
    JOIN campaigns c ON c.campaign_id = cp.campaign_id          -- ★ 中間テーブル → キャンペーン
    GROUP BY p.product_id ORDER BY p.product_id                 -- 商品ごとに 1 行にまとめる
""").fetchall()
print(rows)
```

```text
[('ノート', '新学期・年末'), ('ペン', '新学期'), ('手帳', '年末')]
```

13〜14 行目のように、中間テーブルを挟んで 2 回結合するのが多対多の読み方だ。ノートは 2 つのキャンペーンに入っていることが分かる。

### 親子関係：同じ表の中で親を指す

部門のように「本社の下に営業本部、その下に営業部」と階層になるものは、同じ表の中で親の行を指す列を持たせる。階層の深さが決まっていなくても、1 つの表で表せる。

```python title="departments.py" caption="自分の表を参照する親子関係と、再帰クエリでの階層の展開" {5,11,14}
con.executescript("""
CREATE TABLE departments (
  dept_id   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id INTEGER REFERENCES departments(dept_id)  -- ★ 親部門を指す。最上位は NULL（親なし）
);
INSERT INTO departments VALUES (1, '本社', NULL), (2, '営業本部', 1),
  (3, '東日本営業部', 2), (4, '西日本営業部', 2), (5, '管理本部', 1);
""")
rows = con.execute("""
    WITH RECURSIVE tree(dept_id, depth, path) AS (       -- ★ 再帰クエリ。自分の結果を使って繰り返す
      SELECT dept_id, 0, name FROM departments WHERE parent_id IS NULL      -- 出発点：最上位の部門
      UNION ALL
      SELECT d.dept_id, t.depth + 1, t.path || ' > ' || d.name             -- ★ 子を見つけて 1 段深くする
      FROM departments d JOIN tree t ON d.parent_id = t.dept_id
    )
    SELECT depth, path FROM tree ORDER BY path           -- 経路の文字列順に並べると木の形になる
""").fetchall()
for depth, path in rows:                                 # 1 行ずつ取り出して
    print("  " * depth + path.split(" > ")[-1])          # 深さの分だけ字下げして部門名を表示
```

```text
本社
  営業本部
    東日本営業部
    西日本営業部
  管理本部
```

5 行目の `parent_id` が、同じ表の `dept_id` を指している。11 行目からの `WITH RECURSIVE` は、最上位の部門から出発し、14 行目で「いま見ている部門を親に持つ部門」を探して 1 段ずつ深くしていく。

> [!WARNING] 親子関係は「いつ時点の階層か」を決める
> 組織は毎年のように変わる。`parent_id` を上書きすると、去年の売上を去年の組織で集計できなくなる。過去の組織で集計したいなら、階層にも有効期間を持たせる。持ち方は[第 5 回](2026-10-02-data-design-5-history-scd.html)で扱う。

## 主キー：行を 1 つに決める値の条件

**主キー**（primary key）は、表の中で行を 1 つに決める値だ。前回の粒度の宣言を、データベースに強制させる仕組みでもある。主キーに求められる性質は 3 つある。

| 性質 | 意味 | 破れると起きること |
|---|---|---|
| 一意性 | 同じ値の行が 2 つない | どちらの行を指しているか分からなくなる |
| 安定性 | 一度決めたら変わらない | 参照している全部の表を書き換えることになる |
| NULL がない | 値が必ずある | 「値なし」の行どうしを区別できない |

この 3 つを満たすキーの作り方には、次の選択肢がある。

| 種類 | 何か | 例 | 向く場面 | 弱み |
|---|---|---|---|---|
| 自然キー | 業務の中にもともとある一意な値 | 顧客コード、JAN コード、都道府県コード | 値が公的に管理され、変わらない | 業務の都合で変わる・使い回される・桁が足りなくなる |
| サロゲートキー | システムが振る、意味を持たない番号 | 連番、UUID | 自然キーが変わりうる、またはそもそも無い | それだけでは業務の重複（同じ人の二重登録）を防げない |
| 複合キー | 複数の列の組 | 注文番号＋明細番号 | 依存するエンティティ、中間テーブル | 参照する側も複数の列を持つことになる |

実務でよく使うのは、**サロゲートキーを主キーにし、自然キーには `UNIQUE` 制約を付けて両方持つ**形だ。上のコードの顧客表がそれにあたる（7〜8 行目）。行の識別は変わらない番号に任せ、業務上の重複は自然キーの一意制約で防ぐ。

自然キーを主キーにしてよいかは、「その値が**この先も変わらず、使い回されない**と言い切れるか」で決める。メールアドレスは変わるし、電話番号は解約後に別の人へ割り当てられる。社員番号も、会社の合併で体系が変わることがある。言い切れないなら、サロゲートキーを足す。

> [!NOTE]
> サロゲートキーを常に使うべきかは、昔から意見が分かれる。入力データに安定した一意なキーがあるなら、それをそのまま主キーにするほうが単純だという立場もある。この記事では「安定していると言い切れないなら足す」を判断基準にしている。

### NULL と一意制約の落とし穴

主キーと一意制約には、NULL（値がないこと）にまつわる落とし穴がある。

```python title="null_keys.py" caption="一意制約は NULL の重複を止めない。SQLite では主キーにも NULL が入ることがある" {3,7}
con.execute("CREATE TABLE members (email TEXT UNIQUE, name TEXT)")  # メールに一意制約を付けた表
con.execute("INSERT INTO members VALUES (NULL, '田中')")             # メールなしで 1 人目を登録
con.execute("INSERT INTO members VALUES (NULL, '鈴木')")             # ★ 2 人目もメールなしで登録できてしまう
print(con.execute("SELECT COUNT(*) FROM members WHERE email IS NULL").fetchone()[0])  # メールなしの人数

con.execute("CREATE TABLE codes (code TEXT PRIMARY KEY, label TEXT)")  # 文字列の主キーを持つ表
con.execute("INSERT INTO codes VALUES (NULL, '名前のない区分')")        # ★ 主キーなのに NULL が入る
print(con.execute("SELECT COUNT(*) FROM codes WHERE code IS NULL").fetchone()[0])     # NULL の主キーの数
```

```text
2
1
```

3 行目のとおり、一意制約は NULL どうしを「同じ値」と見なさないため、何件でも入る。これは SQL の標準的な振る舞いで、多くのデータベースで同じだ。「メールは一意」のつもりなら、`NOT NULL` も一緒に付ける。

7 行目は SQLite 固有の古い仕様だ。整数以外の主キーには、`NOT NULL` を書かないと NULL が入る。SQLite の公式ドキュメントも、過去の不具合を互換のために残していると説明している。**主キーの列には必ず `NOT NULL` を書く**と覚えておけば、どのデータベースでも安全だ。

## 外部キー：存在しない相手を指させない

**外部キー**（foreign key）は、「この列の値は、あちらの表の主キーに必ずある値だ」という約束だ。この約束が守られている状態を**参照整合性**と呼ぶ。外部キーがないと何が起きるかを、検査を有効にしていない接続で見てみる。

```python title="orphans.py" caption="外部キーを検査しないと孤児の注文が入る。入ったものを探す 2 つの方法" {7,12,15}
loose = sqlite3.connect(":memory:")      # 外部キーの検査を有効にしていない接続
loose.executescript("""
CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE orders (order_id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(customer_id));  -- 約束は書いてあるが、検査されない
INSERT INTO customers VALUES (1, '山田');
INSERT INTO orders VALUES (10, 1), (11, 99);  -- ★ 存在しない顧客 99 の注文が入ってしまう
""")
orphans = loose.execute("""
    SELECT o.order_id, o.customer_id FROM orders o
    LEFT JOIN customers c ON c.customer_id = o.customer_id  -- 顧客が見つからなくても注文は残す結合
    WHERE c.customer_id IS NULL                             -- ★ 顧客が見つからなかった注文だけ
""").fetchall()
print("孤児の注文:", orphans)
print("SQLite の検査:", loose.execute("PRAGMA foreign_key_check").fetchall())  # ★ 違反行を一覧する
```

```text
孤児の注文: [(11, 99)]
SQLite の検査: [('orders', 11, 'customers', 0)]
```

7 行目で、存在しない顧客 99 を指す注文が何の警告もなく入った。こうなってから探す方法は 2 つある。

- 12 行目の `LEFT JOIN … WHERE 親 IS NULL` は、どのデータベースでも使える汎用の書き方だ。定期的な品質検査にそのまま使える
- 15 行目の `PRAGMA foreign_key_check` は SQLite の機能で、宣言された外部キーに違反している行を「表・行番号・親の表」で返す

検査を有効にした接続（`con`）では、同じ操作がその場で拒否される。

```python title="fk_actions.py" caption="外部キーが有効なら、孤児の挿入と、子のある親の削除が止まる" {4,9,10,11}
def try_sql(sql):
    """SQL を実行し、成功したか、制約で拒否されたかを返す"""
    try:
        con.execute(sql)                       # ★ ここで制約違反なら例外（エラー）が起きる
        return "成功"
    except sqlite3.IntegrityError as e:        # 整合性の制約に違反したときのエラー
        return f"拒否: {e}"                     # 拒否された理由を返す

print(try_sql("INSERT INTO orders VALUES (3, 99, '2026-04-03')"))  # ★ 存在しない顧客 99 の注文
print(try_sql("DELETE FROM customers WHERE customer_id = 1"))       # ★ 注文のある顧客 1 を削除（RESTRICT）
print(try_sql("DELETE FROM orders WHERE order_id = 1"))             # ★ 注文 1 を削除（明細は CASCADE）
print("注文 1 の明細:", con.execute(
    "SELECT COUNT(*) FROM order_lines WHERE order_id = 1").fetchone()[0])  # 明細が残っていないか確かめる
```

```text
拒否: FOREIGN KEY constraint failed
拒否: FOREIGN KEY constraint failed
成功
注文 1 の明細: 0
```

9 行目の孤児の挿入は拒否された。10 行目は、注文を持つ顧客を消そうとして拒否された。注文表の定義で `ON DELETE RESTRICT`（子がいる親は消させない）を指定したからだ。11 行目では注文を消し、`ON DELETE CASCADE`（親を消したら子も消す）により明細 2 行も一緒に消えた。

### 削除したときの挙動を、関係ごとに決める

親の行を消したとき、子の行をどうするかは関係ごとに選ぶ。

| 指定 | 親を消すと | 向く関係 |
|---|---|---|
| `RESTRICT` / `NO ACTION` | 子がいれば拒否する（`NO ACTION` は文の終わりで判定） | 顧客と注文。取引の記録は残す |
| `CASCADE` | 子も一緒に消える | 注文と明細。子が親の一部でしかない |
| `SET NULL` | 子の参照を NULL にする | 担当者と問い合わせ。担当者が辞めても問い合わせは残す |
| `SET DEFAULT` | 子の参照を既定値にする | 「未分類」カテゴリーへ移すなど |

迷ったら `RESTRICT` にする。消せないことで困るのは一時的だが、消えてしまったデータは戻らない。`CASCADE` は、子が親の一部でしかない（親なしに意味を持たない）関係だけに使う。

> [!WARNING] 「顧客を消したい」は、たいてい行の削除ではない
> 退会した顧客の行を消すと、その人の過去の注文が孤児になるか、`CASCADE` で売上ごと消える。取引の記録は会計上も残す必要があることが多い。個人情報を消したいなら、行は残して氏名や連絡先を消す・置き換える（匿名化する）設計にする。「削除済み」の印を付けるだけの**論理削除**にする場合は、外部キーはその印を見てくれないので、集計側で除外を忘れない仕組み（除外済みのビューなど）を用意する。

## データウェアハウスでは、制約が「飾り」になることがある

ここまでの制約は、業務システムのデータベースではデータベース自身が守ってくれる。ところが、分析用の**データウェアハウス**（DWH）では事情が違う。

| 環境 | 主キー・外部キーの扱い |
|---|---|
| 業務用のデータベース（PostgreSQL・MySQL・SQLite など） | 宣言すれば、違反する書き込みを拒否する（SQLite は検査の有効化が必要） |
| クラウドの DWH の多く | 宣言はできるが、**強制しない**。クエリの最適化や文書としての情報にとどまる |

たとえば Snowflake の通常のテーブルは `NOT NULL` と `CHECK` だけを強制し、主キー・一意・外部キーは強制しない。BigQuery は主キー・外部キーを `NOT ENFORCED` で宣言する形になっている。BigQuery の公式ドキュメントは、宣言した制約をクエリの最適化に使うとし、データが制約に合っていることは利用者が保証するよう求めている。

こうした環境では、**制約の代わりに検査を書く**。孤児を探す `LEFT JOIN … IS NULL`、主キーの重複を探す `GROUP BY … HAVING COUNT(*) > 1`（[前回](2026-10-02-data-design-1-purpose-grain.html)の粒度の検査）を、データを取り込むたびに走らせる。検査の置き場所は[第 6 回](2026-10-02-data-design-6-architecture.html)で扱う。

## 設計チェックリスト

| 段階 | 確かめること |
|---|---|
| エンティティ | 業務の名詞を拾い、独立して管理するものを表にしたか。「もの」と「できごと」を分けたか |
| 関係 | 関係ごとに何対何かを決めたか。多対多を 1 列にカンマ区切りで入れていないか |
| 親子 | 自己参照の階層に、いつ時点の階層かという視点があるか |
| 主キー | 一意・安定・NULL なしを満たすか。自然キーが変わる・使い回される可能性を確かめたか |
| 自然キー | サロゲートキーを主キーにしたとき、業務上の重複を防ぐ一意制約を自然キーに付けたか |
| NULL | 主キーと一意制約の列に `NOT NULL` を付けたか |
| 外部キー | 子の表に外部キーを宣言したか。SQLite なら接続ごとに検査を有効にしたか |
| 削除 | 関係ごとに `RESTRICT` / `CASCADE` / `SET NULL` を選んだか。個人情報の削除を行の削除にしていないか |
| DWH | 制約が強制されない環境で、孤児と重複の検査を取り込みごとに走らせているか |

次回は、表をどこまで分けるかを扱う。同じ顧客名をあちこちに持つと何が壊れるのか（正規化）、それでも分析のためにあえてまとめるのはどんなときか（非正規化）を見ていく。

## 参考文献

- SQLite, [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html)（確認 2026-10-02）— 既定で無効であること、`PRAGMA foreign_keys`、`ON DELETE` の各動作
- SQLite, [CREATE TABLE](https://www.sqlite.org/lang_createtable.html)（確認 2026-10-02）— 主キーに NULL が入りうる互換上の仕様
- SQLite, [PRAGMA foreign_key_check](https://www.sqlite.org/pragma.html#pragma_foreign_key_check)（確認 2026-10-02）
- Snowflake, [Overview of Constraints](https://docs.snowflake.com/en/sql-reference/constraints-overview)（確認 2026-10-02）— 通常のテーブルで強制されるのは `NOT NULL` と `CHECK`
- Google Cloud, [Use primary and foreign keys](https://cloud.google.com/bigquery/docs/primary-foreign-keys)（確認 2026-10-02）— BigQuery は主キー・外部キーを強制しない

### 日本語で読める関連記事

- ミック, [テーブル設計のグレーゾーン～毒と薬は紙一重（4）サロゲートキーVSナチュラルキー](https://gihyo.jp/dev/serial/01/sql_academy2/000304)（gihyo.jp, 2009-10-01）— どんなときに自然キーでなく代理キー（サロゲートキー）を使うべきか
- masapiko, [DB設計 サロゲートキーとナチュラルキー](https://qiita.com/masapiko/items/05c393379c2eb42c86f5)（Qiita, 2018-12-30）— 両者の定義と使い分けの整理

※ 記事中の情報は 2026 年 10 月時点で確認したもの。
