---
title: レビュアーを増やしても品質は上がらない——Critic と Aggregator で組むレビュー構成
description: 専門のレビュアーを複数並べる構成で、観点の重複を避け、変更の規模で人数を変え、統合役（Aggregator）と疑い直す役（Critic）で指摘をふるいにかける方法を、偽 LLM で動く Python コードで組み立てる。過去のレビュー結果を知識として次回に生かす仕組みと、人間を最終判断に置く出し方までを扱う。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, コードレビュー, LLM, Python, マルチエージェント]
level: [practice, advanced]
series: レビューエージェントの設計
status: published
---

セキュリティ担当、ロジック担当、設計担当。レビューを専門のエージェントに分けると、1 体では見落としていた問題が見つかるようになる。ところが、そのまま全員の結果を並べると、同じ指摘が 3 回出て、根拠の弱い指摘も 3 倍に増える。

連載の最終回となる第 3 回では、複数のレビュアーを**統合してふるいにかける構成**を作る。第 1 回「[レビューエージェントは「見つける数」より「証明できる数」で決まる](2026-09-29-review-agent-1-verification.html)」の検証と、第 2 回「[「Severity」と「Confidence」は別の軸](2026-09-29-review-agent-2-findings.html)」の分類を、1 本の流れにつなぐ。

> [!TIP] この記事で分かること
> - レビュアーを観点で分け、変更の規模に応じて起動する人数を変える方法
> - 候補の指摘を決まった順番でふるいにかける統合役（Aggregator）の作り方
> - 別の文脈で「成立しない理由」を探させる Critic と、その限界
> - 採用・却下の記録をレビューの知識にし、次回に生かす方法
> - 人間が最終判断しやすい結果の出し方

コードは第 1 回・第 2 回のファイルを読み込んで使う。API キーなしで動くように、決まった返事をする練習用の偽 LLM を用意した。ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

## 推奨アーキテクチャの全体像

最初に、この回で組み立てる構成の全体を示す。

```svg caption="レビュー対象から人間の判断まで。統合役の中で、安い順にふるいにかける"
<svg class="flow-svg" viewBox="0 0 640 600" width="640" style="max-width:100%;height:auto" role="img" aria-label="レビュー対象、文脈の収集、レビュー計画、3 体のレビュアー、候補の指摘、統合役、最終レビュー、人間の判断の順に流れ、人間の判断はレビュー知識に記録され、統合役とレビュー計画に戻る">
  <defs>
    <marker id="rv-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="fl-head"/>
    </marker>
  </defs>
  <g class="fl-node fl-pill"><rect x="220" y="14" width="200" height="36" rx="18"/><text x="320" y="32">レビュー対象の変更</text></g>
  <path class="fl-edge" d="M320,50 L320,70" marker-end="url(#rv-head)"/>
  <g class="fl-node"><rect x="200" y="74" width="240" height="48" rx="6"/><text x="320" y="92">文脈の収集</text><text x="320" y="110">仕様・設計・影響範囲</text></g>
  <path class="fl-edge" d="M320,122 L320,142" marker-end="url(#rv-head)"/>
  <g class="fl-node"><rect x="200" y="146" width="240" height="48" rx="6"/><text x="320" y="164">レビュー計画</text><text x="320" y="182">変更の規模で人数を決める</text></g>
  <path class="fl-edge" d="M280,194 L130,226" marker-end="url(#rv-head)"/>
  <path class="fl-edge" d="M320,194 L320,226" marker-end="url(#rv-head)"/>
  <path class="fl-edge" d="M360,194 L510,226" marker-end="url(#rv-head)"/>
  <g class="fl-node"><rect x="50" y="230" width="160" height="40" rx="6"/><text x="130" y="250">セキュリティ</text></g>
  <g class="fl-node"><rect x="240" y="230" width="160" height="40" rx="6"/><text x="320" y="250">ロジック</text></g>
  <g class="fl-node"><rect x="430" y="230" width="160" height="40" rx="6"/><text x="510" y="250">アーキテクチャ</text></g>
  <path class="fl-edge" d="M130,270 L280,300" marker-end="url(#rv-head)"/>
  <path class="fl-edge" d="M320,270 L320,300" marker-end="url(#rv-head)"/>
  <path class="fl-edge" d="M510,270 L360,300" marker-end="url(#rv-head)"/>
  <g class="fl-node"><rect x="220" y="304" width="200" height="36" rx="6"/><text x="320" y="322">候補の指摘</text></g>
  <path class="fl-edge" d="M320,340 L320,360" marker-end="url(#rv-head)"/>
  <g class="fl-node fl-hl"><rect x="130" y="364" width="380" height="72" rx="10"/><text x="320" y="384">統合役（Aggregator）</text><text x="320" y="404">重複排除 → 根拠の照合 → 指摘しない条件</text><text x="320" y="422">→ Critic → Severity / Confidence</text></g>
  <path class="fl-edge" d="M320,436 L320,456" marker-end="url(#rv-head)"/>
  <g class="fl-node"><rect x="200" y="460" width="240" height="48" rx="6"/><text x="320" y="478">最終レビュー</text><text x="320" y="496">分類・根拠・反証・落とした理由</text></g>
  <path class="fl-edge" d="M320,508 L320,528" marker-end="url(#rv-head)"/>
  <g class="fl-node fl-pill"><rect x="230" y="532" width="180" height="36" rx="18"/><text x="320" y="550">人間の判断</text></g>
  <g class="fl-node"><rect x="490" y="470" width="130" height="48" rx="6"/><text x="555" y="488">レビュー知識</text><text x="555" y="506">採用 / 却下</text></g>
  <path class="fl-edge fl-dashed" d="M410,550 L555,550 L555,522" marker-end="url(#rv-head)"/>
  <path class="fl-edge fl-dashed" d="M555,470 L555,420 L514,420" marker-end="url(#rv-head)"/>
  <path class="fl-edge fl-dashed" d="M600,470 L600,170 L444,170" marker-end="url(#rv-head)"/>
</svg>
```

| 段階 | やること | 詳しく扱う回 |
|---|---|---|
| 文脈の収集 | 差分に、仕様の該当部分・呼び出し元と呼び出し先・固定チェックの結果を添える | 第 1 回・第 2 回 |
| レビュー計画 | 変更の大きさと場所から、起動するレビュアーを決める | この回 |
| 専門のレビュアー | 担当の観点だけを見て、仮説の形で候補を出す | この回 |
| 統合役（Aggregator） | 重複をまとめ、根拠を照合し、指摘しない条件で落とし、Critic に疑わせ、重さと確かさを付ける | この回 |
| 最終レビュー・人間の判断 | 分類つきで見せ、採否を記録する | この回 |

統合役の中の順番は、**安い処理から先に**並べた。重複をまとめてから Critic に回せば、LLM の呼び出しが減る。根拠の照合はプログラムだけで済むので、LLM を使う Critic より前に置く。

## レビュアーは観点で分け、数では増やさない

複数のレビュアーに分ける目的は、**観点を補い合うこと**だ。同じコードを同じ観点で 3 体に見せても、同じ見落としを 3 回繰り返し、同じ誤検知を 3 回出すだけになりやすい。第 1 回で紹介した研究では、10 体のレビュアーが全員一致で、存在しない脆弱性を支持していた。エージェントの数を増やせば品質が上がる、とは考えない方がよい。

各レビュアーには、**見るもの**と同じ重さで**見ないもの**を書く。見ないものを書くと、隣のレビュアーとの重複が減る。

| レビュアー | 見るもの | 見ないもの（他の担当） |
|---|---|---|
| Security | 注入、認証・認可の漏れ、秘密情報、危険な暗号 | 性能、命名 |
| Logic | 条件分岐、境界値、空の値、状態の食い違い | 設計の良し悪し |
| Architecture | 責務の置き場所、層をまたぐ依存、既存の設計との矛盾 | 個々の関数の中身の誤り |
| Test | 変更に対応するテストの有無、確かめ方の弱さ | 本体コードの誤り |
| Dependency | 新しいライブラリ、既知の脆弱性、ライセンス | 自前のコード |
| Performance | ループ内の問い合わせ、不要な全件読み込み、計算量 | 起きにくい前提での最適化 |
| Data | 移行と既存データ、トランザクション、キャッシュの整合 | 画面の表示 |

国内の実践記事でも、レビュアーを単一の責任に絞り、起動する条件を具体的に書くことで、的外れな指摘が減ったと報告されている（参考文献の GLOBIS の記事）。

人数は変更ごとに変えてよい。Cloudflare は社内の AI レビューで、10 行以下の変更には 2 体（約 0.20 ドル）、100 行以下には 4 体（約 0.67 ドル）、それより大きい変更かセキュリティに関わるファイルには 7 体（約 1.68 ドル）を起動していると公開している。この考え方を真似る。

```python title="plan.py" caption="変更の大きさと場所から、起動するレビュアーを決める" {10,11}
SENSITIVE = ("auth", "crypto", "payment", "migrations")  # 触ると危ない場所の目印
BASE = ["logic", "test"]  # どの変更でも起動するレビュアー
MORE = ["security", "architecture"]  # 中くらいの変更で足すレビュアー
FULL = ["performance", "data", "dependency"]  # 大きい変更・危ない場所で足すレビュアー


def plan_reviewers(changed: dict[str, set[int]]) -> list[str]:
    """★ 変更の大きさと場所から、起動するレビュアーを決める。全員を毎回は呼ばない。"""
    lines = sum(len(v) for v in changed.values())  # 変更した行の合計
    risky = any(mark in path for path in changed for mark in SENSITIVE)  # 危ない場所か
    if risky or lines > 100:
        return BASE + MORE + FULL  # 大きい変更・危ない場所: 7 体
    if lines > 10:
        return BASE + MORE  # 中くらい: 4 体
    return BASE  # 小さい変更: 2 体


if __name__ == "__main__":
    print(plan_reviewers({"app/profile.py": {5}}))  # 1 行だけの修正
    print(plan_reviewers({"app/auth/login.py": {3, 4}}))  # 認証まわりの 2 行
```

10 行目で、変更したファイルのパスに `auth`（認証）や `migrations`（データベースの移行）などが含まれるかを調べる。11 行目のとおり、危ない場所なら行数が少なくても全員を起動する。認証まわりは 2 行の変更でも、壊れたときの影響が大きいからだ。

```bash title="実行結果"
$ python plan.py
['logic', 'test']
['logic', 'test', 'security', 'architecture', 'performance', 'data', 'dependency']
```

## Aggregator：候補を決まった順番のふるいにかける

レビュアーの結果をそのまま並べると、読む人が重複を見分け、根拠を確かめることになる。それを代わりに行うのが統合役（Aggregator）だ。まず重複をまとめる部分を作る。

```python title="dedupe.py" caption="同じファイル・近い行・同じ観点の指摘を 1 つにまとめる" {7,19}
from finding import Finding  # 指摘の入れ物
from grading import SEVERITY  # 影響の小さい順のリスト


def same_issue(a: Finding, b: Finding, window: int = 3) -> bool:
    """同じ問題の指摘か。同じファイル・近い行・同じ観点なら同じとみなす。"""
    return a.file == b.file and abs(a.line - b.line) <= window and a.category == b.category


def dedupe(findings: list[Finding]) -> list[Finding]:
    """★ 重複をまとめる。根拠は足し合わせ、Severity は大きい方を残す。"""
    merged: list[Finding] = []  # まとめた後の指摘
    for f in findings:
        for m in merged:
            if same_issue(f, m):  # すでに同じ問題があれば、そちらに合流させる
                m.evidence += [e for e in f.evidence if e not in m.evidence]  # 新しい根拠だけ足す
                if SEVERITY.index(f.severity) > SEVERITY.index(m.severity):
                    m.severity = f.severity  # 影響の見積もりは大きい方を採る
                m.notes.append(f"統合: {f.hypothesis}")  # ★ 何人が言ったかは記録だけする
                break
        else:  # 同じ問題が無かったら（for の最後まで break しなかったら）
            merged.append(f)  # 新しい指摘として加える
    return merged


if __name__ == "__main__":
    a = Finding("user が None だと落ちる", "app/profile.py", 5, "logic", severity="Medium")
    b = Finding("get_user の戻り値を確かめていない", "app/profile.py", 4, "logic", severity="High")
    c = Finding("user_id を検証していない", "app/profile.py", 3, "security", severity="Medium")
    for f in dedupe([a, b, c]):
        print(f.category, f.severity, f.hypothesis, f.notes)
```

7 行目の `same_issue` は、ファイルが同じで、行が 3 行以内で、観点が同じなら同じ問題とみなす。観点が違えば別の指摘として残すのは、同じ行でも「ロジックの誤り」と「セキュリティの穴」は直し方が違うからだ。19 行目では、合流した指摘を `notes` に記録する。何体が同じことを言ったかは残すが、それで Confidence を上げることはしない。

```bash title="実行結果"
$ python dedupe.py
logic High user が None だと落ちる ['統合: get_user の戻り値を確かめていない']
security Medium user_id を検証していない []
```

次に、第 1 回・第 2 回の部品と組み合わせて、ふるいの全体を作る。

```python title="aggregator.py" caption="重複排除 → 根拠の照合 → 指摘しない条件 → Critic → Severity・Confidence の順にふるう" {12,13,17,21,23}
from critic import critic  # 疑い直す役（次の章で作る）
from dedupe import dedupe  # 重複をまとめる
from evidence_check import check_evidence  # 根拠の照合（第 1 回）
from finding import Finding  # 指摘の入れ物
from grading import SEVERITY, cap_severity, decide_confidence, label  # 判定（第 2 回）
from suppress import suppress_reason  # 指摘しない条件（第 2 回）


def aggregate(candidates: list[Finding], changed, affected, intended, critic_fn=critic):
    """★ 候補の指摘を、決まった順番のふるいに通す。残ったものと、落ちたものを返す。"""
    kept, dropped = [], []  # 残す指摘・落とした指摘（理由付き）
    for f in dedupe(candidates):  # ① 重複をまとめる（後の工程の回数を減らす）
        problems = check_evidence(f)  # ② 根拠を照合する
        if problems:
            dropped.append((f, "根拠を照合できない: " + problems[0]))
            continue
        reason = suppress_reason(f, changed, affected, intended)  # ③ 指摘しない条件
        if reason:
            dropped.append((f, reason))
            continue
        verdict = "upheld" if f.status == "verified" else critic_fn(f)  # ④ Critic
        if verdict == "refuted":
            dropped.append((f, "Critic が反証を示した"))  # ★ 捨てずに、人に見せる側へ
            continue
        f.severity = cap_severity(f)  # ⑤ Severity を観点の上限で再判定
        conf = decide_confidence(f, evidence_ok=True, counter_searched=True,
                                 reproduced=f.status == "verified")  # ⑥ Confidence
        if verdict == "unsure" and conf == "High":
            conf = "Medium"  # Critic が決めきれなかった分、一段下げる
        kept.append((f, conf, label(f.severity, conf)))
    kept.sort(key=lambda k: SEVERITY.index(k[0].severity), reverse=True)  # 影響の大きい順
    return kept, dropped
```

①〜⑥の番号が、ふるいの順番だ。12 行目で重複をまとめ、13 行目の根拠の照合と 17 行目の指摘しない条件は、LLM を使わずに済ませる。21 行目の Critic だけが LLM を呼ぶ。ただし、固定チェックで見つけた `verified` の指摘は、規則に一致した事実なので Critic に回さない。

23 行目は大事な設計だ。Critic が反証を示した指摘も、**捨てずに `dropped`（落とした指摘）に理由付きで残す**。反証が正しいとは限らないからで、その理由は次の章の実行結果で分かる。

4 体のレビュアーから集まった候補を流してみる。

```python title="run_review.py" caption="5 つの候補を統合役に通し、残したものと落としたものを表示する" {14}
from aggregator import aggregate  # 統合役
from finding import Evidence, Finding  # 指摘と根拠の入れ物

changed = {"app/profile.py": {4, 5}}  # 今回の変更: profile.py の 4〜5 行目
affected = {"app/api.py"}  # 影響範囲の調査で見つかった、変更の外のファイル
intended = {("app/api.py", "error-handling")}  # 仕様で決めてある挙動

candidates = [  # 4 体のレビュアーから集まった候補
    Finding("get_user が None のとき user.name で落ちる", "app/profile.py", 5, "logic",
            severity="High", evidence=[Evidence("app/profile.py", 5, "user.name")]),
    Finding("戻り値を確かめずに使っている", "app/profile.py", 4, "logic",
            evidence=[Evidence("app/profile.py", 4, "get_user(user_id)")]),
    Finding("SQL インジェクションの恐れ", "app/profile.py", 4, "security", severity="Critical",
            evidence=[Evidence("app/profile.py", 4, "execute(")]),  # 実在しないコード
    Finding("変数名 user では中身が分かりにくい", "app/profile.py", 4, "readability",
            severity="Medium", evidence=[Evidence("app/profile.py", 4, "user =")]),
    Finding("循環 import の恐れ", "app/profile.py", 1, "dependency",
            evidence=[Evidence("app/profile.py", 1, "import get_user")]),
]

kept, dropped = aggregate(candidates, changed, affected, intended)
print("[残した指摘]")
for f, conf, lab in kept:
    print(f"  {lab} / {f.severity} / Confidence {conf}: {f.file}:{f.line} {f.hypothesis}")
print("[落とした指摘]")
for f, why in dropped:
    print(f"  {f.file}:{f.line} {f.hypothesis} → {why}")
```

候補は 5 件あり、そのうち 14 行目の SQL インジェクションは、存在しないコード `execute(` を根拠に挙げた幻の指摘だ。

```bash title="実行結果"
$ python run_review.py
[残した指摘]
  確実な問題 / Low / Confidence High: app/profile.py:4 変数名 user では中身が分かりにくい
[落とした指摘]
  app/profile.py:5 get_user が None のとき user.name で落ちる → Critic が反証を示した
  app/profile.py:4 SQL インジェクションの恐れ → 根拠を照合できない: app/profile.py:4 に「execute(」が無い
  app/profile.py:1 循環 import の恐れ → 既存コードにあるだけ
```

5 件の候補が、それぞれ違うふるいで処理された。

| 候補 | どこで | 結果 |
|---|---|---|
| None で落ちる／戻り値を確かめていない | ① 重複排除 | 1 件にまとまった |
| SQL インジェクション | ② 根拠の照合 | 幻の根拠として落ちた |
| 循環 import | ③ 指摘しない条件 | 触っていない行なので落ちた |
| None で落ちる | ④ Critic | 反証が示され、落とした側へ |
| 変数名 | ⑤ Severity の再判定 | Medium が Low に下がり、確実な問題として残った |

Critical の SQL インジェクションが最も重い候補だったが、根拠が無かったので出ていない。**重い指摘ほど、根拠の照合を先に通す**価値がある。

## Critic：別の文脈で「成立しない理由」を探させる

Critic は、レビュアーが出した指摘を**否定する側**から読み直す役だ。第 1 回の反証はプログラムで決まった問いを確かめたが、Critic は LLM を使って、設定や仕様、型による保証など、決まった形にしにくい反証を探す。

ただし、同じ LLM に「今の指摘を見直して」と頼むだけでは効果が薄い。外部からの手がかりなしに LLM が自分の推論を直すのは難しい、という研究がある。Critic を強くする方法には段階がある。次の表は、公開されている研究をもとに筆者が整理したものだ。

| 方法 | 強さ | 理由 |
|---|---|---|
| 同じ会話の中で見直させる | 弱い | 自分の推論に引きずられる |
| 別の文脈（前提を持たない状態）で読ませる | 中 | レビュアーの推論を見ないので、同じ思い込みを引き継がない |
| 別の系統のモデルに読ませる | やや強い | 同じ学習の偏りを共有しにくい |
| 実際に動かして確かめる | 最も強い | 再現テストやコードの実行は、思い込みの影響を受けない |

2026 年の Refute-or-Promote の研究は、否定を任務とするエージェント、前提を持たない状態のレビュアー、別の系統のモデルによる Critic、実行による実証を組み合わせ、171 件の候補の約 79% を公開前に棄却した。それでも最後の砦は、実際に動かすことだった。

```python title="critic.py" caption="コードと仮説だけを渡して否定させ、否定の根拠も照合する" {26,28,35}
import json  # LLM の返事（JSON 形式の文字列）を読むため

from evidence_check import check_evidence  # 根拠の照合（第 1 回）
from finding import Evidence, Finding  # 指摘と根拠の入れ物
from sample_repo import REPO  # 練習用のリポジトリ

CRITIC_PROMPT = """あなたは指摘を否定する役だ。次の指摘が「成立しない理由」を探せ。
呼び出し元の確認、設定、仕様、型による保証を調べること。
否定するなら、その根拠の file・line・quote を必ず示すこと。
JSON で返す: {{"verdict": "upheld|refuted|unsure", "reason": "...", "counter": [...]}}

指摘: {hypothesis}
場所: {file}:{line}
コード:
{code}"""


def fake_llm(prompt: str) -> str:
    """練習用の偽 LLM。None の指摘にだけ、api.py の守りを示して「否定」を返す。"""
    if "None" not in prompt.split("指摘: ")[1].splitlines()[0]:  # 指摘の行に None が無ければ
        return json.dumps({"verdict": "upheld", "reason": "反証が見つからない", "counter": []})
    return json.dumps({"verdict": "refuted", "reason": "呼び出し元で存在確認している",
                       "counter": [{"file": "app/api.py", "line": 4, "quote": "user_exists"}]})


def critic(f: Finding, llm=fake_llm) -> str:
    """★ 指摘を別の文脈で疑い直す。upheld（成立）/ refuted（棄却）/ unsure を返す。"""
    code = "\n".join(f"--- {p}\n{t}" for p, t in REPO.items())  # ★ 渡すのはコードと仮説だけ
    reply = json.loads(llm(CRITIC_PROMPT.format(code=code, **vars(f))))
    if reply["verdict"] != "refuted":
        return reply["verdict"]
    counter = [Evidence(**c, role="counter") for c in reply.get("counter", [])]
    probe = Finding(f.hypothesis, f.file, f.line, f.category,
                    evidence=[Evidence(c.file, c.line, c.quote) for c in counter])
    if check_evidence(probe):  # ★ 否定の根拠も照合する。照合できなければ棄却させない
        return "unsure"
    f.evidence += counter  # 照合できた反証の根拠を、指摘に残す
    f.notes.append(f"Critic: {reply['reason']}")
    return "refuted"


if __name__ == "__main__":
    f = Finding("get_user が None を返したとき、user.name でエラーになる",
                "app/profile.py", 5, "logic",
                evidence=[Evidence("app/profile.py", 5, "user.name")])
    print(critic(f), f.notes)
```

28 行目で Critic に渡すのは、**コードと仮説だけ**だ。レビュアーがどう考えてその指摘に至ったかは渡さない。推論を見せると、Critic はその筋道に引きずられるからだ。ここでは練習用にリポジトリ全体を渡したが、実際には指摘の周辺と、第 1 回でたどった呼び出し元・呼び出し先を渡す。

35 行目は、第 1 回の根拠の照合を**否定の側にも**かけている。Critic も LLM なので、存在しない守りの行を挙げて否定することがありうる。否定の根拠を照合できなければ、棄却せずに `unsure`（決めきれない）を返す。指摘にも否定にも、同じ基準で根拠を求める。

```bash title="実行結果"
$ python critic.py
refuted ['Critic: 呼び出し元で存在確認している']
```

偽 LLM は、`api.py` の 4 行目で利用者の存在を確かめていることを根拠に否定した。その根拠は照合を通ったので、指摘は `refuted`（棄却）になった。

しかし、第 1 回で見たとおり、`user_exists` と `db.find` の間に利用者が削除されれば、`None` は返りうる。**Critic の否定は、根拠が実在しても、正しいとは限らない。** これが、統合役で棄却した指摘を捨てずに残した理由だ。

> [!WARNING] Critic は指摘を減らす方向に偏らせすぎない
> Critic に「否定せよ」と強く指示すると、本物の問題まで棄却するようになる。精度（出した指摘のうち正しい割合）と再現率（本物の問題のうち見つけた割合）は、片方を上げるともう片方が下がりやすい。棄却した指摘の中に本物が混ざっていないかを、定期的に人が抜き取りで確かめる。

## 過去のレビュー結果を知識にする

同じプロジェクトでレビューを続けると、同じ誤検知が何度も出る。「このプロジェクトでは存在しない利用者に 404 を返す」と人が何度説明しても、次のレビューではまた指摘される。**人間の判断を記録し、次回のレビューに渡す**ことで、これを減らせる。

```flow caption="人間の採否を記録し、次回のレビューで使う"
direction LR
A[最終レビュー] --> B{人間の判断}
B -- 採用 --> C[記録\naccepted]
B -- 却下 --> D[記録\nrejected＋理由]:::hl
C --> E([3 回で固定チェックへ])
D --> F([次回の Critic に渡す])
```

```python title="knowledge.py" caption="人間の採否を 1 行 1 件で記録し、過去の却下と、固定チェックにする候補を探す" {14,26,32}
import json  # 1 行 1 件の JSON で記録する
from collections import Counter  # 数を数える道具
from pathlib import Path  # ファイルの場所を扱う道具

from finding import Finding  # 指摘の入れ物

KB = Path("review_knowledge.jsonl")  # 記録ファイル（1 行に 1 件の判断）


def record(f: Finding, decision: str, reason: str, pattern: str, kb: Path = KB) -> None:
    """★ 人間の判断を記録する。decision は accepted（採用）か rejected（却下）。"""
    row = {"file": f.file, "category": f.category, "hypothesis": f.hypothesis,
           "pattern": pattern,  # 人が付ける短い名前（例: None チェック漏れ）
           "decision": decision, "reason": reason}  # ★ 却下の理由が次回いちばん役に立つ
    with kb.open("a", encoding="utf-8") as fp:  # 追記モードで開く
        fp.write(json.dumps(row, ensure_ascii=False) + "\n")


def load(kb: Path = KB) -> list[dict]:
    """記録をすべて読む。ファイルが無ければ空のリスト。"""
    if not kb.exists():
        return []
    return [json.loads(x) for x in kb.read_text(encoding="utf-8").splitlines() if x.strip()]


def past_rejections(f: Finding, kb: Path = KB) -> list[dict]:
    """★ 同じ場所・同じ観点で、過去に却下された指摘を探す。"""
    return [r for r in load(kb) if r["decision"] == "rejected"
            and r["file"] == f.file and r["category"] == f.category]


def rule_candidates(kb: Path = KB, threshold: int = 3) -> list[str]:
    """★ 3 回以上採用された型は、固定チェックに昇格させる候補にする。"""
    counts = Counter(r["pattern"] for r in load(kb) if r["decision"] == "accepted")
    return [p for p, n in counts.items() if n >= threshold]


if __name__ == "__main__":
    KB.unlink(missing_ok=True)  # 練習のため、前回の記録を消してから始める
    f = Finding("404 ではなく例外にすべき", "app/api.py", 5, "error-handling")
    record(f, "rejected", "仕様 3.2 で存在しない利用者は 404 と決めている", "例外の方針")
    for i in range(3):
        g = Finding("戻り値の None を確かめていない", f"app/m{i}.py", 10, "logic")
        record(g, "accepted", "実際に落ちる", "None チェック漏れ")
    print(past_rejections(f)[0]["reason"])
    print(rule_candidates())
```

記録は 1 行 1 件の JSON（JSONL）にした。追記するだけで済み、行ごとに読めるので、壊れても被害が 1 行で済む。14 行目のとおり、いちばん役に立つのは**却下の理由**だ。「却下」だけでは次回に使えないが、「仕様 3.2 で 404 と決めている」と書いてあれば、次回の Critic に反証の材料として渡せる。

26 行目の `past_rejections` は、同じ場所・同じ観点の過去の却下を探す。32 行目の `rule_candidates` は、3 回以上採用された型を探す。何度も採用される指摘は、LLM に毎回探させるより、第 2 回の固定チェックに昇格させた方が安く確実だ。「同じ指摘が 3 回出たらルール候補にする」という運用は、Zenn の実践記事でも紹介されている。

```bash title="実行結果"
$ python knowledge.py
仕様 3.2 で存在しない利用者は 404 と決めている
['None チェック漏れ']
```

過去の却下を見つけたときの扱い方は、2 通りある。

| 扱い方 | 向いている場面 |
|---|---|
| 却下の理由を Critic の指示に添え、反証の材料にする | 基本はこちら。コードが変わって、過去の理由が当てはまらなくなることがあるため |
| 自動で落とす | 仕様で明確に決まっていて、変わる見込みがないもの。第 2 回の `intended` に移す |

> [!NOTE] 記録の効果を数字で見る
> ByteDance の BitsAI-CR は、指摘された行がその後のコミットで実際に書き換えられた割合（Outdated Rate）を、開発者が指摘を採用した目安として週ごとに追っている。自分の環境でも「採用された指摘の割合」と「却下の理由の内訳」を数えると、どのふるいを強めるべきかが分かる。

## 人間の判断を最終地点にする

ここまでの仕組みは、どれも**人間の判断を置き換えるものではない**。エージェントが「正解」を決めるのではなく、判断に必要な材料を揃えて渡すことが目的だ。CriticGPT の研究でも、LLM の批評役と人間を組み合わせると、見つけるバグの数を保ったまま、LLM 単独より幻覚の指摘が少なかった。

最終レビューには、次の 4 つを載せる。

| 載せるもの | 理由 |
|---|---|
| 残した指摘（分類・Severity・Confidence・根拠・反証） | 何を直すべきかを、根拠と一緒に判断できる |
| 落とした指摘と、その理由（折りたたみ） | ふるいが本物を落としていないかを確かめられる |
| 確認してほしいこと | 要確認の指摘で、何を判断すれば結論が出るかが分かる |
| 自動で直す場合は、その差分 | 何が変わるかを見てから受け入れられる |

今回の実行結果を、人が読む形にするとこうなる。

```text title="最終レビューの例" caption="残した指摘の下に、落とした指摘を理由付きで畳んでおく"
## 指摘 1 件

[確実な問題] Severity: Low / Confidence: High
app/profile.py:4  変数名 user では中身が分かりにくい
根拠: app/profile.py:4  user = get_user(user_id)

## 落とした指摘 3 件（開いて確認できます）

- app/profile.py:5  get_user が None のとき user.name で落ちる
  理由: Critic が反証を示した（app/api.py:4 で利用者の存在を確認している）
  確認してほしいこと: 確認から取得までの間に利用者が削除されることはありうるか
- app/profile.py:4  SQL インジェクションの恐れ
  理由: 根拠を照合できない（4 行目に execute( が無い）
- app/profile.py:1  循環 import の恐れ
  理由: 既存コードにあるだけ
```

`None` の指摘は、Critic によって落とされた。しかし「確認してほしいこと」が添えてあるので、人は仕様を確かめるだけで判断できる。もし削除が起こりうるなら、この指摘は採用され、その判断は知識として記録される。**ふるいが間違えたときに人が気づける形にしておく**ことが、自動化の度合いを上げていく前提になる。

## 連載のチェックリスト

3 回で扱った設計の原則を、1 つの表にまとめる。

| 原則 | 確かめること | 回 |
|---|---|---|
| 検証型レビュー | 指摘を仮説として持ち、仮説 → 調査 → 証拠 → 結論の順で扱っている | 1 |
| 反証 | 否定する材料を手順として探し、反証の候補があれば人に回している | 1 |
| 影響範囲 | 呼び出し元・呼び出し先・DB・キャッシュ・非同期までたどっている | 1 |
| 仕様が最上位 | 仕様を渡し、「一般的でない」だけの指摘をさせていない | 1 |
| 根拠の必須化 | file・line・quote をプログラムで照合している | 1 |
| 観点の体系 | 10 の観点を決め、固定チェックと探索型に分担している | 2 |
| 重さと確かさ | Severity と Confidence を別々に付け、確信度を検証の記録から決めている | 2 |
| 事実と推測の分離 | 確実・可能性高・要確認・改善提案を表示の最初に出している | 2 |
| 指摘しない条件 | 条件をプログラムでも持ち、落とした理由を記録している | 2 |
| 専門のレビュアー | 見るものと見ないものを書き、変更の規模で人数を変えている | 3 |
| 統合役 | 安い順のふるいを通し、一致の数を証拠として扱っていない | 3 |
| Critic | コードと仮説だけを渡し、否定の根拠も照合している | 3 |
| レビュー知識 | 採否と却下の理由を記録し、次回の Critic と固定チェックに生かしている | 3 |
| 人間が最終地点 | 落とした指摘も理由付きで見せ、確認してほしいことを添えている | 3 |

最初から全部を作る必要はない。効果が大きいのは、根拠の照合（第 1 回）と指摘しない条件（第 2 回）だ。どちらも LLM を使わずに作れて、誤検知の多くを落とせる。専門のレビュアーと Critic は、その 2 つを入れても誤検知が多いと分かってから足せばよい。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- Cloudflare, [Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/)（2026-04-20）
- Agarwal, [Refute-or-Promote: An Adversarial Stage-Gated Multi-Agent Review Methodology](https://arxiv.org/abs/2604.19049)（2026-04-21）
- McAleese et al., [LLM Critics Help Catch LLM Bugs](https://arxiv.org/abs/2407.00215)（OpenAI, 2024-06）
- Huang et al., [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)（ICLR 2024）
- [BitsAI-CR: Automated Code Review via LLM in Practice](https://arxiv.org/abs/2501.15134)（ByteDance, 2025-01）
- [Towards Practical Defect-Focused Automated Code Review](https://arxiv.org/abs/2505.17928)（中国科学院・Kuaishou, 2025-05）
- GLOBIS, [AIコードレビューを「単一責任の原則」で育てた話](https://zenn.dev/globis/articles/d0c73d2b176ba5)（Zenn, 2026-03-17）
- minewo, [AIコードレビューを仕組みにする: 指摘の分類・記録・改善の回し方](https://zenn.dev/minewo/articles/ai-code-review-feedback-ops)（Zenn, 2026-04-29）
- HrsUed, [AIコードレビュースキルを「検索エンジン」として捉え直すと、改善の打ち手が見えてくる](https://qiita.com/HrsUed/items/8e60c4dbba07ce0b0e5f)（Qiita, 2026-06-19）
