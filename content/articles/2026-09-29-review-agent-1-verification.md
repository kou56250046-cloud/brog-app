---
title: レビューエージェントは「見つける数」より「証明できる数」で決まる
description: AI にコードレビューをさせると、指摘は増えるのに読まれなくなる。原因は誤検知だ。指摘を「仮説」として持ち、根拠の照合・影響範囲の調査・反証・仕様との照合を通ったものだけを残す検証型レビューを、動く Python コードで組み立てる。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, コードレビュー, LLM, Python]
level: [basic, practice]
series: レビューエージェントの設計
status: published
---
```hero
title レビューの指摘は仮説として持ち、証明できたものだけを出す
group llm LLM が探す
  H(仮説を立てる):::llm
  TR(影響をたどり\n反証を探す):::llm
end
group code プログラムが確かめる
  EV{根拠は実在?}:::code
  SP{仕様に反する?}:::code:::hl
end
group out 出力
  OUT([指摘として残す]):::human
  DROP([出さない]):::muted
end
H --> EV
EV -->|ある| TR --> SP
EV -.->|ない| DROP
SP -->|反する| OUT
note EV 根拠が実在しない指摘は、プログラムで落とす
note TR 変更箇所の外まで影響をたどり、「本当に問題か」を問い直す
note SP 最後の判断基準は仕様に置く
```


AI にコードレビューをさせると、指摘の数はすぐに増える。ところが、しばらくすると誰も読まなくなる。20 件の指摘のうち本当に直すべきものが 2〜3 件しかなく、残りは勘違いや好みの押しつけだと分かってくるからだ。

この連載では、レビューエージェントの目的を**「できるだけ多くの問題を見つけること」から「問題であることを証明できる指摘だけを残すこと」へ**置き換える。第 1 回は、その土台になる**検証型レビュー**を扱う。

> [!TIP] この記事で分かること
> - AI レビューの指摘が読まれなくなる理由と、誤検知が生まれる典型的な原因
> - 指摘を「仮説」として持ち、根拠をプログラムで照合する方法
> - 変更箇所の外（呼び出し元・呼び出し先）まで影響をたどる方法
> - 「本当に問題か」を問い直す反証の手順と、仕様を最上位に置く判断基準

連載は 3 回で、第 2 回は指摘の分類（Severity・Confidence・指摘しない条件）、第 3 回は複数のレビュアーを統合する構成を扱う。コードには、ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

| 記号 | 意味 |
|---|---|
| `#` | ここから行末までは説明（コメント）。動作には関係しない |
| `def 名前():` | 関数（ひとまとまりの処理）を作る |
| `[ ]` | リスト。順番のある入れ物 |
| `{ }` | 辞書（「名前 → 値」の対応表）または集合（重複のない入れ物） |
| `@dataclass` | 項目の決まったデータの入れ物を作る書き方 |

```flow caption="検証型レビューの流れ。どの段階でも、通らなければ指摘として出さない"
A([レビュー対象の変更]) --> B[仮説を立てる]
B --> C{根拠は実在する?}
C -- いいえ --> X([出さない]):::muted
C -- はい --> D[影響範囲をたどる]
D --> E{反証は見つかる?}
E -- 見つかった --> F([要確認として人へ])
E -- 見つからない --> G{仕様に反する?}:::hl
G -- はい --> H([指摘として残す])
G -- 仕様に無い --> I([質問として人へ])
```

## AI レビューの指摘が読まれなくなる理由

AI レビューの問題は、見逃しよりも**誤検知**（問題でないものを問題と言うこと）で表に出やすい。誤検知が混ざると、読む側は全件を疑って確かめ直すことになり、レビューの手間はかえって増える。

公開されている事例と研究は、この傾向を裏づけている。

| 出典 | 分かったこと |
|---|---|
| curl（オープンソースの通信ツール） | AI が作った脆弱性報告が増え、確認された脆弱性の割合は過去の 15% 超から 2025 年に 5% 未満へ落ちた。2026 年 1 月末で報奨金制度を終了した |
| OpenAI の CriticGPT の研究（2024） | LLM の批評役は人間より多くのバグを見つけたが、存在しないバグ（幻覚）や重箱の隅の指摘も出した |
| コードレビュー用データセットの調査（2025） | 学習用のレビューコメントのうち、具体的で行動につながるものは 64% だった |
| Qiita の実践記事（2026） | 20 件の指摘に、変数名の空白と SQL インジェクションが同じ温度で並び、本当に直すべき 2〜3 件が埋もれた |

誤検知には、よく出る型がある。先に並べておくと、この記事で作る仕組みがどれに効くかが分かる。

| 誤検知の型 | 例 | この記事の対策 |
|---|---|---|
| 根拠が存在しない | 存在しない行番号や関数を挙げる | 根拠の照合 |
| 他の場所で保証されている | 呼び出し元で値を確かめているのに「未確認」と言う | 反証 |
| 影響を見誤る | 変更した行だけを見て、呼び出し元での壊れ方を見落とす | 影響範囲の調査 |
| 仕様で意図されている | 仕様で決めた挙動を「一般的でない」と言う | 仕様との照合 |
| 変更と関係ない・好み | 触っていない行や書き方の好みを指摘する | 第 2 回の「指摘しない条件」 |

> [!IMPORTANT] 目的を置き換える
> レビューエージェントの目的は「できるだけ多くの問題を見つけること」ではなく、「問題であることを証明できる指摘だけを残すこと」とする。見逃しを減らす工夫は、この土台の上で行う。

## 指摘を「仮説」として持つ

人間の熟練したレビュアーは、「ここ怪しいな」と思った段階では口に出さない。呼び出し元を見に行き、仕様を確かめ、本当に壊れると分かってから指摘する。レビューエージェントにも同じ順番を踏ませる。

```flow caption="指摘は仮説から始まり、証拠を確かめてから結論になる"
direction LR
A[仮説\n「〜のとき〜が起きる」] --> B[調査\nコードと仕様を読む]
B --> C[証拠の確認\n実在するか照合]:::hl
C --> D([結論\n残す / 回す / 捨てる])
C -.->|足りない| B
```

そのために、指摘を自由な文章ではなく、**項目の決まったデータ**として持つ。文章だと、根拠が書かれているかをプログラムで確かめられないからだ。

```python title="finding.py" caption="指摘と根拠の入れ物。指摘は最初「仮説」の状態で作る" {9,16,23}
from dataclasses import dataclass, field  # 「データの入れ物」を簡単に作る道具


@dataclass
class Evidence:
    """根拠 1 件。「どのファイルの何行目に、何と書いてあるか」。"""
    file: str  # ファイルの場所（パス）
    line: int  # 行番号（1 から数える）
    quote: str  # ★ その行に書いてあるはずのコードの一部。あとでプログラムが照合する
    role: str = "support"  # support（指摘を支える）/ counter（指摘を否定する）


@dataclass
class Finding:
    """指摘 1 件。最初は「仮説」として作り、検証を通ったものだけを残す。"""
    hypothesis: str  # ★ 仮説。「〜のとき、〜が起きる」の形で書かせる
    file: str  # 指摘する場所のファイル
    line: int  # 指摘する場所の行
    category: str  # 観点（logic＝ロジック、security＝セキュリティ など）
    severity: str = "Medium"  # 影響の大きさ（第 2 回で定義する）
    evidence: list[Evidence] = field(default_factory=list)  # 根拠のリスト
    spec_ref: str = ""  # 根拠にした仕様の場所。無ければ空のまま
    status: str = "hypothesis"  # ★ 状態。hypothesis（仮説）→ verified / needs_review / refuted
    notes: list[str] = field(default_factory=list)  # 検証の途中で分かったことのメモ
```

要点は 3 つある。9 行目の `quote` は、根拠の行に書いてあるはずのコードの一部だ。これがあると、LLM が挙げた行番号が本物かをプログラムで照合できる。16 行目の `hypothesis` は「問題がある」ではなく「〜のとき〜が起きる」の形にさせる。条件と結果の形なら、反証を探せるからだ。

23 行目の `status` は、指摘がどこまで確かめられたかを表す。

| status | 意味 | 人への見せ方 |
|---|---|---|
| `hypothesis` | 仮説のまま。まだ何も確かめていない | 見せない |
| `verified` | 根拠を照合し、反証も見つからなかった | 指摘として見せる |
| `needs_review` | 根拠はあるが、反証の候補もある | 「要確認」として見せる |
| `refuted` | 反証が根拠付きで見つかった | 折りたたんで見せる（第 3 回） |

`evidence` の `role` に `counter`（否定する根拠）があるのは、反証の結果も指摘と一緒に残すためだ。人が判断するとき、「なぜ問題か」と同じくらい「なぜ問題でないかもしれないか」が役に立つ。

LLM のレビュアーには、この形で返すように指示する。指示文の要点は次のとおりだ。

```text title="reviewer_prompt.txt" caption="レビュアーへの指示の要点。問題を探す前に、仮説と根拠の形を決めておく"
あなたはロジックの観点だけを見るレビュアーだ。
指摘は「仮説」として、次の形の JSON で返すこと。
- hypothesis: 「〜のとき、〜が起きる」の形で書く
- evidence: 根拠の file・line・quote（その行のコードをそのまま写す）
- spec_ref: 根拠にした仕様の場所。仕様に書かれていなければ空にする

根拠の行を実際に読んでいないものは、指摘に含めないこと。
「一般的ではない」「好ましくない」だけを理由にした指摘はしないこと。
```

## 根拠のない指摘をプログラムで落とす

指摘に根拠の欄を作っても、LLM はもっともらしい行番号を作り出すことがある。そこで、**根拠が本当にそこにあるかをプログラムで照合する**。LLM に「確かめましたか」と聞くのではなく、ファイルを開いて確かめる。

練習用に、3 つのファイルからなる小さなリポジトリを用意する。

```python title="sample_repo.py" caption="練習用のリポジトリ。get_user は、利用者が見つからないと None を返す" {6,13}
# 練習用の小さなリポジトリ。「ファイルの場所 → 中身」の対応表（辞書）
REPO = {
    "app/user.py": (
        "def get_user(user_id):\n"
        "    row = db.find(user_id)\n"
        "    return row  # 見つからなければ None\n"  # ★ None（空っぽ）を返すことがある
    ),
    "app/profile.py": (
        "from app.user import get_user\n"
        "\n"
        "def show_profile(user_id):\n"
        "    user = get_user(user_id)\n"
        "    return user.name\n"  # ★ user が None だと、ここでエラーになる
    ),
    "app/api.py": (
        "from app.profile import show_profile\n"
        "\n"
        "def handle(req):\n"
        "    if not user_exists(req.user_id):\n"  # 呼び出す前に、利用者がいるか確かめている
        "        return 404\n"
        "    return show_profile(req.user_id)\n"
    ),
}


def read_line(path: str, no: int) -> str | None:
    """path の no 行目を返す。ファイルか行が無ければ None を返す。"""
    text = REPO.get(path)  # ファイルの中身を取り出す（無ければ None）
    if text is None:
        return None
    lines = text.splitlines()  # 1 行ずつに分ける
    if not 1 <= no <= len(lines):  # 行番号が範囲の外なら
        return None
    return lines[no - 1]  # リストは 0 から数えるので 1 引く
```

`get_user` は利用者が見つからないと `None`（値が無いことを表す特別な値）を返す。`show_profile` はそれを確かめずに `user.name` を読むので、`None` のときにエラーになる。これが今回の「怪しい箇所」だ。実際のリポジトリでは、`REPO` の代わりにファイルを読めばよい。

```python title="evidence_check.py" caption="根拠の行が実在し、書いてあるはずのコードが本当にあるかを照合する" {10,14,16}
from finding import Evidence, Finding  # 指摘と根拠の入れ物
from sample_repo import read_line  # 練習用リポジトリから 1 行読む関数


def check_evidence(f: Finding) -> list[str]:
    """根拠が実在するかを確かめ、見つかった問題のリストを返す。空なら合格。"""
    problems = []  # 問題を書きためるリスト
    supports = [e for e in f.evidence if e.role == "support"]  # 指摘を支える根拠だけ
    if not supports:
        problems.append("根拠が 1 件もない")  # ★ 根拠のない指摘は、ここで落とす
    for e in supports:
        actual = read_line(e.file, e.line)  # その行に実際に書いてあること
        if actual is None:
            problems.append(f"{e.file}:{e.line} が存在しない")  # ★ 幻の行番号
        elif e.quote not in actual:
            problems.append(f"{e.file}:{e.line} に「{e.quote}」が無い")  # ★ 書き写し違い
    return problems


if __name__ == "__main__":
    f = Finding(
        hypothesis="get_user が None を返したとき、user.name でエラーになる",
        file="app/profile.py", line=5, category="logic",
        evidence=[
            Evidence("app/profile.py", 5, "user.name"),  # 本物の根拠
            Evidence("app/user.py", 3, "return row"),  # 本物の根拠
            Evidence("app/user.py", 9, "raise NotFound"),  # LLM が作り出した偽の根拠
        ],
    )
    for p in check_evidence(f):  # 問題を 1 つずつ表示する
        print("NG:", p)
```

照合は 3 段だ。10 行目で根拠が 1 件も無い指摘を落とす。14 行目で、存在しない行を挙げた根拠を見つける。16 行目で、行はあってもそこに書いてあるはずのコードが無い根拠を見つける。

```bash title="実行結果"
$ python evidence_check.py
NG: app/user.py:9 が存在しない
```

`app/user.py` は 3 行しかないので、9 行目を挙げた根拠は偽物だと分かる。この照合は LLM を使わないので、何度実行しても同じ結果になり、費用もかからない。

> [!WARNING] 照合が証明するのは「根拠が実在すること」だけ
> 照合に通っても、指摘が正しいとは限らない。「5 行目に `user.name` がある」は事実でも、「そこでエラーになる」は、まだ仮説のままだ。照合は、事実に基づかない指摘を安く落とすための最初のふるいであり、この後の影響範囲の調査と反証が本番になる。

## 変更箇所の外まで影響をたどる

変更した行だけを見ていると、2 種類の間違いが起きる。変更が呼び出し元を壊しているのに気づかない見逃しと、呼び出し元ですでに守られているのに「危ない」と言う誤検知だ。どちらも、**変更の外を読まないと判断できない**。

たどる先は、呼び出しの関係だけではない。

| たどる先 | 確かめること |
|---|---|
| 呼び出し元 | 戻り値の形や例外の種類を変えたとき、受け取る側が壊れないか。受け取る側で守られていないか |
| 呼び出し先 | 渡す値の前提（空でない、正の数など）を満たしているか |
| DB | 列の追加・型の変更に、既存のデータや別の読み手が対応しているか |
| API | 外部に公開している応答の形が変わっていないか |
| キャッシュ | データを書き換えたとき、古い値が残って読まれないか |
| 非同期処理 | 待ち行列に残っている古い形式のメッセージを、新しいコードが読めるか |
| 設定 | 環境ごとの設定値によって、挙動が変わらないか |

まずは呼び出し元をたどる部分を作る。

```python title="impact.py" caption="関数の呼び出し元を、決めた段数までさかのぼる" {15,20,25}
import re  # 正規表現。文字の並びのパターンで検索する道具

from sample_repo import REPO  # 練習用のリポジトリ


def find_callers(func: str) -> list[tuple[str, int, str]]:
    """func を呼んでいる行を探す。（ファイル, 行番号, 呼んでいる関数名）のリストを返す。"""
    hits = []  # 見つかった呼び出しを入れるリスト
    for path, text in REPO.items():  # すべてのファイルを順に見る
        current = ""  # 今読んでいる行が、どの関数の中か
        for no, line in enumerate(text.splitlines(), start=1):  # 1 行ずつ、行番号付きで
            m = re.match(r"def (\w+)\(", line)  # 関数の定義の行か
            if m:
                current = m.group(1)  # 関数名を覚えておく
            elif re.search(rf"\b{func}\(", line):  # ★ 「func(」と書いてある行＝呼び出し
                hits.append((path, no, current))
    return hits


def trace_up(func: str, depth: int = 3) -> list[str]:
    """★ 呼び出し元を depth 段までさかのぼり、たどった経路を返す。"""
    route, queue, seen = [], [(func, 0)], {func}  # 結果・これから調べる関数・調べ済み
    while queue:  # 調べる関数が残っている間
        name, d = queue.pop(0)  # 先頭から 1 つ取り出す
        if d >= depth:  # 決めた段数まで来たら、それ以上さかのぼらない
            continue
        for path, no, caller in find_callers(name):
            route.append(f"{'  ' * d}{name} ← {caller}（{path}:{no}）")
            if caller not in seen:  # 同じ関数を二度調べない（無限ループ防止）
                seen.add(caller)
                queue.append((caller, d + 1))  # 呼び出し元の、さらに呼び出し元へ
    return route


if __name__ == "__main__":
    print("\n".join(trace_up("get_user")))  # get_user の影響がどこまで届くか
```

15 行目で「関数名＋`(`」の並びを探し、それを呼び出しとみなす。20 行目の `trace_up` は、見つかった呼び出し元の、さらに呼び出し元へと順にさかのぼる。25 行目で `depth` の段数に上限を置くのは、大きなリポジトリで調べる範囲が際限なく広がらないようにするためだ。

```bash title="実行結果"
$ python impact.py
get_user ← show_profile（app/profile.py:4）
  show_profile ← handle（app/api.py:6）
```

`get_user` の戻り値は `show_profile` を通って `handle` まで届く。つまり、`show_profile` の指摘が本当に問題かどうかは、`handle` での使われ方を見ないと決められない。

> [!NOTE] 文字列の検索は練習用
> ここでは分かりやすさのために文字列で呼び出しを探した。同じ名前の別の関数や、変数に入れてから呼ぶ書き方は見分けられない。実際には、コードを文の木（抽象構文木）に分解するか、エディタが使う言語サーバーの「参照を探す」機能を使う。研究でも、差分の外から親関数や変数の流れを切り出して渡すと、欠陥の検出が改善したと報告されている（参考文献の Kuaishou の研究）。

## 反証：「本当に問題か」を問い直す

問題の候補が見つかったら、次は**それを否定する材料を探す**。人間でも、自分の仮説を支える情報ばかり集めてしまう傾向（確証バイアス）がある。LLM も、一度「問題だ」と書くと、その理由を補強する方向に進みやすい。だから反証は、手順として別に置く。

反証で確かめる問いは、観点によらずほぼ決まっている。

| 反証の問い | 例 |
|---|---|
| 呼び出し元で保証されていないか | 呼ぶ前に値の存在を確かめている |
| 型や形式で保証されていないか | 型の定義で空の値を許していない、入力の検証で弾いている |
| 設定で無効になっていないか | その機能は設定で止めてあり、到達しない |
| フレームワークが守っていないか | テンプレートが文字を自動で無害化している |
| 仕様で意図されていないか | 仕様に「この場合は 404 を返す」と書いてある |
| テストが保証していないか | その条件を確かめるテストがあり、通っている |

1 つ目の「呼び出し元で保証されていないか」を、コードで確かめてみる。

```python title="counter_check.py" caption="呼び出し元の手前に、値を確かめる守りの行があるかを探す" {19,23,37}
import re  # 正規表現

from finding import Evidence, Finding  # 指摘と根拠の入れ物
from impact import find_callers  # 呼び出し元を探す関数
from sample_repo import REPO  # 練習用のリポジトリ

GUARD = re.compile(r"\bif not\b|is None|is not None|\bassert\b|\btry:")  # 守りによくある書き方


def guards_before(path: str, call_line: int) -> list[Evidence]:
    """呼び出しの手前（同じ関数の中）に、守りの行があるかを探す。"""
    lines = REPO[path].splitlines()  # ファイルを 1 行ずつに分ける
    found = []  # 見つかった守りの行
    for no in range(call_line - 1, 0, -1):  # 呼び出し行の 1 つ上から、上へ向かって
        line = lines[no - 1]
        if line.startswith("def "):  # 関数の頭まで来たら、そこで終わり
            break
        if GUARD.search(line):  # 守りの書き方が見つかったら
            found.append(Evidence(path, no, line.strip(), role="counter"))  # ★ 反証の根拠
    return found


def counter_check(f: Finding, func: str) -> Finding:
    """★ 「本当に問題か」を確かめる。func の呼び出し元が守っていないかを見る。"""
    callers = find_callers(func)  # 指摘された関数を呼んでいる場所
    guarded = 0  # 守りがあった呼び出し元の数
    for path, no, caller in callers:
        ev = guards_before(path, no)  # その呼び出しの手前の守り
        f.evidence += ev  # 反証の根拠も、指摘に一緒に残す
        guarded += 1 if ev else 0
        f.notes.append(f"{caller}（{path}:{no}）: {'守りあり' if ev else '守りなし'}")
    if not callers:
        f.status = "needs_review"  # 呼び出し元が見つからない。判断できないので人へ
    elif guarded == len(callers):
        f.status = "needs_review"  # ★ 全部守られて見える。棄却はせず、人に確かめてもらう
    else:
        f.status = "verified"  # 守られていない呼び出しがある。問題として成立する
    return f


if __name__ == "__main__":
    f = Finding("get_user が None を返したとき、user.name でエラーになる",
                "app/profile.py", 5, "logic",
                evidence=[Evidence("app/profile.py", 5, "user.name")])
    counter_check(f, "show_profile")  # show_profile を呼ぶ側を調べる
    print(f.status)
    print("\n".join(f.notes))
```

19 行目で、見つかった守りの行を `role="counter"`（否定する根拠）として記録する。23 行目の `counter_check` は、呼び出し元をすべて調べ、守りの有無で状態を決める。37 行目のとおり、守られていない呼び出しが 1 つでもあれば、指摘は `verified`（成立）になる。

```bash title="実行結果"
$ python counter_check.py
needs_review
handle（app/api.py:6）: 守りあり
```

唯一の呼び出し元 `handle` は、呼ぶ前に `user_exists` で利用者の存在を確かめていた。ここで注目したいのは、指摘を**棄却せず `needs_review`（要確認）にした**ことだ。`user_exists` と `db.find` は別々の問い合わせなので、その間に利用者が削除されれば `None` は返りうる。守りの行が「ある」ことは確かめられても、「十分か」まではプログラムでは決められない。

> [!WARNING] 何人が「問題だ」と言っても、それは証拠ではない
> 複数の LLM に同じ指摘をさせ、一致した数で採否を決める方法がある。しかし 2026 年の Refute-or-Promote の研究では、10 体のレビュアーが全員一致で支持した脆弱性が、実際に動かすと存在しなかった例が報告されている。一致の数は優先順位を付ける材料にはなるが、証拠の代わりにはならない。最も強い反証は、実際に動かして確かめることだ。

## 仕様を最上位の判断基準にする

反証まで通った指摘でも、最後に確かめることがある。それが**仕様に照らして問題か**だ。レビューの判断基準には上下がある。

```flow caption="判断の上下関係。下の層は、上の層に合っているかで評価する"
A[仕様\n何をすべきか]:::hl --> B[設計\nどう分けて作るか]
B --> C[実装\nコード]
C --> D[テスト\n確かめ方]
```

実装やテストの良し悪しは、仕様に合っているかで決まる。逆に、仕様に合っている実装を「一般的ではない」という理由だけで問題にしてはいけない。

| 状況 | 判断 |
|---|---|
| 仕様に反する実装 | 最優先で指摘する。`spec_ref` に仕様の場所を書く |
| 仕様どおりだが、一般的な書き方ではない | 指摘しない。気になるなら仕様を見直す提案として人に回す |
| 仕様に書かれていないことで、壊れる可能性がある | 要確認として出す。「仕様ではどうすべきか」を質問の形にする |
| 仕様そのものが矛盾している | コードの指摘ではなく、仕様の問題として分けて出す |

たとえば、先ほどの `handle` が利用者がいないときに 404 を返すのを見て、「例外を投げるべきだ」と指摘するレビュアーがいたとする。仕様に「存在しない利用者には 404 を返す」と書かれていれば、それは誤検知だ。仕様を読まないレビュアーは、この区別がつかない。

そのため、レビュアーには差分と一緒に**仕様の該当部分を渡す**。どこが該当するかは、変更したファイルや関数名から仕様書を検索して選ぶ。仕様が無いプロジェクトでは、既存のテストとコメントが次に強い判断材料になる。

> [!NOTE] 仕様が無いときに「常識」で埋めさせない
> 仕様が見つからないとき、LLM は一般的な良い習慣を基準に判断しがちだ。それ自体は役に立つこともあるが、その指摘の根拠は「仕様」ではなく「一般論」だと分かる形で出す。`spec_ref` を空のままにしておけば、第 2 回で作る仕組みが、その指摘を低い確信度として扱える。

## 第 1 回のチェックリスト

| 確かめること | 対応する仕組み |
|---|---|
| 指摘を「〜のとき〜が起きる」の仮説の形で持っている | `Finding.hypothesis` |
| 根拠に file・line・quote があり、プログラムで照合している | `check_evidence` |
| 変更の外（呼び出し元・呼び出し先・DB・キャッシュ・非同期）までたどっている | `trace_up` |
| 否定する材料を手順として探し、否定の根拠も指摘と一緒に残している | `counter_check` |
| 反証の候補があるとき、勝手に棄却せず人に回している | `status="needs_review"` |
| 仕様を渡し、「一般的でない」だけの指摘をさせていない | `spec_ref` |

ここまでで、1 件の指摘を確かめる流れができた。ただし、確かめ方の深さは指摘ごとに違う。実際に動かして再現したものと、根拠の行が実在するだけのものを、同じ重みで見せてはいけない。次回「[「Severity」と「Confidence」は別の軸](2026-09-29-review-agent-2-findings.html)」では、指摘の重さと確かさを分けて表し、指摘しない条件を決める。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- The Register, [Curl shutters bug bounty program to stop AI slop](https://www.theregister.com/security/2026/01/21/curl-shutters-bug-bounty-program-to-stop-ai-slop/5063039)（2026-01-21）
- BleepingComputer, [Curl ending bug bounty program after flood of AI slop reports](https://www.bleepingcomputer.com/news/security/curl-ending-bug-bounty-program-after-flood-of-ai-slop-reports/)（2026-01）
- McAleese et al., [LLM Critics Help Catch LLM Bugs](https://arxiv.org/abs/2407.00215)（OpenAI, 2024-06）
- [Too Noisy To Learn: Enhancing Data Quality for Code Review Comment Generation](https://arxiv.org/abs/2502.02757)（2025-02）
- [Towards Practical Defect-Focused Automated Code Review](https://arxiv.org/abs/2505.17928)（中国科学院・Kuaishou, 2025-05）
- Agarwal, [Refute-or-Promote: An Adversarial Stage-Gated Multi-Agent Review Methodology](https://arxiv.org/abs/2604.19049)（2026-04-21）
- fuji1009_REBELL, [AIコードレビューの精度を上げた「重要度分類×Few-shot」](https://qiita.com/fuji1009_REBELL/items/54509e90f74c3f970713)（Qiita, 2026-07）
