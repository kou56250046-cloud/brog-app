---
title: 弱いモデルを束ねると強くなる：バギング・ブースティング・スタッキングを使い分ける
description: 表形式データでいまも最有力なのは、決定木を何百本も束ねるアンサンブルだ。多数決が強くなる理由から、ランダムフォレスト・勾配ブースティング・スタッキングの仕組みと使い分け、LightGBM・XGBoost・CatBoost の違い、本番事例までを動くコードで整理する。
date: "2026-09-30"
updated: ""
verified: "2026-09-30"
category: 機械学習
tags: [機械学習, アンサンブル, 勾配ブースティング, ランダムフォレスト, scikit-learn, Python]
level: [basic, practice, advanced]
series: 機械学習の基礎と使いどころ
status: published
---

前回見たように、決定木は読みやすい代わりに不安定で、1 本では精度が伸びにくい。ところが、少しずつ違う決定木を何百本も作って**多数決を取る**と、精度は大きく上がり、不安定さも打ち消される。これがアンサンブル（ensemble）学習だ。

売上予測、不正検知、到着時刻の推定など、表形式データを扱う本番システムの多くで、いまも中心にいるのはこの手法だ。この記事では、束ね方の 3 つの型を仕組みから比べ、どれを選ぶかの判断軸まで整理する。

> [!TIP] この記事で分かること
> - 多数決でなぜ精度が上がるのか、上がらないのはどんなときか
> - バギング・ランダムフォレスト・勾配ブースティング・スタッキングの違い
> - 勾配ブースティングの学習率と早期終了の関係
> - LightGBM・XGBoost・CatBoost の設計の違い
> - 表形式データで深層学習より木のアンサンブルが強い理由と、最近の例外

連載「機械学習の基礎と使いどころ」の第 4 回。前回「[決定木は「質問の順番」を学ぶ](2026-09-30-ml-basics-3-decision-tree.html)」の決定木が、今回の部品になる。

| 記号 | 意味 |
|---|---|
| `#` | ここから行末までは説明（コメント）。動作には関係しない |
| `{名前: 値, ...}` | 辞書。「名前 → 値」の対応表 |
| `for name, m in models.items():` | 辞書から名前と中身を 1 組ずつ取り出して繰り返す |
| `n_estimators` | 束ねるモデル（木）の数 |
| `n_jobs=-1` | CPU のコアをすべて使って並列に計算する |

```flow caption="アンサンブル 3 つの型。並列に作って平均するか、順に作って誤りを直すか、予測を別のモデルで束ねるか"
A([学習データ]) --> B[バギング:\n並列に作って平均]
A --> C[ブースティング:\n前の誤りを順に直す]:::hl
A --> D[スタッキング:\n別々のモデルを作る]
B --> E([ばらつきを減らす])
C --> F([偏りを減らす])
D --> G[予測を入力に\nまとめ役が学習]
G --> H([両方を補い合う])
```

## 多数決が強くなる条件：精度より「間違え方の違い」

正解率 60% の分類器が 1 つあるとする。これを何個も集めて多数決を取ると、正解率はどうなるか。各分類器の**間違え方が互いに独立**なら、二項分布（コイン投げの成功回数の分布）で計算できる。

```python title="majority_vote.py" caption="正解率 60% の分類器を n 個集めて多数決を取る" {5}
from math import comb  # comb(n, i): n 個から i 個を選ぶ組み合わせの数

def vote(n, p):  # 正解率 p の分類器 n 個による多数決の正解率
    k = n // 2 + 1  # 過半数に必要な人数
    return sum(comb(n, i) * p**i * (1 - p)**(n - i)  # ★ ちょうど i 個が正解する確率
               for i in range(k, n + 1))  # 過半数〜全員が正解する場合を足し合わせる

for n in [1, 5, 25, 101]:  # 集める数を変えてみる
    print(f"{n:>3} 個の多数決 正解率 {vote(n, 0.6):.3f}")
```

```text
  1 個の多数決 正解率 0.600
  5 個の多数決 正解率 0.683
 25 個の多数決 正解率 0.846
101 個の多数決 正解率 0.979
```

60% の分類器でも、101 個集めれば 98% になる。ただし、これは**間違え方が独立している**という前提での計算だ。全員が同じデータで同じように学習すれば、同じ問題で同じように間違えるので、何個集めても 60% のままになる。

つまりアンサンブルの設計とは、**それなりに正確で、しかも間違え方がばらばらなモデルをどう作るか**という問題だ。3 つの型は、その「ばらばらにする方法」が違う。

| 型 | ばらばらにする方法 | 主に減らすもの | 代表 |
|---|---|---|---|
| バギング | データを復元抽出（重複を許して無作為に選ぶ）で毎回変える | ばらつき（バリアンス） | ランダムフォレスト |
| ブースティング | 前のモデルが外したところに次のモデルを集中させる | 偏り（バイアス） | 勾配ブースティング（LightGBM・XGBoost・CatBoost） |
| スタッキング | 種類の違うモデル（木・線形・近傍法など）を使う | 両方 | Kaggle の上位解法 |

## ランダムフォレスト：データと質問の両方を揺らす

**バギング**（bootstrap aggregating）は、学習データから重複を許して同じ件数を無作為に選び直し、それぞれで木を学習して平均する。選ばれなかった約 37% のデータは、その木にとっての「未使用データ」になる。

**ランダムフォレスト**は、これに加えて、**各分割で使える特徴量も無作為に絞る**（分類の既定は全特徴量数の平方根）。強い特徴量が 1 つあると、どの木も最初にそれを使って似た形になってしまう。候補を絞ることで木どうしの相関が下がり、多数決が効くようになる。

4 つのモデルを、同じデータ（5,000 件、30 項目の練習用データ）で比べる。

```python title="compare.py" caption="決定木 1 本と 3 種類のアンサンブルを交差検証で比べる" {14,16}
from sklearn.datasets import make_classification  # 練習用データを作る
from sklearn.model_selection import cross_val_score  # 交差検証の点数を出す
from sklearn.tree import DecisionTreeClassifier  # 決定木
from sklearn.ensemble import (BaggingClassifier, RandomForestClassifier,  # バギング / ランダムフォレスト
                              HistGradientBoostingClassifier)  # 勾配ブースティング

X, y = make_classification(n_samples=5000, n_features=30, n_informative=10,  # 30 列のうち 10 列が有効
                           n_redundant=5, flip_y=0.03, class_sep=0.7, random_state=0)

models = {  # 比べるモデルの一覧
    "決定木 1 本": DecisionTreeClassifier(random_state=0),
    "バギング": BaggingClassifier(DecisionTreeClassifier(), n_estimators=200,  # 木 200 本を平均
                                 random_state=0, n_jobs=-1),
    "ランダムフォレスト": RandomForestClassifier(n_estimators=200,  # ★ 特徴量も無作為に絞る
                                               random_state=0, n_jobs=-1),
    "勾配ブースティング": HistGradientBoostingClassifier(random_state=0),  # ★ 誤りを順に直す
}
for name, m in models.items():  # 1 つずつ 5 分割の交差検証で評価する
    s = cross_val_score(m, X, y, cv=5)  # 5 回分の正解率
    print(f"{name:<10} 正解率 {s.mean():.3f} ± {s.std():.3f}")  # 平均 ± ばらつき
```

```text
決定木 1 本    正解率 0.820 ± 0.009
バギング       正解率 0.900 ± 0.009
ランダムフォレスト  正解率 0.913 ± 0.007
勾配ブースティング  正解率 0.918 ± 0.008
```

決定木 1 本の 0.820 から、木を束ねるだけで 0.900 に上がる。特徴量も揺らすランダムフォレストでさらに 0.913、勾配ブースティングが 0.918 で最も高い。表形式データでは、この順位になることが多い。

ランダムフォレストには、もう 1 つ実務で便利な性質がある。各木の「未使用データ」で予測を検証できるので、**交差検証をしなくても汎化性能のおおよその値が手に入る**。これを OOB（out-of-bag）スコアと呼ぶ。

```python title="oob.py" caption="OOB スコアはテスト用データの点数とほぼ一致する（compare.py の続き）" {4}
from sklearn.model_selection import train_test_split  # 学習用とテスト用に分ける

X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=0)
rf = RandomForestClassifier(n_estimators=300, oob_score=True,  # ★ OOB スコアを計算させる
                            random_state=0, n_jobs=-1).fit(X_tr, y_tr)
print(f"OOB {rf.oob_score_:.3f}  テスト {rf.score(X_te, y_te):.3f}")  # 2 つを並べる
```

```text
OOB 0.912  テスト 0.910
```

OOB スコア 0.912 は、学習に使っていないテスト用データの 0.910 とほぼ同じだ。データが少なくテスト用に分ける余裕がないときや、手早く設定を比べたいときに役立つ。

> [!NOTE] ランダムフォレストは調整しなくても大崩れしにくい
> ランダムフォレストは、木の数を増やしても過学習がひどくならず、既定の設定でもそこそこの精度が出る。最初に試す「基準のモデル」として扱いやすい。木の数は、点数が頭打ちになるまで増やせばよい（増やしすぎの害は計算時間だけ）。

## 勾配ブースティング：前の木の「残りの誤差」を次の木が学ぶ

**ブースティング**は、木を 1 本ずつ順番に作る。2 本目の木は「1 本目の予測がどれだけ外れたか（残差）」を予測するように学習し、3 本目は「2 本目まで足しても残った誤差」を学習する。最終的な予測は、すべての木の出力の足し算だ。

名前の「勾配」は、誤差を減らす方向を**損失関数の勾配**で決めることから来ている。第 5 回で扱う勾配降下法を、「パラメータ」ではなく「木を 1 本足すこと」で行っていると考えればよい。

```flow caption="勾配ブースティングの学習。各木は小さな一歩（学習率）だけ予測を直す"
A([最初の予測:\n全体の平均]) --> B[残りの誤差を計算]
B --> C[誤差を予測する\n小さな木を学習]
C --> D[予測 += 学習率 × 木の出力]:::hl
D --> E{検証の点数が\n改善しなくなった?}
E -- いいえ --> B
E -- はい --> F([終了: 木の足し算])
```

勾配ブースティングで最も重要な設定は、**学習率**（1 本の木がどれだけ予測を直すか）と**木の数**の組だ。学習率を小さくすると、1 本ずつの直しが控えめになり、必要な木の数が増える代わりに過学習しにくくなる。木の数は、検証用データの点数が改善しなくなったところで止める**早期終了**で決めるのが定石だ。

```python title="boosting.py" caption="学習率を変え、早期終了で木の数を自動で決める（oob.py の続き）" {3,5}
for lr in [0.3, 0.1, 0.03]:  # 学習率を 3 通り試す
    m = HistGradientBoostingClassifier(
        learning_rate=lr,       # ★ 1 本の木が予測を直す大きさ
        max_iter=2000,          # 木の数の上限（実際は早期終了で止まる）
        early_stopping=True,    # ★ 検証の点数が伸びなくなったら止める
        validation_fraction=0.1, n_iter_no_change=20,  # 学習用の 1 割で検証し、20 本改善しなければ止める
        random_state=0).fit(X_tr, y_tr)
    print(f"学習率 {lr:<5} 木の数 {m.n_iter_:>4}  テスト {m.score(X_te, y_te):.3f}")
```

```text
学習率 0.3   木の数   58  テスト 0.911
学習率 0.1   木の数  123  テスト 0.921
学習率 0.03  木の数  295  テスト 0.918
```

学習率を 0.3 → 0.1 → 0.03 と小さくすると、止まるまでの木の数は 58 → 123 → 295 と増える。精度は 0.1 が最も良く、0.03 まで下げても伸びていない。学習率を下げすぎると計算時間だけが増えるので、**0.05〜0.1 あたりから始め、早期終了に任せる**のが扱いやすい。

> [!WARNING] 早期終了の検証データとテストデータを混ぜない
> 早期終了は、検証用データの点数を見て木の数を決める。その検証用データでそのまま最終評価をすると、点数が甘くなる。`HistGradientBoostingClassifier` は学習用データの中から検証用を自動で切り出すので、テスト用データは別に取っておく。

### LightGBM・XGBoost・CatBoost の違い

実務で使われる勾配ブースティングの実装は主に 3 つある。どれも同じ考え方だが、木の育て方と、カテゴリー（区分）の列の扱いが違う。scikit-learn の `HistGradientBoosting` は LightGBM の方式にならった実装だ。

| 実装 | 木の育て方（既定） | 特徴 | 向く場面 |
|---|---|---|---|
| LightGBM | 葉ごと（leaf-wise）: 最も誤差の減る葉から伸ばす | 値を区間に分けるヒストグラム方式で高速。データが少ないと過学習しやすい | 大量データを速く学習したい |
| XGBoost | 深さごと（depthwise）: 同じ深さの葉を順に分ける | 歴史が長く、分散学習や多くの環境への対応が厚い | 既存の基盤に組み込みたい、大規模な分散学習 |
| CatBoost | 対称木（SymmetricTree）: 同じ深さの葉をすべて同じ条件で分ける | カテゴリー列の扱いが丁寧で、既定の設定でも崩れにくい | カテゴリー列が多い、調整に時間をかけたくない |
| scikit-learn `HistGradientBoosting` | 葉ごと（LightGBM と同様） | 追加の導入が不要。欠損値・カテゴリー列を直接扱える | 依存を増やしたくない、まず試したい |

どれを選んでも、精度の差は調整の仕方で入れ替わる程度のことが多い。既存の環境で使いやすいもの、チームが慣れているものを選べばよい。

## スタッキング：種類の違うモデルを「まとめ役」が束ねる

**スタッキング**は、種類の違うモデル（木・サポートベクターマシン・近傍法など）の予測を**入力として**、もう 1 つのモデル（まとめ役、メタモデル）に学習させる。「どのモデルをどれだけ信じるか」をデータから学ばせるわけだ。

まとめ役の学習には、各モデルが**学習に使っていないデータに対して出した予測**を使う。学習に使ったデータへの予測は当たりすぎていて、まとめ役がそれを過信してしまうからだ。scikit-learn の `StackingClassifier` は、この処理を交差検証で自動的に行う。

```python title="stacking.py" caption="4 種類のモデルをロジスティック回帰で束ねる（boosting.py の続き）" {10,15,16}
from sklearn.ensemble import StackingClassifier  # スタッキング
from sklearn.linear_model import LogisticRegression  # まとめ役に使う単純なモデル
from sklearn.svm import SVC  # サポートベクターマシン（境界からの距離で分類する）
from sklearn.neighbors import KNeighborsClassifier  # 近傍法（近いデータの多数決）
from sklearn.pipeline import make_pipeline  # 前処理とモデルをつなぐ
from sklearn.preprocessing import StandardScaler  # 尺度を揃える（SVM と近傍法に必要）

base = [("rf", RandomForestClassifier(n_estimators=300, random_state=0, n_jobs=-1)),
        ("hgb", HistGradientBoostingClassifier(random_state=0)),
        ("svm", make_pipeline(StandardScaler(), SVC(random_state=0))),  # ★ 木とは違う仕組みのモデル
        ("knn", make_pipeline(StandardScaler(), KNeighborsClassifier(15)))]
for name, m in base:  # まず 1 つずつの実力を測る
    print(f"{name:<5} テスト {m.fit(X_tr, y_tr).score(X_te, y_te):.3f}")

stack = StackingClassifier(base, final_estimator=LogisticRegression(),  # ★ まとめ役
                           cv=5, n_jobs=-1)  # ★ 学習に使っていないデータへの予測で、まとめ役を学習
print(f"stack テスト {stack.fit(X_tr, y_tr).score(X_te, y_te):.3f}")
```

```text
rf    テスト 0.910
hgb   テスト 0.914
svm   テスト 0.896
knn   テスト 0.845
stack テスト 0.918
```

最良の単体モデル（勾配ブースティング 0.914）に対し、スタッキングは 0.918 で、改善は 0.4 ポイントだ。モデルを 4 つ学習して予測時にも 4 つ動かすコストに見合うかは、場面による。

- **コンペティション**: 0.4 ポイントで順位が大きく変わるので、スタッキングは定番になっている。2025 年 4 月の Kaggle Playground では、500 回の実験から選んだ 75 個のモデルを 3 段に重ねた解法が優勝した
- **本番システム**: 予測の遅延、保守するモデルの数、原因調査のしやすさを考えると、単体の勾配ブースティングで十分なことが多い

## 活用事例と、表形式データで木が強い理由

木のアンサンブルは、表形式データを扱う現場で広く使われている。

| 分野 | 事例 | 使われる理由 |
|---|---|---|
| 配車・物流 | Uber は機械学習基盤 Michelangelo で分散 XGBoost を本番化し、深さ 16 以上の木を数十億件のデータで学習して、到着時刻（ETA）の推定などの精度を上げたと報告している | 数値と区分が混在する大量の表データを高速に学習できる |
| 金融 | カード取引の不正スコア | 欠損値をそのまま扱え、予測が速い。重要度で理由を確かめやすい |
| 小売・需要予測 | 店舗 × 商品 × 日ごとの売上予測 | 曜日・天気・販促など、条件の組み合わせの効果を拾いやすい |
| 広告・推薦 | クリック率の予測、候補の並べ替え（ランキング） | 並べ替え専用の損失関数（LambdaRank など）が用意されている |
| データ分析コンペ | Kaggle の表形式データの課題 | 2025 年の調査では、表形式のコンペの多くを GBDT（主に LightGBM）が制し、ニューラルネットとのアンサンブルも多い |

表形式データで深層学習より木が強い理由は、Grinsztajn らの NeurIPS 2022 の研究が整理している。約 1 万件規模のデータで比べると、木のモデルが依然として最良で、ニューラルネットには次の 3 つの弱点があった。

| ニューラルネットの弱点 | 表形式データでの意味 | 木が強い理由 |
|---|---|---|
| 滑らかな関数を学びがち | 「年収 400 万円を境に急に変わる」ような段差を表しにくい | 区切り値で分けるので、段差をそのまま表せる |
| 無関係な列に弱い | 業務データには効かない列が多く含まれる | 分割に使わなければ、その列の影響を受けない |
| 列の向きを保たない（回転不変） | 列ごとに意味が違うのに、列を混ぜ合わせて学習する | 1 回の分割で 1 つの列だけを見る |

> [!NOTE] 最近の例外：表形式データの基盤モデル
> 2025 年に Nature に掲載された TabPFN は、大量の合成データで事前に学習した Transformer で、1 万件以下のデータでは調整済みの勾配ブースティングを上回ったと報告されている。ただし対象は小〜中規模のデータで、大規模データでは木のアンサンブルがいまも有力だ。深層学習との線引きは第 6 回で扱う。

## どのアンサンブルを選ぶか

```flow caption="表形式データでのアンサンブルの選び方"
A([表形式のデータ]) --> B{まず基準が欲しい?}
B -- はい --> C[ランダムフォレスト\n既定の設定]
B -- いいえ --> D[勾配ブースティング\n早期終了つき]:::hl
C --> D
D --> E{0.1 ポイントを\n争う?}
E -- はい --> F([スタッキング])
E -- いいえ --> G([単体で本番へ])
```

| 観点 | ランダムフォレスト | 勾配ブースティング | スタッキング |
|---|---|---|---|
| 精度 | 良い | 最も良いことが多い | わずかに上積み |
| 調整の手間 | ほぼ不要 | 学習率・葉の数・早期終了 | 各モデル＋まとめ役 |
| 過学習のしにくさ | しにくい | 早期終了がないと過学習する | まとめ役の学習方法しだい |
| 学習の並列化 | 木ごとに並列にできる | 木は順番に作る（木の中は並列） | 各モデルを並列にできる |
| 本番の保守 | 1 モデル | 1 モデル | 複数モデル |

## アンサンブルのチェックリスト

| 確かめること | 対応する節 |
|---|---|
| まず単体の決定木とランダムフォレストで基準の点数を取った | ランダムフォレスト |
| 勾配ブースティングは早期終了で木の数を決めた | 勾配ブースティング |
| 早期終了の検証データと、最終評価のテストデータを分けた | 勾配ブースティング |
| スタッキングの改善幅が、運用コストに見合うか確かめた | スタッキング |
| 学習データの範囲外を予測する必要がないか確かめた（木は外挿できない） | 第 3 回 |
| 重要度は並べ替え重要度で確かめた | 第 3 回 |

木のアンサンブルは「間違え方の違う木をどう作るか」という 1 つの考え方の変奏だ。バギングはデータを揺らし、ブースティングは誤りを順に直し、スタッキングはモデルの種類を変える。

次回「[学習とは「坂を下ること」である](2026-09-30-ml-basics-5-gradient-descent.html)」では、勾配ブースティングの名前にも入っていた**勾配降下法**を、NumPy だけで一から組み立てる。

## 参考文献

情報はすべて 2026-09-30 時点で確認した。

- scikit-learn, [Ensembles: Gradient boosting, random forests, bagging, voting, stacking](https://scikit-learn.org/stable/modules/ensemble.html)
- LightGBM, [Features（Leaf-wise tree growth、ヒストグラム方式）](https://lightgbm.readthedocs.io/en/latest/Features.html)
- XGBoost, [XGBoost Parameters（grow_policy）](https://xgboost.readthedocs.io/en/stable/parameter.html)
- CatBoost, [Parameter tuning（grow_policy: SymmetricTree）](https://catboost.ai/docs/en/concepts/parameter-tuning)
- Uber Engineering, [Productionizing Distributed XGBoost to Train Deep Tree Models with Large Data Sets at Uber](https://www.uber.com/blog/productionizing-distributed-xgboost/)（2019-12-10）
- Grinsztajn, Oyallon, Varoquaux, [Why do tree-based models still outperform deep learning on typical tabular data?](https://arxiv.org/abs/2207.08815)（NeurIPS 2022）
- Hollmann et al., [Accurate predictions on small data with a tabular foundation model](https://pubmed.ncbi.nlm.nih.gov/39780007/)（Nature 637, 2025）
- [Kaggle Chronicles: 15 Years of Competitions, Community and Data Science Innovation](https://arxiv.org/abs/2511.06304)（2025-11）
- NVIDIA Technical Blog, [Grandmaster Pro Tip: Winning First Place in a Kaggle Competition with Stacking Using cuML](https://developer.nvidia.com/blog/grandmaster-pro-tip-winning-first-place-in-a-kaggle-competition-with-stacking-using-cuml/)
