#!/usr/bin/env node
/**
 * scripts/sync-substack.js
 *
 * Pulls bozelli.substack.com/feed and:
 *   1. Builds/updates individual article pages (insights/<slug>.html)
 *   2. Builds/updates series pages    (insights/series/<series-slug>.html)
 *   3. Rebuilds the hub               (insights.html)
 *
 * Series vs. orphan distinction:
 *   - Any slug listed in a series.posts array → series article
 *   - Any slug NOT listed anywhere            → orphan article
 *
 * series.json optional field per series:
 *   "hasIntro": true  → index 0 labeled "Intro", rest Part I, II…
 *                        Default: false (all labeled Part I, II…)
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

// article page

function buildArticlePage(post, template) {
  const html = template
    .replace(/{{TITLE}}/g,        esc(post.title))
    .replace(/{{DEK}}/g,          esc(post.dek))
    .replace(/{{SECTION}}/g,      esc(post.section))
    .replace(/{{READTIME}}/g,     String(post.readTime))
    .replace(/{{PUBDATE}}/g,      fmtDate(post.pubDate))
    .replace(/{{SUBSTACK_URL}}/g, post.substackUrl)
    .replace(/{{CANONICAL_URL}}/g,`${SITE_URL}/insights/${post.slug}.html`)
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
`        <a href="insights/series/${series.slug}.html" class="hub-series-tile" style="background:${color.bg};">
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
`        <a href="insights/${p.slug}.html" class="hub-orphan-tile" style="background:${ORPHAN_COLOR.bg};">
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

  const src    = fs.readFileSync(HUB_PATH,"utf8");
  const marker = /<!-- INSIGHTS_GRID:START -->[\s\S]*?<!-- INSIGHTS_GRID:END -->/;
  if (!marker.test(src)) { console.warn("INSIGHTS_GRID markers missing."); return; }
  fs.writeFileSync(HUB_PATH, src.replace(marker,`<!-- INSIGHTS_GRID:START -->\n${block}      <!-- INSIGHTS_GRID:END -->`));
  console.log("Rebuilt insights.html hub.");
}

// cross-link rewriting

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
  let   changedAny = false;

  for (const item of feed.items) {
    const slug    = slugFromLink(item.link);
    const rawHtml = item.fullContent || item.content || "";
    if (!rawHtml) { console.warn(`Skipping "${item.title}" — no content.`); continue; }

    const contentHash = hashOf(item.title+"|"+rawHtml);
    const existing    = bySlug.get(slug);
    if (existing && existing.contentHash === contentHash) continue;

    const $       = cheerio.load(rawHtml);
    cleanContent($);
    const bodyHtml  = $("body").html() ?? $.root().html() ?? rawHtml;
    const plainText = $("body").text();
    const section   = (Array.isArray(item.categories) && item.categories[0]) || item.category || DEFAULT_SECTION;
    const dek       = (item.contentSnippet||item.summary||"").split("\n")[0].trim();

    const post = {
      slug, title:item.title||"Untitled", dek, section,
      pubDate:item.isoDate||item.pubDate||new Date().toISOString(),
      substackUrl:item.link, readTime:readTime(plainText),
      imageUrl:extractImageUrl(item), contentHash, bodyHtml,
    };
    bySlug.set(slug,post);
    changedAny = true;

    buildArticlePage(post, articleTemplate);
    console.log(`${existing?"Updated":"Built"} insights/${slug}.html`);
  }

  const allPosts = Array.from(bySlug.values());
  manifest.posts = allPosts.map(({bodyHtml:_,...rest})=>rest);
  saveManifest(manifest);

  // Always rebuild series pages and hub (covers series.json edits between syncs)
  const config    = loadSeriesConfig();
  const bySlugMap = new Map(allPosts.map(p=>[p.slug,p]));
  (config.series||[]).forEach((series,i) => {
    const posts = (series.posts||[]).map(s=>bySlugMap.get(s)).filter(Boolean);
    if (posts.length) buildSeriesPage(series,posts,i);
  });

  rewriteAllCrossLinks(new Set(allPosts.map(p=>p.slug)));
  rebuildHub(allPosts);

  if (!changedAny) console.log("No content changes since last sync.");
}

run().catch(err=>{ console.error("Sync failed:",err); process.exitCode=1; });