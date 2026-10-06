---
title: 文書は「切って、身元を付けて」初めて検索できる——RAGのチャンク・メタデータ・有効期間
description: 規程・議事録・契約書をエージェントに読ませるには、どう分割し、どんなメタデータを付け、古い版をどう扱えばよいか。見出し単位の分割、有効期間での絞り込み、ベクトル検索とキーワード検索の組み合わせ、再現率での精度の測り方までを、API キーなしで動く Python で分解する。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, データ設計, RAG, ベクトル検索, メタデータ, Python]
level: [practice]
series: AIエージェントのデータ設計
status: published
---
```hero
title 文書は切って、身元を付けて、測りながら検索する
group ingest 取り込み（この記事の中心）
  DOC([規程・議事録]):::data --> CH[構造に沿って\nチャンクに切る]:::code
  CH --> MD[メタデータを付け\n索引にする]:::data:::hl
end
group search 検索と回答
  Q([質問]):::human
  H[絞ってから\nハイブリッド検索]:::code
  A(根拠付きで回答):::llm
  EV[recall@k で\n分割を比べる]:::code
end
MD --> H
Q --> H --> A
H -.-> EV
note CH 見出し・条文など、文書の構造に沿って切る
note MD 版と有効期間を持たせ、旧版の規程で答えるのを防ぐ
note EV 分割方法は再現率で比べて選ぶ
```


規程の改訂から半年たっても、エージェントが旧版の数字で答え続ける。原因は、モデルの知識の古さではない。検索の仕組みが、旧版と新版を**同じ重みの文書として並べていた**ことにある。

社内の文書をエージェントに読ませるには、文書を検索できる単位に切り、それぞれに「どの文書の、どの版の、いつまで有効な部分か」という身元を付ける必要がある。この記事は「AIエージェントのデータ設計」連載の 2 回目で、PDF・Word・Excel・議事録・規程・契約書といった**文書のデータ**を扱う。

> [!TIP] この記事で分かること
> - 文書をエージェントに渡す仕組み（RAG）の全体像
> - 文書の構造に沿ってチャンク（検索の単位）に切る方法
> - チャンクに付けるメタデータ 10 項目と、それぞれの使い道
> - 有効期間と最新版の管理で、旧版の規程で答えるのを防ぐ方法
> - ベクトル検索とキーワード検索を組み合わせる理由
> - 検索精度を再現率（recall@k）で測り、分割方法を比べる手順

[1 回目](2026-09-29-ai-agent-data-design-1-structured.html)では、表の形をしたデータに「列の意味」を持たせた。今回はその文書版だ。題材は同じ架空の金融会社の融資サポートエージェントで、融資事務規程・審査会の議事録・住宅ローン契約書のひな形を検索させる。

## コードの読み方

コードは Python で書き、ほぼ全行に日本語の説明を付けた。特に大事な行には `★` を付けてある。本物の埋め込みモデル（後で説明する）の代わりに**練習用の偽物**を使うので、AI サービスの契約も API キーも要らない。

| 書き方 | 意味 |
|---|---|
| `# 〜` | 説明文（コメント）。プログラムとしては無視される |
| `def 名前(引数):` | 「関数」の定義。決まった手順に名前を付けたもの |
| `return 値` | 関数の結果として、その値を返して終わる |
| `if 条件:` / `for x in 並び:` | 条件に合うときだけ実行 / 並びの中身を 1 つずつ取り出して繰り返す |
| `[a, b]` / `{"名前": 値}` | リスト（順番のある入れ物） / 辞書（名前と値の組の入れ物） |
| `@dataclass` + `class 名前:` | 決まった項目を持つ「データの入れ物」の設計図 |
| `None` | 「値が無い」を表す特別な値 |

## 全体マップ：文書が回答の根拠になるまで

**RAG**（Retrieval-Augmented Generation、検索拡張生成）は、質問に関係する文書の断片を検索して LLM に渡し、それを根拠に答えさせる仕組みだ。LLM は社内の規程を知らないので、答えるたびに必要な部分を見せる。

```flow caption="文書の取り込みから、根拠付きの回答まで。この記事は取り込み側を中心に扱う"
A([PDF・Word・Excel\n議事録・規程]) --> B[文字を取り出す]
B --> C[構造に沿って\nチャンクに切る]
C --> D[メタデータを付ける\n版・有効期間・機密区分]:::hl
D --> E[検索用の索引を作る\n埋め込み＋キーワード]
E --> F{質問}
F --> G[メタデータで絞ってから\n近いチャンクを探す]
G --> H([根拠付きで回答])
```

回答の質の多くは、図の上半分（取り込み）で決まる。検索の工夫をいくら重ねても、切り方が悪く、身元の分からないチャンクからは正しい根拠を返せない。

## チャンク分割：文書の構造に沿って切る

LLM に渡せる文章の量には限りがあり、関係のない部分まで渡すと注意が散る。そこで文書を小さな単位に切っておき、関係する部分だけを検索で取り出す。この単位を**チャンク**と呼ぶ。

切り方には大きく 2 つある。

| 切り方 | 方法 | 長所 | 短所 |
|---|---|---|---|
| 固定長 | 決まった文字数（トークン数）ごとに機械的に切る | 実装が簡単。どんな文書にも使える | 条文や表の途中で切れる。見出しが本文から離れる |
| 構造に沿う | 見出し・条・議題・表などの区切りで切る | 意味のまとまりが保たれる。見出しを根拠として示せる | 文書の種類ごとに区切り方を決める必要がある |

文書の種類ごとに、区切りの目安はおおむね決まっている。

| 文書の種類 | 区切りの目安 | 気をつけること |
|---|---|---|
| 規程・契約書 | 条（第○条） | 「前条の場合」のように他の条を参照する文は、参照先の条番号も残す |
| 議事録 | 議題 | 日付と会議名を必ずメタデータに入れる（本文に書かれていないことが多い） |
| Excel・表 | 表ごと、または数行ごと | 行だけを切り出すと列の見出しが失われる。各チャンクに見出し行を付ける |
| スライド | 1 枚ごと | 図の中の文字は取り出せないことがある。取り出せたかを確かめる |
| 長い説明文 | 見出し、次に段落 | 見出しが無い文書は固定長で切るしかない |

PDF や Word から文字を取り出す部分は、使う道具によって書き方が変わるので、この記事では取り出した後の文字から始める。練習用の文書を用意する。

```python title="docs_data.py" caption="練習用の社内文書。規程は旧版と新版の 2 つがある"
# 練習用の社内文書。本物なら PDF や Word から文字を取り出したもの
DOCUMENTS = [
    {
        "doc_id": "RULE-LOAN", "title": "融資事務規程", "doc_type": "規程", "department": "融資部",
        "version": "第2版", "created_at": "2024-03-01", "updated_at": "2024-03-15",
        "effective_from": "2024-04-01", "effective_to": "2026-03-31",  # ★ 2026 年 3 月末で失効した旧版
        "confidentiality": "社内", "source": "規程集/融資事務規程_v2.pdf",
        "body": "第3条（年収の確認）\n年収は直近 1 年分の源泉徴収票で確認する。\n"
                "第5条（返済負担率）\n年収 400 万円以上の場合、返済負担率は 35% 以内とする。",
    },
    {
        "doc_id": "RULE-LOAN", "title": "融資事務規程", "doc_type": "規程", "department": "融資部",
        "version": "第3版", "created_at": "2026-02-01", "updated_at": "2026-02-20",
        "effective_from": "2026-04-01", "effective_to": None,  # ★ 現在有効な版（終わりが決まっていない）
        "confidentiality": "社内", "source": "規程集/融資事務規程_v3.pdf",
        "body": "第3条（年収の確認）\n年収は直近 2 年分の源泉徴収票で確認する。\n"
                "第5条（返済負担率）\n返済負担率は年収にかかわらず 30% 以内とする。",
    },
    {
        "doc_id": "MIN-20260910", "title": "融資審査会 議事録", "doc_type": "議事録", "department": "融資部",
        "version": "確定版", "created_at": "2026-09-10", "updated_at": "2026-09-12",
        "effective_from": "2026-09-10", "effective_to": None,
        "confidentiality": "機密", "source": "議事録/2026-09-10_融資審査会.docx",
        "body": "議題1（カードローンの延滞）\nカードローンの延滞が前年より増えた。督促の開始を 5 日早める。\n"
                "議題2（審査の手順）\n年収の確認書類の不足による差し戻しが多い。受付時の案内を改める。",
    },
    {
        "doc_id": "TPL-HOUSING", "title": "住宅ローン契約書 ひな形", "doc_type": "契約書", "department": "法務部",
        "version": "2025年版", "created_at": "2025-01-10", "updated_at": "2025-01-10",
        "effective_from": "2025-02-01", "effective_to": None,
        "confidentiality": "社内", "source": "契約書/住宅ローン契約書_2025.docx",
        "body": "第12条（繰上返済）\n繰上返済の手数料は 1 回につき 5,500 円とする。\n"
                "第15条（期限の利益の喪失）\n返済が 3 か月以上遅れた場合、残額を一括で返済する。",
    },
]
```

同じ「融資事務規程」に、2026 年 3 月末で失効した第 2 版と、4 月から有効な第 3 版がある。第 5 条の返済負担率（年収に対する年間返済額の割合）の上限が、35% から 30% に変わっている。

この本文を、見出し（第○条・議題○）で切る関数を書く。

```python title="chunking.py" caption="見出しで切る分割と、比較用の固定長の分割"
import re  # 文字のパターンで探す道具（正規表現）

# ★ 見出しとみなす行のパターン: 「第3条（…）」「議題1（…）」のような行
HEADING = re.compile(r"^(第\d+条|議題\d+)（.+）$")
MAX_CHARS = 300  # 1 つのチャンクの文字数の上限。超えたら段落で分ける


def split_by_heading(body: str) -> list[tuple[str, str]]:
    """本文を見出しごとに分け、(見出し, 中身) の組のリストで返す。"""
    sections = []                # 分けた結果をためるリスト
    heading, lines = "冒頭", []  # 最初の見出しより前の部分は「冒頭」と呼ぶ
    for line in body.splitlines():  # 本文を 1 行ずつ見る
        if HEADING.match(line):     # ★ 見出しの行が来たら、そこで区切る
            if lines:
                sections.append((heading, "\n".join(lines)))
            heading, lines = line, []  # 新しい見出しで数え直す
        else:
            lines.append(line)
    if lines:
        sections.append((heading, "\n".join(lines)))  # 最後の区切りを忘れずに足す

    # 長すぎる区切りは、段落（空行）でさらに分ける。見出しは分けた後も付けておく
    result = []
    for heading, text in sections:
        if len(text) <= MAX_CHARS:
            result.append((heading, text))
        else:
            result += [(heading, part) for part in text.split("\n\n") if part.strip()]
    return result


def split_fixed(body: str, size: int = 40) -> list[tuple[str, str]]:
    """比較用: 見出しを無視して、決まった文字数で機械的に切る。"""
    return [("", body[i:i + size]) for i in range(0, len(body), size)]  # size 文字ずつ切り出す
```

`HEADING` が見出しの行を見分けるパターンだ。`^(第\d+条|議題\d+)（.+）$` は「行の頭が『第 + 数字 + 条』か『議題 + 数字』で、全角のかっこ書きで終わる行」という意味になる。見出しの形は組織ごとに違うので、自分の文書に合わせて書き換える。

長すぎる条は段落でさらに分けるが、分けた後も同じ見出しを付けておく。第 5 条の後半だけが検索に当たっても、それが第 5 条の一部だと分かるようにするためだ。

### チャンクの大きさに決まった正解は無い

チャンクの大きさと、隣のチャンクとの重なり（オーバーラップ）には、さまざまな推奨値が出回っている。しかし調査によって結論が食い違う。

| 出典 | 結論 |
|---|---|
| 検索用データベースの開発元による評価（2024） | 200 トークン程度の小さめのチャンクが効率で優れ、重なりを無くすと無駄な取得が減った |
| 各種の実践ガイド（2026） | 256〜512 トークン・重なり 10〜20% を出発点に勧めるものが多い |
| 同上 | 重なりに効果が見られなかったという分析も紹介されている |

数字が揃わないのは、文書の種類と質問の種類で最適な大きさが変わるからだ。短い事実を聞く質問には小さなチャンク、複数の条にまたがる質問には大きなチャンクが向く。**推奨値を決め打ちせず、自分の文書と質問で測る**。測り方はこの記事の最後で扱う。

## メタデータ：チャンクに身元を持たせる

切り出したチャンクは、それだけでは「どこから来た文章か」が分からない。「返済負担率は 35% 以内とする」という一文が、旧版の規程なのか、議事録で出た案なのか、他社の資料なのかで意味がまったく変わる。

そこで、チャンクごとに文書の情報（**メタデータ**）を持たせる。

| 項目 | 例 | 何に使うか |
|---|---|---|
| 文書名 | 融資事務規程 | 根拠として見せる。キーワード検索にも効く |
| 作成日 | 2026-02-01 | 並べ替え。いつ書かれたかの目安 |
| 更新日 | 2026-02-20 | 回答に「いつ時点の情報か」を添える |
| 部門 | 融資部 | 部門で絞る。問い合わせ先を示す |
| 文書の種類 | 規程・議事録・契約書 | 「規程だけから答える」と絞る |
| 版 | 第3版 | 根拠に版を示す。版の違いを見分ける |
| 有効期間 | 2026-04-01 〜（終わり無し） | **今有効な版だけを検索する** |
| 機密区分 | 公開・社内・機密 | 見せてよい人を絞る（3 回目で扱う） |
| 出典 | 規程集/融資事務規程_v3.pdf | 元の文書を開いて確かめられるようにする |
| 見出し | 第5条（返済負担率） | 根拠の場所を示す |

これをチャンクの入れ物として定義する。

```python title="chunk_model.py" caption="チャンクとメタデータの入れ物。文書のメタデータをすべてのチャンクに写す"
from dataclasses import dataclass  # データの入れ物を簡単に作る道具
from chunking import split_by_heading


@dataclass
class Chunk:
    chunk_id: str         # チャンクの番号。「文書ID:版:見出し」で、同じ文書を取り込み直しても変わらない
    text: str             # 本文の一部
    section: str          # どの見出しの中か（第5条 など）
    # ここから下がメタデータ（本文についての情報）
    doc_id: str           # 文書の番号。版が変わっても同じ
    title: str            # 文書名
    doc_type: str         # 文書の種類（規程・議事録・契約書）
    department: str       # 所管の部門
    version: str          # 版
    created_at: str       # 作成日
    updated_at: str       # 更新日
    effective_from: str   # ★ 有効期間の始まり
    effective_to: str | None  # ★ 有効期間の終わり。None なら「現在も有効」
    confidentiality: str  # 機密区分（公開・社内・機密）
    source: str           # 出典。元のファイルの場所

    def embed_text(self) -> str:
        """検索用の文章。★ 本文の前に「どの文書の、どの版の、どこか」を付ける"""
        return f"{self.title}（{self.version}）{self.section}\n{self.text}"

    def citation(self) -> str:
        """回答の根拠として見せる文字列。"""
        return f"{self.title} {self.version} {self.section}（{self.source}）"


def make_chunks(doc: dict, splitter=split_by_heading) -> list[Chunk]:
    """文書 1 つを分割し、すべてのチャンクに文書のメタデータを写す。"""
    meta = {k: v for k, v in doc.items() if k != "body"}  # 本文以外の項目 = メタデータ
    return [
        Chunk(chunk_id=f"{doc['doc_id']}:{doc['version']}:{heading or i}",  # 見出しが無ければ連番
              text=text, section=heading, **meta)  # ** は「辞書の中身を引数として展開する」
        for i, (heading, text) in enumerate(splitter(doc["body"]))  # enumerate は番号付きで取り出す
    ]
```

ポイントは 3 つある。

1. **文書のメタデータを、すべてのチャンクに写す。** 検索で当たるのはチャンク単位なので、文書にだけ持たせても絞り込みに使えない
2. **`chunk_id` を「文書ID:版:見出し」で作る。** 取り込み直すたびに番号が変わると、回答の根拠として記録した番号が指す先が無くなる。安定した番号は 3 回目の「根拠の追跡」の前提になる
3. **検索用の文章の前に、文書名・版・見出しを付ける（`embed_text`）。** 「30% 以内とする」だけでは何の話か分からないが、「融資事務規程（第3版）第5条（返済負担率）」が前に付けば、検索で当たりやすくなる

3 つ目の工夫には実測がある。チャンクごとに文書全体から見た説明を前に付けてから索引を作ると、上位 20 件の取りこぼしが 35% 減り、キーワード検索と組み合わせると 49%、さらに並べ替え（再ランキング）を足すと 67% 減ったという報告がある（Anthropic、2024）。報告ではこの説明文を LLM に書かせているが、規程のように見出しがはっきりした文書なら、上のようにメタデータから組み立てるだけでも同じ方向の効果を狙える。

> [!TIP] メタデータは取り込むときに付ける
> 後から付けようとすると、どの文書のどの版から来たかが分からなくなっている。文字を取り出す段階で、ファイルの場所・更新日・版を一緒に持ち運ぶ。本文から自動で読み取れない項目（有効期間・機密区分）は、文書を登録する人に入力してもらう。

## 鮮度と有効期間：いつ時点の情報かを決める

文書には「書かれた日」と「効力のある期間」の 2 つの時間がある。規程は 2 月に書かれても、効力は 4 月からだ。これを 1 つの日付で済ませると、改訂の前後で必ず混乱が起きる。

| 項目 | 意味 | 例 |
|---|---|---|
| `updated_at` | 文書の中身を最後に変えた日 | 2026-02-20 |
| `effective_from` | 効力が始まる日 | 2026-04-01 |
| `effective_to` | 効力が終わる日。終わりが決まっていなければ空 | 空（現在も有効） |

検索では、**質問の時点に有効な版だけを候補にする**。

```python title="search.py" caption="有効期間と文書の種類で先に絞り、意味の近さと言葉の一致を混ぜて並べる"
import re
from datetime import date
from embedding import embed, cosine

# 型番・条番号・数字・漢字やカタカナの語を「キーワード」として取り出すパターン
KEYWORD = re.compile(r"第\d+条|\d+%|[ァ-ヶー]{2,}|[一-龥]{2,}")


def is_effective(chunk, as_of: date) -> bool:
    """★ as_of の日に有効な版かどうか。始まり ≤ as_of ≤ 終わり（終わりが無ければ現在も有効）"""
    start_ok = date.fromisoformat(chunk.effective_from) <= as_of
    end_ok = chunk.effective_to is None or as_of <= date.fromisoformat(chunk.effective_to)
    return start_ok and end_ok


def search(query: str, chunks: list, as_of: date, k: int = 3,
           doc_type: str | None = None, only_effective: bool = True) -> list[dict]:
    """質問に近いチャンクを k 件、根拠付きで返す。only_effective=False は比較のためだけに使う。"""
    # ★ 1. メタデータで先に絞る（有効期間・文書の種類）。絞ってから似ているかを測る
    pool = [c for c in chunks
            if (not only_effective or is_effective(c, as_of)) and (doc_type is None or c.doc_type == doc_type)]

    q_vec, keywords = embed(query), KEYWORD.findall(query)  # 質問の特徴と、キーワード
    scored = []
    for c in pool:
        semantic = cosine(q_vec, embed(c.embed_text()))  # 2. 意味の近さ（ベクトル検索）
        # 3. キーワードがどれだけ含まれるか（言葉の一致）。条番号や数字はベクトル検索が苦手
        lexical = sum(kw in c.embed_text() for kw in keywords) / len(keywords) if keywords else 0
        scored.append((0.7 * semantic + 0.3 * lexical, c))  # ★ 2 つを混ぜて点数にする
    scored.sort(key=lambda x: x[0], reverse=True)  # 点数の高い順に並べる

    return [{"score": round(s, 3), "text": c.text, "cite": c.citation(),   # ★ 根拠（出典）を必ず付ける
             "chunk_id": c.chunk_id, "updated_at": c.updated_at} for s, c in scored[:k]]
```

最初に `pool` を作る行が要だ。似ているかを測る**前に**、有効期間と文書の種類で候補を絞っている。似ているものを探してから古い版を捨てる順番だと、上位 3 件が全部旧版で埋まり、捨てた後に何も残らないことがある。

有効期間で絞ると何が変わるかを見る。

```python title="search_demo.py" caption="有効期間で絞る場合と絞らない場合を比べる"
from datetime import date
from docs_data import DOCUMENTS
from chunk_model import make_chunks
from search import search

chunks = [c for doc in DOCUMENTS for c in make_chunks(doc)]  # すべての文書をチャンクにする
question = "年収 500 万円の人の返済負担率の上限は？"
today = date(2026, 9, 29)

# 有効期間で絞らずに検索すると……
for hit in search(question, chunks, as_of=today, k=1, only_effective=False):
    print("絞らない:", hit["text"], "|", hit["cite"])

# ★ 今日有効な版だけに絞って検索する
for hit in search(question, chunks, as_of=today, k=1):
    print("今日有効:", hit["text"], "|", hit["cite"])

# 「2025 年 6 月時点では？」と聞かれたら、その日に有効だった版を返せる
for hit in search(question, chunks, as_of=date(2025, 6, 1), k=1):
    print("2025年6月:", hit["text"], "|", hit["cite"])
```

```text
絞らない: 年収 400 万円以上の場合、返済負担率は 35% 以内とする。 | 融資事務規程 第2版 第5条（返済負担率）（規程集/融資事務規程_v2.pdf）
今日有効: 返済負担率は年収にかかわらず 30% 以内とする。 | 融資事務規程 第3版 第5条（返済負担率）（規程集/融資事務規程_v3.pdf）
2025年6月: 年収 400 万円以上の場合、返済負担率は 35% 以内とする。 | 融資事務規程 第2版 第5条（返済負担率）（規程集/融資事務規程_v2.pdf）
```

絞らないと、**旧版の第 2 版が 1 位に来る**。質問の「年収」「万円」という言葉が、旧版の「年収 400 万円以上の場合」とよく一致するからだ。検索は「似ているか」しか見ないので、古いかどうかは判断できない。有効期間で絞ると現行の第 3 版が返り、「2025 年 6 月時点では？」と聞かれれば当時有効だった第 2 版を返せる。

> [!WARNING] 旧版を消さない
> 「古い版が検索に出てくるなら消せばいい」と考えがちだが、消すと「去年の審査はどの基準で行ったか」に答えられなくなる。3 回目で扱う監査でも、当時の根拠となった版が必要になる。消さずに有効期間を閉じる。

### 最新版を管理する

新しい版を登録するときは、前の版の有効期間を閉じる。人の手で両方を直すと必ず漏れるので、登録の手順に組み込む。

```python title="versions.py" caption="新しい版を登録すると、前の版の有効期間が自動で閉じる"
from datetime import date, timedelta  # timedelta は「日数の差」を表す


def register_version(documents: list[dict], new_doc: dict) -> None:
    """新しい版を登録し、同じ文書の「現在有効な版」の有効期間を閉じる。"""
    start = date.fromisoformat(new_doc["effective_from"])  # 新しい版が効き始める日
    for doc in documents:
        # 同じ文書で、まだ終わりが決まっていない版（= いま有効な版）を探す
        if doc["doc_id"] == new_doc["doc_id"] and doc["effective_to"] is None:
            # ★ 新しい版が始まる前日で閉じる。削除はしない（過去の時点の質問と監査に使う）
            doc["effective_to"] = (start - timedelta(days=1)).isoformat()
            new_doc["supersedes"] = doc["version"]  # どの版を置き換えたかを記録する
    documents.append(new_doc)  # 新しい版を足す


if __name__ == "__main__":
    docs = [{"doc_id": "RULE-LOAN", "version": "第3版", "effective_from": "2026-04-01", "effective_to": None}]
    register_version(docs, {"doc_id": "RULE-LOAN", "version": "第4版", "effective_from": "2027-04-01", "effective_to": None})
    for d in docs:
        print(d["version"], d["effective_from"], "〜", d["effective_to"], d.get("supersedes", ""))
```

```text
第3版 2026-04-01 〜 2027-03-31 
第4版 2027-04-01 〜 None 第3版
```

第 4 版を登録しただけで、第 3 版の終わりが第 4 版の始まる前日に設定された。`supersedes` には、どの版を置き換えたかを記録している。

議事録のように「版」の概念が無い文書は、有効期間の代わりに**会議の日付**で扱う。「最新の方針は？」と聞かれたら新しい議事録を優先し、回答には必ず日付を添える。議事録に書かれたことは、規程に反映されるまで正式な決まりではないことにも注意する。

## ベクトル検索とキーワード検索を組み合わせる

上の検索関数は、2 種類の近さを混ぜて点数にしていた。

**ベクトル検索**は、文章を**埋め込み**（エンベディング）と呼ばれる数字の並びに変え、その並びが近いものを探す方法だ。埋め込みモデルは意味の近い文章を近い数字の並びに変えるので、「返済の割合の上限」と「返済負担率は 30% 以内」のように、言葉が違っても意味が近いものを見つけられる。

一方で、ベクトル検索は**言葉そのものの一致**に弱い。条番号（第 15 条）、商品の型番、金額のような、1 文字違えば別物になる言葉は、意味の近さでは区別しにくい。そこで、キーワードの一致も点数に入れる。

| 検索の方法 | 得意 | 苦手 |
|---|---|---|
| ベクトル検索（意味の近さ） | 言い換え・表記の揺れ・自然文の質問 | 条番号・型番・数字・固有名詞 |
| キーワード検索（言葉の一致） | 条番号・型番・数字・固有名詞 | 言い換え（「延滞」と「滞納」など） |
| 組み合わせ（ハイブリッド検索） | 両方 | 2 つの点数の混ぜ方を調整する必要がある |

先に紹介した報告でも、「埋め込みとキーワード検索（BM25）の組み合わせは、埋め込み単体より良い」と結論づけている。BM25 は、キーワードの一致を文書の長さや言葉の珍しさで重み付けする、広く使われている計算方法だ。

この記事の練習用の埋め込みは、意味ではなく「隣り合う 2 文字の組」を数えているだけの偽物だ。

```python title="embedding.py" caption="練習用の埋め込み。本物に差し替えるのは最後の 1 行だけ"
import math                      # 平方根などの計算
from collections import Counter  # 数を数える入れ物


def fake_embed(text: str) -> Counter:
    """練習用の埋め込み。隣り合う 2 文字の組を数えて「文章の特徴」とする。

    ★ 本物の埋め込みモデルは、意味の近い文章を近い数字の並びに変える。
    ここだけ使うサービスの埋め込み API に差し替える。
    """
    t = text.replace("\n", "")                            # 改行は特徴に含めない
    return Counter(t[i:i + 2] for i in range(len(t) - 1))  # 「返済」「済負」「負担」… を数える


def cosine(a: Counter, b: Counter) -> float:
    """2 つの特徴がどれだけ似ているかを 0〜1 で返す（コサイン類似度）。"""
    dot = sum(a[k] * b[k] for k in a if k in b)  # 共通する組の数をかけ合わせて足す
    norm = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return dot / norm if norm else 0.0  # 長さで割って、文章の長さの影響を消す


embed = fake_embed  # ★ この 1 行を本物の埋め込み関数に変えれば、残りのコードはそのまま使える
```

`embed = fake_embed` の 1 行を、使うサービスの埋め込み API を呼ぶ関数に変えれば、残りのコードはそのまま使える。埋め込みの形（数字のリスト）に合わせて `cosine` の書き方は変わるが、「似ている度合いを 0〜1 で返す」という役割は同じだ。

> [!NOTE] 埋め込みモデルを変えたら索引は作り直す
> 埋め込みはモデルごとに数字の意味が違う。モデルを変えたり版を上げたりしたら、すべてのチャンクの埋め込みを作り直す。どのモデルで作った索引かも、メタデータとして記録しておく。

## 検索精度を測る：再現率で分割方法を比べる

ここまでの工夫が効いているかは、測らなければ分からない。検索の精度を測る最も基本的な指標が**再現率**（recall@k）だ。「上位 k 件の中に、答えを含むチャンクが入った質問の割合」を表す。

測るには、**質問と、正解のチャンクに含まれるはずの言葉の組**を用意する。本当は実際の利用者の質問から作るのがよい。ここでは 5 問で、見出しで切った場合と 40 文字で機械的に切った場合を比べる。

```python title="evaluate.py" caption="同じ質問で、分割方法ごとの再現率を比べる"
from datetime import date
from docs_data import DOCUMENTS
from chunk_model import make_chunks
from chunking import split_by_heading, split_fixed
from search import search

# ★ 評価用の質問と、正しいチャンクに必ず含まれるはずの言葉の組。実際の利用者の質問から作る
EVAL_SET = [
    ("今の返済負担率の上限は？", "30% 以内"),
    ("年収の確認に使う書類は何年分？", "直近 2 年分"),
    ("繰上返済の手数料はいくら？", "5,500 円"),
    ("返済が何か月遅れると一括返済になる？", "3 か月以上"),
    ("カードローンの延滞にどう対応する？", "督促の開始を 5 日早める"),
]


def recall_at_k(chunks: list, k: int) -> float:
    """上位 k 件の中に、答えを含むチャンクが入った質問の割合（再現率 recall@k）。"""
    today = date(2026, 9, 29)
    found = 0
    for question, answer in EVAL_SET:
        hits = search(question, chunks, as_of=today, k=k)     # 上位 k 件を検索する
        found += any(answer in h["text"] for h in hits)        # ★ 答えを含むチャンクが 1 つでもあれば「見つかった」
    return found / len(EVAL_SET)                               # 見つかった質問の割合


# 分け方だけを変えて、同じ質問で比べる
for name, splitter in [("見出しで分割", split_by_heading), ("40 文字で分割", split_fixed)]:
    chunks = [c for doc in DOCUMENTS for c in make_chunks(doc, splitter)]
    print(f"{name}: チャンク {len(chunks)} 個 / recall@1 = {recall_at_k(chunks, 1):.2f}"
          f" / recall@3 = {recall_at_k(chunks, 3):.2f}")
```

```text
見出しで分割: チャンク 8 個 / recall@1 = 0.80 / recall@3 = 1.00
40 文字で分割: チャンク 10 個 / recall@1 = 0.60 / recall@3 = 0.80
```

見出しで切ると、1 位に正解が来る割合が 0.60 から 0.80 に上がり、上位 3 件まで見れば全問で正解を含んだ。40 文字で切ると「5,500 円」が「5,」と「500 円」のように分かれたり、見出しと本文が別のチャンクになったりして、答えを 1 つのチャンクに収められない。

見出しで切っても 1 位を外した 1 問は、「年収の確認に使う書類は何年分？」だ。1 位に来たのは規程の第 3 条ではなく、議事録の「年収の確認書類の不足による差し戻しが多い」だった。**言い回しが質問に似ている別の文書に負けた**わけだ。直し方はいくつかある。

| 直し方 | 中身 |
|---|---|
| 文書の種類で絞る | 「決まり」を聞く質問では `doc_type="規程"` で検索する。エージェントに引数として選ばせる |
| 候補を増やして並べ替える | 上位 10〜20 件を取り、別のモデル（再ランキング）で質問との関係を採点し直す |
| 取り込みを直す | 議事録のチャンクに「議事録」「2026-09-10」を前置きし、規程との違いを索引に反映する |

どれが効くかも、同じ評価で測って決める。**評価用の質問は、直すたびに同じものを使う**。質問を変えると、良くなったのか質問が易しくなったのかが分からなくなる。

> [!IMPORTANT] 検索の精度と回答の精度は分けて測る
> 回答が間違っていたとき、原因が「検索で正しいチャンクを取れなかった」のか「取れたのに LLM が読み違えた」のかで、直す場所が違う。再現率で検索だけを先に測り、次に回答の正しさを測る。

## 設計チェックリスト

| 段階 | 確かめること |
|---|---|
| 取り込み | 文書の種類ごとに区切り方を決めたか。表の見出し行や図の中の文字が失われていないか |
| 分割 | 見出し・条・議題など構造に沿って切っているか。分けた後も見出しが付いているか |
| メタデータ | 文書名・作成日・更新日・部門・種類・版・有効期間・機密区分・出典が、すべてのチャンクにあるか |
| 番号 | チャンクの番号は、取り込み直しても変わらないか |
| 鮮度 | 検索の前に有効期間で絞っているか。旧版を消さずに期間を閉じているか。新しい版の登録で前の版が自動で閉じるか |
| 検索 | 意味の近さと言葉の一致を組み合わせているか。回答に出典・版・更新日を添えているか |
| 評価 | 質問と正解の組を用意し、再現率を測っているか。直すたびに同じ質問で測り直しているか |

次回は連載の最終回として、ここまでのデータを**誰に見せてよいか**と、**なぜその回答になったかを後から追えるか**を扱う。この記事で付けた機密区分・版・安定したチャンク番号が、権限の絞り込みと回答根拠の追跡の土台になる。

## 参考文献

- Anthropic, [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)（2024-09-19）
- Chroma Research, [Evaluating Chunking Strategies for Retrieval](https://www.trychroma.com/research/evaluating-chunking)（2024-07-03）
- Patrick Lewis ほか, [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)（arXiv 2020 / NeurIPS 2020）
- Pramod Sadalage, Prem Chandrasekaran, [Making Data Ready for Agentic AI](https://martinfowler.com/articles/making-data-ready-for-agentic-ai.html)（martinfowler.com, 2026-08-27）

### 日本語で読める関連記事

- libercraft, [RAGのチャンキング戦略を比較する：固定長・再帰分割・セマンティックの使い分け](https://zenn.dev/libercraft/articles/20260511-rag-chunking-comparison)（Zenn, 2026-05-11）— 固定長・再帰分割・意味による分割を実装付きで比べ、文書の種類ごとの切り方を示している
- sanpi333, [RAGの回答精度は「モデル」より「データ前処理」で決まる](https://qiita.com/sanpi333/items/969f38a05a524da1b48e)（Qiita, 2026-01-01）—「1 チャンク = 1 トピック（規程なら 1 条＋例外）」の原則と、日付・版・出典のメタデータを勧める前処理の実例

※ 記事中の数値・仕様は 2026 年 9 月時点で確認したもの。
