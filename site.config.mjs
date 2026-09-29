// サイト全体の設定。ここだけ書き換えれば他は追従する。
export default {
  title: "Dev Knowledge Base",
  /** ホーム画面に追加したときの短い名前 */
  short: "DevKB",
  tagline: "作って、分解して、理解する。",
  description: "AI・設計・開発ツールを、図とコードで基礎から発展まで解説するエンジニアの学習ノート",
  /** 公開 URL（GitHub Pages）。RSS・サイトマップ・OGP・404 にだけ使う。ページ内リンクは相対パス */
  url: "https://kou56250046-cloud.github.io/brog-app",
  lang: "ja",
  /** GitHub リポジトリの URL（フッターに出す。空なら出さない） */
  repo: "https://github.com/kou56250046-cloud/brog-app",
  /**
   * カテゴリーの表示設定。記事の category と同じ名前をキーにする。
   * slug はファイル名（英小文字とハイフン）。未登録のカテゴリーは名前から自動で作る
   */
  categories: {
    AIエージェント: { slug: "ai-agents", color: "#3b4cca", description: "LLM を使って自律的に動くシステムの仕組みと作り方" },
    "LLM・生成AI": { slug: "llm", color: "#7a3fb8", description: "モデルの性質、プロンプト、評価" },
    "設計・アーキテクチャ": { slug: "architecture", color: "#1f7a6d", description: "システムとコードの組み立て方" },
    開発ツール: { slug: "tools", color: "#b5651d", description: "エディタ・CLI・CI など日々の道具" },
  },
};
