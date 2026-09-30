# 機械学習の基礎 8 テーマ リサーチメモ（2026-09-30）

対象: 決定木 / 過学習と正則化 / 深層学習 / 勾配降下法 / クラスタリング / 次元削減 / 評価指標 / アンサンブル

## 事実（出典付き）

### 表形式データと木のモデル
- 中規模（約 1 万件）の表形式データでは木ベースのモデルが依然として最良。NN が苦手な理由は (1) 無関係な特徴量に弱い (2) データの向き（回転不変性）を保てない (3) 不規則な関数を学びにくい — [Grinsztajn et al., Why do tree-based models still outperform deep learning on typical tabular data? (NeurIPS 2022 Datasets and Benchmarks, arXiv:2207.08815)](https://arxiv.org/abs/2207.08815)（確認 2026-09-30）
- TabPFN（表形式の基盤モデル）は 1 万件以下のデータで既存手法を大きく上回り、分類では 4 時間チューニングした最強ベースラインのアンサンブルに 2.8 秒で勝つと報告 — [Hollmann et al., Accurate predictions on small data with a tabular foundation model, Nature 637 (2025)](https://pubmed.ncbi.nlm.nih.gov/39780007/)（2025-01 / 確認 2026-09-30）。後継 TabPFN-2.5 — [arXiv:2511.08667](https://arxiv.org/abs/2511.08667)
- 高リスクの判断では、ブラックボックスを後から説明するより最初から解釈可能なモデルを使うべき — [Rudin, Nature Machine Intelligence 1, 206–215 (2019), arXiv:1811.10154](https://arxiv.org/abs/1811.10154)

### アンサンブル
- Uber は Michelangelo 上で分散 XGBoost を本番化し、深さ 16 以上の木を数十億件で学習。ETA 推定などで精度向上 — [Uber Engineering, Productionizing Distributed XGBoost（2019-12-10）](https://www.uber.com/blog/productionizing-distributed-xgboost/)
- Kaggle の優勝解法で頻出するのは efficientnet・lightgbm・データ拡張・アンサンブル。表形式コンペは主に GBDT（多くは LightGBM）が勝ち、NN とのアンサンブルも多い — [Kaggle Chronicles: 15 Years of Competitions (arXiv:2511.06304)](https://arxiv.org/abs/2511.06304)（2025-11）
- 2025 年 4 月の Kaggle Playground で、500 実験から選んだ 75 モデルを 3 段スタッキングして優勝 — [NVIDIA Technical Blog, Grandmaster Pro Tip](https://developer.nvidia.com/blog/grandmaster-pro-tip-winning-first-place-in-a-kaggle-competition-with-stacking-using-cuml/)
- LightGBM は葉ごとに成長（leaf-wise）、XGBoost は既定で深さごと（level-wise）— Zenn 記事（二次）/ 公式ドキュメントで要裏取り（LightGBM docs "Leaf-wise (Best-first) Tree Growth"）

### 過学習と正則化
- 深層学習では、モデルサイズ・エポック数に対して誤差が一度下がり、上がり、再び下がる「二重降下」が起きる。ラベルノイズ下の CIFAR や翻訳で CNN・ResNet・Transformer に現れる — [Nakkiran et al., Deep Double Descent (arXiv:1912.02292) / OpenAI blog](https://openai.com/index/deep-double-descent/)（2019-12）
- L1 はスパース化（特徴選択）、L2 は重みを小さく — [Google ML Crash Course: Overfitting / L2 regularization](https://developers.google.com/machine-learning/crash-course/overfitting/regularization)
- Dropout — Srivastava et al., JMLR 15 (2014)
- AdamW（重み減衰を勾配更新から切り離す）— Loshchilov & Hutter, ICLR 2019, arXiv:1711.05101

### 勾配降下法
- 学習率が小さすぎると収束が遅く、大きすぎると最小値の周りを跳ね回って収束しない。ミニバッチ SGD はフルバッチと SGD の折衷 — [Google ML Crash Course: Linear regression hyperparameters](https://developers.google.com/machine-learning/crash-course/linear-regression/hyperparameters)
- Adam — Kingma & Ba, arXiv:1412.6980 (ICLR 2015)
- Muon（更新を行列直交化する最適化手法）: 重み減衰と更新スケール調整で大規模化でき、計算最適な学習で Adam 比約 2 倍のサンプル効率と報告 — [Liu et al., Muon is Scalable for LLM Training (arXiv:2502.16982)](https://arxiv.org/abs/2502.16982)（2025-02）。大きなバッチで AdamW よりデータ効率を保つ — [arXiv:2505.02222](https://arxiv.org/abs/2505.02222)
  → 記事では「最新動向」として一段落に留める。一般の実務の既定は依然 Adam/AdamW

### 評価指標
- 「不均衡データでは AUPRC が AUROC より優れる」は一般には成り立たない。AUPRC は正例の多い部分集団の改善を過大評価し、公平性を損ないうる。150 万本の論文調査で、この主張は出典なしや誤引用が多い — [McDermott et al., A Closer Look at AUROC and AUPRC under Class Imbalance (NeurIPS 2024, arXiv:2401.06091)](https://arxiv.org/abs/2401.06091)
- scikit-learn 1.5 で `TunedThresholdClassifierCV` 追加。TP/FP/FN/TN に損得を付けたビジネス指標で閾値を最適化できる — [Release Highlights 1.5](https://scikit-learn.org/stable/auto_examples/release_highlights/plot_release_highlights_1_5_0.html)
- 指標選びの第一歩は「FP と FN のどちらがコストに直結するか」— Zenn（takasaki, ncdc）二次情報

### クラスタリング
- scikit-learn のクラスタリング手法比較表（パラメータ・スケーラビリティ・用途・幾何）。K-Means は非常に大きな n_samples・中程度のクラスタ数、クラスタサイズが揃っている平坦な形向け — [scikit-learn User Guide 2.3 Clustering](https://scikit-learn.org/stable/modules/clustering.html)
- HDBSCAN は scikit-learn 1.3 で `sklearn.cluster.HDBSCAN` として追加 — 公式 changelog で要確認
- 顧客セグメンテーションで UMAP → HDBSCAN の組み合わせ報告あり（二次）

### 次元削減
- 数千次元から 2 次元への削減は必然的に大きな歪みを生む。t-SNE/UMAP の 2 次元図の距離・形を解釈しすぎない。任意の形（象）に埋め込める Picasso で実演 — [Chari & Pachter, The Specious Art of Single-Cell Genomics, PLOS Comput Biol (2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10434946/)
- 反論: 2 次元埋め込みは近傍・細胞型は保つので有用という立場もある（同論争）
- 埋め込みベクトルの次元削減: Matryoshka Representation Learning（Kusupati et al., NeurIPS 2022）で次元を切り詰めても検索品質を大きく落とさない。例: Nomic Embed v1.5 は 64〜768 次元を選べる — [Nomic blog](https://www.nomic.ai/news/nomic-embed-matryoshka)
- PCA: 線形・決定的・速い、解釈可。t-SNE: 可視化専用、新データに適用不可。UMAP: 新データを transform できる（二次: dev.to / Zenn）

### 深層学習
- 活用領域: 画像（外観検査）、音声（異音検知）、言語、推薦。製造業では外観検査・異常検知・予知保全が即効性の高い領域。失敗の主因は技術よりデータ整備・現場連携 — [AI Market 製造業のAI活用事例](https://ai-market.jp/industry/manufacturing_aikatsuyo/)（二次）
- 表形式では GBDT が強い（上記 Grinsztajn）。深層学習が効くのは画像・音声・テキストなど生データの表現学習

## 主張・意見（誰の）
- 表形式ならまず GBDT、次に必要なら NN とのアンサンブル — Kaggle 優勝解法の傾向（Kaggle Chronicles）
- 解釈性が要る高リスク領域は単純なモデルを — Rudin
- クラスタリングは「分類」ではない。正解がないので解釈と事業上の使い道で評価する — CIO Japan 記事（二次）

## 記事に使うコード・図の素材
- 環境: Python 3.11 / scikit-learn 1.8.0 / numpy 1.26 / torch 2.11（ローカルで確認済み）
- データはネット不要の組み込みのみ: load_breast_cancer, load_digits, load_wine, make_moons, make_blobs, make_classification
- 勾配降下法は numpy だけで線形回帰を学習し、学習率 3 通りの損失推移を出す
- 深層学習は PyTorch の最小 MLP（digits）と、比較として sklearn MLPClassifier

## 未確認・食い違い
- AUPRC vs AUROC: 実務ブログの多くは「不均衡なら PR-AUC」。McDermott 2024 はこれを否定。記事では両論を併記し、「目的（上位何件を見るか・閾値）で決める」に落とす
- Muon は LLM 規模での報告が中心。小規模・表形式での優位は未確認
- TabPFN の優位は 1 万件以下。大規模データでは GBDT が依然有力
- Zenn・Qiita の site: 検索で ML 基礎の良質な記事が十分に拾えなかった。執筆時に個別に探し、使うなら一次情報で裏を取る
