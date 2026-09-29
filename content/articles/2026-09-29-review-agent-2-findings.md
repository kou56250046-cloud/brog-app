---
title: 「Severity」と「Confidence」は別の軸——レビュー指摘を事実と推測に仕分ける
description: AI レビューの指摘に、影響の大きさ（Severity）と根拠の強さ（Confidence）を別々に付ける方法を解説する。観点の体系、固定チェックと探索型レビューの分担、確信度を LLM の自己申告でなく検証の深さで決めるコード、指摘しない条件の書き方までを扱う。
date: "2026-09-29"
verified: "2026-09-29"
category: AIエージェント
tags: [AIエージェント, コードレビュー, LLM, Python]
level: [practice]
series: レビューエージェントの設計
status: published
---

「重大」と書かれた指摘を開いてみたら、根拠は「一般的にはこう書く」だけだった。AI レビューでよく起きることだ。原因は、**影響の大きさ**と**根拠の強さ**を 1 つのラベルに混ぜていることにある。

第 1 回「[レビューエージェントは「見つける数」より「証明できる数」で決まる](2026-09-29-review-agent-1-verification.html)」では、1 件の指摘を確かめる流れを作った。第 2 回では、確かめた結果を**人が判断しやすい形で表す**方法と、そもそも**指摘しない条件**を決める。

> [!TIP] この記事で分かること
> - レビューの観点を 10 に分け、機械的に調べるもの（固定チェック）と LLM に探させるもの（探索型）に分担する方法
> - Severity（影響の大きさ）と Confidence（根拠の強さ）を別々に決める基準
> - 確信度を LLM の自己申告ではなく、「どこまで確かめたか」で決めるコード
> - 変更と無関係・仕様どおり・好みの問題などを、指摘の前に落とす条件

コードは第 1 回の `finding.py`（指摘の入れ物）をそのまま使う。ほぼ全行に日本語の説明を付け、要点の行には `★` を付けた。

```flow caption="第 2 回で作る部分。検証済みの候補に、重さと確かさを付けてから出す"
A([検証済みの候補]) --> B{指摘しない条件に\n当てはまる?}
B -- はい --> X([出さない。理由を記録]):::muted
B -- いいえ --> C[Severity を決める\n影響の大きさ]
C --> D[Confidence を決める\n根拠の強さ]:::hl
D --> E[4 つに仕分ける\n確実 / 可能性高 / 要確認 / 提案]
E --> F([人に見せる])
```

## レビューの観点を 10 に分ける

「このコードをレビューして」とだけ頼むと、LLM は目に付きやすいもの（変数名、書き方）から指摘しがちだ。見る観点を先に決めておくと、抜けと偏りの両方を減らせる。

| 観点 | 見ること | 主な担当 |
|---|---|---|
| セキュリティ | 注入、認証・認可の漏れ、秘密情報の露出、危険な暗号 | 固定チェック＋探索型 |
| ロジック | 条件分岐の誤り、境界値、空の値、状態の食い違い | 探索型 |
| アーキテクチャ | 責務の置き場所、層をまたいだ依存、既存の設計との矛盾 | 探索型 |
| パフォーマンス | ループ内の問い合わせ、不要な全件読み込み、計算量 | 探索型 |
| エラーハンドリング | 握りつぶし、処理されない例外、失敗時の後始末 | 固定チェック＋探索型 |
| テスト | 変更に対応するテストの有無、確かめ方が弱いテスト | 探索型 |
| 保守性 | 重複、変更の影響が広がる作り | 探索型 |
| 依存関係 | 新しいライブラリ、既知の脆弱性、ライセンス | 固定チェック |
| データ整合性 | 移行と既存データ、トランザクションの範囲、キャッシュとの食い違い | 探索型 |
| 可読性 | 名前、構造の分かりやすさ | 固定チェック（整形・命名規約）＋探索型 |

右の列が、次の章の話になる。

## 決まった検査はツールに、設計の問題は LLM に

観点の中には、**規則として書けるもの**と、**文脈を読まないと判断できないもの**がある。前者を LLM にやらせると、同じコードでも実行のたびに結果が変わり、費用もかかる。後者をツールにやらせることは、そもそもできない。

| | 固定チェック | 探索型レビュー |
|---|---|---|
| 対象 | 型エラー、SQL インジェクションの典型、認証の付け忘れ、処理されない例外、未使用の変数、秘密情報の露出 | 設計上の問題、責務の不整合、拡張性、データの流れの不整合、既存の仕様との矛盾、業務ロジックの誤り |
| 担当 | 型検査、linter（コードの書き方を機械的に調べる道具）、秘密情報の検出ツール、依存関係の脆弱性検査 | LLM のレビュアー |
| 結果 | 毎回同じ。検出したものは事実 | 実行ごとに揺れる。検出したものは仮説 |
| 費用 | ほぼゼロ | 呼び出しごとにかかる |

大事なのは、ツールの結果も**LLM の指摘と同じ形にそろえる**ことだ。形がそろっていれば、後で重複をまとめたり、Severity の順に並べたりする処理を共通にできる。

```python title="fixed_checks.py" caption="秘密情報の直書きと、種類を書かない except: を機械的に見つけ、指摘の形にそろえる" {11,15,19}
import ast  # Python のコードを「文の木」に分解して調べる標準の道具
import re  # 正規表現

from finding import Evidence, Finding  # 指摘と根拠の入れ物

# 「api_key = "長い文字列"」のような、秘密の直書きによくある形
SECRET = re.compile(r"(api[_-]?key|secret|token|password)\s*=\s*['\"][^'\"]{8,}['\"]", re.I)


def fixed_checks(path: str, source: str) -> list[Finding]:
    """★ 決まった規則で機械的に調べる。同じ入力には、毎回まったく同じ結果を返す。"""
    out = []  # 見つかった指摘
    for no, line in enumerate(source.splitlines(), start=1):  # 1 行ずつ
        if SECRET.search(line):
            name = line.split("=")[0].strip()  # ★ 根拠には変数名だけを写す。秘密そのものは写さない
            out.append(Finding("秘密情報がコードに直書きされている", path, no, "security",
                               severity="High", evidence=[Evidence(path, no, name)],
                               status="verified"))  # 規則に一致した＝事実なので最初から確定
    for node in ast.walk(ast.parse(source)):  # 文の木の、すべての枝を見る
        if isinstance(node, ast.ExceptHandler) and node.type is None:  # 種類を書かない except:
            out.append(Finding("except: がすべての例外を握りつぶす", path, node.lineno,
                               "error-handling", severity="Medium",
                               evidence=[Evidence(path, node.lineno, "except:")],
                               status="verified"))
    return out


if __name__ == "__main__":
    code = (
        'API_KEY = "sk-live-1234567890"\n'
        "def load():\n"
        "    try:\n"
        "        return open('a.txt').read()\n"
        "    except:\n"
        "        return ''\n"
    )
    for f in fixed_checks("app/config.py", code):
        print(f.severity, f"{f.file}:{f.line}", f.hypothesis, "| 根拠:", f.evidence[0].quote)
```

11 行目の説明にあるとおり、固定チェックは同じ入力に同じ結果を返す。規則に一致したことは事実なので、指摘は最初から `status="verified"`（確定）で作る。19 行目では、Python 標準の `ast` でコードを文の木に分解し、種類を書かない `except:` を探している。文字の検索ではなく文の構造で探すので、文字列やコメントの中の `except:` を誤って拾わない。

15 行目は見落としやすい。秘密情報を見つけたとき、根拠にその値を書き写すと、**レビュー結果そのものが秘密を広める**ことになる。根拠には変数名だけを残す。

```bash title="実行結果"
$ python fixed_checks.py
High app/config.py:1 秘密情報がコードに直書きされている | 根拠: API_KEY
Medium app/config.py:5 except: がすべての例外を握りつぶす | 根拠: except:
```

実際には、この関数を自分で書くより、使っている言語の型検査・linter・秘密情報の検出ツールを動かし、その出力を `Finding` に変換する方がよい。自分で書くのは、プロジェクト固有の規則（「この関数は必ず権限の確認を通す」など）だけで足りる。

> [!TIP] LLM には固定チェックの結果を渡しておく
> 探索型のレビュアーに、固定チェックの結果を先に渡し、「これらは指摘済みなので繰り返さない」と伝える。LLM は目に付きやすい問題に注意を取られやすいので、機械で見つかるものを先に片付けておくと、設計やロジックの問題に集中させられる。

## Severity は影響の大きさで決める

Severity（重大度）は「直さなかったら、どれだけ悪いことが起きるか」を表す。根拠の強さとは切り離して、**起きたときの影響**だけで決める。

| Severity | 基準 | 例 |
|---|---|---|
| Critical | 重大なデータ破壊、重大なセキュリティ問題 | 認証なしで他人のデータを読める。移行処理が既存のデータを消す |
| High | 本番の障害など、重大な影響 | 通常の操作で例外が出て、画面が開けなくなる |
| Medium | 特定の条件で起きる機能の不具合 | 利用者が同時に削除されたときだけエラーになる |
| Low | 保守性・可読性などの問題 | 同じ処理が 3 か所に重複している |
| Info | 参考情報・改善提案 | 標準ライブラリに同じ機能がある |

段階の数はチームで決めてよい。たとえば Cloudflare が公開した社内の AI レビューでは、3 段で運用している。

| Cloudflare の 3 段 | 意味 | この記事の 5 段との対応 |
|---|---|---|
| critical | 障害を起こす、悪用できる | Critical・High |
| warning | 具体的なリスクがある | Medium |
| suggestion | 改善の提案 | Low・Info |

LLM に Severity を付けさせると、読みにくさや命名の問題に High を付けることがある。そこで、**観点ごとに上限を決め、プログラムで頭打ちにする**。これは次のコードの前半に入れた。

## Confidence は「どこまで確かめたか」で決める

Confidence（確信度）は「その指摘がどれだけ確かか」を表す。Severity が High でも、根拠が弱ければ人は慎重に読むべきだし、Low でも確実なら迷わず直せる。2 つを分けると、読む人が優先順位を付けやすくなる。

ここで、確信度を**LLM に自己申告させてはいけない**。LLM が言葉で述べる確信度は実際の正答率と合っておらず、自信たっぷりに間違えることがある、と研究で報告されている（参考文献）。代わりに、第 1 回で作った検証を**どこまで通ったか**で機械的に決める。

| Confidence | 条件 |
|---|---|
| High | 実行やテストで再現した、固定チェックで検出した、または根拠を照合し反証を探しても見つからなかった |
| Medium | 根拠は照合できたが、反証をまだ探していない |
| Low | 根拠は照合できたが、反証の候補が見つかっている |
| （出さない） | 根拠を照合できない |

```python title="grading.py" caption="Severity を観点の上限で頭打ちにし、Confidence を検証の深さで決め、人が読む分類に直す" {4,11,15,30}
from finding import Finding  # 指摘の入れ物

SEVERITY = ["Info", "Low", "Medium", "High", "Critical"]  # 影響の小さい順
CAP = {"readability": "Low", "maintainability": "Low", "style": "Info"}  # ★ 観点ごとの上限


def cap_severity(f: Finding) -> str:
    """LLM が付けた Severity を、観点ごとの上限で頭打ちにする。"""
    limit = CAP.get(f.category, "Critical")  # 上限の無い観点は Critical まで
    if SEVERITY.index(f.severity) > SEVERITY.index(limit):  # 上限を超えていたら
        return limit  # ★ 「読みにくい」を High にはさせない
    return f.severity


def decide_confidence(f: Finding, evidence_ok: bool, counter_searched: bool,
                      reproduced: bool = False) -> str:
    """★ Confidence を、LLM の自己申告ではなく「どこまで確かめたか」で決める。"""
    counters = [e for e in f.evidence if e.role == "counter"]  # 反証の根拠
    if not evidence_ok:
        return "None"  # 根拠が照合できない。そもそも出さない
    if reproduced:
        return "High"  # テストや実行で再現できた、または固定チェックで検出した
    if counter_searched and not counters:
        return "High"  # 反証を探したが、見つからなかった
    if counters:
        return "Low"  # 反証の候補がある。人が確かめる必要がある
    return "Medium"  # 根拠はあるが、反証をまだ探していない


def label(severity: str, confidence: str) -> str:
    """★ 人が読む分類に直す。事実と推測を、見た目で区別できるようにする。"""
    if severity == "Info":
        return "改善提案"
    return {"High": "確実な問題", "Medium": "可能性が高い問題", "Low": "要確認"}[confidence]


if __name__ == "__main__":
    from finding import Evidence
    f = Finding("user.name でエラーになる", "app/profile.py", 5, "logic", severity="High",
                evidence=[Evidence("app/profile.py", 5, "user.name"),
                          Evidence("app/api.py", 4, "if not user_exists", role="counter")])
    c = decide_confidence(f, evidence_ok=True, counter_searched=True)
    print(cap_severity(f), c, label(cap_severity(f), c))
    g = Finding("変数名が短すぎる", "app/user.py", 2, "readability", severity="High",
                evidence=[Evidence("app/user.py", 2, "row")])
    c = decide_confidence(g, evidence_ok=True, counter_searched=True)
    print(cap_severity(g), c, label(cap_severity(g), c))
```

4 行目の `CAP` が観点ごとの上限だ。可読性と保守性は Low まで、書き方の好みに近い `style` は Info までにしている。11 行目で、上限を超えた Severity を頭打ちにする。

15 行目の `decide_confidence` は、引数に LLM の意見を一切取らない。受け取るのは「根拠を照合できたか」「反証を探したか」「再現したか」という、検証の記録だけだ。30 行目の `label` で、人が読む 4 つの分類に直す。

```bash title="実行結果"
$ python grading.py
High Low 要確認
Low High 確実な問題
```

1 つ目は第 1 回の `None` の指摘だ。Severity は High のままだが、呼び出し元に守りの行（反証の候補）があるので、Confidence は Low、分類は「要確認」になった。2 つ目の「変数名が短すぎる」は、LLM が付けた High が Low に頭打ちされた。一方で、根拠は確かなので Confidence は High だ。**「重いが不確か」と「軽いが確か」を区別できる**のが、2 つの軸に分ける効果だ。

## 事実と推測を 4 つに仕分ける

Severity と Confidence の組み合わせから、人に見せる分類を決める。

| 分類 | 条件 | 読む人に期待すること |
|---|---|---|
| 確実な問題 | Confidence が High | 直す。直さないなら理由を残す |
| 可能性が高い問題 | Confidence が Medium | 根拠を読み、成立するかを判断する |
| 要確認 | Confidence が Low | 反証の候補と見比べて判断する。質問の形で出す |
| 改善提案 | Severity が Info | 余裕があれば検討する。今回の変更で直さなくてよい |

**根拠が弱いものを、確実な問題として扱わない。** これを守るには、分類を表示の最初に出すことだ。Severity だけを先頭に大きく出すと、「High・要確認」が「High」として読まれてしまう。

```text title="表示の例" caption="分類・Severity・Confidence を 1 行目にまとめ、根拠と反証を並べて見せる"
[要確認] Severity: High / Confidence: Low
app/profile.py:5  get_user が None を返したとき、user.name でエラーになる

根拠:
- app/profile.py:5  return user.name
- app/user.py:3     return row  # 見つからなければ None
反証の候補:
- app/api.py:4      if not user_exists(req.user_id):
確認してほしいこと:
- user_exists と db.find の間に利用者が削除される可能性は、仕様上ありうるか
```

「確認してほしいこと」は、要確認の指摘で特に大事だ。何を判断すれば結論が出るのかを書いておくと、読む人は仕様を確かめるだけで済む。

## 指摘しない条件を書いておく

レビュアーに「何を見るか」を伝えるのと同じくらい、「**何を指摘しないか**」を伝えることが大事だ。Cloudflare の AI レビューも、各レビュアーの指示に「何を無視するか」を明記していると公開している。挙げられているのは、ありそうにない前提が要る理論上のリスク、主な防御がすでにあるときの多層防御の提案、変更で触れていないコード、一般的な改善の提案だ。

原則として指摘しないものを並べる。

| 指摘しない条件 | 理由 |
|---|---|
| 変更と無関係な問題 | 今回の変更の判断に使えない。別の作業として扱う |
| 既存のコードにあるだけの問題 | 変更した人の責任ではない。まとめて別に直す |
| 仕様として意図された挙動 | 第 1 回のとおり、仕様が最上位 |
| 単なる好み、個人的なコーディングスタイル | 規約に書かれていなければ、判断の基準がない |
| 根拠のない改善提案 | 仕様にも計測にも基づかない提案は、読む時間の方が高くつく |

これを、LLM への指示だけでなく**プログラムの条件としても持つ**。指示だけだと、LLM はときどき破るからだ。

```python title="suppress.py" caption="指摘しない条件に当てはまれば、その理由を返す" {9,10,12,14}
from finding import Finding  # 指摘の入れ物

TASTE = {"style", "naming", "formatting"}  # 好みが分かれやすい観点


def suppress_reason(f: Finding, changed: dict[str, set[int]], affected: set[str],
                    intended: set[tuple[str, str]]) -> str | None:
    """指摘しない条件に当てはまれば、その理由を返す。当てはまらなければ None。"""
    touched = f.line in changed.get(f.file, set())  # 変更した行そのものか
    if not touched and f.file in changed:  # ★ 変更したファイルの、触っていない行
        return "既存コードにあるだけ"
    if not touched and f.file not in affected:  # ★ 変更した行でも、影響範囲でもない
        return "変更と無関係"
    if (f.file, f.category) in intended:  # ★ 仕様で「意図した挙動」と決めてある
        return "仕様として意図された挙動"
    if f.category in TASTE and not f.spec_ref:  # 規約（仕様）に書かれていない好み
        return "好みの問題"
    if f.severity == "Info" and not f.spec_ref:  # 仕様にも計測にも基づかない提案
        return "根拠のない改善提案"
    return None  # どれにも当てはまらない＝指摘として残す


if __name__ == "__main__":
    changed = {"app/profile.py": {5}}  # 今回の変更: profile.py の 5 行目だけ
    affected = {"app/api.py"}  # 影響範囲の調査で見つかった、変更の外のファイル
    intended = {("app/api.py", "error-handling")}  # 仕様: 「存在しない利用者は 404」と決めてある
    cases = [
        Finding("user.name でエラー", "app/profile.py", 5, "logic"),
        Finding("404 ではなく例外にすべき", "app/api.py", 5, "error-handling"),
        Finding("db.find が遅い", "app/user.py", 2, "performance"),
        Finding("変数名 row は曖昧", "app/profile.py", 5, "naming", severity="Low"),
    ]
    for f in cases:
        print(f"{f.hypothesis} → {suppress_reason(f, changed, affected, intended) or '残す'}")
```

9 行目で、指摘の行が今回変更した行かを調べる。10〜13 行目が「変更と無関係」「既存コードにあるだけ」の判定だ。ただし、第 1 回で調べた**影響範囲のファイル**（`affected`）は、変更していなくても残す。変更が呼び出し元を壊すことはあるからだ。14 行目の `intended` は、仕様書の「意図した挙動」から作る一覧で、ここでは「`api.py` のエラー処理は仕様で決めてある」という 1 件を入れた。

```bash title="実行結果"
$ python suppress.py
user.name でエラー → 残す
404 ではなく例外にすべき → 仕様として意図された挙動
db.find が遅い → 変更と無関係
変数名 row は曖昧 → 好みの問題
```

関数が `None` ではなく**理由の文字列**を返すのは、落とした指摘とその理由を記録に残すためだ。記録があれば、条件が厳しすぎて本物の問題まで落としていないかを後から確かめられる。第 3 回では、この記録をレビューの知識として次回に生かす。

> [!WARNING] 「指摘しない」は「調べない」ではない
> 変更と無関係な重大な問題（たとえば既存コードに SQL インジェクションがある）を見つけたとき、黙って捨ててはいけない。今回のレビューの指摘からは外し、別の作業（課題票など）として人に知らせる。指摘しない条件は、レビューのノイズを減らすためのもので、見つけた危険を隠すためのものではない。

## 第 2 回のチェックリスト

| 確かめること | 対応する仕組み |
|---|---|
| 観点を先に決め、レビュアーに渡している | 観点の表 |
| 規則で書けるものはツールに任せ、結果を指摘と同じ形にそろえている | `fixed_checks` |
| 根拠に秘密情報そのものを書き写していない | `Evidence.quote` に変数名だけ |
| Severity を観点ごとの上限で頭打ちにしている | `cap_severity` |
| Confidence を LLM の自己申告ではなく、検証の記録から決めている | `decide_confidence` |
| 分類（確実・可能性高・要確認・提案）を表示の最初に出している | `label` |
| 指摘しない条件をプログラムでも持ち、落とした理由を記録している | `suppress_reason` |

ここまでは、1 体のレビュアーが出した指摘を扱ってきた。次回「[レビュアーを増やしても品質は上がらない](2026-09-29-review-agent-3-architecture.html)」では、専門のレビュアーを複数並べ、結果を統合役（Aggregator）と疑い直す役（Critic）でふるいにかける構成を作る。

## 参考文献

情報はすべて 2026-09-29 時点で確認した。

- Cloudflare, [Orchestrating AI Code Review at scale](https://blog.cloudflare.com/ai-code-review/)（2026-04-20）
- [Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution](https://arxiv.org/abs/2508.06225)（2025-08）
- minewo, [AIコードレビューを仕組みにする: 指摘の分類・記録・改善の回し方](https://zenn.dev/minewo/articles/ai-code-review-feedback-ops)（Zenn, 2026-04-29）
- Tsutomu_eng, [AIによるレビュー精度を保つ方法](https://qiita.com/Tsutomu_eng/items/d40f674449298a5ee6ce)（Qiita, 2026-08）
