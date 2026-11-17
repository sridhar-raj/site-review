#!/usr/bin/env node
// seo-check.mjs: what search engines, share cards and AI agents get from a page, measured on three layers:
// the raw HTML (no JS, what most crawlers and agents see), the rendered DOM (Playwright) and HTTP (status,
// headers, redirects). Websites only; an app screen behind a login has no use for it.
//
//   node seo-check.mjs <url | file.html> [--out .review] [--crawl N] [--storage state.json] [--cookie "a=1"]
//
// Per page: status and redirect hops, soft 404, noindex/nofollow (meta, googlebot, X-Robots-Tag; raw vs
// rendered), canonical (count, absolute, self, resolves), title and description (generic, lengths), head and
// main content present in the raw HTML (h1, prices, h2s, JSON-LD, og tags), h1 with no text, generic
// headings and anchors, `#`/javascript: links, internal links that 404 or redirect, camera-style image names,
// viewport, mixed content, URL shape. JSON-LD: parse, @graph, required and recommended fields per @type,
// absolute URLs, ISO dates, enums, conflicting blocks, retired rich results, and facts (price, rating,
// review count, author) that aren't in the page text. Share card: og:image absolute, fetched, its type, size
// and pixel dimensions; og:url = canonical; twitter:card. hreflang: codes, self entry, canonical in the set,
// each alternate fetched (status, noindex, points back).
// Site, once (URLs only): robots.txt (status, Disallow: /, page or its CSS/JS blocked, named groups that drop
// the wildcard's disallows, Sitemap:, AI bots by purpose), the sitemap (XML, index, absolute <loc>s, ≤ 50
// sampled for status, redirects, noindex and canonical, lastmod), a random path that must 404, host and
// slash variants (public hosts), llms.txt (info only).
// --crawl N   also check up to N more pages of the same site, breadth first from the target: duplicate titles,
//             descriptions and h1s, click depth, and sitemap URLs never linked (when the whole site was seen).
//
// On localhost the site is usually configured for production (metadataBase), so absolute URLs on another host
// are compared by path and fetched from the local server. A file target has no server: robots.txt, sitemap,
// the 404 probe, link HEADs, share-card and hreflang fetches are skipped (said as info).
// Every finding's detail starts with its evidence: [raw], [rendered], [HTTP] or [site].

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { newContext, parseArgs, toUrl, loadChromium, outDir, settle, Findings } from "./lib.mjs";

const { opt, target } = parseArgs(["--out", "--crawl"]);
if (!target) { console.error("usage: seo-check.mjs <url | file.html> [--out .review] [--crawl N] [--storage state.json] [--cookie a=1]"); process.exit(2); }
const startUrl = toUrl(target);
const out = outDir(opt("--out", ".review"));
const crawlN = Math.max(0, Number(opt("--crawl", 0)) || 0);
const isFile = startUrl.startsWith("file:");
const F = new Findings("seo");
const t0 = Date.now();

// ── hosts, fetch ────────────────────────────────────────────────────────────

const LOCAL = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|::1|.+\.local|.+\.localhost)$/i;
const isLocalHost = (h) => LOCAL.test(h);
const origin = isFile ? null : new URL(startUrl).origin;
const pageLocal = isFile || isLocalHost(new URL(startUrl).hostname);
const PREVIEW = /(\.vercel\.app|\.netlify\.app|\.pages\.dev|staging\.|preview\.|\.ngrok)/i;
/** On localhost, a production URL is fetched from the local server (same path): metadataBase points elsewhere. */
const localize = (u) => { try { const x = new URL(u); return !isFile && pageLocal && /^https?:$/.test(x.protocol) && !isLocalHost(x.hostname) ? origin + x.pathname + x.search : x.href; } catch { return u; } };
const normPath = (p) => { const s = decodeURIComponent(p || "/").replace(/\/index\.html?$/i, "/").replace(/\.html?$/i, "").replace(/\/+$/, ""); return s || "/"; };
const pathOf = (u) => { try { return normPath(new URL(u).pathname); } catch { return null; } };
const fileStem = (u) => normPath("/" + basename(new URL(u).pathname));
/** Same page? On local or file targets the host is not compared (canonical points at production). */
const samePage = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    if (x.protocol === "file:" || y.protocol === "file:") return fileStem(x.href) === fileStem(y.href);
    if (!pageLocal && x.host !== y.host) return false;
    return normPath(x.pathname) === normPath(y.pathname) && x.search === y.search;
  } catch { return false; }
};

const UA = "Mozilla/5.0 (compatible; site-review-seo-check)";
function cookieFor(u) {
  const argv = process.argv.slice(2); const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const parts = [];
  try {
    const host = new URL(u).hostname;
    if (val("--cookie") && origin && new URL(origin).hostname === host) parts.push(val("--cookie"));
    if (val("--storage")) for (const c of JSON.parse(readFileSync(resolve(val("--storage")), "utf8")).cookies || []) if (host === c.domain.replace(/^\./, "") || host.endsWith(c.domain.startsWith(".") ? c.domain : "." + c.domain)) parts.push(`${c.name}=${c.value}`);
  } catch {}
  return parts.join("; ");
}
const cache = new Map();
/** Follows redirects by hand so every hop is seen. HEAD falls back to GET where HEAD isn't allowed. */
function http(u, { method = "GET", maxBytes = 12e6 } = {}) {
  const key = method + " " + u;
  if (!cache.has(key)) cache.set(key, (async () => {
    const chain = []; let cur = u; let m = method;
    for (let hop = 0; hop < 8; hop++) {
      let res;
      try { res = await fetch(cur, { method: m, redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*", ...(cookieFor(cur) ? { cookie: cookieFor(cur) } : {}) }, signal: AbortSignal.timeout(15000) }); }
      catch (e) { return { error: String(e.cause?.code || e.message).split("\n")[0], chain, url: cur }; }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { chain.push({ status: res.status, url: cur }); await res.body?.cancel(); cur = new URL(loc, cur).href; continue; }
      if (m === "HEAD" && (res.status === 405 || res.status === 501 || res.status === 403)) { await res.body?.cancel(); m = "GET"; hop--; continue; }
      let buf = null;
      if (m === "GET") { const ab = await res.arrayBuffer().catch(() => null); buf = ab ? Buffer.from(ab).subarray(0, maxBytes) : null; }
      else await res.body?.cancel();
      return { status: res.status, headers: res.headers, chain, url: cur, buf, text: buf ? buf.toString("utf8") : "", type: res.headers.get("content-type") || "", length: Number(res.headers.get("content-length")) || (buf ? buf.length : 0) };
    }
    return { error: "more than 8 redirects (a loop?)", chain, url: cur };
  })());
  return cache.get(key);
}

// ── raw HTML (a small regex parser: enough for the head, h1, JSON-LD and the text) ──

const decode = (s) => String(s).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|#39);/gi, (m, e) => {
  const l = e.toLowerCase();
  if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : Number(l.slice(1)));
  return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[l] ?? m;
});
const attrs = (s) => { const o = {}; for (const m of String(s).matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) o[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? ""); return o; };
const toText = (h) => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function parseRaw(html) {
  const jsonld = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (/ld\+json/i.test(attrs(m[1]).type || "")) jsonld.push(m[2]);
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<template\b[\s\S]*?<\/template>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const metas = [...clean.matchAll(/<meta\b([^>]*)>/gi)].map((m) => attrs(m[1]));
  const links = [...clean.matchAll(/<link\b([^>]*)>/gi)].map((m) => attrs(m[1]));
  const head = (clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [, clean])[1];
  const title = (head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const body = (clean.match(/<body\b[^>]*>([\s\S]*)/i) || [, clean])[1].replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  return {
    title: title != null ? toText(title) : null,
    metas: metas.map((a) => ({ name: (a.name || "").toLowerCase(), property: (a.property || "").toLowerCase(), content: a.content ?? null })),
    canonicals: links.filter((a) => /(^|\s)canonical(\s|$)/i.test(a.rel || "")).map((a) => a.href || ""),
    hreflang: links.filter((a) => /(^|\s)alternate(\s|$)/i.test(a.rel || "") && a.hreflang).map((a) => ({ lang: a.hreflang, href: a.href || "" })),
    jsonld, h1s: [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => toText(m[1])), text: toText(body),
    viewport: metas.some((a) => (a.name || "").toLowerCase() === "viewport"),
  };
}
const metaOf = (d, key) => { const k = key.toLowerCase(); const m = d.metas.find((x) => x.name === k || x.property === k); return m ? m.content : null; };
const robotsOf = (d, header) => [metaOf(d, "robots"), metaOf(d, "googlebot"), ...(header ? String(header).split(/,(?=\s*[\w-]+\s*:)|\n/).map((s) => s.replace(/^\s*(googlebot|\*)\s*:/i, "")) : [])].filter(Boolean).join(", ").toLowerCase();
const squash = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// ── rendered DOM ────────────────────────────────────────────────────────────

const COLLECT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none"; };
  const label = (el) => { const t = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 48); return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (t ? ` "${t}"` : ""); };
  const metas = [...document.querySelectorAll("meta")].map((m) => ({ name: (m.getAttribute("name") || "").toLowerCase(), property: (m.getAttribute("property") || "").toLowerCase(), content: m.getAttribute("content") }));
  return {
    url: location.href, title: document.title || null, metas,
    canonicals: [...document.querySelectorAll("link[rel~=canonical]")].map((l) => l.getAttribute("href") || ""),
    hreflang: [...document.querySelectorAll("link[rel~=alternate][hreflang]")].map((l) => ({ lang: l.getAttribute("hreflang"), href: l.getAttribute("href") || "" })),
    jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => ({ level: +h.tagName[1], text: h.innerText.trim().replace(/\s+/g, " ").slice(0, 120), img: !!h.querySelector("img,svg"), el: label(h) })),
    links: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), abs: a.href, text: (a.innerText || a.getAttribute("aria-label") || [...a.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ") || "").trim().replace(/\s+/g, " "), visible: vis(a), button: a.getAttribute("role") === "button" || a.hasAttribute("aria-controls") || a.hasAttribute("aria-expanded"), nav: !!a.closest("nav,header,footer,[role=navigation]"), el: label(a) })),
    imgs: [...document.querySelectorAll("img")].map((i) => { const r = i.getBoundingClientRect(); return { src: i.currentSrc || i.getAttribute("src") || "", w: Math.round(r.width), h: Math.round(r.height), visible: vis(i), alt: i.getAttribute("alt"), el: label(i) }; }),
    subresources: [...document.querySelectorAll("img[src],script[src],link[rel=stylesheet][href],iframe[src],video[src],audio[src],source[src]")].map((e) => e.src || e.href || ""),
    scripts: [...document.querySelectorAll("script[src],link[rel=stylesheet][href]")].map((e) => e.src || e.href),
    text: document.body ? document.body.innerText : "",
    viewport: !!document.querySelector("meta[name=viewport]"),
  };
};

// ── JSON-LD rules ───────────────────────────────────────────────────────────

const ARTICLE = { req: ["headline", "image", "datePublished", "author"], rec: ["dateModified", "publisher", "description"] };
const APP = { req: ["name", "offers"], rec: ["applicationCategory", "operatingSystem", "aggregateRating"] };
const BUSINESS = { req: ["name", "address"], rec: ["geo", "openingHours", "telephone"] };
const SCHEMA = {
  Organization: { req: ["name", "url"], rec: ["logo", "sameAs"] }, Corporation: { req: ["name", "url"], rec: ["logo", "sameAs"] },
  WebSite: { req: ["name", "url"], rec: [] },
  Article: ARTICLE, BlogPosting: ARTICLE, NewsArticle: ARTICLE, TechArticle: ARTICLE,
  Product: { req: ["name", "image", "offers"], rec: ["brand", "sku", "aggregateRating"] },
  SoftwareApplication: APP, WebApplication: APP, MobileApplication: APP,
  BreadcrumbList: { req: ["itemListElement"], rec: [] },
  LocalBusiness: BUSINESS, Restaurant: BUSINESS, Store: BUSINESS, ProfessionalService: BUSINESS,
  Event: { req: ["name", "startDate", "location"], rec: ["offers", "organizer"] },
};
const RETIRED = { FAQPage: "FAQ rich results (Google stopped showing them, May 2026)", HowTo: "HowTo rich results (retired 2023)" };
const URL_KEYS = new Set(["url", "image", "logo", "item", "sameAs", "contentUrl", "thumbnailUrl", "mainEntityOfPage"]);
const DATE_KEYS = new Set(["datePublished", "dateModified", "dateCreated", "startDate", "endDate", "uploadDate", "priceValidUntil", "validFrom"]);
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const typesOf = (n) => (Array.isArray(n?.["@type"]) ? n["@type"] : n?.["@type"] ? [n["@type"]] : []).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ""));
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const filled = (v) => v != null && v !== "" && !(Array.isArray(v) && !v.length);
function topNodes(json) {
  const outN = [];
  const visit = (n) => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== "object") return; if (n["@graph"]) visit(n["@graph"]); if (n["@type"]) outN.push(n); };
  visit(json); return outN;
}
/** Problems inside one typed node: required fields, nested offers / author / rating / breadcrumb items. */
function nodeProblems(n, t) {
  const rule = SCHEMA[t]; const req = [], rec = [];
  if (!rule) return { req, rec };
  for (const k of rule.req) if (!filled(n[k])) req.push(k);
  for (const k of rule.rec) if (!filled(n[k])) rec.push(k);
  if (filled(n.offers)) for (const o of asList(n.offers)) {
    if (typeof o !== "object") { req.push("offers (an Offer object)"); continue; }
    const agg = typesOf(o).includes("AggregateOffer");
    if (agg ? !filled(o.lowPrice) : !filled(o.price) && !filled(o.priceSpecification?.price)) req.push(agg ? "offers.lowPrice" : "offers.price");
    if (!filled(o.priceCurrency) && !filled(o.priceSpecification?.priceCurrency)) req.push("offers.priceCurrency");
    if (t === "Product" && !agg && !filled(o.availability)) req.push("offers.availability");
  }
  if (rule === ARTICLE && filled(n.author)) for (const a of asList(n.author)) { if (typeof a === "string") rec.push("author as a Person/Organization with a name (not a string)"); else if (!filled(a.name)) req.push("author.name"); }
  if (filled(n.aggregateRating)) { const r = n.aggregateRating; if (!filled(r.ratingValue)) req.push("aggregateRating.ratingValue"); if (!filled(r.reviewCount) && !filled(r.ratingCount)) req.push("aggregateRating.reviewCount or ratingCount"); }
  if (t === "BreadcrumbList") asList(n.itemListElement).forEach((it, i, all) => {
    if (!filled(it?.position)) req.push(`itemListElement[${i}].position`);
    if (!filled(it?.name) && !filled(it?.item?.name)) req.push(`itemListElement[${i}].name`);
    if (i < all.length - 1 && !filled(it?.item)) req.push(`itemListElement[${i}].item`);
  });
  return { req, rec };
}
function valueProblems(n, path = "") {
  const outV = [];
  for (const [k, v] of Object.entries(n || {})) {
    if (k.startsWith("@") && k !== "@id") continue;
    for (const x of asList(v)) {
      if (x && typeof x === "object") { outV.push(...valueProblems(x, path + k + ".")); continue; }
      if (typeof x !== "string") continue;
      if (URL_KEYS.has(k) && !/^https?:\/\//.test(x)) outV.push(`${path}${k} "${x.slice(0, 50)}" is not an absolute URL`);
      if (DATE_KEYS.has(k) && !ISO.test(x)) outV.push(`${path}${k} "${x.slice(0, 30)}" is not an ISO 8601 date`);
      if (k === "availability" && !/^https?:\/\/schema\.org\/\w+$/.test(x)) outV.push(`${path}availability "${x}" should be the full enum URL (https://schema.org/InStock)`);
    }
  }
  return outV;
}
/** Facts a rich result would show, which Google requires to be visible on the page. */
function facts(n) {
  const f = [];
  for (const o of asList(n.offers)) if (o && typeof o === "object") for (const k of ["price", "lowPrice", "highPrice"]) if (filled(o[k])) f.push({ what: `offers.${k}`, value: String(o[k]), kind: "number" });
  if (n.aggregateRating) { if (filled(n.aggregateRating.ratingValue)) f.push({ what: "aggregateRating.ratingValue", value: String(n.aggregateRating.ratingValue), kind: "number" }); for (const k of ["reviewCount", "ratingCount"]) if (filled(n.aggregateRating[k])) f.push({ what: `aggregateRating.${k}`, value: String(n.aggregateRating[k]), kind: "number" }); }
  for (const a of asList(n.author)) { const name = typeof a === "string" ? a : a?.name; if (name) f.push({ what: "author.name", value: String(name), kind: "text" }); }
  return f;
}
function inText(fact, text) {
  if (fact.kind === "text") return squash(text).includes(squash(fact.value));
  const t = text.replace(/(\d)[,   ](?=\d{3}(\D|$))/g, "$1");
  const num = Number(String(fact.value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num)) return true;
  const [int, dec = ""] = String(num).split(".");
  const re = dec ? new RegExp(`(?<![\\d.,])${int}[.,]${dec}0?(?!\\d)`) : new RegExp(`(?<![\\d.,])${int}(?:[.,]0{1,2})?(?![\\d]|[.,]\\d)`);
  return re.test(t);
}

// ── fix hints (Next.js App Router; see references/seo.md) ──────────────────

const FIX = {
  canonical: "per route `alternates: { canonical: \"/path\" }` in `metadata`/`generateMetadata`, with `metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL)` in the root layout so it is absolute (nextjs-seo skill)",
  noindex: "`robots: { index: false }` only where meant; gate preview noindex on `VERCEL_ENV !== \"production\"`, not NODE_ENV (nextjs-seo skill)",
  title: "`export const metadata = { title: { default: \"Brand: what it does\", template: \"%s · Brand\" } }` in app/layout.tsx; per route `generateMetadata` from the page's data",
  description: "`description` in `metadata`/`generateMetadata`, written for this page (~70-160 chars)",
  raw: "render it on the server: fetch data in a Server Component, no `Date.now()`/`Math.random()` in render (it stops the prerender at the Suspense fallback), metadata via the metadata API not a client effect (nextjs-seo skill)",
  jsonld: "in the page (Server Component): `<script type=\"application/ld+json\" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, \"\\\\u003c\") }} />` built from the same data the page renders (schema skill)",
  og: "`app/opengraph-image.tsx` (ImageResponse) or a static `opengraph-image.png` at 1200×630; `metadataBase` for absolute URLs; `twitter: { card: \"summary_large_image\" }` (nextjs-seo skill)",
  robots: "`app/robots.ts` returning `{ rules: [{ userAgent: \"*\", allow: \"/\", disallow: [\"/api/\"] }], sitemap: \"https://…/sitemap.xml\" }`; repeat the disallows in every named group (nextjs-seo skill)",
  sitemap: "`app/sitemap.ts` returning `MetadataRoute.Sitemap` of absolute canonical URLs with `lastModified` from content data; revalidate on publish (nextjs-seo skill)",
  notFound: "call `notFound()` for unknown slugs, add `app/not-found.tsx`, `dynamicParams = false` for a fixed set; no catch-all route that renders 200",
  hreflang: "`alternates: { canonical, languages: { en: \"/en/x\", \"en-GB\": \"/en-gb/x\", \"x-default\": \"/en/x\" } }` including the page itself, same set on every alternate",
  links: "link text names the destination (\"Pricing for teams\", not \"Read more\"); real pages get `next/link` with an href, not onClick",
  images: "rename the asset descriptively (team-offsite-lisbon.jpg); filenames are a small image-search signal",
};

// ── one page ────────────────────────────────────────────────────────────────

const pagesSeen = []; // { url, title, description, h1, canonical, depth, links }
let crawling = crawlN > 0;
const sitemapPaths = new Set();

async function checkPage(browser, url, depth) {
  const path = isFile ? basename(fileURLToPath(url)) : new URL(url).pathname + new URL(url).search;
  const at = (s) => (crawling ? `${path} ${s}` : s);
  const add = (f) => F.add({ ...f, el: at(f.el) });

  // 1. Raw HTML and HTTP.
  let raw = null, rawText = "", httpRes = null;
  if (isFile) { try { rawText = readFileSync(fileURLToPath(url), "utf8"); } catch {} }
  else {
    httpRes = await http(url);
    if (httpRes.error) add({ type: "seo-status", el: "page", detail: `[HTTP] the page could not be fetched without a browser: ${httpRes.error}`, severity: "fail", fix: "crawlers fetch without JS or cookies: the page must answer a plain GET" });
    else {
      rawText = /html/i.test(httpRes.type) ? httpRes.text : "";
      if (httpRes.status >= 400) add({ type: "seo-status", el: "page", detail: `[HTTP] ${httpRes.status} for the page itself`, severity: "fail", fix: "a public page answers 200; a removed one 301 to its replacement or 404/410" });
      if (httpRes.chain.length) {
        const hops = httpRes.chain.map((h) => `${h.status} ${h.url}`).join(" → ") + ` → ${httpRes.status} ${httpRes.url}`;
        if (httpRes.chain.length > 2) add({ type: "seo-redirect-chain", el: "page", detail: `[HTTP] ${httpRes.chain.length} redirect hops: ${hops}`, severity: "warn", fix: "redirect straight to the final URL (`redirects()` in next.config with `permanent: true`)" });
        else add({ type: "seo-redirect", el: "page", detail: `[HTTP] redirected: ${hops}`, severity: "info" });
      }
    }
  }
  raw = parseRaw(rawText);
  const xRobots = httpRes?.headers?.get?.("x-robots-tag") || "";

  // 2. Rendered DOM.
  const ctx = await newContext(browser, url, { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let resp = null, dom = null;
  try {
    resp = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await settle(page, 400, 4000);
    dom = await page.evaluate(COLLECT);
  } catch (e) { add({ type: "seo-status", el: "page", detail: `[rendered] the page did not load in Chromium: ${String(e.message).split("\n")[0]}`, severity: "fail" }); }
  await ctx.close();
  if (!dom) return null;
  const finalUrl = dom.url || url;
  const status = httpRes?.status ?? resp?.status() ?? 200;
  const rRobots = robotsOf(dom, xRobots || resp?.headers()?.["x-robots-tag"]);
  const wRobots = robotsOf(raw, xRobots);
  const desc = metaOf(dom, "description");
  const h1s = dom.headings.filter((h) => h.level === 1);
  const h1 = h1s[0]?.text || "";

  // Status: soft 404.
  if (status === 200 && /\b(404|page not found|not found|doesn.t exist)\b/i.test(`${dom.title || ""} | ${h1}`)) add({ type: "seo-soft-404", el: "page", detail: `[HTTP] answers 200 but says "${(h1 || dom.title).slice(0, 60)}"`, severity: "fail", fix: FIX.notFound });

  // Robots meta / header.
  const noR = /noindex|\bnone\b/.test(rRobots), noW = /noindex|\bnone\b/.test(wRobots);
  if (noR || noW) {
    const where = noR && noW ? "[raw+rendered]" : noR ? "[rendered]" : "[raw]";
    const disagree = noR !== noW ? ` — raw and rendered disagree (${noW ? "raw" : "rendered"} only), so crawlers may see either` : "";
    add({ type: "seo-noindex", el: "<head> robots", detail: `${where} noindex (${noR ? rRobots : wRobots}): search engines drop this page${disagree}`, severity: "fail", fix: FIX.noindex });
  }
  for (const d of ["nofollow", "nosnippet"]) if (new RegExp(`\\b${d}\\b`).test(rRobots) && !/\bnone\b/.test(rRobots)) add({ type: "seo-robots-directive", el: "<head> robots", detail: `[rendered] ${d}: ${d === "nofollow" ? "links on this page pass nothing" : "no snippet in search results and no quotes in AI answers"}`, severity: "warn", fix: "drop it unless there's a reason (`robots` in metadata)" });

  // Canonical.
  const canon = dom.canonicals; let canonAbs = null;
  if (canon.length > 1) add({ type: "seo-canonical", el: "<head> link[rel=canonical]", detail: `[rendered] ${canon.length} canonical tags (${canon.join(", ").slice(0, 120)}): search engines may ignore all of them`, severity: "fail", fix: FIX.canonical });
  if (canon.length) {
    const c = canon[0];
    const problems = [];
    if (!/^https?:\/\//i.test(c)) problems.push(`relative ("${c}")`);
    try { canonAbs = new URL(c, finalUrl).href; } catch { problems.push(`not a URL ("${c}")`); }
    if (canonAbs) {
      const cu = new URL(canonAbs);
      if (!samePage(canonAbs, finalUrl)) problems.push(`points to another page (${isFile ? cu.pathname : canonAbs})`);
      if (!pageLocal && cu.host !== new URL(finalUrl).host) problems.push(`on another host (${cu.host})`);
      if (!isFile && new URL(finalUrl).protocol === "https:" && cu.protocol === "http:") problems.push("http: on an https site");
      if (pageLocal && !isFile && /^https?:/.test(c) && !isLocalHost(cu.hostname)) add({ type: "seo-local-host", el: "<head> link[rel=canonical]", detail: `[rendered] canonical is on ${cu.host}; on localhost only its path is compared, and it is fetched from the local server`, severity: "info" });
      if (!isFile && !problems.length) {
        const r = await http(localize(canonAbs), { method: "HEAD" });
        if (r.error || r.status >= 400 || r.chain.length) problems.push(r.error ? `doesn't resolve (${r.error})` : r.chain.length ? `redirects (${r.chain[0].status} → ${r.url})` : `answers ${r.status}`);
      }
    }
    if (problems.length) add({ type: "seo-canonical", el: "<head> link[rel=canonical]", detail: `[rendered] canonical ${problems.join("; ")}`, severity: "fail", fix: FIX.canonical });
  } else add({ type: "seo-canonical-missing", el: "<head>", detail: "[rendered] no canonical: a self-canonical tells search engines which URL variant (query, slash, host) is this page", severity: "warn", fix: FIX.canonical });

  // Raw vs rendered.
  const rawMissing = [], rawLate = [];
  if (dom.title && raw.title == null) rawMissing.push("<title>");
  if (canon.length && !raw.canonicals.length) rawMissing.push("canonical");
  else if (canon.length && raw.canonicals.length && raw.canonicals[0] !== canon[0]) rawMissing.push(`canonical changes after JS ("${raw.canonicals[0]}" → "${canon[0]}")`);
  if (metaOf(dom, "robots") && !metaOf(raw, "robots")) rawMissing.push("meta robots");
  for (const k of ["og:title", "og:image"]) if (metaOf(dom, k) && !metaOf(raw, k)) rawMissing.push(`${k} (share-card scrapers don't run JS)`);
  if (h1 && !squash(raw.text).includes(squash(h1).slice(0, 80))) rawMissing.push(`the h1 "${h1.slice(0, 60)}"`);
  const prices = [...new Set((dom.text.match(/[$€£¥₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:€|USD|EUR|GBP)/g) || []).map((s) => s.trim()))];
  const rawCompact = raw.text.replace(/\s+/g, "");
  const missPrices = prices.filter((p) => !rawCompact.includes(p.replace(/\s+/g, "")));
  if (missPrices.length) rawMissing.push(`price${missPrices.length > 1 ? "s" : ""} ${missPrices.slice(0, 4).join(", ")}`);
  if (desc && !metaOf(raw, "description")) rawLate.push("meta description");
  const h2s = dom.headings.filter((h) => h.level === 2 && h.text);
  const missH2 = h2s.filter((h) => !squash(raw.text).includes(squash(h.text).slice(0, 60)));
  if (missH2.length) rawLate.push(`${missH2.length} of ${h2s.length} h2 section(s), e.g. "${missH2[0].text.slice(0, 50)}"`);
  if (dom.jsonld.length > raw.jsonld.length) rawLate.push(`${dom.jsonld.length - raw.jsonld.length} JSON-LD block(s) (Google renders JS; most other crawlers and AI agents don't)`);
  if (rawMissing.length) add({ type: "seo-raw-missing", el: "raw HTML", detail: `[raw] only after JS: ${rawMissing.join("; ")}`, severity: "fail", fix: FIX.raw });
  if (rawLate.length) add({ type: "seo-raw-late", el: "raw HTML", detail: `[raw] only after JS: ${rawLate.join("; ")}`, severity: "warn", fix: FIX.raw });

  // Title and description.
  const title = dom.title || "";
  if (title && /^(home|untitled|index|welcome|page|new tab|document|my (site|app)|create next app|vite \+ react( \+ ts)?|react app|next\.js|app)$/i.test(title.trim())) add({ type: "seo-title-generic", el: "<title>", detail: `[rendered] title "${title}" says nothing about the page (search results and tabs show it)`, severity: "fail", fix: FIX.title });
  if (title && (title.length < 30 || (title.length > 60 && title.length <= 65))) add({ type: "seo-title-length", el: "<title>", detail: `[rendered] title is ${title.length} characters (about 30-60 shows whole in results; a lint proxy, Google cuts by pixel width)`, severity: "info", fix: FIX.title });
  if (desc != null && (desc.length < 70 || desc.length > 160)) add({ type: "seo-description-length", el: "meta description", detail: `[rendered] description is ${desc.length} characters (about 70-160; Google often rewrites it anyway)`, severity: "info", fix: FIX.description });
  if (title && h1) {
    const words = (s) => new Set(squash(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
    const a = words(title), b = words(h1);
    if (a.size && b.size && ![...a].some((w) => b.has(w))) add({ type: "seo-title-topic", el: "<title>", detail: `[rendered] title "${title.slice(0, 50)}" and h1 "${h1.slice(0, 50)}" share no word: Google may rewrite the title from the h1`, severity: "info", fix: FIX.title });
  }

  // Headings.
  for (const h of h1s) if (!h.text) add({ type: "seo-h1", el: h.el, detail: `[rendered] the h1 has no text${h.img ? " (an image or logo)" : ""}: the page's main topic is unreadable to search`, severity: "fail", fix: "the h1 is the page's topic in words; put the logo in a plain link and an <h1> with text beside it" });
  const generic = dom.headings.filter((h) => h.level > 1 && /^(overview|more|features|introduction|welcome|section|details|info|untitled|heading|title)$/i.test(h.text));
  if (generic.length) add({ type: "seo-heading-generic", el: generic[0].el, detail: `[rendered] generic heading(s): ${generic.map((h) => `"${h.text}"`).join(", ")} (a heading that names the topic is what search and AI answers quote)`, severity: "info" });

  // Links.
  const visLinks = dom.links.filter((l) => l.visible);
  const GENERIC = /^(click here|read more|learn more|here|more|this|link|details|continue|see more|go)$/i;
  const gen = visLinks.filter((l) => GENERIC.test(l.text.replace(/[\s→›»>…]+$/u, "").trim()));
  if (gen.length) add({ type: "seo-anchor-text", el: gen[0].el, detail: `[rendered] ${gen.length} link(s) with generic text: ${[...new Set(gen.map((l) => `"${l.text}"`))].join(", ")} (anchor text tells search what the target is about)`, severity: gen.length > 3 ? "warn" : "info", fix: FIX.links });
  const dead = visLinks.filter((l) => !l.button && (/^#?$/.test((l.href || "").trim()) || /^javascript:/i.test(l.href || "")));
  if (dead.length) add({ type: "seo-link-js", el: dead[0].el, detail: `[rendered] ${dead.length} link(s) with href="${dead[0].href}": crawlers can't follow them${dead.length > 1 ? `, e.g. ${dead.slice(0, 3).map((l) => l.el).join(", ")}` : ""}`, severity: "warn", fix: "a link to a page has a real href (`<Link href=\"/pricing\">`); an action is a <button>" });
  const internal = [];
  for (const l of dom.links) {
    let u; try { u = new URL(l.abs); } catch { continue; }
    if (isFile) { if (u.protocol === "file:" && !/^(\/|[a-z]+:|#)/i.test(l.href || "#")) internal.push({ ...l, file: fileURLToPath(u.href.split(/[?#]/)[0]) }); continue; }
    if (u.origin !== new URL(finalUrl).origin || /\.(pdf|zip|png|jpe?g|gif|svg|webp|avif|mp4|webm|xml|txt|ico)$/i.test(u.pathname) || /logout|sign-?out/i.test(u.pathname)) continue;
    u.hash = ""; internal.push({ ...l, abs: u.href });
  }
  const uniq = [...new Map(internal.map((l) => [l.file || l.abs, l])).values()];
  if (isFile) {
    for (const l of uniq) if (!existsSync(l.file)) add({ type: "seo-broken-link", el: l.el, detail: `[raw] links to ${l.href}, which doesn't exist`, severity: "fail", fix: "fix or remove the link; a moved page gets a permanent redirect" });
  } else {
    const sample = uniq.filter((l) => !samePage(l.abs, finalUrl)).slice(0, 40);
    const results = await Promise.all(sample.map(async (l) => [l, await http(l.abs, { method: "HEAD" })]));
    for (const [l, r] of results) {
      if (r.error || r.status >= 400) add({ type: "seo-broken-link", el: l.el, detail: `[HTTP] links to ${new URL(l.abs).pathname}: ${r.error || r.status}`, severity: "fail", fix: "fix or remove the link; a moved page gets a permanent redirect" });
      else if (r.chain.length) add({ type: "seo-link-redirect", el: l.el, detail: `[HTTP] links to ${new URL(l.abs).pathname}, which redirects (${r.chain[0].status}) to ${r.url}`, severity: "warn", fix: "link to the final URL directly" });
    }
  }

  // Images.
  const CAMERA = /^(img|dsc|dscn|dscf|dcim|pxl|mvimg|gopr|screenshot|screen[ _-]?shot|image|photo|unnamed|untitled|whatsapp image)[-_ ]?\d+/i;
  for (const i of dom.imgs) {
    if (!i.visible || i.w < 80 || i.h < 60 || /^(data|blob):/.test(i.src)) continue;
    let src = i.src; try { const u = new URL(src, finalUrl); src = u.searchParams.get("url") && /\/_next\/image/.test(u.pathname) ? u.searchParams.get("url") : u.pathname; } catch {}
    const file = decodeURIComponent(src.split("/").pop() || ""); const stem = file.replace(/\.\w+$/, "");
    if (CAMERA.test(stem) || /^[a-f0-9]{16,}$/i.test(stem) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(stem)) add({ type: "seo-image-filename", el: i.el, detail: `[rendered] content image named "${file}" (${i.w}×${i.h})`, severity: "warn", fix: FIX.images });
  }

  // Viewport, HTTPS, URL.
  if (!dom.viewport) add({ type: "seo-viewport", el: "<head>", detail: "[rendered] no meta viewport: phones render a zoomed-out desktop page, and Google indexes the phone version", severity: "fail", fix: "Next.js adds it by default; `export const viewport = { width: \"device-width\", initialScale: 1 }` if it was removed" });
  if (!isFile) {
    const fu = new URL(finalUrl);
    if (fu.protocol === "https:") { const mixed = dom.subresources.filter((s) => /^http:\/\//i.test(s)); if (mixed.length) add({ type: "seo-mixed-content", el: "page", detail: `[rendered] ${mixed.length} http: subresource(s) on an https page, e.g. ${mixed[0].slice(0, 80)}`, severity: "fail", fix: "load them over https (or protocol-relative from your own host)" }); }
    else if (!pageLocal) add({ type: "seo-https", el: "page", detail: "[HTTP] the page is served over http:", severity: "fail", fix: "serve https and redirect http → https (308) at the platform" });
    if (fu.protocol === "https:" && !pageLocal && httpRes?.headers && !httpRes.headers.get("strict-transport-security")) add({ type: "seo-hsts", el: "page", detail: "[HTTP] no Strict-Transport-Security header", severity: "info" });
    const p = fu.pathname;
    const shape = [/[A-Z]/.test(p) && "uppercase", /_/.test(p) && "underscores", p.length > 75 && `${p.length} characters`, fu.search && "query parameters", /\/\d{4}\/\d{2}\//.test(p) && "a date in the path"].filter(Boolean);
    if (shape.length) add({ type: "seo-url", el: "URL", detail: `[HTTP] path ${p}${fu.search}: ${shape.join(", ")} (short lowercase hyphenated paths read best in results)`, severity: "info" });
  }

  // 4. JSON-LD.
  const blocks = [];
  dom.jsonld.forEach((src, i) => {
    try { blocks.push({ i, json: JSON.parse(src) }); }
    catch (e) { add({ type: "seo-jsonld-invalid", el: `JSON-LD block ${i + 1}`, detail: `[rendered] doesn't parse: ${String(e.message).slice(0, 90)} — the whole block is ignored`, severity: "fail", fix: FIX.jsonld }); }
  });
  const byType = new Map();
  for (const b of blocks) for (const n of topNodes(b.json)) for (const t of typesOf(n)) {
    const tag = `JSON-LD ${t}`;
    if (!byType.has(t)) byType.set(t, []); byType.get(t).push({ block: b.i, n });
    if (RETIRED[t]) add({ type: "seo-jsonld-retired", el: tag, detail: `[rendered] ${t} is fine as semantics but no longer earns ${RETIRED[t]}: don't sell it as a rich result`, severity: "info" });
    if (t === "WebSite" && asList(n.potentialAction).some((a) => typesOf(a).includes("SearchAction"))) add({ type: "seo-jsonld-retired", el: tag, detail: "[rendered] SearchAction: the sitelinks search box was retired in 2024", severity: "info" });
    const { req, rec } = nodeProblems(n, t);
    if (req.length) add({ type: "seo-jsonld-required", el: tag, detail: `[rendered] ${t} is missing required ${req.join(", ")}: not eligible for its rich result`, severity: "fail", fix: FIX.jsonld });
    if (rec.length) add({ type: "seo-jsonld-recommended", el: tag, detail: `[rendered] ${t} could add ${rec.join(", ")}`, severity: "info", fix: FIX.jsonld });
    const vals = valueProblems(n);
    if (vals.length) add({ type: "seo-jsonld-value", el: tag, detail: `[rendered] ${vals.slice(0, 4).join("; ")}${vals.length > 4 ? ` (+${vals.length - 4} more)` : ""}`, severity: "warn", fix: "absolute URLs (metadataBase or the site URL), ISO 8601 dates, full schema.org enum URLs (schema skill)" });
    const missing = facts(n).filter((f) => !inText(f, dom.text));
    if (missing.length) add({ type: "seo-jsonld-fact", el: tag, detail: `[rendered] ${missing.map((f) => `${f.what} "${f.value}"`).join(", ")} not in the page's text: structured data must describe what the visitor sees (a manual action risk)`, severity: "fail", fix: "build the JSON-LD from the same data the page renders, and show those facts on the page (schema skill)" });
  }
  for (const [t, list] of byType) {
    const blocksOf = new Set(list.map((x) => x.block));
    if (blocksOf.size < 2) continue;
    const sig = (n) => JSON.stringify([n.name || n.headline || "", asList(n.offers).map((o) => o?.price ?? "")]);
    if (new Set(list.map((x) => sig(x.n))).size > 1) add({ type: "seo-jsonld-conflict", el: `JSON-LD ${t}`, detail: `[rendered] ${list.length} ${t} nodes in ${blocksOf.size} blocks disagree (${list.map((x) => sig(x.n)).join(" vs ").slice(0, 120)}): usually a manual block plus a plugin's`, severity: "fail", fix: "keep one source of structured data per entity (schema skill)" });
  }

  // 5. Share card.
  const ogImage = metaOf(dom, "og:image") || metaOf(dom, "og:image:url");
  const ogUrl = metaOf(dom, "og:url");
  // A relative canonical is already a finding; compare it against og:url on og:url's own host.
  const canonCmp = canonAbs && canon[0] && !/^https?:/i.test(canon[0]) && ogUrl && /^https?:/.test(ogUrl) ? new URL(canon[0], ogUrl).href : canonAbs;
  if (ogUrl && canonAbs && !/^https?:/.test(ogUrl)) add({ type: "seo-og-url", el: "meta og:url", detail: `[rendered] og:url "${ogUrl}" is not absolute`, severity: "fail", fix: FIX.og });
  else if (ogUrl && canonCmp && ogUrl.replace(/\/+$/, "") !== canonCmp.replace(/\/+$/, "")) add({ type: "seo-og-url", el: "meta og:url", detail: `[rendered] og:url ${ogUrl} ≠ canonical ${canon[0]}: shares and search count different URLs`, severity: "fail", fix: "set both from one value: `alternates.canonical` and `openGraph.url` (or let metadataBase resolve both)" });
  if (ogImage) {
    const missingOg = ["og:title", "og:description", "og:url", "og:type"].filter((k) => !metaOf(dom, k));
    if (missingOg.length) add({ type: "seo-og-fields", el: "<head> og:*", detail: `[rendered] share card has an image but no ${missingOg.join(", ")}`, severity: "info", fix: "metadata merges shallowly: a child `openGraph` replaces the parent's, so spread a shared base (nextjs-seo skill)" });
    if (!metaOf(dom, "twitter:card")) add({ type: "seo-twitter-card", el: "<head>", detail: "[rendered] og:image but no twitter:card: X shows a small card or none", severity: "warn", fix: "`twitter: { card: \"summary_large_image\" }` in metadata" });
    let abs = null;
    if (!/^https?:\/\//i.test(ogImage)) add({ type: "seo-og-image", el: "meta og:image", detail: `[rendered] og:image "${ogImage.slice(0, 80)}" is not absolute: share scrapers can't resolve it`, severity: "fail", fix: FIX.og });
    else {
      abs = ogImage; const host = new URL(abs).hostname;
      if (!pageLocal && (isLocalHost(host) || PREVIEW.test(host))) add({ type: "seo-og-image", el: "meta og:image", detail: `[rendered] og:image is on ${host}: a local or preview host, unreachable or temporary for share scrapers`, severity: "fail", fix: FIX.og });
      else if (pageLocal && isLocalHost(host)) add({ type: "seo-local-host", el: "meta og:image", detail: `[rendered] og:image is on ${host}: fine locally, but check production emits the production host (metadataBase)`, severity: "info" });
    }
    if (abs && isFile) add({ type: "seo-skipped", el: "meta og:image", detail: "[site] share-card image not fetched for a file target (serve the page to check it)", severity: "info" });
    else if (abs) {
      const r = await http(localize(abs));
      const dims = r.buf ? imageSize(r.buf) : null;
      if (r.error || r.status >= 400) add({ type: "seo-og-image", el: "meta og:image", detail: `[HTTP] og:image ${localize(abs)} answers ${r.error || r.status}: links shared on X, Slack and LinkedIn show no picture`, severity: "fail", fix: FIX.og });
      else if (!/^image\//i.test(r.type) || !dims) add({ type: "seo-og-image", el: "meta og:image", detail: `[HTTP] og:image is ${r.type || "untyped"}${dims ? "" : ", not a PNG/JPEG/GIF/WebP"}: scrapers drop it`, severity: "fail", fix: FIX.og });
      else {
        const ratio = dims.w / dims.h; const issues = [];
        if (dims.w < 1200 || Math.abs(ratio - 1.91) > 0.12) issues.push(`${dims.w}×${dims.h} (ratio ${ratio.toFixed(2)}:1)`);
        if (r.length > 5e6) issues.push(`${(r.length / 1e6).toFixed(1)} MB (over 5 MB some scrapers skip it)`);
        if (issues.length) add({ type: "seo-og-size", el: "meta og:image", detail: `[HTTP] share image is ${issues.join(", ")}; 1200×630 (1.91:1) shows uncropped everywhere`, severity: "warn", fix: FIX.og });
        else add({ type: "seo-og-ok", el: "meta og:image", detail: `[HTTP] share image ${dims.w}×${dims.h} ${dims.type}, ${Math.round(r.length / 1024)} KB`, severity: "info" });
      }
    }
  }

  // 7. hreflang.
  const alts = dom.hreflang;
  if (alts.length) {
    const self = canonAbs || finalUrl;
    const absAlts = alts.map((a) => { let abs = null; try { abs = new URL(a.href, finalUrl).href; } catch {} return { ...a, abs }; });
    const bad = [];
    for (const a of absAlts) { const why = hreflangProblem(a.lang); if (why) bad.push(`"${a.lang}" ${why}`); if (!/^https?:\/\//.test(a.href)) bad.push(`"${a.lang}" href is relative`); }
    if (!absAlts.some((a) => a.abs && samePage(a.abs, self))) bad.push("no entry for this page itself");
    if (canonAbs && absAlts.length && !absAlts.some((a) => a.abs && samePage(a.abs, canonAbs))) bad.push("the canonical is not in the set (or the canonical points to another locale)");
    if (!isFile) {
      for (const a of absAlts.filter((a) => a.abs && !samePage(a.abs, self) && a.lang !== "x-default").slice(0, 10)) {
        const r = await http(localize(a.abs));
        if (r.error || r.status >= 400) { bad.push(`${a.lang} → ${new URL(a.abs).pathname} answers ${r.error || r.status}`); continue; }
        if (r.chain.length) bad.push(`${a.lang} → ${new URL(a.abs).pathname} redirects`);
        const p = parseRaw(r.text);
        if (/noindex/.test(robotsOf(p, r.headers.get("x-robots-tag")))) bad.push(`${a.lang} → ${new URL(a.abs).pathname} is noindex`);
        if (!p.hreflang.some((b) => { try { return samePage(new URL(b.href, r.url).href, self); } catch { return false; } })) bad.push(`${a.lang} → ${new URL(a.abs).pathname} doesn't link back (hreflang must be reciprocal)`);
      }
    } else add({ type: "seo-skipped", el: "hreflang", detail: "[site] alternates not fetched for a file target (reciprocity unchecked)", severity: "info" });
    if (bad.length) add({ type: "seo-hreflang", el: "<head> hreflang", detail: `[rendered] ${bad.join("; ")}`, severity: "fail", fix: FIX.hreflang });
    if (!alts.some((a) => a.lang.toLowerCase() === "x-default")) add({ type: "seo-hreflang-xdefault", el: "<head> hreflang", detail: "[rendered] no x-default for visitors whose language isn't listed", severity: "info", fix: FIX.hreflang });
  }

  const rec = { url: finalUrl, path, depth, title, description: desc, h1, canonical: canonAbs, noindex: noR || noW, scripts: dom.scripts, navLinks: isFile ? [] : dom.links.filter((l) => { try { return l.nav && new URL(l.abs).origin === new URL(finalUrl).origin && !samePage(l.abs, finalUrl); } catch { return false; } }).map((l) => l.abs), links: uniq.filter((l) => l.abs).map((l) => l.abs) };
  pagesSeen.push(rec);
  return rec;
}

function hreflangProblem(code) {
  if (/^x-default$/i.test(code)) return null;
  const [lang, ...rest] = code.split("-");
  try { Intl.getCanonicalLocales(code); } catch { return "is not a valid language code"; }
  const L = new Intl.DisplayNames(["en"], { type: "language" }), R = new Intl.DisplayNames(["en"], { type: "region" });
  if (!/^[a-z]{2,3}$/i.test(lang) || L.of(lang.toLowerCase()) === lang.toLowerCase()) return "is not an ISO 639-1 language";
  const region = rest.find((p) => /^([a-z]{2}|\d{3})$/i.test(p));
  if (region) {
    const canon = Intl.getCanonicalLocales(`und-${region}`)[0].split("-")[1];
    if (canon.toUpperCase() !== region.toUpperCase()) return `uses region ${region.toUpperCase()}, which isn't ISO 3166-1 (use ${lang}-${canon})`;
    const name = R.of(region.toUpperCase()); if (!name || name === region.toUpperCase() || /unknown/i.test(name)) return `has an unknown region ${region}`;
  }
  return null;
}

/** Pixel size from the first bytes: PNG, JPEG, GIF, WebP. */
function imageSize(b) {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: "PNG" };
    if (b.length > 10 && b.toString("ascii", 0, 4) === "GIF8") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), type: "GIF" };
    if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, type: "WebP" };
      if (kind === "VP8L") { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1, type: "WebP" }; }
      if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), type: "WebP" };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), type: "JPEG" };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}

// ── 6. the site, once ───────────────────────────────────────────────────────

function parseRobots(txt) {
  const groups = []; let cur = null; const sitemaps = [];
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim(); if (!line) continue;
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "sitemap") { sitemaps.push(v); continue; }
    if (k === "user-agent") { if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] })); cur.agents.push(v.toLowerCase()); continue; }
    if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  }
  return { groups, sitemaps };
}
/** Longest match wins; Allow wins a tie (Google's rules). */
function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
const AI_BOTS = { search: ["oai-searchbot", "claude-searchbot", "perplexitybot"], "user fetch": ["chatgpt-user", "claude-user", "perplexity-user"], training: ["gptbot", "claudebot", "google-extended", "ccbot"] };

async function checkSite(first) {
  const add = (f) => F.add({ ...f, detail: `[site] ${f.detail}` });
  const firstPath = new URL(first.url).pathname;

  // robots.txt
  const rb = await http(origin + "/robots.txt");
  let robots = { groups: [], sitemaps: [] };
  if (rb.error || rb.status >= 500) add({ type: "seo-robots-txt", el: "/robots.txt", detail: `answers ${rb.error || rb.status}: Google treats a 5xx robots.txt as "crawl nothing" until it recovers`, severity: "fail", fix: FIX.robots });
  else if (rb.status >= 400) add({ type: "seo-robots-txt", el: "/robots.txt", detail: `${rb.status}: no robots.txt, so everything may be crawled and no Sitemap: line points at the sitemap`, severity: "info", fix: FIX.robots });
  else if (/html/i.test(rb.type) || /<html/i.test(rb.text.slice(0, 500))) add({ type: "seo-robots-txt", el: "/robots.txt", detail: "serves an HTML page (a catch-all route), not robots rules", severity: "warn", fix: FIX.robots });
  else {
    robots = parseRobots(rb.text);
    const star = robots.groups.filter((g) => g.agents.includes("*")).flatMap((g) => g.rules);
    if (star.some((r) => !r.allow && r.path === "/") && !star.some((r) => r.allow && r.path === "/")) add({ type: "seo-robots-txt", el: "/robots.txt", detail: `"Disallow: /" for every crawler${pageLocal ? " (fine on a preview, never on production)" : ""}: nothing is crawled`, severity: "fail", fix: FIX.robots });
    for (const p of pagesSeen) {
      const path = new URL(p.url).pathname;
      if (!robotsAllows(star, path)) add({ type: "seo-robots-blocked", el: "/robots.txt", detail: `blocks ${path}${p.noindex ? ", which carries noindex: crawlers never fetch it, so never see the noindex, and the URL can still be indexed from links" : ": it can't be crawled"}`, severity: "fail", fix: p.noindex ? "let it be crawled so the noindex is seen (remove the Disallow), or keep the Disallow and drop the noindex" : FIX.robots });
    }
    const blockedAssets = [...new Set(first.scripts.filter((s) => { try { const u = new URL(s); return u.origin === origin && !robotsAllows(star, u.pathname); } catch { return false; } }))];
    if (blockedAssets.length) add({ type: "seo-robots-blocked", el: "/robots.txt", detail: `blocks ${blockedAssets.length} script/stylesheet(s) the page needs to render, e.g. ${new URL(blockedAssets[0]).pathname}`, severity: "fail", fix: "never disallow /_next/ or other asset paths: Google renders the page with them" });
    const starDis = star.filter((r) => !r.allow && r.path);
    const named = robots.groups.filter((g) => !g.agents.includes("*"));
    const dropping = named.filter((g) => starDis.some((d) => robotsAllows(g.rules, d.path) && !g.rules.some((r) => !r.allow && r.path === d.path)));
    if (dropping.length && starDis.length) add({ type: "seo-robots-groups", el: "/robots.txt", detail: `group(s) for ${dropping.map((g) => g.agents.join("/")).join(", ")} don't repeat the wildcard's Disallow (${starDis.map((d) => d.path).join(", ")}): a named group replaces "*" for that bot, it doesn't add to it`, severity: "warn", fix: FIX.robots });
    if (!robots.sitemaps.length) add({ type: "seo-robots-sitemap", el: "/robots.txt", detail: "no Sitemap: line", severity: "warn", fix: FIX.robots });
    const policy = Object.entries(AI_BOTS).map(([purpose, bots]) => {
      const said = bots.map((b) => { const g = robots.groups.find((g) => g.agents.includes(b)); if (!g) return null; return `${b} ${robotsAllows(g.rules, firstPath) ? "allowed" : "blocked"}`; }).filter(Boolean);
      return said.length ? `${purpose}: ${said.join(", ")}` : null;
    }).filter(Boolean);
    add({ type: "seo-ai-bots", el: "/robots.txt", detail: policy.length ? `AI crawlers named: ${policy.join("; ")}; the rest follow "*"` : `no AI crawler named; all follow "*" (${robotsAllows(star, firstPath) ? "allowed" : "blocked"}). Report the policy, never change it unasked`, severity: "info" });
  }

  // sitemap
  const smUrls = robots.sitemaps.length ? robots.sitemaps : [origin + "/sitemap.xml"];
  const locs = []; const lastmods = []; let smOk = false;
  const readSitemap = async (u, depth) => {
    const r = await http(localize(u));
    if (r.error || r.status >= 400) { add({ type: "seo-sitemap", el: new URL(u).pathname, detail: `${new URL(u).pathname} answers ${r.error || r.status}${robots.sitemaps.length ? " (named in robots.txt)" : ": no sitemap"}`, severity: robots.sitemaps.length ? "fail" : "warn", fix: FIX.sitemap }); return; }
    if (!/<(urlset|sitemapindex)\b/i.test(r.text)) { add({ type: "seo-sitemap", el: new URL(u).pathname, detail: `${new URL(u).pathname} is not a sitemap (${r.type || "no content-type"}${/<html/i.test(r.text) ? ", an HTML page" : ""})`, severity: "fail", fix: FIX.sitemap }); return; }
    smOk = true;
    if (r.length > 50e6) add({ type: "seo-sitemap", el: new URL(u).pathname, detail: `${(r.length / 1e6).toFixed(0)} MB: over the 50 MB limit, split it with a sitemap index`, severity: "warn", fix: FIX.sitemap });
    if (/<sitemapindex\b/i.test(r.text)) { if (depth < 1) for (const m of [...r.text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].slice(0, 5)) await readSitemap(decode(m[1]), depth + 1); return; }
    for (const m of r.text.matchAll(/<url>([\s\S]*?)<\/url>/gi)) { const loc = (m[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/i) || [])[1]; if (loc) locs.push(decode(loc)); const lm = (m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i) || [])[1]; if (lm) lastmods.push(lm); }
  };
  for (const u of smUrls.slice(0, 3)) await readSitemap(new URL(u, origin).href, 0);
  if (smOk) {
    if (locs.length > 50000) add({ type: "seo-sitemap", el: "sitemap", detail: `${locs.length} URLs in one sitemap: over the 50,000 limit`, severity: "warn", fix: FIX.sitemap });
    const relative = locs.filter((l) => !/^https?:\/\//i.test(l));
    if (relative.length) add({ type: "seo-sitemap", el: "sitemap <loc>", detail: `${relative.length} relative <loc>(s), e.g. "${relative[0]}": a sitemap needs absolute URLs`, severity: "fail", fix: FIX.sitemap });
    const expectHost = first.canonical && /^https?:/.test(first.canonical) ? new URL(first.canonical).host : new URL(first.url).host;
    const wrongHost = locs.filter((l) => /^https?:\/\//i.test(l) && new URL(l).host !== expectHost && !(pageLocal && isLocalHost(new URL(l).hostname)));
    if (wrongHost.length) add({ type: "seo-sitemap", el: "sitemap <loc>", detail: `${wrongHost.length} <loc>(s) on another host than the canonical (${expectHost}), e.g. ${wrongHost[0]}`, severity: "fail", fix: FIX.sitemap });
    const sample = locs.filter((l) => /^https?:\/\//i.test(l)).slice(0, 50);
    for (const l of locs) { const p = pathOf(l.startsWith("/") ? origin + l : l); if (p) sitemapPaths.add(p); }
    const res = await Promise.all(sample.map(async (l) => [l, await http(localize(l))]));
    const broken = [], redirected = [], noindexed = [], nonCanon = [];
    for (const [l, r] of res) {
      const p = new URL(l).pathname;
      if (r.error || r.status >= 400) { broken.push(`${p} (${r.error || r.status})`); continue; }
      if (r.chain.length) redirected.push(`${p} → ${new URL(r.url).pathname}`);
      const d = parseRaw(r.text);
      if (/noindex/.test(robotsOf(d, r.headers.get("x-robots-tag")))) noindexed.push(p);
      if (d.canonicals[0]) { try { if (!samePage(new URL(d.canonicals[0], r.url).href, localize(l)) && !samePage(new URL(d.canonicals[0], r.url).href, l)) nonCanon.push(`${p} → ${d.canonicals[0]}`); } catch {} }
    }
    const n = `of ${sample.length} sampled`;
    if (broken.length) add({ type: "seo-sitemap-url", el: "sitemap <loc>", detail: `${broken.length} ${n} URL(s) fail: ${broken.slice(0, 5).join(", ")}`, severity: "fail", fix: FIX.sitemap });
    if (noindexed.length) add({ type: "seo-sitemap-url", el: "sitemap <loc>", detail: `${noindexed.length} ${n} URL(s) are noindex (a sitemap lists pages to index): ${noindexed.slice(0, 5).join(", ")}`, severity: "fail", fix: FIX.sitemap });
    if (redirected.length) add({ type: "seo-sitemap-url", el: "sitemap <loc>", detail: `${redirected.length} ${n} URL(s) redirect: ${redirected.slice(0, 5).join(", ")}`, severity: "warn", fix: "list final URLs only" });
    if (nonCanon.length) add({ type: "seo-sitemap-url", el: "sitemap <loc>", detail: `${nonCanon.length} ${n} URL(s) canonicalise elsewhere: ${nonCanon.slice(0, 5).join(", ")}`, severity: "warn", fix: "list canonical URLs only" });
    if (lastmods.length >= 3 && new Set(lastmods).size === 1) add({ type: "seo-sitemap-lastmod", el: "sitemap <lastmod>", detail: `every lastmod is ${lastmods[0]}: a build time, not real edits, so search engines learn to ignore it`, severity: "info", fix: "`lastModified` from each page's content data in sitemap.ts, or leave it out" });
    const navMissing = [...new Set(first.navLinks.map((u) => pathOf(u)).filter(Boolean))].filter((p) => { try { return !sitemapPaths.has(p); } catch { return false; } });
    if (navMissing.length && sitemapPaths.size) add({ type: "seo-sitemap-nav", el: "sitemap", detail: `${navMissing.length} page(s) linked from the nav/footer aren't in the sitemap: ${navMissing.slice(0, 6).join(", ")}`, severity: "info", fix: FIX.sitemap });
  }

  // Missing URLs must 404.
  const probe = `${origin}/${Math.random().toString(36).slice(2, 10)}-review-404`;
  const pr = await http(probe);
  if (!pr.error && pr.status === 200) add({ type: "seo-soft-404", el: new URL(probe).pathname, detail: `a made-up URL answers 200${pr.chain.length ? ` (after redirecting to ${new URL(pr.url).pathname})` : ""}: dead URLs look live to search engines (a catch-all route)`, severity: "fail", fix: FIX.notFound });

  // Host and slash variants (public hosts only: a local server has no www or http/https pair).
  if (!pageLocal) {
    const u = new URL(first.url); const variants = [];
    if (u.protocol === "https:") variants.push(["http://", "http://" + u.host + u.pathname]);
    variants.push(["www/apex", u.protocol + "//" + (u.hostname.startsWith("www.") ? u.hostname.slice(4) : "www." + u.hostname) + (u.port ? ":" + u.port : "") + u.pathname]);
    if (u.pathname !== "/") variants.push(["trailing slash", u.origin + (u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname + "/")]);
    if (/[a-z]/.test(u.pathname)) variants.push(["uppercase path", u.origin + u.pathname.toUpperCase()]);
    for (const [name, v] of variants) {
      const r = await http(v, { method: "HEAD" });
      if (r.error) continue;
      if (r.status === 200 && !r.chain.length && !(name === "uppercase path")) add({ type: "seo-host-variant", el: name, detail: `${v} serves 200 without redirecting to ${first.url}`, severity: "warn", fix: "redirect variants permanently (host redirect at the platform; `trailingSlash` in next.config)" });
      else if (r.chain.some((h) => h.status === 302 || h.status === 307)) add({ type: "seo-redirect-type", el: name, detail: `${v} redirects with a temporary ${r.chain.find((h) => h.status === 302 || h.status === 307).status}`, severity: "info", fix: "301/308 for permanent moves (`permanent: true`)" });
    }
  }

  // 9. llms.txt: info only.
  const lt = await http(origin + "/llms.txt");
  if (!lt.error && lt.status === 200 && !/<html/i.test(lt.text.slice(0, 300))) add({ type: "seo-llms-txt", el: "/llms.txt", detail: `present (${lt.type || "no type"}), first line "${lt.text.split("\n")[0].slice(0, 60)}"${/^#\s/.test(lt.text) ? "" : " (should start with # Name)"}`, severity: "info" });
  else add({ type: "seo-llms-txt", el: "/llms.txt", detail: `absent (${lt.error || lt.status}); optional, only worth adding for agent or docs discovery`, severity: "info" });
}

// ── run ─────────────────────────────────────────────────────────────────────

const { chromium } = loadChromium();
const browser = await chromium.launch();
let complete = false;
try {
  const first = await checkPage(browser, startUrl, 0);
  if (first && crawlN > 0 && !isFile) {
    const seen = new Set([pathOf(first.url)]); const queue = first.links.map((u) => [u, 1]);
    let checked = 0;
    while (queue.length && checked < crawlN) {
      const [u, depth] = queue.shift(); const key = pathOf(u);
      if (seen.has(key)) continue; seen.add(key);
      const head = await http(u, { method: "HEAD" }); // a dead link is already a seo-broken-link
      if (head.error || head.status >= 400) continue;
      const rec = await checkPage(browser, u, depth); checked++;
      if (rec) for (const l of rec.links) if (!seen.has(pathOf(l))) queue.push([l, depth + 1]);
    }
    complete = !queue.some(([u]) => !seen.has(pathOf(u)));
    console.log(`crawl: ${checked} more page(s) checked${complete ? " (every linked page seen)" : `, ${new Set(queue.map(([u]) => pathOf(u)).filter((p) => !seen.has(p))).size} more linked`}`);
  } else if (crawlN > 0 && isFile) F.add({ type: "seo-skipped", el: "--crawl", detail: "[site] --crawl needs a URL (serve the files)", severity: "info" });
  if (first && isFile) F.add({ type: "seo-skipped", el: "site", detail: "[site] file target: robots.txt, sitemap, the 404 probe, host variants, link HEADs, share-card and hreflang fetches skipped (serve the page to run them)", severity: "info" });
  else if (first) await checkSite(first);

  // 8. Across the crawl.
  if (pagesSeen.length > 1) {
    for (const key of ["title", "description", "h1"]) {
      const groups = new Map();
      for (const p of pagesSeen) if (p[key]) { const k = squash(p[key]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      for (const [, list] of groups) if (list.length > 1) F.add({ type: "seo-duplicate", el: key === "h1" ? "h1" : key === "title" ? "<title>" : "meta description", detail: `[rendered] ${list.length} pages share the ${key} "${list[0][key].slice(0, 60)}": ${list.map((p) => p.path).join(", ")}`, severity: key === "h1" ? "warn" : "fail", fix: key === "h1" ? "each page's h1 names its own topic" : key === "title" ? FIX.title : FIX.description });
    }
    const canonTargets = pagesSeen.filter((p) => p.canonical).map((p) => pathOf(p.canonical));
    if (pagesSeen.length > 2 && canonTargets.length === pagesSeen.length && new Set(canonTargets).size === 1) F.add({ type: "seo-canonical", el: "link[rel=canonical]", detail: `[rendered] every crawled page is canonical to ${canonTargets[0]} (an inherited root canonical): only that page can rank`, severity: "fail", fix: "the root layout sets `alternates.canonical: \"/\"` and children inherit it: set `alternates: { canonical: \"/path\" }` per route" });
    for (const p of pagesSeen.filter((p) => p.depth > 3)) F.add({ type: "seo-click-depth", el: p.path, detail: `[site] ${p.depth} clicks from the start page`, severity: "info", fix: "link important pages from the nav, footer or a hub page (≤ 3 clicks)" });
    if (sitemapPaths.size) {
      const linked = new Set([pathOf(startUrl), ...pagesSeen.flatMap((p) => p.links.map(pathOf))]);
      const orphans = [...sitemapPaths].filter((p) => !linked.has(p));
      if (orphans.length) F.add({ type: "seo-orphan", el: "sitemap", detail: `[site] ${orphans.length} sitemap URL(s) never linked from ${complete ? "any page of the site" : `the ${pagesSeen.length} crawled pages (crawl more to be sure)`}: ${orphans.slice(0, 6).join(", ")}`, severity: complete ? "warn" : "info", fix: FIX.links });
    }
  }
} finally { await browser.close(); }

const summary = F.print();
F.write(out, { url: startUrl, pages: pagesSeen.map((p) => ({ url: p.url, depth: p.depth, title: p.title, canonical: p.canonical, noindex: p.noindex })), seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s · search-engine validation pending: confirm in Rich Results Test, validator.schema.org and Search Console`);
process.exit(summary.fails ? 1 : 0);
