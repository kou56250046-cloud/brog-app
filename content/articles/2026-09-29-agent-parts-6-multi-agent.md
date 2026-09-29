---
title: 複数Agentは最後の手段——高度なエージェントに進む前に知っておく失敗の型
description: 調査・分析・作成・レビューを別々の AI に任せる複数 Agent は、うまくはまれば強力だが、コストは跳ね上がり、失敗の型も増える。分けるべきかの判断、依頼書と報告書による引き継ぎ、プログラムで判定するレビュー、チーム全体の予算、研究が示す失敗の型、段階③の「高度な」部品の中身までを解説する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, LLM, Python, マルチエージェント]
level: [advanced]
series: AIエージェントの構成要素
status: published
---

調査担当・分析担当・作成担当・レビュー担当。人間のチームのように AI にも役割を分けたくなるのは自然なことだ。実際、うまくはまった複数 Agent の構成は、1 体のエージェントでは届かない成果を出す。ただし、同じ仕組みがコストを何倍にも膨らませ、1 体のときには無かった失敗を生む。

連載の最終回となる第 6 話では、段階③の部品を扱う。中心は**複数 Agent**だ。加えて、段階②で作った Planning・State・Memory・権限・監視が、段階③で何を足されて「高度」になるのかを整理する。

> [!TIP] この記事で分かること
> - 複数 Agent に分けるべき仕事と、分けてはいけない仕事の見分け方
> - 部下のエージェントに渡す「依頼書」と、返させる「報告書」の形
> - レビュー役の判定を LLM 任せにしない方法と、チーム全体の予算の持ち方
> - 研究が示した、複数 Agent がよく失敗する型と、その対策
> - 段階②から③へ進むときに、各部品に何が足されるか

第 5 話「[AIに「やらせない」設計](2026-09-29-agent-parts-5-guardrails.html)」までの部品を前提にしている。コードには、ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

## まず 1 体で限界を確かめる

複数 Agent は、1 体のエージェントで困ったことが起きてから検討する。Anthropic が公開した、複数 Agent で調べものをするシステムの開発記録には、判断の材料になる数字が載っている。

| 観点 | 公開された数字・知見 |
|---|---|
| 性能 | 指揮役 1 体＋部下の構成が、同社の評価で 1 体構成を 90.2% 上回った |
| コスト | トークンの消費量は、通常のチャットの約 4 倍（1 体のエージェント）、約 15 倍（複数 Agent） |
| 性能の源 | 評価の成績の差の 80% は、使ったトークンの量で説明できた |
| 向かない仕事 | 全員が同じ文脈を共有する必要がある仕事、エージェント間の依存が強い仕事 |

つまり、複数 Agent が強いのは、**大量の情報を並列に読むことで、1 体の文脈に入りきらない量を扱えるから**だ。1 体の文脈に収まる仕事を分けても、コストが増えるだけになりやすい。

| 分けるとよい仕事 | 分けない方がよい仕事 |
|---|---|
| 互いに独立した調べもの（A 社・B 社・C 社を別々に調べる） | 前の結果を見ないと次が決まらない仕事 |
| 読む量が 1 体の文脈に入りきらない | 1 体の文脈に収まる |
| 権限を分けたい（読む係と送る係） | 全員が同じ情報を細かく共有する必要がある |
| 観点を独立させたい（レビューを作成者と別にする） | 多くのコーディング作業（ファイル同士の依存が強い） |

最後の行の「権限を分けたい」は、第 5 話とつながる。読む係には送信の Tool を持たせず、送る係には信用できない文章を読ませない。役割を分けることで、第 5 話の「3 つの能力を揃えさせない」を構成で実現できる。

## 役割分担：指揮役と部下

Anthropic の開発記録や OpenAI の構築ガイドが紹介している基本の形は、**全体の文脈を持つ指揮役（オーケストレーター）1 体と、部下**の組み合わせだ。OpenAI のガイドはこれを「マネージャー型」と呼んでいる。この記事では、部下には要約だけを返させる。部下どうしは直接話さず、すべて指揮役を通す。

```svg caption="指揮役が依頼書を渡し、部下は報告書だけを返す。部下どうしは直接話さない"
<svg class="flow-svg" viewBox="0 0 640 300" width="640" style="max-width:100%;height:auto" role="img" aria-label="指揮役と 4 つの部下。依頼書と報告書は必ず指揮役を通る">
  <defs>
    <marker id="hub-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="fl-head"/>
    </marker>
  </defs>
  <g class="fl-node fl-pill"><rect x="30" y="48" width="120" height="40" rx="20"/><text x="90" y="68">依頼</text></g>
  <g class="fl-node fl-pill"><rect x="490" y="48" width="120" height="40" rx="20"/><text x="550" y="68">最終結果</text></g>
  <g class="fl-node fl-hl"><rect x="230" y="38" width="180" height="60" rx="10"/><text x="320" y="58">指揮役</text><text x="320" y="80">計画・依頼書・統合</text></g>
  <path class="fl-edge" d="M150,68 L226,68" marker-end="url(#hub-head)"/>
  <path class="fl-edge" d="M410,68 L486,68" marker-end="url(#hub-head)"/>
  <path class="fl-edge" d="M280,100 L84,206" marker-start="url(#hub-head)" marker-end="url(#hub-head)"/>
  <path class="fl-edge" d="M305,100 L242,206" marker-start="url(#hub-head)" marker-end="url(#hub-head)"/>
  <path class="fl-edge" d="M335,100 L398,206" marker-start="url(#hub-head)" marker-end="url(#hub-head)"/>
  <path class="fl-edge" d="M360,100 L556,206" marker-start="url(#hub-head)" marker-end="url(#hub-head)"/>
  <g class="fl-node"><rect x="20" y="210" width="120" height="44" rx="6"/><text x="80" y="232">調査役</text></g>
  <g class="fl-node"><rect x="180" y="210" width="120" height="44" rx="6"/><text x="240" y="232">分析役</text></g>
  <g class="fl-node"><rect x="340" y="210" width="120" height="44" rx="6"/><text x="400" y="232">作成役</text></g>
  <g class="fl-node"><rect x="500" y="210" width="120" height="44" rx="6"/><text x="560" y="232">レビュー役</text></g>
  <g class="fl-elabel"><text x="320" y="282">↓ 依頼書（目的・返す内容・Tool・範囲）　↑ 報告書（要点・根拠・分からないこと）</text></g>
</svg>
```

部下どうしを直接話させない理由は、会話の流れが追えなくなるからだ。誰が何を決めたかが指揮役に集まっていれば、第 4 話のログで流れを追える。

## 引き継ぎ：依頼書と報告書の形を決める

複数 Agent の失敗の多くは、**引き継ぎ**で起きる。部下のエージェントは、指揮役が見てきた会話を知らない。渡された依頼書だけで仕事をする。人間の新人に「あれ、やっておいて」と頼んでもうまくいかないのと同じだ。

Anthropic の開発記録は、部下に渡すべきものとして、目的・出力の形式・使う Tool と情報源・仕事の範囲を挙げている。これを依頼書の形にしておく。

```python title="handoff.py" caption="部下に渡す依頼書と、部下から返ってくる報告書の形"
from dataclasses import dataclass, field  # 「データの入れ物」を簡単に作る道具


@dataclass
class Brief:
    """★ 部下のエージェントに渡す依頼書。これ以外の文脈は渡らないと考えて書く。"""
    goal: str  # 何のための仕事か（目的）
    output: str  # 何を、どんな形で返してほしいか
    tools: list[str]  # 使ってよい Tool
    boundary: str  # やらないこと・範囲の外
    max_tokens: int = 20_000  # 使ってよい量の上限（コストの予算）


@dataclass
class Report:
    """★ 部下から返ってくる報告書。全文ではなく、要点と根拠だけを返させる。"""
    status: str  # done（完了）/ partial（一部）/ failed（失敗）
    summary: str  # 要点。長くても数百字
    evidence: list[str] = field(default_factory=list)  # 根拠（どの Tool の結果か、どの文書か）
    open_questions: list[str] = field(default_factory=list)  # 分からなかったこと。推測で埋めさせない


def to_prompt(b: Brief) -> str:
    """依頼書を、部下の LLM に渡す指示文にする。"""
    lines = [
        f"目的: {b.goal}",  # ★ 何のための仕事かを最初に書く
        f"返す内容: {b.output}",
        f"使える Tool: {', '.join(b.tools) or 'なし'}",  # 空なら「なし」と書く
        f"やらないこと: {b.boundary}",
        "分からないことは推測で埋めず、open_questions に書くこと。",
    ]
    return "\n".join(lines)  # 1 行ずつ改行でつなぐ


if __name__ == "__main__":
    brief = Brief(
        goal="青葉商事への来期提案に使うため、直近4か月の売上の傾向をつかむ",
        output="伸び率と、目立つ月を3行以内で。根拠の数字を添える",
        tools=["get_customer", "get_sales"],
        boundary="他社の売上は調べない。メールは送らない",
    )
    print(to_prompt(brief))
```

`Brief`（依頼書）と `Report`（報告書）が、指揮役と部下の間の約束だ。

| 依頼書の項目 | 書かないとどうなるか |
|---|---|
| `goal`（目的） | 「売上を調べて」だけだと、何のためか分からず、調べる範囲が決まらない |
| `output`（返す内容） | 全データをそのまま返してきて、指揮役の文脈があふれる |
| `tools`（使ってよい Tool） | 要らない Tool まで使う。第 5 話の権限の重なりもここで絞る |
| `boundary`（やらないこと） | 他の部下と同じ仕事をする、範囲外まで調べ続ける |

報告書には、`open_questions`（分からなかったこと）の欄を設けた。欄が無いと、部下は分からないことを推測で埋めて報告する。**「分からない」と書く場所を用意しておく**ことが、推測の混入を防ぐ。

`to_prompt` で指示文にすると、次のようになる。

```bash title="実行結果"
$ python handoff.py
目的: 青葉商事への来期提案に使うため、直近4か月の売上の傾向をつかむ
返す内容: 伸び率と、目立つ月を3行以内で。根拠の数字を添える
使える Tool: get_customer, get_sales
やらないこと: 他社の売上は調べない。メールは送らない
分からないことは推測で埋めず、open_questions に書くこと。
```

## レビュー役は、合格の条件をプログラムで持つ

役割分担の最後に置くレビュー役は、作成役と**別の文脈**で見ることに意味がある。自分が書いたものの誤りは、自分では気づきにくいからだ。

ただし、レビュー役も LLM だと、「よくできています」と通してしまうことがある。そこで、**確かめられる条件はプログラムで判定する**。

```python title="team.py" caption="調査・分析・作成・レビューの 4 役を、指揮役が順に回す"
from handoff import Brief, Report  # 依頼書と報告書の形


# ★ 役割ごとのエージェント。練習用の偽物で、本物はそれぞれ別の指示文と Tool を持つ LLM
def researcher(b: Brief) -> Report:
    """調査役。データを集めて、要点と根拠だけ返す。"""
    return Report("done", "青葉商事: 300→280→310→330万円", evidence=["get_sales(C001)"])


def analyst(b: Brief, data: Report) -> Report:
    """分析役。調査役の報告（要約）だけを受け取って分析する。"""
    return Report("done", "4か月で+10.0%。2か月目に一時減少", evidence=data.evidence + ["compare()"])


def writer(b: Brief, analysis: Report, feedback: str = "") -> Report:
    """作成役。分析結果を文章にする。レビューの指摘があれば直す。"""
    text = "青葉商事の売上は4か月で10%伸びた。"  # 最初の下書き
    if "根拠" in feedback:  # レビューで根拠が無いと言われたら、根拠を足して書き直す
        text += f"（根拠: {', '.join(analysis.evidence)}）"
    return Report("done", text, evidence=analysis.evidence)


def reviewer(draft: Report) -> str:
    """★ レビュー役。合格の条件をプログラムで確かめる。LLM の「よさそう」だけで通さない。"""
    problems = []  # 見つけた問題
    if "根拠" not in draft.summary:  # 本文に根拠が書かれているか
        problems.append("根拠が本文に書かれていない")
    if not any(ch.isdigit() for ch in draft.summary):  # 数字が 1 つでも入っているか
        problems.append("数字が無い")
    return "OK" if not problems else "NG: " + "、".join(problems)  # 問題が無ければ OK


def orchestrate(task: str, max_reviews: int = 2) -> str:
    """指揮役。部下に依頼書を渡し、報告を受けて次へ回す。"""
    data = researcher(Brief(task, "月ごとの売上", ["get_sales"], "書き込みはしない"))  # ① 調べる
    analysis = analyst(Brief(task, "伸び率と特徴", [], "新しいデータは取らない"), data)  # ② 分析する
    feedback = ""  # レビューの指摘（最初は無し）
    for round_ in range(1, max_reviews + 1):  # ★ 書き直しは max_reviews 回まで
        draft = writer(Brief(task, "3行以内の報告", [], "送信しない"), analysis, feedback)  # ③ 書く
        feedback = reviewer(draft)  # ④ レビューする
        print(f"レビュー{round_}回目: {feedback}")
        if feedback == "OK":  # 合格したら終わり
            return draft.summary
    return "レビューに通りませんでした。人間が確認してください: " + draft.summary  # 上限で人間に渡す


if __name__ == "__main__":
    print(orchestrate("青葉商事の売上傾向を報告して"))
```

`orchestrate` は、調査 → 分析 → 作成 → レビューの順に部下を呼ぶ。★ の付いた箇所がポイントだ。

**1. レビューの条件をコードで持つ。** `reviewer` は「本文に根拠が書かれているか」「数字が入っているか」をプログラムで確かめる。本物のレビュー役なら、LLM に内容の妥当性を見させつつ、機械的に判定できる条件はこのようにコードで固める。

**2. 書き直しに上限がある。** 作成とレビューの往復が終わらないことがある。上限に達したら、人間に渡す。

```bash title="実行結果"
$ python team.py
レビュー1回目: NG: 根拠が本文に書かれていない
レビュー2回目: OK
青葉商事の売上は4か月で10%伸びた。（根拠: get_sales(C001), compare()）
```

1 回目は根拠が無いので差し戻され、2 回目で根拠を足して合格した。部下はそれぞれ要約（`Report`）だけを受け渡していて、生のデータ全体は指揮役の文脈に入っていない。

## チーム全体で予算を持つ

複数 Agent では、1 体ずつに上限を付けても、**合計が膨らむ**。部下を 4 体並列に走らせれば、それだけで 4 倍になる。予算はチーム全体で 1 つ持つ。

```python title="budget.py" caption="トークンの予算をチーム全体で共有し、合計が上限を超えたら止める"
class Budget:
    """チーム全体で共有する、トークン（≒コスト）の予算。"""

    def __init__(self, total: int):
        self.total = total  # チーム全体の上限
        self.used = {}  # エージェントごとの使用量

    def charge(self, agent: str, tokens: int) -> None:
        """使った量を記録する。上限を超えたら止める。"""
        self.used[agent] = self.used.get(agent, 0) + tokens
        spent = sum(self.used.values())  # チーム全体の合計
        if spent > self.total:  # ★ 誰か 1 体ではなく、チーム全体で上限を見る
            raise RuntimeError(f"予算超過: {spent:,} / {self.total:,} トークン。内訳 {self.used}")



budget = Budget(total=100_000)  # チーム全体で 10 万トークンまで
budget.charge("orchestrator", 12_000)  # 指揮役の計画
for i in range(1, 5):  # 調査役を 4 体並列に走らせたつもり
    budget.charge(f"researcher{i}", 20_000)
try:
    budget.charge("writer", 15_000)  # 最後の書き手で上限を超える
except RuntimeError as e:
    print(e)
```

`charge` は、エージェントごとの使用量を記録しつつ、★ の行で**チーム全体の合計**を上限と比べる。

```bash title="実行結果"
$ python budget.py
予算超過: 107,000 / 100,000 トークン。内訳 {'orchestrator': 12000, 'researcher1': 20000, 'researcher2': 20000, 'researcher3': 20000, 'researcher4': 20000, 'writer': 15000}
```

どの役がどれだけ使ったかの内訳を出しているのは、予算の配分を見直すためだ。調査役が予算の 8 割を使っているなら、調査役の依頼書（`output` の指定）を絞れないかを考える。

## 複数 Agent がよく失敗する型

2025 年の研究「Why Do Multi-Agent LLM Systems Fail?」（MAST）は、複数 Agent の実行記録 150 件を専門家が分析し、失敗を 14 の型、3 つの分類にまとめた。

| 分類 | 中身 | 対策（この連載の部品） |
|---|---|---|
| システム設計の問題 | 役割の決め方・仕事の分け方・止め方の不備 | 依頼書の `boundary`、回数の上限（第 2 話） |
| エージェント間の食い違い | 情報を渡さない、相手の報告を無視する、推論と行動が合わない | 依頼書と報告書の形、指揮役を通す |
| 検証の不足 | 終わっていないのに終える、誤りを確かめない | プログラムで判定するレビュー |

最も多かった失敗は**同じステップの繰り返し**で、次が**推論と行動の不一致**（正しく考えたのに別のことをする）、その次が**確認の質問をしない**（曖昧な依頼を推測で進める）だった。論文は、多くの失敗がモデルの性能ではなく**システムの設計**から来ていて、より大きなモデルを使うだけでは直らないと結論づけている。

| 頻出の失敗 | 連載の中の対策 |
|---|---|
| 同じステップの繰り返し | 第 2 話の繰り返しの見張り、State で終わったステップを飛ばす |
| 推論と行動の不一致 | 第 2 話の計画の検査。考えた計画と実行するステップを突き合わせる |
| 確認の質問をしない | 報告書の `open_questions`。分からないことを書く場所を用意する |

## 段階③の「高度な」部品は何が違うのか

第 1 話で、段階③を「②のすべて＋複数 Agent・高度な Planning / State / Memory・高度な権限とセキュリティ・大規模な監視と運用」と書いた。段階②からの差分をまとめる。

| 部品 | 段階②（この連載で作ったもの） | 段階③で足されるもの |
|---|---|---|
| Planning | 1 体が計画を立て、失敗したステップを書き直す | 計画を部下に割り振り、依存関係を見て並列に実行する。部下の報告を見て計画全体を組み替える |
| State | 1 つの依頼の進捗をファイルに保存する | 複数の部下の進捗をまとめて持つ。処理が落ちても自動で続きから再開する（永続実行） |
| Memory | 利用者ごとの記憶に、出典・状態・期限を付ける | チームで共有する記憶と、エージェントごとの記憶を分ける。記憶どうしの矛盾を見つけて整理する |
| 権限・セキュリティ | 人間の権限とエージェントの持ち物の重なり、3 つの能力の見張り | エージェントごとに別の資格情報を持たせる。部下から指揮役への報告も「信用できない文章」として扱う |
| 監視・運用 | 依頼 ID 付きのログ、失敗率・コストの集計 | エージェントをまたいだ追跡、評価用の問題集で変更のたびに成績を測る、予算とアラート |

表の右の列に共通しているのは、**複数のものの間の整合**だ。複数の部下、複数の記憶、複数の資格情報。段階③の難しさは、1 つずつの部品の難しさではなく、それらを食い違わせずに動かし続けることにある。

評価の考え方（1 回できることと、毎回できることの違い）は、既存記事「[AIエージェントは「賢さ」より「設計」で決まる](2026-09-29-ai-agent-design-fundamentals.html)」の評価の節で扱っている。

> [!WARNING] 部下の報告も「信用できない文章」になりうる
> 部下が Web ページや受信メールを読んでいれば、その報告書には攻撃の命令が紛れ込んでいる可能性がある。指揮役が部下の報告をそのまま信じて、送信の Tool を使うと、第 5 話の 3 つの能力が指揮役の中で揃ってしまう。部下の報告は、読んだものの信用度を引き継ぐと考える。

## 連載全体のチェックリスト

6 回で扱った 16 の部品を、段階ごとに確かめる表にまとめる。

| 段階 | 部品 | 確かめること | 回 |
|---|---|---|---|
| ① | LLM・Tool | LLM は頼むだけで、実行はプログラム。SQL の形は固定している | 1 |
| ① | Tool 選択 | 説明文が具体的か。多いときは候補を絞っている | 1 |
| ① | RAG（簡単） | 検索結果に出典を付けて渡している | 1 |
| ② | 複数 Tool・複数ステップ | 結果を次が使える形で返し、計算はプログラムでしている | 2 |
| ② | Planning | 計画を実行前に検査し、失敗したステップだけを書き直す | 2 |
| ② | State 管理 | 1 ステップごとに保存し、終わったステップを飛ばして再開できる | 2 |
| ② | Memory | 記憶に出典・状態・期限を付け、利用者ごとに分けている | 3 |
| ② | RAG | 権限で絞ってから検索し、見つからないときは次の手を返す | 3 |
| ② | エラー処理 | 失敗を種類で分け、止めずに次の手を LLM に返す | 4 |
| ② | リトライ | 一時的な失敗だけ、ジッター付きで、上限付きで、1 つの層でやり直す | 4 |
| ② | ログ・監視 | 依頼 ID 付きで記録し、失敗率・時間・コストを集計している | 4 |
| ② | 権限管理 | 行単位の権限を Tool の中で守り、人間とエージェントの権限の重なりにしている | 5 |
| ② | Human 承認 | 取り消せない操作は、本人以外が承認し、保存した引数で実行する | 5 |
| ② | セキュリティ | 3 つの能力を揃えさせず、秘密をコード・ログ・文脈に入れない | 5 |
| ③ | 複数 Agent | 1 体で限界を確かめた。依頼書と報告書の形がある | 6 |
| ③ | 複数 Agent | レビューの条件をプログラムで持ち、予算をチーム全体で見ている | 6 |

最初から全部を作る必要はない。段階①で動かし、困ったことが起きた部品から足していく。エージェントの品質を決めるのは、多くの場合、LLM の賢さよりも、この表の右の列をどれだけ丁寧に作ったかだ。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)（2025-06-13）
- Cemri et al., [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)（NeurIPS 2025）
- Anthropic, [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）
- OpenAI, [A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)（2025）
- Meta AI, [Agents Rule of Two: A Practical Approach to AI Agent Security](https://ai.meta.com/blog/practical-ai-agent-security/)（2025-10-31）

