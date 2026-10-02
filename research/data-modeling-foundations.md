# データ基盤・データモデリング・データ設計 リサーチメモ（2026-10-02）

ユーザー提供のアウトライン（1. 設計の基本思想 〜 6. データ基盤アーキテクチャ）をもとに連載化する。
既存連載「AIエージェントのデータ設計」（2026-09-29）と粒度・意味の章が重なるので、こちらは汎用のデータ設計として書き、AI 向けの話は既存連載へリンクする。

## 事実（出典付き）

### 次元モデリングと粒度
- Kimball の 4 ステップ: (1) 業務プロセスを選ぶ (2) 粒度を宣言する (3) ディメンションを特定する (4) ファクトを特定する。粒度は「ファクトテーブルの 1 行が何を表すか」を厳密に決めること — [Kimball Group, Four-Step Dimensional Design Process](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/four-4-step-design-process/)（確認 2026-10-02）
- 粒度は元データが支える最も細かい単位（atomic）にするのが推奨。粒度ごとに別テーブルにし、同じファクトテーブルに異なる粒度を混ぜない — [Kimball Group, Grain](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/grain/)
- ファンアウト: 粒度の違う表を結合すると行が掛け算で増え、合計が二重計上される。数字が現実と合わないと気づくまで見えない — [Coginiti, Fan and Chasm Traps](https://coginiti.co/glossary/fan-chasm-traps/)

### 適合ディメンションとマスター
- 適合ディメンション（conformed dimension）: 複数のファクトで同じ意味・同じキー・同じ値を持つディメンション。ETL で一度だけ管理し、複数のファクトで再利用する。バスマトリクスはその計画表 — [Kimball Group, Data Warehouse Bus Architecture](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/kimball-data-warehouse-bus-architecture/) / [Wikipedia, Enterprise bus matrix](https://en.wikipedia.org/wiki/Enterprise_bus_matrix)

### 履歴（SCD）
- SCD タイプ: 0 元の値を保持 / 1 上書き / 2 新しい行を追加（サロゲートキー・有効期間・現行フラグ） / 3 前の値の列を追加 / 4 ミニディメンション / 6 は 1+2+3 の組み合わせ — [Kimball Group, Design Tip #152 Slowly Changing Dimension Types 0, 4, 5, 6 and 7](https://www.kimballgroup.com/2013/02/design-tip-152-slowly-changing-dimension-types-0-4-5-6-7/)（2013-02-05）
- 実務で広く使われるのは 0・1・2 — [Wikipedia, Slowly changing dimension](https://en.wikipedia.org/wiki/Slowly_changing_dimension)（二次情報）
- dbt snapshot は SCD タイプ 2 を作る。`dbt_valid_from` / `dbt_valid_to`（現行行は NULL、`dbt_valid_to_current` で任意の値に変えられる）。変更検知は timestamp（updated_at）と check（列比較）の 2 戦略 — [dbt Docs, Add snapshots to your DAG](https://docs.getdbt.com/docs/build/snapshots) / [dbt_valid_to_current](https://docs.getdbt.com/reference/resource-configs/dbt_valid_to_current)
- SCD2 を snapshot でなく incremental model で管理する例 — [DevelopersIO（クラスメソッド）](https://dev.classmethod.jp/articles/how_to_manage_an_scd_type_2_table_with_dbt_incremental_model/)

### キー
- ナチュラルキー（業務上の意味を持つ一意な値）とサロゲートキー（システムが振る意味のない値）。入力に一意なキーがない・値が使い回される・体系が変わる場合にサロゲートキーを検討 — [Qiita masapiko](https://qiita.com/masapiko/items/05c393379c2eb42c86f5) / [gihyo.jp ミック「SQL アカデミー」](https://gihyo.jp/dev/serial/01/sql_academy2/000304)

### 参照整合性（SQLite で実演する）
- SQLite は 3.6.19 から外部キーをサポートするが、既定は OFF。接続ごとに `PRAGMA foreign_keys = ON` が要る。ON DELETE は NO ACTION（既定）/ RESTRICT / SET NULL / SET DEFAULT / CASCADE — [SQLite, Foreign Key Support](https://www.sqlite.org/foreignkeys.html)

### 正規化・非正規化
- 正規化は冗長性と不整合の機会を減らす。性能のため一貫性と引き換えにあえて非正規化することもある — [Zenn masaruxstudy](https://zenn.dev/masaruxstudy/articles/333f8fe395ef2e) / [Zenn bizlink](https://zenn.dev/bizlink/articles/40138181a2ed9e)
- One Big Table（OBT）とスタースキーマのトレードオフ — [DEV Community](https://dev.to/gowthampotureddi/one-big-table-obt-vs-star-schema-denormalization-trade-offs-in-the-modern-warehouse-3p6k)

### データ基盤のレイヤー
- メダリオン: Bronze（生データ）→ Silver（検証・クレンジング済み）→ Gold（次元モデル・集計）。層を進むごとに構造と品質を段階的に上げる — [Databricks Docs, What is the medallion lakehouse architecture?](https://docs.databricks.com/aws/en/lakehouse/medallion)
- dbt の推奨: staging（ソースと 1 対 1、改名・型変換だけ。結合・集計しない）→ intermediate（結合・業務ロジック）→ marts（`dim_` / `fct_`）。staging は view、marts は table を推奨 — [dbt Docs, How we structure our dbt projects](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview)
- 日本語の解説 — [Zenn tenajima](https://zenn.dev/tenajima/articles/6b7fbaffe842e2)

## 主張・意見（誰の）
- 「RDB だから正規化必須、NoSQL だから正規化しない、ではない。設計思想と得意分野が違うだけ」 — Zenn rdlabo
- 「Bronze はパイプラインでなく着地場所。メタデータを付けて置いておく」 — 二次情報（Databricks 解説記事群）

## 記事に使うコード・図の素材
- Python 標準の sqlite3 で、注文・明細・顧客を作って動かす（依存なし・読者がその場で実行できる）
- 粒度の混在でファンアウトが起きる SQL と、先に集計してから結合する修正
- SCD タイプ 2 の更新関数（現行行を閉じて新行を挿入）と「その時点の住所」で結合するクエリ
- コード体系の名寄せ（東京 / Tokyo / 13 / TKY → 1 つの標準コード）の対応表

## 未確認・食い違い
- ユーザー提供のアウトラインは「6.1 データの流れを設計する」の図で途切れている。6.2 以降があるか要確認
- SCD タイプ 5・7 の扱いは出典で揺れる（Kimball Design Tip #152 は 5・7 も定義している。Wikipedia 系は「5 は合意された定義がない」）。本文は 0〜3 と 6 を中心にし、他は名前だけ触れる
- メダリオンの層の数・名前は組織によって違う（Raw / Staging / Mart、Bronze / Silver / Gold、+Platinum）。一般論として「生 → 整形 → 業務モデル」の 3 段で書き、名前の対応表を置く

## 執筆中に追加で確認したこと（2026-10-02）
- SQLite: `INTEGER PRIMARY KEY`・WITHOUT ROWID・STRICT・`NOT NULL` のどれでもない主キー列には NULL が入る（初期の不具合を互換のため残している） — [SQLite, CREATE TABLE](https://www.sqlite.org/lang_createtable.html)
- SQLite: RESTRICT は即時に判定、NO ACTION は文の終わりで判定（遅延制約に従う） — [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html)
- Snowflake の通常のテーブルで強制されるのは NOT NULL と CHECK だけ。主キー・外部キーを強制するのはハイブリッドテーブル — [Snowflake, Overview of Constraints](https://docs.snowflake.com/en/sql-reference/constraints-overview)
- BigQuery は主キー・外部キーを強制しない（`NOT ENFORCED`）。制約はクエリの最適化に使う — [Google Cloud, Use primary and foreign keys](https://cloud.google.com/bigquery/docs/primary-foreign-keys)
- Databricks: 取り込みから直接 Silver に書くと、スキーマの変化や壊れたレコードで失敗する。Bronze を通す（2026-09-11 更新） — [Databricks Docs](https://docs.databricks.com/aws/en/lakehouse/medallion)
- Kimball Design Tip #152（Margy Ross, 2013-02-05）はタイプ 0・4・5・6・7 を定義している。本文ではタイプ 0・1・2・3・6 を表で扱い、4・5・7 は名前を挙げるだけにした
- 都道府県コードは JIS X 0401 の 2 桁（PLATEAU の仕様で確認）。総務省の PDF は本文を取り出せなかったので、構造の記述には使っていない
- Lakehouse 論文: Armbrust, Ghodsi, Xin, Zaharia, CIDR 2021 — [CIDR](https://vldb.org/cidrdb/2021/lakehouse-a-new-generation-of-open-platforms-that-unify-data-warehousing-and-advanced-analytics.html)
