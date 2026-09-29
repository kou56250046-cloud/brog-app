// content/articles の Markdown を読み込み、サイト全体のデータモデルを組み立てる
// url はすべてサイトルートからの相対パス（先頭の "/" なし）。出力時に rel() で各ページからの相対へ直す。
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { stripMarkdown } from "./markdown.mjs";
import { slugify } from "./util.mjs";

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, "content", "articles");

/** 1 分あたりの想定読字数（日本語の技術文。コードは別に加算） */
const CHARS_PER_MINUTE = 500;
/** コード 1 行を読むのにかかる秒数 */
const SECONDS_PER_CODE_LINE = 4;

export const LEVELS = {
  basic: { label: "入門", order: 1 },
  practice: { label: "実践", order: 2 },
  advanced: { label: "発展", order: 3 },
};

function toArray(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function measure(content) {
  const text = stripMarkdown(content).replace(/\s/g, "");
  const codeLines = (content.match(/```[\s\S]*?```/g) || []).reduce((n, b) => n + b.split("\n").length - 2, 0);
  const minutes = text.length / CHARS_PER_MINUTE + (codeLines * SECONDS_PER_CODE_LINE) / 60;
  return { chars: text.length, codeLines, minutes: Math.max(1, Math.round(minutes)) };
}

function loadArticles() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const { data, content } = parseFrontmatter(fs.readFileSync(path.join(ARTICLES_DIR, f), "utf8"));
      const levels = toArray(data.level).filter((l) => LEVELS[l]);
      return {
        slug,
        url: `articles/${slug}.html`,
        title: String(data.title ?? slug),
        description: String(data.description ?? ""),
        date: String(data.date ?? ""),
        updated: data.updated ? String(data.updated) : "",
        category: String(data.category ?? "未分類"),
        tags: toArray(data.tags),
        levels: levels.length ? levels : ["basic"],
        series: data.series ? String(data.series) : "",
        status: String(data.status ?? "draft"),
        content,
        ...measure(content),
      };
    })
    .filter((a) => a.status === "published")
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? 1 : -1));
}

function countBy(items, pick) {
  const map = new Map();
  for (const item of items) {
    for (const key of [].concat(pick(item)).filter(Boolean)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
}

/** サイト全体のデータを一度だけ組み立てる */
export function loadSite(site) {
  const articles = loadArticles();
  const catMeta = site.categories ?? {};

  const categories = countBy(articles, (a) => a.category).map(([name, count]) => {
    const meta = catMeta[name] ?? {};
    return {
      name,
      count,
      slug: meta.slug ?? slugify(name),
      description: meta.description ?? "",
      color: meta.color ?? "",
      url: `categories/${meta.slug ?? slugify(name)}.html`,
    };
  });

  const tags = countBy(articles, (a) => a.tags).map(([name, count]) => ({
    name,
    count,
    slug: slugify(name),
    url: `tags/${slugify(name)}.html`,
  }));

  const catByName = new Map(categories.map((c) => [c.name, c]));
  const tagByName = new Map(tags.map((t) => [t.name, t]));

  const lastUpdated = articles.map((x) => x.updated || x.date).sort().pop() ?? "";

  return {
    articles,
    categories,
    tags,
    catByName,
    tagByName,
    stats: {
      articleCount: articles.length,
      categoryCount: categories.length,
      tagCount: tags.length,
      totalMinutes: articles.reduce((n, x) => n + x.minutes, 0),
      lastUpdated,
    },
  };
}

/** 同じシリーズ → 同じカテゴリー → 共通タグの順で関連記事を選ぶ */
export function relatedArticles(target, articles, limit = 3) {
  return articles
    .filter((a) => a.slug !== target.slug)
    .map((a) => {
      const shared = a.tags.filter((t) => target.tags.includes(t)).length;
      const series = target.series && a.series === target.series ? 5 : 0;
      return { article: a, score: series + (a.category === target.category ? 3 : 0) + shared };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.article.date < b.article.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.article);
}
