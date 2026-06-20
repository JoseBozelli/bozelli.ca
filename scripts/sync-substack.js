#!/usr/bin/env node
/**
 * scripts/sync-substack.js
 *
 * Pulls the public RSS feed at bozelli.substack.com/feed and turns each
 * post into a styled page at insights/<slug>.html, using your own design
 * tokens and the template in insights/_template/article-template.html.
 * Also rebuilds the card grid in insights.html between the
 * INSIGHTS_GRID:START / INSIGHTS_GRID:END markers.
 *
 * No paid services, no API keys — just the free RSS feed every Substack
 * publication already has. Re-running this is always safe: unchanged
 * posts are skipped (tracked via a content hash in insights/_data/posts.json),
 * and edited posts are quietly rebuilt with the new text.
 *
 * Usage:
 *   node scripts/sync-substack.js
 * or click "Run workflow" on the "Sync Substack to Website" GitHub Action.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const cheerio = require("cheerio");

const FEED_URL = "https://bozelli.substack.com/feed";
const SITE_URL = "https://bozelli.ca";
const DEFAULT_SECTION = "Lipids, Data & Life";

const ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "insights/_data/posts.json");
const TEMPLATE_PATH = path.join(ROOT, "insights/_template/article-template.html");
const HUB_PATH = path.join(ROOT, "insights.html");

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// ── helpers ────────────────────────────────────────────────────────────

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { posts: [] };
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    console.warn("Couldn't parse existing manifest — starting fresh.");
    return { posts: [] };
  }
}

function saveManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}

function slugFromLink(link) {
  // https://bozelli.substack.com/p/the-biomarker-gold-rush -> the-biomarker-gold-rush
  const m = link.match(/\/p\/([^/?#]+)/);
  if (m) return m[1];
  const parts = link.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function hashOf(str) {
  return crypto.createHash("sha256").update(str || "").digest("hex");
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimateReadTime(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

// Strip Substack chrome that doesn't make sense duplicated inside our own
// page (its own subscribe widgets, share-button rows, "leave a comment"
// prompts). Class names below are best-guesses at Substack's current
// markup — if a real sync leaves stray widgets behind, inspect the
// fetched HTML and add the right selector here.
function cleanContent($) {
  $(
    [
      ".subscribe-widget",
      ".subscription-widget-wrap",
      ".subscription-widget-wrap-editor",
      ".button-wrapper",
      ".comments-cta",
      ".like-button-container",
      ".post-ufi",
      "[data-component-name*='Subscribe']",
    ].join(", ")
  ).remove();
  return $;
}

// ── main ───────────────────────────────────────────────────────────────

async function run() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Missing template at ${TEMPLATE_PATH}`);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");

  const parser = new Parser({
    customFields: { item: [["content:encoded", "fullContent"]] },
  });

  console.log(`Fetching ${FEED_URL} ...`);
  const feed = await parser.parseURL(FEED_URL);
  console.log(`Found ${feed.items.length} item(s) in the feed.`);

  const manifest = loadManifest();
  const bySlug = new Map(manifest.posts.map((p) => [p.slug, p]));
  let changedAny = false;

  for (const item of feed.items) {
    const slug = slugFromLink(item.link);
    const rawHtml = item.fullContent || item.content || item["content:encoded"] || "";
    if (!rawHtml) {
      console.warn(`Skipping "${item.title}" — no content found in feed item.`);
      continue;
    }

    const contentHash = hashOf(item.title + "|" + rawHtml);
    const existing = bySlug.get(slug);
    if (existing && existing.contentHash === contentHash) {
      continue; // unchanged since last sync — nothing to do
    }

    const $ = cheerio.load(rawHtml);
    cleanContent($);
    const bodyHtml = $("body").html() ?? $.root().html() ?? rawHtml;
    const plainText = $("body").text();

    const section =
      (Array.isArray(item.categories) && item.categories[0]) ||
      item.category ||
      DEFAULT_SECTION;

    const dek = (item.contentSnippet || item.summary || "").split("\n")[0].trim();

    const post = {
      slug,
      title: item.title || "Untitled",
      dek,
      section,
      pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
      substackUrl: item.link,
      readTime: estimateReadTime(plainText),
      contentHash,
    };
    bySlug.set(slug, post);
    changedAny = true;

    const pageHtml = template
      .replace(/{{TITLE}}/g, escapeHtml(post.title))
      .replace(/{{DEK}}/g, escapeHtml(post.dek))
      .replace(/{{SECTION}}/g, escapeHtml(post.section))
      .replace(/{{READTIME}}/g, String(post.readTime))
      .replace(/{{PUBDATE}}/g, formatDate(post.pubDate))
      .replace(/{{SUBSTACK_URL}}/g, post.substackUrl)
      .replace(/{{CANONICAL_URL}}/g, `${SITE_URL}/insights/${slug}.html`)
      .replace("{{BODY}}", bodyHtml);

    const outDir = path.join(ROOT, "insights");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${slug}.html`), pageHtml);
    console.log(`${existing ? "Updated" : "Built"} insights/${slug}.html`);
  }

  // Number posts "Part N" within their own section, oldest first —
  // matches how the Lipids, Data & Life series is meant to read.
  const allPosts = Array.from(bySlug.values());
  manifest.posts = allPosts;
  saveManifest(manifest);

  rewriteAllArticleCrossLinks(new Set(allPosts.map((p) => p.slug)));

  if (changedAny) {
    rebuildHub(allPosts);
    console.log("Rebuilt insights.html grid.");
  } else {
    console.log("No changes since last sync — nothing to rebuild.");
  }
}

function loadSeriesConfig() {
  const seriesPath = path.join(ROOT, "insights/_data/series.json");
  if (!fs.existsSync(seriesPath)) return { series: [] };
  try {
    return JSON.parse(fs.readFileSync(seriesPath, "utf8"));
  } catch {
    console.warn("Couldn't parse series.json — treating as empty.");
    return { series: [] };
  }
}

function renderCard(p, partLabel) {
  return `        <div class="insight-card reveal">
          <div class="insight-eyebrow">${partLabel ? `Part ${partLabel} <span class="dot"></span> ` : ""}${escapeHtml(p.section || "")}</div>
          <h3>${escapeHtml(p.title)}</h3>
          <p class="teaser">${escapeHtml(p.dek)}</p>
          <div class="insight-meta">${p.readTime} MIN READ · PUBLISHED</div>
          <a href="insights/${p.slug}.html" class="insight-link">Read the full piece →</a>
        </div>`;
}

function rebuildHub(posts) {
  if (!fs.existsSync(HUB_PATH)) {
    console.warn(`No insights.html found at ${HUB_PATH} — skipping hub rebuild.`);
    return;
  }
  const config = loadSeriesConfig();
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const assignedSlugs = new Set();
  let blocks = "";

  for (const series of config.series || []) {
    const seriesPosts = (series.posts || []).map((slug) => bySlug.get(slug)).filter(Boolean);
    seriesPosts.forEach((p) => assignedSlugs.add(p.slug));
    if (!seriesPosts.length) continue;

    const cards = seriesPosts.map((p, i) => renderCard(p, ROMAN[i] || String(i + 1))).join("\n");
    blocks += `      <div class="series-block">
        <div class="section-label">${escapeHtml(series.title)}</div>
        ${series.blurb ? `<p class="series-blurb">${escapeHtml(series.blurb)}</p>` : ""}
        <div class="insights-grid">
${cards}
        </div>
      </div>
`;
  }

  const unassigned = posts
    .filter((p) => !assignedSlugs.has(p.slug))
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  if (unassigned.length) {
    const cards = unassigned.map((p) => renderCard(p, null)).join("\n");
    blocks += `      <div class="series-block">
        <div class="section-label">Just published</div>
        <p class="series-blurb">Not yet assigned to a series — add the slug to insights/_data/series.json.</p>
        <div class="insights-grid">
${cards}
        </div>
      </div>
`;
  }

  const hubHtml = fs.readFileSync(HUB_PATH, "utf8");
  const markerPattern = /<!-- INSIGHTS_GRID:START -->[\s\S]*?<!-- INSIGHTS_GRID:END -->/;
  if (!markerPattern.test(hubHtml)) {
    console.warn("Couldn't find INSIGHTS_GRID markers — skipping hub rebuild.");
    return;
  }
  const updated = hubHtml.replace(markerPattern, `<!-- INSIGHTS_GRID:START -->\n${blocks}      <!-- INSIGHTS_GRID:END -->`);
  fs.writeFileSync(HUB_PATH, updated);
}

function rewriteCrossLinksInHtml(html, slugSet) {
  const pattern = /https?:\/\/bozelli\.substack\.com\/p\/([a-z0-9-]+)(\?[^"'\s)]*)?(#[^"'\s)]*)?/gi;
  return html.replace(pattern, (match, slug) =>
    slugSet.has(slug) ? `/insights/${slug}.html` : match
  );
}

function rewriteAllArticleCrossLinks(slugSet) {
  const dir = path.join(ROOT, "insights");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const original = fs.readFileSync(filePath, "utf8");
    const updated = rewriteCrossLinksInHtml(original, slugSet);
    if (updated !== original) {
      fs.writeFileSync(filePath, updated);
      console.log(`Rewrote cross-links in insights/${file}`);
    }
  }
}

run().catch((err) => {
  console.error("Sync failed:", err);
  process.exitCode = 1;
});
