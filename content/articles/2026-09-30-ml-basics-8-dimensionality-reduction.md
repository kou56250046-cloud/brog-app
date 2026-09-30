---
title: 2 次元の図を信じすぎない：PCA・t-SNE・UMAP を目的で使い分ける
description: 次元削減は、列の多いデータを少ない列に縮める技術だ。PCA の寄与率と主成分の読み方、前処理としての圧縮、t-SNE による可視化とその図の読み違え、埋め込みベクトルの圧縮までを動くコードで整理し、目的から手法を選ぶ判断軸をまとめる。
date: "2026-09-30"
updated: ""
verified: "2026-09-30"
category: 機械学習
tags: [機械学習, 次元削減, PCA, t-SNE, scikit-learn, Python]
level: [basic, practice, advanced]
series: 機械学習の基礎と使いどころ
status: published
---

検査項目が 30 個ある診断データ、64 画素の画像、1,000 次元を超える文章の埋め込みベクトル。列（次元）が多いデータは、そのままでは人の目で眺められず、計算も重く、過学習も起きやすい。**次元削減**は、情報をなるべく失わずに列の数を減らす技術だ。

次元削減には、目的の違う 2 つの使い方がある。1 つは**計算のための圧縮**（100 列を 20 列にしてモデルに渡す）、もう 1 つは**人が見るための可視化**（2 次元の散布図にする）だ。同じ手法でも、目的によって良し悪しの基準が変わる。

特に可視化の図は、見た目の説得力が強いぶん読み違えやすい。この記事では、その違いを軸に整理する。

> [!TIP] この記事で分かること
> - PCA が何を残し何を捨てるのかと、寄与率による次元数の決め方
> - 主成分の中身を読み、「何の軸か」を解釈する方法
> - 前処理として次元を削ったとき、精度がどう変わるか
> - t-SNE の図で分かること・分からないこと（距離・大きさ・形を読みすぎない）
> - PCA・t-SNE・UMAP・埋め込みの次元圧縮を、目的から選ぶ判断軸

連載「機械学習の基礎と使いどころ」の最終回（第 8 回）。前回「[正解のない分類をどう評価するか](2026-09-30-ml-basics-7-clustering.html)」の文書クラスタリングでは、次元削減が前処理として使われていた。

| 記号 | 意味 |
|---|---|
| `#` | ここから行末までは説明（コメント）。動作には関係しない |
| `np.cumsum(a)` | 先頭からの累積の合計（1 番目、1〜2 番目、1〜3 番目…の合計） |
| `np.argsort(a)[::-1][:3]` | 値の大きい順に並べて、上位 3 つの位置を取り出す |
| `fit_transform(X)` | 学習して、そのまま変換した結果を返す |
| `components_` | PCA が見つけた新しい軸（主成分）の中身 |

```flow caption="次元削減の手法は、目的で先に分かれる"
A([列の多いデータ]) --> B{目的は?}
B -- 計算のための圧縮 --> C[PCA]:::hl
B -- 人が見る可視化 --> D[t-SNE / UMAP]
C --> E([モデルの入力に使う])
D --> F[近さだけを読む]
F --> G([仮説を立てて\n元のデータで確かめる])
```

## PCA：ばらつきの大きい方向から順に残す

**主成分分析**（PCA）は、データが最も大きくばらついている方向を 1 本目の新しい軸（第 1 主成分）とし、それと直交する方向の中で次にばらつきの大きい方向を 2 本目の軸とする、という手順で軸を作り直す。そして上位の軸だけを残し、残りを捨てる。

「ばらつきが大きい方向には情報が多い」と考えるわけだ。たとえば身長と体重は強く相関するので、2 列を「体の大きさ」という 1 本の軸にまとめても、失う情報は少ない。

各軸が元のばらつきの何割を説明するかを**寄与率**と呼ぶ。乳がん診断データ（30 項目）で、何本の軸を残せば元の情報の大半を保てるかを調べる。

```python title="pca_variance.py" caption="30 項目を何本の軸にまとめられるか、累積寄与率で調べる" {7,10}
import numpy as np  # 数値計算のライブラリ
from sklearn.datasets import load_breast_cancer  # 乳がん診断の練習用データ（30 項目）
from sklearn.preprocessing import StandardScaler  # 各列を平均 0・ばらつき 1 に揃える
from sklearn.decomposition import PCA  # 主成分分析

data = load_breast_cancer()  # データを読み込む
Xs = StandardScaler().fit_transform(data.data)  # ★ 単位の違う列を揃えてから PCA にかける
pca = PCA().fit(Xs)  # 30 本すべての主成分を計算する

cum = np.cumsum(pca.explained_variance_ratio_)  # ★ 累積寄与率（上位 k 本で何割を説明するか）
for k in [1, 2, 3, 5, 10]:  # 残す本数ごとに表示する
    print(f"{k:>2} 本  累積寄与率 {cum[k - 1]:.3f}")
print(f"95% を残すのに必要な本数: {np.searchsorted(cum, 0.95) + 1}")  # 初めて 0.95 を超える位置
```

```text
 1 本  累積寄与率 0.443
 2 本  累積寄与率 0.632
 3 本  累積寄与率 0.726
 5 本  累積寄与率 0.847
10 本  累積寄与率 0.952
95% を残すのに必要な本数: 10
```

30 項目のうち、第 1 主成分だけでばらつきの 44% を、上位 10 本で 95% を説明できる。30 列を 10 列に減らしても、ばらつきの大半は残るということだ。項目どうしが強く相関しているデータほど、少ない本数にまとまる。

> [!IMPORTANT] PCA の前に標準化する
> PCA は「ばらつきの大きさ」を見るので、単位の大きい列（面積など）が、それだけで第 1 主成分を占領してしまう。第 7 回の k-means と同じく、列の単位が違うデータでは必ず標準化してからかける。

## 主成分を読んで「何の軸か」を名付ける

PCA の軸は、元の項目の重み付きの足し算でできている。その重み（`components_`）を見れば、各軸が何を表しているかを解釈できる。

```python title="pca_loadings.py" caption="第 1・第 2 主成分で重みの大きい項目を見る（pca_variance.py の続き）" {2}
for i in range(2):  # 第 1 と第 2 主成分について
    weights = pca.components_[i]  # ★ 30 項目それぞれへの重み
    top = np.argsort(np.abs(weights))[::-1][:3]  # 重みの絶対値が大きい 3 項目
    names = [f"{data.feature_names[j]} ({weights[j]:+.2f})" for j in top]  # 名前と重みを並べる
    print(f"第 {i + 1} 主成分: " + ", ".join(names))
```

```text
第 1 主成分: mean concave points (+0.26), mean concavity (+0.26), worst concave points (+0.25)
第 2 主成分: mean fractal dimension (+0.37), fractal dimension error (+0.28), worst fractal dimension (+0.28)
```

第 1 主成分では、細胞核の輪郭の「くぼみ」（concave points、concavity）の重みが大きい。第 2 主成分では、輪郭の「複雑さ」（fractal dimension）が中心だ。つまり、この 30 項目のデータは主に「くぼみの多さ」と「輪郭の複雑さ」の 2 つの軸で整理できる、と解釈できる。

ただし、第 1 主成分の重みは上位 3 項目でも 0.25 前後で、多くの項目に少しずつ重みが分散している。主成分は複数の項目の混合なので、**1 つの名前でぴったり言い表せるとは限らない**。解釈は「おおよそ何の軸か」に留める。

## 前処理として削ると、精度はどう変わるか

次元削減をモデルの前処理に使うと、計算が軽くなり、雑音の多い軸を捨てることで過学習が抑えられることもある。一方、削りすぎれば予測に必要な情報まで捨てる。手書き数字（64 画素）で、残す次元数と分類の精度の関係を見る。

```python title="pca_preprocess.py" caption="64 画素を 5〜40 次元に縮めてから分類する（pca_loadings.py の続き）" {9}
from sklearn.datasets import load_digits  # 手書き数字（8×8 = 64 画素）
from sklearn.linear_model import LogisticRegression  # 分類モデル
from sklearn.pipeline import make_pipeline  # 前処理とモデルをつなぐ
from sklearn.model_selection import cross_val_score  # 交差検証で点数を出す

X, y = load_digits(return_X_y=True)  # 1,797 枚の画像と、その数字
for k in [5, 10, 20, 40, 64]:  # 残す次元数を変える（64 は削らない場合）
    steps = [StandardScaler(), PCA(k, random_state=0)] if k < 64 else [StandardScaler()]
    pipe = make_pipeline(*steps, LogisticRegression(max_iter=2000))  # ★ PCA もパイプラインに入れる
    print(f"{k:>2} 次元  正解率 {cross_val_score(pipe, X, y, cv=5).mean():.3f}")
```

```text
 5 次元  正解率 0.771
10 次元  正解率 0.840
20 次元  正解率 0.899
40 次元  正解率 0.914
64 次元  正解率 0.920
```

40 次元まで縮めても、正解率は 0.920 から 0.914 と、ほとんど下がらない。20 次元で 0.899、5 次元では 0.771 まで落ちる。どこまで削るかは、**精度の低下と、計算の軽さ・保存容量の節約を天秤にかけて**決める。`PCA(0.95)` のように割合で指定すると、累積寄与率 95% を満たす最小の本数を自動で選べる。

PCA をパイプラインに入れているのは、第 2 回のデータ漏れを防ぐためだ。PCA の軸を全データで計算してから交差検証すると、検証用データの情報が軸に混ざる。

> [!NOTE] 木のモデルには PCA をかけないことが多い
> 決定木や勾配ブースティングは、1 回の分割で 1 つの列を見る。PCA で列を混ぜ合わせると、「年収 400 万円を境に」のような分かりやすい区切りが使えなくなり、精度も解釈性も落ちることがある。PCA の前処理が効きやすいのは、線形モデル・近傍法・SVM など距離や重み付きの和を使うモデルだ。

## t-SNE：近いものを近くに置く可視化

PCA は直線的な軸しか作れないので、曲がった構造を持つデータを 2 次元にすると、グループが重なって見えることが多い。可視化によく使われる **t-SNE** は、考え方がまったく違う。**元の空間で近かった点どうしを、2 次元でも近くに置く**ことだけを目指して、点の配置を少しずつ動かしていく。

手書き数字 1,797 枚を、PCA と t-SNE でそれぞれ 2 次元にした。下の図は、そこから各数字 35 枚ずつを取り出し、点の代わりにその数字を描いたものだ。

```svg caption="手書き数字を 2 次元に縮めた散布図（各数字 35 枚）。左の PCA では数字が重なり、右の t-SNE では 0〜9 が固まって分かれる"
<svg viewBox="0 0 640 334" width="640" style="max-width:100%;height:auto" role="img" aria-label="手書き数字 350 枚を 2 次元に縮めた散布図。左の PCA では数字が大きく重なり、右の t-SNE では 0〜9 がそれぞれ固まって分かれる">
<style>.dr-frame{fill:none;stroke:var(--line-strong)}.dr-title{fill:var(--ink);font-size:13px;font-weight:600;text-anchor:middle}.dr-pts text{fill:var(--ink-2);font-size:9px;font-family:var(--font-mono);text-anchor:middle;dominant-baseline:central}</style>
<rect x="0" y="30" width="300" height="300" rx="6" class="dr-frame"/><text x="150.0" y="20" class="dr-title">PCA（線形）</text><g class="dr-pts"><text x="179" y="275">0</text><text x="135" y="281">0</text><text x="126" y="282">0</text><text x="191" y="279">0</text><text x="147" y="276">0</text><text x="99" y="269">0</text><text x="200" y="254">0</text><text x="131" y="309">0</text><text x="193" y="285">0</text><text x="140" y="266">0</text><text x="156" y="299">0</text><text x="138" y="265">0</text><text x="207" y="236">0</text><text x="152" y="290">0</text><text x="152" y="316">0</text><text x="205" y="272">0</text><text x="151" y="228">0</text><text x="180" y="263">0</text><text x="184" y="266">0</text><text x="140" y="263">0</text><text x="149" y="274">0</text><text x="172" y="272">0</text><text x="185" y="286">0</text><text x="143" y="209">0</text><text x="159" y="274">0</text><text x="177" y="272">0</text><text x="131" y="292">0</text><text x="197" y="238">0</text><text x="167" y="239">0</text><text x="140" y="267">0</text><text x="134" y="282">0</text><text x="165" y="260">0</text><text x="139" y="255">0</text><text x="181" y="258">0</text><text x="185" y="273">0</text><text x="176" y="68">1</text><text x="188" y="50">1</text><text x="203" y="69">1</text><text x="161" y="137">1</text><text x="181" y="105">1</text><text x="166" y="124">1</text><text x="200" y="92">1</text><text x="178" y="60">1</text><text x="168" y="147">1</text><text x="203" y="70">1</text><text x="155" y="160">1</text><text x="173" y="58">1</text><text x="141" y="170">1</text><text x="211" y="69">1</text><text x="151" y="147">1</text><text x="190" y="119">1</text><text x="120" y="223">1</text><text x="245" y="83">1</text><text x="198" y="160">1</text><text x="223" y="107">1</text><text x="127" y="185">1</text><text x="232" y="119">1</text><text x="167" y="140">1</text><text x="211" y="82">1</text><text x="116" y="173">1</text><text x="194" y="57">1</text><text x="153" y="136">1</text><text x="191" y="103">1</text><text x="132" y="157">1</text><text x="209" y="161">1</text><text x="201" y="51">1</text><text x="188" y="157">1</text><text x="184" y="114">1</text><text x="217" y="98">1</text><text x="189" y="75">1</text><text x="95" y="139">2</text><text x="97" y="135">2</text><text x="104" y="127">2</text><text x="140" y="173">2</text><text x="81" y="157">2</text><text x="111" y="159">2</text><text x="99" y="167">2</text><text x="132" y="144">2</text><text x="134" y="142">2</text><text x="97" y="225">2</text><text x="71" y="134">2</text><text x="127" y="128">2</text><text x="168" y="130">2</text><text x="107" y="160">2</text><text x="120" y="121">2</text><text x="109" y="148">2</text><text x="108" y="135">2</text><text x="90" y="128">2</text><text x="83" y="145">2</text><text x="100" y="107">2</text><text x="115" y="169">2</text><text x="127" y="147">2</text><text x="99" y="121">2</text><text x="118" y="132">2</text><text x="99" y="178">2</text><text x="109" y="150">2</text><text x="112" y="142">2</text><text x="121" y="141">2</text><text x="92" y="127">2</text><text x="125" y="154">2</text><text x="94" y="129">2</text><text x="93" y="200">2</text><text x="117" y="138">2</text><text x="93" y="127">2</text><text x="87" y="146">2</text><text x="47" y="177">3</text><text x="58" y="209">3</text><text x="71" y="179">3</text><text x="57" y="176">3</text><text x="50" y="113">3</text><text x="119" y="101">3</text><text x="67" y="194">3</text><text x="100" y="204">3</text><text x="94" y="131">3</text><text x="55" y="179">3</text><text x="40" y="217">3</text><text x="38" y="225">3</text><text x="121" y="76">3</text><text x="94" y="44">3</text><text x="31" y="196">3</text><text x="14" y="213">3</text><text x="62" y="174">3</text><text x="90" y="65">3</text><text x="37" y="203">3</text><text x="68" y="153">3</text><text x="59" y="182">3</text><text x="25" y="195">3</text><text x="68" y="170">3</text><text x="78" y="136">3</text><text x="57" y="214">3</text><text x="89" y="158">3</text><text x="97" y="217">3</text><text x="117" y="195">3</text><text x="50" y="178">3</text><text x="67" y="135">3</text><text x="62" y="175">3</text><text x="50" y="198">3</text><text x="43" y="149">3</text><text x="119" y="241">3</text><text x="65" y="132">3</text><text x="271" y="162">4</text><text x="237" y="111">4</text><text x="269" y="238">4</text><text x="230" y="205">4</text><text x="268" y="178">4</text><text x="238" y="208">4</text><text x="257" y="177">4</text><text x="247" y="125">4</text><text x="284" y="207">4</text><text x="223" y="153">4</text><text x="249" y="236">4</text><text x="246" y="165">4</text><text x="251" y="153">4</text><text x="277" y="163">4</text><text x="265" y="180">4</text><text x="220" y="179">4</text><text x="277" y="130">4</text><text x="261" y="203">4</text><text x="216" y="205">4</text><text x="275" y="177">4</text><text x="286" y="195">4</text><text x="281" y="171">4</text><text x="286" y="173">4</text><text x="275" y="179">4</text><text x="265" y="233">4</text><text x="247" y="258">4</text><text x="238" y="103">4</text><text x="255" y="98">4</text><text x="257" y="191">4</text><text x="284" y="220">4</text><text x="266" y="162">4</text><text x="265" y="186">4</text><text x="275" y="183">4</text><text x="256" y="142">4</text><text x="273" y="118">4</text><text x="177" y="122">5</text><text x="86" y="179">5</text><text x="79" y="234">5</text><text x="189" y="133">5</text><text x="95" y="238">5</text><text x="118" y="232">5</text><text x="162" y="176">5</text><text x="155" y="155">5</text><text x="89" y="225">5</text><text x="176" y="166">5</text><text x="153" y="146">5</text><text x="137" y="123">5</text><text x="161" y="163">5</text><text x="132" y="198">5</text><text x="175" y="120">5</text><text x="192" y="116">5</text><text x="183" y="109">5</text><text x="190" y="146">5</text><text x="134" y="124">5</text><text x="155" y="122">5</text><text x="145" y="113">5</text><text x="128" y="92">5</text><text x="137" y="226">5</text><text x="131" y="230">5</text><text x="131" y="203">5</text><text x="92" y="252">5</text><text x="113" y="125">5</text><text x="127" y="91">5</text><text x="163" y="117">5</text><text x="98" y="262">5</text><text x="149" y="178">5</text><text x="150" y="238">5</text><text x="103" y="162">5</text><text x="127" y="210">5</text><text x="121" y="198">5</text><text x="241" y="206">6</text><text x="216" y="231">6</text><text x="265" y="177">6</text><text x="214" y="248">6</text><text x="234" y="230">6</text><text x="212" y="236">6</text><text x="254" y="184">6</text><text x="232" y="233">6</text><text x="251" y="207">6</text><text x="230" y="234">6</text><text x="184" y="153">6</text><text x="226" y="254">6</text><text x="234" y="239">6</text><text x="220" y="228">6</text><text x="243" y="185">6</text><text x="232" y="247">6</text><text x="179" y="266">6</text><text x="235" y="231">6</text><text x="234" y="242">6</text><text x="242" y="234">6</text><text x="204" y="215">6</text><text x="236" y="167">6</text><text x="218" y="232">6</text><text x="223" y="254">6</text><text x="226" y="185">6</text><text x="235" y="203">6</text><text x="254" y="181">6</text><text x="222" y="246">6</text><text x="217" y="245">6</text><text x="246" y="152">6</text><text x="236" y="223">6</text><text x="220" y="255">6</text><text x="249" y="226">6</text><text x="225" y="250">6</text><text x="258" y="221">6</text><text x="126" y="84">7</text><text x="166" y="113">7</text><text x="140" y="104">7</text><text x="180" y="129">7</text><text x="173" y="113">7</text><text x="172" y="110">7</text><text x="171" y="120">7</text><text x="212" y="84">7</text><text x="176" y="118">7</text><text x="141" y="91">7</text><text x="166" y="114">7</text><text x="144" y="98">7</text><text x="172" y="81">7</text><text x="158" y="103">7</text><text x="190" y="105">7</text><text x="119" y="93">7</text><text x="141" y="74">7</text><text x="152" y="99">7</text><text x="212" y="135">7</text><text x="97" y="98">7</text><text x="134" y="77">7</text><text x="176" y="149">7</text><text x="155" y="86">7</text><text x="156" y="112">7</text><text x="151" y="85">7</text><text x="115" y="93">7</text><text x="121" y="77">7</text><text x="141" y="71">7</text><text x="160" y="89">7</text><text x="166" y="125">7</text><text x="123" y="84">7</text><text x="195" y="74">7</text><text x="152" y="76">7</text><text x="172" y="99">7</text><text x="161" y="107">7</text><text x="155" y="169">8</text><text x="157" y="139">8</text><text x="103" y="192">8</text><text x="123" y="175">8</text><text x="155" y="86">8</text><text x="154" y="167">8</text><text x="136" y="196">8</text><text x="131" y="179">8</text><text x="124" y="157">8</text><text x="116" y="149">8</text><text x="174" y="100">8</text><text x="143" y="197">8</text><text x="129" y="169">8</text><text x="115" y="203">8</text><text x="139" y="133">8</text><text x="140" y="125">8</text><text x="167" y="121">8</text><text x="131" y="91">8</text><text x="135" y="141">8</text><text x="143" y="155">8</text><text x="159" y="198">8</text><text x="174" y="178">8</text><text x="172" y="176">8</text><text x="187" y="116">8</text><text x="119" y="114">8</text><text x="123" y="186">8</text><text x="125" y="166">8</text><text x="171" y="125">8</text><text x="164" y="167">8</text><text x="140" y="190">8</text><text x="179" y="99">8</text><text x="150" y="196">8</text><text x="98" y="193">8</text><text x="144" y="217">8</text><text x="143" y="165">8</text><text x="157" y="190">9</text><text x="136" y="178">9</text><text x="42" y="236">9</text><text x="97" y="219">9</text><text x="72" y="230">9</text><text x="89" y="237">9</text><text x="91" y="240">9</text><text x="50" y="234">9</text><text x="125" y="225">9</text><text x="82" y="239">9</text><text x="67" y="218">9</text><text x="163" y="208">9</text><text x="68" y="234">9</text><text x="58" y="223">9</text><text x="165" y="210">9</text><text x="66" y="225">9</text><text x="97" y="169">9</text><text x="105" y="217">9</text><text x="140" y="120">9</text><text x="156" y="110">9</text><text x="79" y="195">9</text><text x="116" y="197">9</text><text x="59" y="225">9</text><text x="136" y="214">9</text><text x="122" y="84">9</text><text x="123" y="109">9</text><text x="133" y="233">9</text><text x="73" y="239">9</text><text x="68" y="198">9</text><text x="74" y="228">9</text><text x="119" y="133">9</text><text x="108" y="223">9</text><text x="127" y="151">9</text><text x="144" y="185">9</text><text x="75" y="245">9</text></g>
<rect x="340" y="30" width="300" height="300" rx="6" class="dr-frame"/><text x="490.0" y="20" class="dr-title">t-SNE（非線形）</text><g class="dr-pts"><text x="503" y="301">0</text><text x="485" y="309">0</text><text x="484" y="308">0</text><text x="510" y="299">0</text><text x="495" y="307">0</text><text x="481" y="311">0</text><text x="515" y="296">0</text><text x="500" y="315">0</text><text x="511" y="297">0</text><text x="488" y="304">0</text><text x="480" y="285">0</text><text x="497" y="307">0</text><text x="507" y="286">0</text><text x="482" y="285">0</text><text x="498" y="316">0</text><text x="507" y="289">0</text><text x="472" y="290">0</text><text x="489" y="292">0</text><text x="507" y="291">0</text><text x="473" y="297">0</text><text x="482" y="296">0</text><text x="500" y="302">0</text><text x="504" y="292">0</text><text x="471" y="290">0</text><text x="481" y="295">0</text><text x="481" y="303">0</text><text x="507" y="309">0</text><text x="510" y="286">0</text><text x="473" y="292">0</text><text x="474" y="303">0</text><text x="487" y="306">0</text><text x="480" y="295">0</text><text x="475" y="290">0</text><text x="499" y="284">0</text><text x="493" y="295">0</text><text x="511" y="130">1</text><text x="510" y="129">1</text><text x="492" y="135">1</text><text x="535" y="146">1</text><text x="531" y="143">1</text><text x="536" y="146">1</text><text x="501" y="140">1</text><text x="509" y="128">1</text><text x="361" y="94">1</text><text x="506" y="137">1</text><text x="362" y="93">1</text><text x="503" y="130">1</text><text x="544" y="143">1</text><text x="503" y="136">1</text><text x="357" y="100">1</text><text x="487" y="142">1</text><text x="551" y="144">1</text><text x="503" y="140">1</text><text x="358" y="94">1</text><text x="493" y="146">1</text><text x="547" y="144">1</text><text x="495" y="147">1</text><text x="542" y="135">1</text><text x="501" y="139">1</text><text x="549" y="147">1</text><text x="504" y="133">1</text><text x="539" y="142">1</text><text x="493" y="149">1</text><text x="358" y="102">1</text><text x="354" y="96">1</text><text x="493" y="136">1</text><text x="358" y="95">1</text><text x="533" y="146">1</text><text x="496" y="143">1</text><text x="531" y="138">1</text><text x="427" y="94">2</text><text x="402" y="90">2</text><text x="401" y="83">2</text><text x="408" y="80">2</text><text x="396" y="104">2</text><text x="425" y="104">2</text><text x="417" y="81">2</text><text x="407" y="97">2</text><text x="390" y="99">2</text><text x="388" y="113">2</text><text x="415" y="102">2</text><text x="410" y="99">2</text><text x="453" y="118">2</text><text x="429" y="90">2</text><text x="399" y="96">2</text><text x="395" y="110">2</text><text x="405" y="103">2</text><text x="396" y="84">2</text><text x="418" y="85">2</text><text x="420" y="103">2</text><text x="387" y="111">2</text><text x="429" y="88">2</text><text x="409" y="91">2</text><text x="407" y="96">2</text><text x="388" y="112">2</text><text x="426" y="90">2</text><text x="419" y="80">2</text><text x="420" y="112">2</text><text x="426" y="93">2</text><text x="404" y="85">2</text><text x="396" y="84">2</text><text x="393" y="110">2</text><text x="415" y="80">2</text><text x="425" y="101">2</text><text x="424" y="103">2</text><text x="376" y="156">3</text><text x="391" y="187">3</text><text x="392" y="180">3</text><text x="388" y="179">3</text><text x="386" y="152">3</text><text x="400" y="148">3</text><text x="415" y="173">3</text><text x="397" y="189">3</text><text x="384" y="146">3</text><text x="383" y="173">3</text><text x="368" y="173">3</text><text x="368" y="183">3</text><text x="492" y="79">3</text><text x="407" y="146">3</text><text x="368" y="179">3</text><text x="370" y="177">3</text><text x="378" y="170">3</text><text x="407" y="146">3</text><text x="373" y="176">3</text><text x="383" y="147">3</text><text x="378" y="165">3</text><text x="370" y="177">3</text><text x="391" y="178">3</text><text x="382" y="149">3</text><text x="379" y="188">3</text><text x="380" y="170">3</text><text x="396" y="187">3</text><text x="417" y="171">3</text><text x="385" y="166">3</text><text x="386" y="157">3</text><text x="390" y="170">3</text><text x="389" y="186">3</text><text x="381" y="153">3</text><text x="378" y="192">3</text><text x="380" y="154">3</text><text x="623" y="127">4</text><text x="597" y="117">4</text><text x="615" y="146">4</text><text x="597" y="135">4</text><text x="608" y="132">4</text><text x="624" y="150">4</text><text x="602" y="144">4</text><text x="591" y="153">4</text><text x="610" y="146">4</text><text x="624" y="118">4</text><text x="622" y="149">4</text><text x="598" y="145">4</text><text x="595" y="152">4</text><text x="626" y="126">4</text><text x="609" y="132">4</text><text x="597" y="127">4</text><text x="588" y="150">4</text><text x="610" y="148">4</text><text x="597" y="135">4</text><text x="619" y="132">4</text><text x="617" y="136">4</text><text x="612" y="131">4</text><text x="607" y="138">4</text><text x="625" y="129">4</text><text x="622" y="148">4</text><text x="624" y="149">4</text><text x="581" y="149">4</text><text x="586" y="150">4</text><text x="600" y="129">4</text><text x="622" y="141">4</text><text x="620" y="124">4</text><text x="606" y="135">4</text><text x="610" y="130">4</text><text x="590" y="150">4</text><text x="584" y="152">4</text><text x="518" y="195">5</text><text x="481" y="207">5</text><text x="474" y="229">5</text><text x="512" y="196">5</text><text x="464" y="228">5</text><text x="478" y="229">5</text><text x="520" y="192">5</text><text x="501" y="216">5</text><text x="471" y="224">5</text><text x="523" y="196">5</text><text x="489" y="204">5</text><text x="516" y="193">5</text><text x="502" y="215">5</text><text x="497" y="220">5</text><text x="506" y="207">5</text><text x="515" y="199">5</text><text x="513" y="201">5</text><text x="500" y="215">5</text><text x="494" y="210">5</text><text x="504" y="206">5</text><text x="514" y="193">5</text><text x="503" y="201">5</text><text x="496" y="222">5</text><text x="481" y="229">5</text><text x="478" y="212">5</text><text x="466" y="226">5</text><text x="496" y="202">5</text><text x="502" y="197">5</text><text x="502" y="206">5</text><text x="465" y="226">5</text><text x="500" y="218">5</text><text x="498" y="228">5</text><text x="486" y="212">5</text><text x="497" y="223">5</text><text x="482" y="215">5</text><text x="575" y="214">6</text><text x="581" y="221">6</text><text x="580" y="200">6</text><text x="582" y="233">6</text><text x="599" y="213">6</text><text x="564" y="226">6</text><text x="578" y="203">6</text><text x="588" y="222">6</text><text x="575" y="205">6</text><text x="595" y="219">6</text><text x="566" y="211">6</text><text x="587" y="229">6</text><text x="575" y="227">6</text><text x="565" y="224">6</text><text x="575" y="208">6</text><text x="586" y="224">6</text><text x="597" y="232">6</text><text x="594" y="217">6</text><text x="595" y="209">6</text><text x="568" y="224">6</text><text x="572" y="217">6</text><text x="579" y="198">6</text><text x="589" y="209">6</text><text x="596" y="229">6</text><text x="566" y="213">6</text><text x="593" y="202">6</text><text x="573" y="204">6</text><text x="603" y="220">6</text><text x="589" y="238">6</text><text x="582" y="197">6</text><text x="569" y="219">6</text><text x="592" y="229">6</text><text x="573" y="228">6</text><text x="594" y="228">6</text><text x="587" y="201">6</text><text x="490" y="59">7</text><text x="524" y="75">7</text><text x="490" y="51">7</text><text x="520" y="74">7</text><text x="540" y="62">7</text><text x="532" y="60">7</text><text x="520" y="62">7</text><text x="505" y="47">7</text><text x="518" y="63">7</text><text x="493" y="52">7</text><text x="514" y="76">7</text><text x="529" y="63">7</text><text x="500" y="49">7</text><text x="524" y="64">7</text><text x="533" y="61">7</text><text x="493" y="57">7</text><text x="495" y="64">7</text><text x="531" y="64">7</text><text x="535" y="60">7</text><text x="506" y="64">7</text><text x="504" y="60">7</text><text x="530" y="57">7</text><text x="507" y="52">7</text><text x="521" y="77">7</text><text x="528" y="62">7</text><text x="491" y="61">7</text><text x="510" y="55">7</text><text x="499" y="61">7</text><text x="509" y="52">7</text><text x="524" y="75">7</text><text x="493" y="60">7</text><text x="498" y="44">7</text><text x="511" y="62">7</text><text x="529" y="60">7</text><text x="518" y="75">7</text><text x="452" y="170">8</text><text x="464" y="145">8</text><text x="441" y="161">8</text><text x="448" y="175">8</text><text x="487" y="129">8</text><text x="456" y="145">8</text><text x="450" y="169">8</text><text x="449" y="152">8</text><text x="454" y="166">8</text><text x="455" y="149">8</text><text x="507" y="141">8</text><text x="447" y="164">8</text><text x="450" y="176">8</text><text x="449" y="163">8</text><text x="453" y="174">8</text><text x="479" y="149">8</text><text x="476" y="156">8</text><text x="470" y="146">8</text><text x="444" y="147">8</text><text x="462" y="152">8</text><text x="452" y="179">8</text><text x="431" y="138">8</text><text x="459" y="134">8</text><text x="469" y="138">8</text><text x="467" y="145">8</text><text x="451" y="170">8</text><text x="450" y="166">8</text><text x="451" y="131">8</text><text x="456" y="130">8</text><text x="447" y="160">8</text><text x="470" y="140">8</text><text x="447" y="159">8</text><text x="446" y="171">8</text><text x="438" y="165">8</text><text x="451" y="155">8</text><text x="553" y="126">9</text><text x="550" y="120">9</text><text x="419" y="224">9</text><text x="431" y="232">9</text><text x="416" y="205">9</text><text x="423" y="209">9</text><text x="436" y="224">9</text><text x="425" y="225">9</text><text x="433" y="198">9</text><text x="414" y="220">9</text><text x="419" y="202">9</text><text x="554" y="125">9</text><text x="426" y="211">9</text><text x="422" y="222">9</text><text x="555" y="123">9</text><text x="412" y="216">9</text><text x="403" y="195">9</text><text x="417" y="178">9</text><text x="531" y="98">9</text><text x="531" y="99">9</text><text x="422" y="230">9</text><text x="439" y="208">9</text><text x="426" y="214">9</text><text x="429" y="204">9</text><text x="501" y="190">9</text><text x="528" y="97">9</text><text x="430" y="203">9</text><text x="433" y="216">9</text><text x="428" y="210">9</text><text x="433" y="216">9</text><text x="531" y="96">9</text><text x="419" y="206">9</text><text x="465" y="156">9</text><text x="419" y="192">9</text><text x="412" y="220">9</text></g>
</svg>
```

PCA（左）では、0 や 6 は分かれているが、中央で多くの数字が重なっている。t-SNE（右）では、10 種類の数字がそれぞれ固まりを作っている。この違いを数字でも確かめる。

```python title="tsne.py" caption="2 次元にしたとき、元の近さがどれだけ保たれるかを比べる（pca_preprocess.py の続き）" {5,8}
from sklearn.manifold import TSNE, trustworthiness  # t-SNE と、近さの保存度を測る関数
from sklearn.neighbors import KNeighborsClassifier  # 近くの 5 点の多数決で分類するモデル

Z_pca = PCA(2, random_state=0).fit_transform(X)  # PCA で 64 → 2 次元
Z_tsne = TSNE(2, perplexity=30, random_state=0).fit_transform(X)  # ★ t-SNE で 64 → 2 次元

for name, Z in [("PCA", Z_pca), ("t-SNE", Z_tsne)]:
    trust = trustworthiness(X, Z, n_neighbors=5)  # ★ 2 次元での近所が、元でも近所だった度合い（1 が最良）
    knn = cross_val_score(KNeighborsClassifier(5), Z, y, cv=5).mean()  # 2 次元の近所で数字を当てられるか
    print(f"{name:<6} 近さの保存度 {trust:.3f}  2 次元での近傍分類 {knn:.3f}")
```

```text
PCA    近さの保存度 0.830  2 次元での近傍分類 0.603
t-SNE  近さの保存度 0.995  2 次元での近傍分類 0.976
```

t-SNE は近さの保存度が 0.995 で、2 次元上の近所だけを使って数字を 97.6% 当てられる。**近所の関係**を保つことにかけては、PCA（0.830、60.3%）より圧倒的に優れている。

### t-SNE の図で「読んではいけない」もの

t-SNE が保つのは「近所の関係」だけだ。それ以外を図から読み取ると間違える。Distill に掲載された解説記事（Wattenberg ら、2016）は、設定値によって見た目が大きく変わる例を多数示している。

| 図の特徴 | 読んでよいか | 理由 |
|---|---|---|
| 同じ固まりの中の点は似ている | 読んでよい | t-SNE が最も守ろうとする性質 |
| 固まりどうしの距離 | 読まない | 離れた点どうしの距離は保たれない。「0 と 6 が遠いから違いが大きい」とは言えない |
| 固まりの大きさ（広がり） | 読まない | t-SNE は密なところを広げ、疎なところを縮める |
| 固まりの形 | 読まない | 設定値（perplexity）で大きく変わる |
| 固まりの数 | 慎重に | 乱数だけのデータでも、設定によっては固まりが現れる |

生命科学の分野では、この問題が大きな論争になった。Chari と Pachter は 2023 年の論文で、数千次元の遺伝子発現データを 2 次元にすると必ず大きな歪みが生じ、t-SNE や UMAP の図の距離や形には理論的な裏付けが乏しいと指摘した。任意の 2 次元の形（象の形）にデータを埋め込める手法を作って、見た目の任意性を実演している。一方で、「距離は歪んでも、細胞の近所関係や種類の区別は保たれるので図は有用だ」とする反論もある。

実務での受け取り方はシンプルだ。**t-SNE・UMAP の図は「仮説を思いつくための道具」として使い、見つけた仮説は元のデータで確かめる**。図の見た目そのものを結論にしない。

> [!WARNING] t-SNE は新しいデータを変換できない
> scikit-learn の `TSNE` には、学習後に新しいデータを同じ図に載せる `transform` がない。点の配置そのものを最適化しているからだ。モデルの前処理として t-SNE を使うことはできない。新しいデータも載せたい可視化には、`transform` を持つ UMAP（別ライブラリ）や PCA を使う。

## 埋め込みベクトルの次元を減らす

最近、次元削減が特に効いているのが、文章や画像を数百〜数千次元のベクトルにした**埋め込み**（embedding）の圧縮だ。ベクトル検索では、全文書のベクトルを保存し、検索のたびに距離を計算する。次元を半分にすれば、保存容量も計算量もおおよそ半分になる。

| 方法 | 考え方 | 特徴 |
|---|---|---|
| PCA で削る | 手元の文書のベクトルで PCA を学習し、上位の軸だけ残す | どの埋め込みにも使える。削りすぎると検索の品質が落ちる |
| Matryoshka 表現学習 | 先頭の数十〜数百次元だけでも意味が通るように、埋め込みのモデル自体を学習しておく | 先頭を切り取るだけで次元を選べる。対応したモデルでしか使えない |
| 量子化 | 次元は減らさず、1 つの値を少ないビット数で表す（32 ビット → 8 ビットや 1 ビット） | 次元削減と組み合わせられる |

Matryoshka 表現学習（Kusupati ら、NeurIPS 2022）に対応した埋め込みモデルでは、たとえば Nomic Embed v1.5 が 64〜768 次元の範囲で次元数を選べる。検索の品質をどこまで保てるかはモデルとデータしだいなので、**手元の検索の評価データで、次元数ごとの品質を測ってから**決める。

## 活用事例：次元削減が使われる場面

| 分野 | 使い方 | 手法 |
|---|---|---|
| 生命科学 | 数千の遺伝子の発現量を 2 次元にし、細胞の種類を眺める | PCA で数十次元に縮めてから t-SNE / UMAP |
| 文書・検索 | 埋め込みを圧縮して、ベクトル検索の容量と速度を改善する | PCA、Matryoshka、量子化 |
| 文書の話題分析 | 埋め込みを数次元に縮めてからクラスタリングする（第 7 回） | UMAP＋HDBSCAN |
| 製造・センサー | 数百のセンサー値を少数の主成分にまとめ、正常の範囲からの外れを監視する | PCA（外れ具合を管理図で見る） |
| 機械学習の開発 | 学習データ全体を眺め、ラベルの誤りや偏りを探す | t-SNE / UMAP で可視化し、気になる点を 1 件ずつ確認 |

## 目的から手法を選ぶ

```flow caption="次元削減の手法の選び方"
A([列の多いデータ]) --> B{新しいデータも\n変換する?}
B -- はい --> C{関係は線形で\n十分?}
C -- はい --> D([PCA]):::hl
C -- いいえ --> E([UMAP])
B -- いいえ --> F{目的は可視化?}
F -- はい --> G([t-SNE または UMAP\n距離と形は読まない])
F -- いいえ --> D
```

| 観点 | PCA | t-SNE | UMAP |
|---|---|---|---|
| 主な目的 | 圧縮、前処理、軸の解釈 | 可視化 | 可視化、非線形の圧縮 |
| 保つもの | 大きなばらつき（全体の構造） | 近所の関係 | 近所の関係＋ある程度の全体構造 |
| 新しいデータ | 変換できる | 変換できない | 変換できる |
| 結果の再現性 | 毎回同じ | 乱数で変わる | 乱数で変わる（固定すれば同じ） |
| 速さ | 速い | 遅い（大量データでは PCA で先に縮める） | t-SNE より速い |
| 導入 | scikit-learn に含まれる | scikit-learn に含まれる | 別ライブラリ（umap-learn） |

## 次元削減のチェックリスト

| 確かめること | 対応する節 |
|---|---|
| 目的が「計算のための圧縮」か「可視化」かを先に決めた | 冒頭 |
| PCA の前に標準化した | PCA |
| 残す次元数を、累積寄与率か精度の変化で決めた | PCA、前処理 |
| 前処理の PCA をパイプラインに入れ、データ漏れを防いだ | 前処理 |
| t-SNE / UMAP の図で、固まりの距離・大きさ・形を読まなかった | t-SNE |
| 図で見つけた仮説を、元のデータで確かめた | t-SNE |

## 連載のおわりに：8 回の地図

連載「機械学習の基礎と使いどころ」は今回で終わる。8 回で扱った内容を、実務で手を動かす順に並べ直す。

| 順番 | やること | 回 |
|---|---|---|
| 1 | 誤りのコストから評価指標と閾値を決める | [第 1 回 評価指標](2026-09-30-ml-basics-1-metrics.html) |
| 2 | 訓練とテストを分け、データ漏れを防ぐ | [第 2 回 過学習と正則化](2026-09-30-ml-basics-2-overfitting.html) |
| 3 | 説明が必要なら浅い決定木、精度なら勾配ブースティング | [第 3 回 決定木](2026-09-30-ml-basics-3-decision-tree.html) / [第 4 回 アンサンブル](2026-09-30-ml-basics-4-ensemble.html) |
| 4 | 画像・音声・文章なら、事前学習済みのニューラルネット | [第 5 回 勾配降下法](2026-09-30-ml-basics-5-gradient-descent.html) / [第 6 回 深層学習](2026-09-30-ml-basics-6-deep-learning.html) |
| 5 | 正解がないなら、区切りを事業の言葉に翻訳する | [第 7 回 クラスタリング](2026-09-30-ml-basics-7-clustering.html) |
| 6 | 列が多すぎるなら、目的に合わせて縮める | 第 8 回 次元削減（この記事） |

どの手法を選ぶかより、何で測るか・どう分けて測るかのほうが結果を大きく左右する。迷ったら第 1 回と第 2 回に戻ってほしい。

## 参考文献

情報はすべて 2026-09-30 時点で確認した。

- scikit-learn, [Decomposing signals in components（PCA）](https://scikit-learn.org/stable/modules/decomposition.html)
- scikit-learn, [Manifold learning（t-SNE）](https://scikit-learn.org/stable/modules/manifold.html)
- Wattenberg, Viégas, Johnson, [How to Use t-SNE Effectively](https://distill.pub/2016/misread-tsne/)（Distill, 2016）
- Chari & Pachter, [The Specious Art of Single-Cell Genomics](https://pmc.ncbi.nlm.nih.gov/articles/PMC10434946/)（PLOS Computational Biology, 2023）
- McInnes, Healy, Melville, [UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction](https://arxiv.org/abs/1802.03426)（2018）
- Kusupati et al., [Matryoshka Representation Learning](https://arxiv.org/abs/2205.13147)（NeurIPS 2022）
- Nomic, [Nomic Embed Matryoshka](https://www.nomic.ai/news/nomic-embed-matryoshka)
