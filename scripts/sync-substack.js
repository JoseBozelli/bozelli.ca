#!/usr/bin/env node
/**
 * scripts/sync-substack.js
 *
 * Pulls bozelli.substack.com/feed and:
 *   1. Builds/updates individual article pages (insights/<slug>.html)
 *   2. Builds/updates series pages    (insights/series/<series-slug>.html)
 *   3. Rebuilds the hub               (insights.html)
 *   4. Rebuilds the Home featured module (index.html), driven by
 *      "featured" / "featuredQuestion" / "secondary" in posts.json
 *
 * Series vs. orphan distinction:
 *   - Any slug listed in a series.posts array → series article
 *   - Any slug NOT listed anywhere            → orphan article
 *
 * series.json optional field per series:
 *   "hasIntro": true  → index 0 labeled "Intro", rest Part I, II…
 *                        Default: false (all labeled Part I, II…)
 *
 * posts.json top-level fields (in addition to "posts"):
 *   "featured"           → slug of the article to feature on Home
 *   "featuredQuestion"   → EN "Currently investigating" question shown
 *                          above the featured story on Home
 *   "featuredQuestionPt" → PT translation of the above
 *   "secondary"          → array of up to 3 slugs shown as the smaller
 *                          cards below the featured story on Home
 *   Per-post optional fields:
 *   "dekPt"               → PT translation of that post's dek, used
 *                            when the post appears as featured/secondary
 *   "localImage"           → path to a self-hosted image (e.g.
 *                            "assets/img/<slug>.png"), preferred
 *                            over "imageUrl" (the Substack CDN hotlink)
 *                            when building the Home featured module —
 *                            self-hosted images avoid CDN hotlink
 *                            protection degrading resolution. For dense
 *                            multi-panel diagrams, point this at a
 *                            cropped "<slug>-card.png" detail instead of
 *                            the full diagram — the full version reads
 *                            fine at article width but becomes illegible
 *                            shrunk into a Home card.
 *   series.json optional field per series:
 *   "titlePt"              → PT translation of the series title, used
 *                            as the series label on Home when featured
 *   To change what Home foregrounds, edit the fields above and
 *   re-run this script — do not hand-edit the HOME_FEATURED markers
 *   in index.html, they get overwritten on every sync. If a PT field
 *   is missing, the script falls back to "[PT translation pending]"
 *   (or the English text for series labels) rather than failing.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");
const cheerio = require("cheerio");

const FEED_URL        = "https://bozelli.substack.com/feed";
const SITE_URL        = "https://bozelli.ca";
const DEFAULT_SECTION = "Lipids, Data & Life";

const ROOT             = path.join(__dirname, "..");
const MANIFEST_PATH    = path.join(ROOT, "insights/_data/posts.json");
const ARTICLE_TPL_PATH = path.join(ROOT, "insights/_template/article-template.html");
const SERIES_TPL_PATH  = path.join(ROOT, "insights/_template/series-template.html");
const HUB_PATH         = path.join(ROOT, "insights.html");
const HOME_PATH        = path.join(ROOT, "index.html");
const HUB_PATH_PT      = path.join(ROOT, "pt/insights.html");
const HOME_PATH_PT     = path.join(ROOT, "pt/index.html");
const EXPLORE_PATH     = path.join(ROOT, "explore/index.html");
const EXPLORE_PATH_PT  = path.join(ROOT, "pt/explore/index.html");

const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];

const SERIES_COLORS = [
  { bg:"#f5f1ea" },
  { bg:"#eae9e3" },
  { bg:"#e9eee9" },
  { bg:"#eeeae9" },
  { bg:"#e9ecee" },
];
const ORPHAN_COLOR = { bg:"#f0ede6" };

// helpers

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { posts:[] };
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH,"utf8")); }
  catch { return { posts:[] }; }
}

function saveManifest(m) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH),{recursive:true});
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m,null,2)+"\n");
}

function slugFromLink(link) {
  const m = link.match(/\/p\/([^/?#]+)/);
  if (m) return m[1];
  const p = link.split("/").filter(Boolean);
  return p[p.length-1];
}

function hashOf(s) { return crypto.createHash("sha256").update(s||"").digest("hex"); }

function esc(s="") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function readTime(t) { return Math.max(1,Math.round(t.trim().split(/\s+/).filter(Boolean).length/200)); }

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString("en-CA",{year:"numeric",month:"long",day:"numeric"}); }
  catch { return ""; }
}

function extractImageUrl(item) {
  if (item.mediaContent) {
    const mc = Array.isArray(item.mediaContent) ? item.mediaContent[0] : item.mediaContent;
    if (mc && mc.$)   return mc.$.url || null;
    if (mc && mc.url) return mc.url;
  }
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;
  const html  = item.fullContent || item.content || "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/);
  return match ? match[1] : null;
}

function cleanContent($) {
  $([".subscribe-widget",".subscription-widget-wrap",
     ".subscription-widget-wrap-editor",".button-wrapper",
     ".comments-cta",".like-button-container",".post-ufi",
     "[data-component-name*='Subscribe']"].join(",")).remove();
  return $;
}

function loadSeriesConfig() {
  const p = path.join(ROOT,"insights/_data/series.json");
  if (!fs.existsSync(p)) return {series:[]};
  try { return JSON.parse(fs.readFileSync(p,"utf8")); }
  catch { return {series:[]}; }
}

function getPartLabel(series, index) {
  if (series.hasIntro && index === 0) return "Intro";
  const n = series.hasIntro ? index - 1 : index;
  return "Part " + (ROMAN[n] || String(n+1));
}

function findSeriesLabelForSlug(slug, seriesConfig) {
  for (const series of (seriesConfig.series || [])) {
    if ((series.posts || []).includes(slug)) return series.title;
  }
  return null;
}

function jsonEscape(str="") {
  return String(str).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g," ");
}

// Prefers a self-hosted full (non-card) image for OG/social sharing —
// falls back to the Substack CDN hotlink if assets/img/<slug>.png hasn't
// been saved locally yet.
function resolveOgImage(post) {
  const localPath = path.join(ROOT, "assets/img", `${post.slug}.png`);
  if (fs.existsSync(localPath)) return `${SITE_URL}/assets/img/${post.slug}.png`;
  if (post.imageUrl) return post.imageUrl;
  return `${SITE_URL}/assets/img/profile.jpg`;
}

// Related articles: prefer siblings in the same series; orphan posts (or
// series with no other members yet) fall back to the most recent other
// posts, capped at 3.
function computeRelatedArticles(post, bySlugMap, seriesConfig) {
  let candidates = [];
  const series = (seriesConfig.series || []).find(s => (s.posts || []).includes(post.slug));
  if (series) {
    candidates = (series.posts || [])
      .filter(slug => slug !== post.slug)
      .map(slug => bySlugMap.get(slug))
      .filter(Boolean);
  }
  if (candidates.length < 3) {
    const fallback = Array.from(bySlugMap.values())
      .filter(p => p.slug !== post.slug && !candidates.includes(p))
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    candidates = candidates.concat(fallback).slice(0, 3);
  } else {
    candidates = candidates.slice(0, 3);
  }
  return candidates.map(p => `        <a href="${p.slug}.html" class="related-card">
          <h5>${esc(p.title)}</h5>
          <p>${esc(p.dek)}</p>
        </a>`).join("\n");
}

// article page

function buildArticlePage(post, template, bySlugMap, seriesConfig) {
  const ogImage = resolveOgImage(post);
  const html = template
    .replace(/{{TITLE}}/g,        esc(post.title))
    .replace(/{{DEK}}/g,          esc(post.dek))
    .replace(/{{SECTION}}/g,      esc(post.section))
    .replace(/{{READTIME}}/g,     String(post.readTime))
    .replace(/{{PUBDATE}}/g,      fmtDate(post.pubDate))
    .replace(/{{SUBSTACK_URL}}/g, post.substackUrl)
    .replace(/{{CANONICAL_URL}}/g,`${SITE_URL}/insights/${post.slug}.html`)
    .replace(/{{OG_IMAGE}}/g,     ogImage)
    .replace(/{{TITLE_JSON}}/g,   jsonEscape(post.title))
    .replace(/{{DEK_JSON}}/g,     jsonEscape(post.dek))
    .replace(/{{DATE_ISO}}/g,     post.pubDate)
    .replace(/{{RELATED_ARTICLES}}/g, computeRelatedArticles(post, bySlugMap, seriesConfig))
    .replace("{{BODY}}",           post.bodyHtml || "");
  fs.mkdirSync(path.join(ROOT,"insights"),{recursive:true});
  fs.writeFileSync(path.join(ROOT,"insights",`${post.slug}.html`), html);
}

// series page

function buildSeriesPage(series, posts, idx) {
  if (!fs.existsSync(SERIES_TPL_PATH)) {
    console.warn(`Missing series-template.html — skipping "${series.title}".`);
    return;
  }
  const template = fs.readFileSync(SERIES_TPL_PATH,"utf8");
  const color    = SERIES_COLORS[idx % SERIES_COLORS.length];

  const articleListHtml = posts.map((p,i) => {
    const label = getPartLabel(series,i);
    return `    <a href="../${p.slug}.html" class="series-article-row">
      <div class="series-article-part">${esc(label)}</div>
      <div class="series-article-content">
        <h3 class="series-article-title">${esc(p.title)}</h3>
        ${p.dek ? `<p class="series-article-dek">${esc(p.dek)}</p>` : ""}
        <span class="series-article-meta">${p.readTime} min read · ${fmtDate(p.pubDate)}</span>
      </div>
      <div class="series-article-arrow">→</div>
    </a>`;
  }).join("\n");

  const imageData = posts
    .filter(p => p.imageUrl)
    .map((p,i) => ({
      url:        p.imageUrl,
      articleUrl: `../${p.slug}.html`,
      title:      p.title,
      label:      getPartLabel(series,i),
    }));

  const html = template
    .replace(/{{SERIES_TITLE}}/g,    esc(series.title))
    .replace(/{{SERIES_SLUG}}/g,     series.slug)
    .replace(/{{SERIES_BLURB}}/g,    esc(series.blurb||""))
    .replace(/{{ARTICLE_COUNT}}/g,   String(posts.length))
    .replace(/{{ARTICLE_LIST}}/g,    articleListHtml)
    .replace(/{{IMAGE_DATA_JSON}}/g, JSON.stringify(imageData))
    .replace(/{{CANONICAL_URL}}/g,   `${SITE_URL}/insights/series/${series.slug}.html`)
    .replace(/{{SERIES_BG}}/g,       color.bg);

  fs.mkdirSync(path.join(ROOT,"insights/series"),{recursive:true});
  fs.writeFileSync(path.join(ROOT,"insights/series",`${series.slug}.html`), html);
  console.log(`Built insights/series/${series.slug}.html`);
}

// hub

function rebuildHub(allPosts) {
  if (!fs.existsSync(HUB_PATH)) { console.warn("No insights.html — skipping hub rebuild."); return; }

  const config        = loadSeriesConfig();
  const bySlug        = new Map(allPosts.map(p=>[p.slug,p]));
  const assignedSlugs = new Set();
  let   seriesHtml    = "";
  let   orphanHtml    = "";

  (config.series||[]).forEach((series,i) => {
    const color       = SERIES_COLORS[i % SERIES_COLORS.length];
    const seriesPosts = (series.posts||[]).map(s=>bySlug.get(s)).filter(Boolean);
    seriesPosts.forEach(p => assignedSlugs.add(p.slug));
    if (!seriesPosts.length) return;
    const wm    = ROMAN[i] || String(i+1);
    const count = seriesPosts.length;
    seriesHtml +=
`        <a href="/insights/series/${series.slug}.html" class="hub-series-tile" style="background:${color.bg};">
          <div class="hub-tile-watermark">${wm}</div>
          <div class="hub-tile-eyebrow">Series · ${count} article${count!==1?"s":""}</div>
          <h3 class="hub-tile-title">${esc(series.title)}</h3>
          <p class="hub-tile-blurb">${esc(series.blurb||"")}</p>
          <span class="hub-tile-link">Browse series →</span>
        </a>\n`;
  });

  allPosts
    .filter(p => !assignedSlugs.has(p.slug))
    .sort((a,b) => new Date(b.pubDate)-new Date(a.pubDate))
    .forEach(p => {
      orphanHtml +=
`        <a href="/insights/${p.slug}.html" class="hub-orphan-tile" style="background:${ORPHAN_COLOR.bg};">
          <div class="hub-tile-eyebrow">${p.readTime} min read · ${fmtDate(p.pubDate)}</div>
          <h3 class="hub-orphan-title">${esc(p.title)}</h3>
          <p class="hub-tile-blurb">${esc(p.dek)}</p>
          <span class="hub-tile-link">Read article →</span>
        </a>\n`;
    });

  let block = "";
  if (seriesHtml) block += `      <div class="hub-series-grid">\n${seriesHtml}      </div>\n`;
  if (orphanHtml) {
    block += `      <div class="section-label" style="margin-top:64px;" data-en="Standalone articles" data-pt="Artigos avulsos">Standalone articles</div>\n`;
    block += `      <div class="hub-orphan-grid">\n${orphanHtml}      </div>\n`;
  }

  const marker = /<!-- INSIGHTS_GRID:START -->[\s\S]*?<!-- INSIGHTS_GRID:END -->/;
  const replacement = `<!-- INSIGHTS_GRID:START -->\n${block}      <!-- INSIGHTS_GRID:END -->`;

  const src = fs.readFileSync(HUB_PATH,"utf8");
  if (!marker.test(src)) { console.warn("INSIGHTS_GRID markers missing in insights.html."); }
  else { fs.writeFileSync(HUB_PATH, src.replace(marker, replacement)); console.log("Rebuilt insights.html hub."); }

  if (fs.existsSync(HUB_PATH_PT)) {
    const srcPt = fs.readFileSync(HUB_PATH_PT,"utf8");
    if (!marker.test(srcPt)) { console.warn("INSIGHTS_GRID markers missing in pt/insights.html."); }
    else { fs.writeFileSync(HUB_PATH_PT, srcPt.replace(marker, replacement)); console.log("Rebuilt pt/insights.html hub."); }
  }
}

// home featured module
//
// Driven entirely by posts.json's "featured" (slug), "featuredQuestion"
// (string), and "secondary" (array of up to 3 slugs) fields. Swapping
// what Home foregrounds — e.g. for a new EXP-### activation — is a
// three-line JSON edit followed by a sync run.
//
// Image resolution is automatic by naming convention: if
// assets/img/<slug>-card.png exists on disk, it's used with no JSON
// field required. A post's own "localImage" field, if set, always wins
// over the convention (manual override). If neither exists, this falls
// back to the raw Substack CDN hotlink (imageUrl) — which reintroduces
// the resolution/hotlinking problem, so create the -card crop before
// featuring a new article, don't rely on the fallback.
//
// PT strings are left as "[PT translation pending]" here; this script
// does not translate — fill those in posts.json (or the generated HTML)
// once confirmed.

function resolveCardImage(post) {
  if (post.localImage) return post.localImage;
  const cardPath = path.join(ROOT, "assets/img", `${post.slug}-card.png`);
  if (fs.existsSync(cardPath)) return `assets/img/${post.slug}-card.png`;
  if (post.imageUrl) {
    console.warn(`No assets/img/${post.slug}-card.png found for "${post.slug}" — falling back to Substack CDN image. Create a -card crop before featuring this article.`);
  }
  return post.imageUrl || "";
}

function buildHomeFeaturedBlock(manifest, bySlugMap, seriesConfig) {
  const featuredSlug = manifest.featured;
  const featured = featuredSlug ? bySlugMap.get(featuredSlug) : null;
  if (!featured) {
    console.warn('posts.json has no valid "featured" slug — skipping Home featured rebuild.');
    return null;
  }

  const secondarySlugs = (manifest.secondary || [])
    .filter(s => s !== featuredSlug && bySlugMap.has(s))
    .slice(0, 3);

  if (!secondarySlugs.length) {
    console.warn('posts.json has no valid "secondary" slugs — Home secondary cards will be empty.');
  }

  const seriesLabel   = findSeriesLabelForSlug(featuredSlug, seriesConfig) || featured.section || "Insights";
  const seriesLabelPt = (seriesConfig.series || []).find(s => (s.posts||[]).includes(featuredSlug))?.titlePt || seriesLabel;
  const question      = manifest.featuredQuestion   || featured.title;
  const questionPt     = manifest.featuredQuestionPt || "[PT translation pending]";

  const secondaryHtml = secondarySlugs.map((slug, i) => {
    const p = bySlugMap.get(slug);
    const delayClass = i === 0 ? "" : ` reveal-delay-${i}`;
    return `        <a href="/insights/${p.slug}.html" class="secondary-story reveal${delayClass}">
          <img class="secondary-story-img" src="${resolveCardImage(p)}" alt="${esc(p.title)}">
          <h4>${esc(p.title)}</h4>
          <p data-en="${esc(p.dek)}" data-pt="${esc(p.dekPt || "[PT translation pending]")}">${esc(p.dek)}</p>
        </a>`;
  }).join("\n");

  return `      <div class="insights-kicker reveal" data-en="Currently investigating" data-pt="Investigando atualmente">Currently investigating</div>
      <h2 class="insights-question reveal reveal-delay-1" data-en="${esc(question)}" data-pt="${esc(questionPt)}">${esc(question)}</h2>
      <span class="insights-series-tag" data-en="${esc(seriesLabel)}" data-pt="${esc(seriesLabelPt)}">${esc(seriesLabel)}</span>

      <div class="featured-story reveal reveal-delay-2">
        <img class="featured-story-img" src="${resolveCardImage(featured)}" alt="${esc(featured.title)}">
        <div class="featured-story-body">
          <div class="featured-story-label" data-en="${esc(seriesLabel)}" data-pt="${esc(seriesLabelPt)}">${esc(seriesLabel)}</div>
          <h3>${esc(featured.title)}</h3>
          <p data-en="${esc(featured.dek)}" data-pt="${esc(featured.dekPt || "[PT translation pending]")}">${esc(featured.dek)}</p>
          <a href="/insights/${featured.slug}.html" class="featured-story-link" data-en="Read →" data-pt="Ler →">Read →</a>
        </div>
      </div>

      <div class="secondary-stories">
${secondaryHtml}
      </div>

      <div class="insights-module-footer reveal">
        <a href="/insights.html" class="btn btn-outline" data-en="Explore all Insights →" data-pt="Ver todas as Reflexões →">Explore all Insights →</a>
      </div>`;
}

function rebuildHomeFeatured(manifest, allPosts, seriesConfig) {
  if (!fs.existsSync(HOME_PATH)) { console.warn("No index.html — skipping Home featured rebuild."); return; }
  const bySlugMap = new Map(allPosts.map(p => [p.slug, p]));
  const block = buildHomeFeaturedBlock(manifest, bySlugMap, seriesConfig);
  if (!block) return;

  const marker = /<!-- HOME_FEATURED:START -->[\s\S]*?<!-- HOME_FEATURED:END -->/;
  const replacement = `<!-- HOME_FEATURED:START -->\n${block}\n      <!-- HOME_FEATURED:END -->`;

  const src = fs.readFileSync(HOME_PATH,"utf8");
  if (!marker.test(src)) { console.warn("HOME_FEATURED markers missing in index.html."); }
  else { fs.writeFileSync(HOME_PATH, src.replace(marker, replacement)); console.log("Rebuilt index.html featured module."); }

  if (fs.existsSync(HOME_PATH_PT)) {
    // "Explore all Insights" should point to the PT hub here — everything
    // else (individual article links) correctly stays pointed at the
    // English articles, since no PT article translations exist.
    const replacementPt = replacement.replace('href="/insights.html"', 'href="/pt/insights.html"');
    const srcPt = fs.readFileSync(HOME_PATH_PT,"utf8");
    if (!marker.test(srcPt)) { console.warn("HOME_FEATURED markers missing in pt/index.html."); }
    else { fs.writeFileSync(HOME_PATH_PT, srcPt.replace(marker, replacementPt)); console.log("Rebuilt pt/index.html featured module."); }
  }
}

// explore page "Start Here" — single-card version of the Home featured
// module (no secondary stories), same underlying data lever:
// posts.json's "featured" field. Swapping what's on Home also swaps
// what's on /explore/ unless overridden separately (not currently
// separated — deliberate, since both are meant to spotlight the same
// current activation article).

function buildExploreFeaturedBlock(manifest, bySlugMap, seriesConfig, lang) {
  const featuredSlug = manifest.featured;
  const featured = featuredSlug ? bySlugMap.get(featuredSlug) : null;
  if (!featured) {
    console.warn('posts.json has no valid "featured" slug — skipping /explore/ featured rebuild.');
    return null;
  }
  const seriesLabel = findSeriesLabelForSlug(featuredSlug, seriesConfig) || featured.section || "Insights";
  const image = resolveCardImage(featured);
  const dek = lang === "pt" ? (featured.dekPt || featured.dek) : featured.dek;
  const readLabel = lang === "pt" ? "Ler →" : "Read →";
  const badge = lang === "pt"
    ? `<span class="lang-flag" data-en="Content in English" data-pt="Conteúdo em inglês">Conteúdo em inglês</span>`
    : "";

  return `      <div class="explore-featured-label" data-en="Currently exploring" data-pt="Investigando atualmente">${lang === "pt" ? "Investigando atualmente" : "Currently exploring"}</div>
      <a href="/insights/${featured.slug}.html" class="explore-featured-card">
        <img src="${image}" alt="${esc(featured.title)}">
        <div class="explore-featured-body">
          <span class="explore-featured-series">${esc(seriesLabel)}</span>
          <h3>${esc(featured.title)}${badge}</h3>
          <p>${esc(dek)}</p>
          <span class="explore-featured-cta">${readLabel}</span>
        </div>
      </a>`;
}

function rebuildExploreFeatured(manifest, allPosts, seriesConfig) {
  const bySlugMap = new Map(allPosts.map(p => [p.slug, p]));
  const marker = /<!-- EXPLORE_FEATURED:START -->[\s\S]*?<!-- EXPLORE_FEATURED:END -->/;

  if (fs.existsSync(EXPLORE_PATH)) {
    const block = buildExploreFeaturedBlock(manifest, bySlugMap, seriesConfig, "en");
    if (block) {
      const src = fs.readFileSync(EXPLORE_PATH, "utf8");
      if (!marker.test(src)) console.warn("EXPLORE_FEATURED markers missing in explore/index.html.");
      else { fs.writeFileSync(EXPLORE_PATH, src.replace(marker, `<!-- EXPLORE_FEATURED:START -->\n${block}\n      <!-- EXPLORE_FEATURED:END -->`)); console.log("Rebuilt explore/index.html featured card."); }
    }
  }
  if (fs.existsSync(EXPLORE_PATH_PT)) {
    const blockPt = buildExploreFeaturedBlock(manifest, bySlugMap, seriesConfig, "pt");
    if (blockPt) {
      const srcPt = fs.readFileSync(EXPLORE_PATH_PT, "utf8");
      if (!marker.test(srcPt)) console.warn("EXPLORE_FEATURED markers missing in pt/explore/index.html.");
      else { fs.writeFileSync(EXPLORE_PATH_PT, srcPt.replace(marker, `<!-- EXPLORE_FEATURED:START -->\n${blockPt}\n      <!-- EXPLORE_FEATURED:END -->`)); console.log("Rebuilt pt/explore/index.html featured card."); }
    }
  }
}



function rewriteCrossLinks(html, slugSet) {
  return html.replace(
    /https?:\/\/bozelli\.substack\.com\/p\/([a-z0-9-]+)(\?[^"'\s)]*)?/gi,
    (_,slug) => slugSet.has(slug) ? `/insights/${slug}.html` : _
  );
}

function rewriteAllCrossLinks(slugSet) {
  const dir = path.join(ROOT,"insights");
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter(f=>f.endsWith(".html")).forEach(file => {
    const fp  = path.join(dir,file);
    const src = fs.readFileSync(fp,"utf8");
    const out = rewriteCrossLinks(src,slugSet);
    if (out!==src) { fs.writeFileSync(fp,out); console.log(`Cross-links rewritten: insights/${file}`); }
  });
}

// main

async function run() {
  if (!fs.existsSync(ARTICLE_TPL_PATH)) throw new Error(`Missing article template at ${ARTICLE_TPL_PATH}`);
  const articleTemplate = fs.readFileSync(ARTICLE_TPL_PATH,"utf8");
  const templateHash    = hashOf(articleTemplate);

  const parser = new Parser({
    customFields: { item:[
      ["content:encoded","fullContent"],
      ["media:content","mediaContent"],
      ["enclosure","enclosure"],
    ]},
  });

  console.log(`Fetching ${FEED_URL} …`);
  const feed = await parser.parseURL(FEED_URL);
  console.log(`Found ${feed.items.length} item(s).`);

  const manifest   = loadManifest();
  const bySlug     = new Map(manifest.posts.map(p=>[p.slug,p]));
  const seriesConfig = loadSeriesConfig();
  let   changedAny = false;

  for (const item of feed.items) {
    const slug    = slugFromLink(item.link);
    const rawHtml = item.fullContent || item.content || "";
    if (!rawHtml) { console.warn(`Skipping "${item.title}" — no content.`); continue; }

    const contentHash = hashOf(item.title+"|"+rawHtml);
    const existing    = bySlug.get(slug);
    // Rebuild if either the article content OR the template itself
    // changed since last sync — a template edit (e.g. a sitewide link
    // fix) otherwise goes unnoticed forever, since content-only hashing
    // has no way to detect it.
    if (existing && existing.contentHash === contentHash && existing.templateHash === templateHash) continue;

    const $       = cheerio.load(rawHtml);
    cleanContent($);
    const bodyHtml  = $("body").html() ?? $.root().html() ?? rawHtml;
    const plainText = $("body").text();
    const section   = (Array.isArray(item.categories) && item.categories[0]) || item.category || DEFAULT_SECTION;
    const dek       = (item.contentSnippet||item.summary||"").split("\n")[0].trim();

    const post = {
      ...existing,
      slug, title:item.title||"Untitled", dek, section,
      pubDate:item.isoDate||item.pubDate||new Date().toISOString(),
      substackUrl:item.link, readTime:readTime(plainText),
      imageUrl:extractImageUrl(item), contentHash, templateHash, bodyHtml,
    };
    bySlug.set(slug,post);
    changedAny = true;

    buildArticlePage(post, articleTemplate, bySlug, seriesConfig);
    console.log(`${existing?"Updated":"Built"} insights/${slug}.html`);
  }

  const allPosts = Array.from(bySlug.values());
  manifest.posts = allPosts.map(({bodyHtml:_,...rest})=>rest);
  saveManifest(manifest);

  // Always rebuild series pages, hub, and Home featured module
  // (covers series.json / posts.json edits between syncs, even
  // when no new Substack content was fetched)
  const bySlugMap = new Map(allPosts.map(p=>[p.slug,p]));
  (seriesConfig.series||[]).forEach((series,i) => {
    const posts = (series.posts||[]).map(s=>bySlugMap.get(s)).filter(Boolean);
    if (posts.length) buildSeriesPage(series,posts,i);
  });

  rewriteAllCrossLinks(new Set(allPosts.map(p=>p.slug)));
  rebuildHub(allPosts);
  rebuildHomeFeatured(manifest, allPosts, seriesConfig);
  rebuildExploreFeatured(manifest, allPosts, seriesConfig);

  if (!changedAny) console.log("No content changes since last sync.");
}

run().catch(err=>{ console.error("Sync failed:",err); process.exitCode=1; });