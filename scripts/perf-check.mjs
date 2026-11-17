#!/usr/bin/env node
// perf-check.mjs: measure page speed properly and say why it is slow.
//
//   node perf-check.mjs <url> [--out .review] [--runs 3] [--profile mobile|desktop] [--cpu 4]
//        [--no-throttle] [--no-interact] [--coverage] [--field]
//
// --field   real-user numbers (p75 over 28 days, Chrome UX Report) for a public URL: the CrUX API when
//           CRUX_API_KEY is set (fast), else PageSpeed Insights' field section (slower; key-less calls share
//           one daily quota, so set PSI_API_KEY for your own). The page's
//           URL is sent to Google; never used for localhost or private hosts. Lab numbers here are a floor; field
//           numbers are what visitors get.
//
// Cold runs in fresh browser contexts with Lighthouse's mobile throttling (Slow 4G: 150 ms RTT, 1.6 Mbps,
// applied as 562.5 ms / 1.47 Mbps; CPU 4×; on an Apple-silicon Mac consider --cpu 6) and the medians of: TTFB,
// FCP, LCP with its four parts (TTFB, load delay, load time, render delay) and element, CLS, TBT, weight by
// type and origin. The median-LCP run is diagnosed: LCP image lazy / without fetchpriority / discovered late /
// hidden by an entrance animation, render-blocking files, oversized and old-format images, fonts, autoplay
// video, DOM size, third-party main-thread time (Long Animation Frames by origin), long frames. Then the main
// controls are clicked to measure interaction latency (INP-like) with its phases. Measure a production build:
// a dev server is detected and called out.

import { newContext, parseArgs, toUrl, loadChromium, outDir, HELPERS, installHelpers, dismissPopups, Findings } from "./lib.mjs";

const { opt, has, target } = parseArgs(["--out", "--runs", "--profile", "--cpu"]);
if (!target) { console.error("usage: perf-check.mjs <url> [--out .review] [--runs 3] [--profile mobile|desktop] [--cpu 4] [--no-throttle] [--no-interact] [--coverage]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const RUNS = Math.max(1, Number(opt("--runs", 3)) || 3);
const profile = opt("--profile", "mobile");
const throttle = !has("--no-throttle");
const PROFILES = {
  mobile: { viewport: { width: 412, height: 823 }, dpr: 1.75, mobile: true, latency: 562.5, down: 1474.56, up: 675, cpu: 4 },
  desktop: { viewport: { width: 1350, height: 940 }, dpr: 1, mobile: false, latency: 40, down: 10240, up: 10240, cpu: 1 },
};
const P = { ...PROFILES[profile] || PROFILES.mobile };
if (opt("--cpu")) P.cpu = Number(opt("--cpu"));
const F = new Findings("perf");
const { chromium } = loadChromium();
const browser = await chromium.launch();
const t0 = Date.now();

const OBSERVE = () => {
  const w = (window.__perf = { lcp: [], shifts: [], long: [], loaf: [], events: [] });
  const tryObs = (type, fn, extra = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch {} };
  tryObs("largest-contentful-paint", (e) => w.lcp.push({ t: e.startTime, url: e.url, size: e.size, el: e.element }));
  tryObs("layout-shift", (e) => { if (!e.hadRecentInput) w.shifts.push({ v: e.value, t: e.startTime, node: e.sources?.[0]?.node || null }); });
  tryObs("longtask", (e) => w.long.push({ t: e.startTime, d: e.duration }));
  tryObs("long-animation-frame", (e) => w.loaf.push({ t: e.startTime, d: e.duration, block: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ url: s.sourceURL, fn: s.sourceFunctionName, inv: s.invoker, d: s.duration, forced: s.forcedStyleAndLayoutDuration })) }));
  tryObs("event", (e) => { if (e.interactionId) w.events.push({ id: e.interactionId, name: e.name, d: e.duration, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart, pres: e.startTime + e.duration - e.processingEnd, target: e.target }); }, { durationThreshold: 16 });
};

const COLLECT = () => {
  const sr = window.__sr; const w = window.__perf;
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const res = performance.getEntriesByType("resource");
  const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
  const last = w.lcp[w.lcp.length - 1] || null;
  let lcp = null;
  if (last) {
    const ttfb = nav.responseStart || 0;
    const r = last.url ? res.find((x) => x.name === last.url) : null;
    const loadStart = r ? Math.max(ttfb, r.requestStart || r.startTime) : ttfb;
    const loadEnd = r ? Math.max(loadStart, r.responseEnd) : loadStart;
    const el = last.el;
    // Is the LCP element (or an ancestor) entering with an animation / starting invisible?
    let anim = null;
    for (let n = el; n && n.nodeType === 1 && !anim; n = n.parentElement) { const a = n.getAnimations ? n.getAnimations() : []; if (a.some((x) => /opacity|transform/.test(JSON.stringify(x.effect?.getKeyframes?.() || [])))) anim = sr.label(n); }
    const img = el && el.tagName === "IMG" ? el : null;
    lcp = {
      t: last.t, url: last.url || null, el: el ? sr.label(el) : null, selector: el ? sr.cssPath(el) : null, owner: el ? sr.owner(el) : null, classes: el ? sr.classes(el) : "",
      ttfb, loadDelay: loadStart - ttfb, loadTime: loadEnd - loadStart, renderDelay: Math.max(0, last.t - loadEnd),
      initiator: r?.initiatorType || null, lazy: img ? img.loading === "lazy" : false, priority: img ? img.fetchPriority : null, anim,
      video: Boolean(el && el.tagName === "VIDEO"),
      bg: Boolean(last.url && el && !img && !/^(VIDEO|IMAGE|svg)$/i.test(el.tagName)), // a CSS background image
      transfer: r?.transferSize || 0,
    };
  }
  // CLS: largest session window.
  let cls = 0, cur = 0, start = 0, prev = -1e9;
  for (const s of w.shifts) { if (s.t - prev > 1000 || s.t - start > 5000) { cur = 0; start = s.t; } cur += s.v; prev = s.t; cls = Math.max(cls, cur); }
  const tbt = w.long.filter((l) => fcp == null || l.t >= fcp).reduce((s, l) => s + Math.max(0, l.d - 50), 0);
  const byType = {}, byOrigin = {}; let total = nav.transferSize || 0;
  for (const r of res) { const t = /\.(m?js)(\?|$)/.test(r.name) || r.initiatorType === "script" ? "js" : /\.css(\?|$)/.test(r.name) || r.initiatorType === "css" && /\.css/.test(r.name) ? "css" : /\.(woff2?|ttf|otf)(\?|$)/.test(r.name) ? "font" : r.initiatorType === "img" || /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(r.name) || /_next\/image/.test(r.name) ? "image" : /\.(mp4|webm|mov)(\?|$)/.test(r.name) ? "video" : "other";
    byType[t] = (byType[t] || 0) + (r.transferSize || 0); total += r.transferSize || 0;
    let o = ""; try { o = new URL(r.name).origin; } catch {} byOrigin[o] = (byOrigin[o] || 0) + (r.transferSize || 0); }
  // Chrome marks every parser-blocking file "blocking", even a script at the end of <body>; one that comes after
  // the page's content in the document can't hold up that content's first paint, so it isn't counted.
  const content = document.querySelector("main, h1, [role=main]");
  const after = new Set([...document.querySelectorAll("body script[src]")].filter((s) => content && (content.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && !content.contains(s)).map((s) => s.src));
  const isBlocking = (r) => r.renderBlockingStatus === "blocking" && !after.has(r.name);
  const blocking = res.filter(isBlocking).map((r) => r.name);
  const blockingFiles = res.filter(isBlocking).map((r) => ({ url: r.name, kb: Math.round((r.transferSize || 0) / 1024), end: Math.round(r.responseEnd) }));
  const dpr = devicePixelRatio;
  const imgs = [...document.images].filter((i) => i.naturalWidth && sr.visible(i)).map((i) => { const r = i.getBoundingClientRect(); const e = res.find((x) => x.name === i.currentSrc); return { src: i.currentSrc, el: sr.label(i), selector: sr.cssPath(i), owner: sr.owner(i), classes: sr.classes(i), ratio: i.naturalWidth / Math.max(1, r.width * dpr), shown: Math.round(r.width), natural: i.naturalWidth, above: r.top < innerHeight, lazy: i.loading === "lazy", bytes: e?.transferSize || 0, sized: i.hasAttribute("width") }; });
  const fonts = res.filter((r) => /\.(woff2?|ttf|otf)(\?|$)/.test(r.name)).map((r) => ({ url: r.name, bytes: r.transferSize }));
  const videos = [...document.querySelectorAll("video")].map((v) => ({ el: sr.label(v), selector: sr.cssPath(v), owner: sr.owner(v), autoplay: v.autoplay, preload: v.preload, poster: Boolean(v.poster) }));
  // Main-thread time by script origin (Long Animation Frames).
  const scriptTime = {};
  for (const f of w.loaf) for (const s of f.scripts) { let o = "(inline or unknown)"; try { if (s.url) o = new URL(s.url).origin; } catch {} scriptTime[o] = (scriptTime[o] || 0) + (s.d || 0); }
  const forced = w.loaf.flatMap((f) => f.scripts).filter((s) => s.forced > 30).map((s) => `${s.fn || s.inv || "?"} in ${(s.url || "").split("/").pop()} (${Math.round(s.forced)}ms forced layout)`).slice(0, 3);
  const longFrames = w.loaf.filter((f) => f.block > 200).map((f) => ({ t: Math.round(f.t), d: Math.round(f.d), top: f.scripts.sort((a, b) => b.d - a.d)[0] })).slice(0, 5).map((f) => `${f.d}ms at ${f.t}ms${f.top ? `: ${/\/cdn-cgi\/challenge-platform/.test(f.top.url || "") ? "Cloudflare's bot challenge script" : `${f.top.fn || "script"} in ${(f.top.url || "inline").split("/").pop().split("?")[0].slice(0, 50)}`}` : ""}`);
  const dev = res.some((r) => /react-refresh|webpack-hmr|\[turbopack\]|__nextjs_original-stack-frame|_next\/static\/chunks\/webpack\.js|@vite\/client|hot-update/.test(r.name)) || Boolean(document.querySelector("nextjs-portal, script[src*='react-refresh'], script[src*='@vite/client']"));
  return { ttfb: nav.responseStart || null, fcp, lcp, blockingFiles, cls: Math.round(cls * 1000) / 1000, tbt: Math.round(tbt), total, byType, byOrigin, requests: res.length + 1, blocking, imgs, fonts, videos, dom: document.getElementsByTagName("*").length, scriptTime, forced, longFrames, dev, origin: location.origin };
};

async function oneRun(i) {
  const ctx = await newContext(browser, url, { viewport: P.viewport, deviceScaleFactor: P.dpr, isMobile: P.mobile, hasTouch: P.mobile, userAgent: P.mobile ? "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" : undefined });
  await ctx.addInitScript(HELPERS); await ctx.addInitScript(OBSERVE);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (throttle) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: P.latency, downloadThroughput: (P.down * 1024) / 8, uploadThroughput: (P.up * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: P.cpu });
  }
  if (has("--coverage") && i === 0) await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
  try {
    await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await installHelpers(page);
    const m = await page.evaluate(COLLECT);
    let coverage = null;
    if (has("--coverage") && i === 0) {
      const js = await page.coverage.stopJSCoverage().catch(() => []);
      coverage = js.map((e) => { const total = e.source?.length || 0; const used = e.functions.flatMap((f) => f.ranges).filter((r) => r.count > 0).reduce((a, r) => a + (r.endOffset - r.startOffset), 0); return { url: e.url, total, unused: total ? Math.max(0, 1 - used / total) : 0 }; }).filter((x) => x.total > 50_000 && x.unused > 0.5).sort((a, b) => b.total * b.unused - a.total * a.unused).slice(0, 5);
    }
    return { m, page, ctx, coverage };
  } catch (e) { await ctx.close(); return { error: String(e.message).split("\n")[0] }; }
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await oneRun(i);
  if (r.error) { console.log(`run ${i + 1}: failed (${r.error})`); continue; }
  runs.push(r);
  console.log(`run ${i + 1}: LCP ${Math.round(r.m.lcp?.t ?? 0)}ms · CLS ${r.m.cls} · TBT ${r.m.tbt}ms · ${Math.round(r.m.total / 1024)} KB`);
  if (i < RUNS - 1) await r.ctx.close();
}
if (!runs.length) { console.error("every run failed"); await browser.close(); process.exit(2); }

const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const lcpMed = med(runs.map((r) => r.m.lcp?.t));
const pick = runs.reduce((a, b) => (Math.abs((b.m.lcp?.t ?? 0) - lcpMed) < Math.abs((a.m.lcp?.t ?? 0) - lcpMed) ? b : a));
const m = pick.m;
const S = { ttfb: med(runs.map((r) => r.m.ttfb)), fcp: med(runs.map((r) => r.m.fcp)), lcp: lcpMed, cls: med(runs.map((r) => r.m.cls)), tbt: med(runs.map((r) => r.m.tbt)), kb: Math.round(med(runs.map((r) => r.m.total)) / 1024), requests: med(runs.map((r) => r.m.requests)) };
const spread = (k) => { const v = runs.map((r) => (k === "lcp" ? r.m.lcp?.t : r.m[k])).filter((x) => x != null); return v.length > 1 ? Math.round(((Math.max(...v) - Math.min(...v)) / Math.max(1, med(v))) * 100) : 0; };
const mode = `${profile}${throttle ? `, Slow 4G + ${P.cpu}× CPU` : ", no throttling"}, ${runs.length} cold run(s), medians`;

if (m.dev) F.add({ type: "dev-server", el: m.origin, detail: "this is a dev server: timings are inflated and React runs in dev mode; measure next build && next start (or the deployed URL)", severity: "warn" });

// Core numbers.
const grade = (v, good, poor) => (v == null ? null : v > poor ? "fail" : v > good ? "warn" : null);
const lcpG = grade(S.lcp, 2500, 4000), clsG = grade(S.cls, 0.1, 0.25), tbtG = grade(S.tbt, 200, 600), ttfbG = grade(S.ttfb, 800, 1800);
if (lcpG) F.add({ type: "lcp", el: m.lcp?.el || "LCP", selector: m.lcp?.selector, owner: m.lcp?.owner, classes: m.lcp?.classes, detail: `LCP ${Math.round(S.lcp)}ms (good ≤ 2500) — TTFB ${Math.round(m.lcp?.ttfb ?? 0)} · load delay ${Math.round(m.lcp?.loadDelay ?? 0)} · load ${Math.round(m.lcp?.loadTime ?? 0)} · render delay ${Math.round(m.lcp?.renderDelay ?? 0)}ms`, severity: lcpG, fix: "fix the biggest of the four parts (see the LCP findings below)" });
if (clsG) F.add({ type: "cls", el: "page load", detail: `CLS ${S.cls} (good ≤ 0.1)`, severity: clsG, fix: "run layout-check for what moved and why" });
if (tbtG) F.add({ type: "tbt", el: "main thread", detail: `Total Blocking Time ${S.tbt}ms (good ≤ 200)`, severity: tbtG, fix: "less JavaScript on load: Server Components, dynamic() for heavy client parts, defer third parties" });
if (ttfbG) F.add({ type: "ttfb", el: "document", detail: `TTFB ${Math.round(S.ttfb)}ms (good ≤ 800)`, severity: ttfbG, fix: "cache the route (static / revalidate / 'use cache'), drop cookies()/headers() from layouts that don't need them, serve from a region near the data" });

// LCP diagnosis.
const L = m.lcp;
if (L && S.lcp) {
  const base = { el: L.el, selector: L.selector, owner: L.owner, classes: L.classes };
  if (L.lazy) F.add({ ...base, type: "lcp-lazy", detail: "the LCP image is loading=\"lazy\"", severity: "fail", fix: 'Next 16: <Image loading="eager" fetchPriority="high" …> (Next 15: priority); plain: remove loading="lazy", add fetchpriority="high"' });
  else if (L.url && !L.bg && !L.video && L.priority !== "high" && L.loadDelay > Math.max(150, S.lcp * 0.1)) F.add({ ...base, type: "lcp-priority", detail: `the LCP image starts loading ${Math.round(L.loadDelay)}ms after the HTML arrives (no fetchpriority="high")`, severity: "warn", fix: 'fetchPriority="high" (next/image: fetchPriority="high" loading="eager"); and sizes on fill images' });
  if (L.video) F.add({ ...base, type: "lcp-video-poster", detail: `the LCP is a video's poster (${(L.url || "").split("/").pop().split("?")[0].slice(0, 50)}), which the browser fetches late and at low priority`, severity: "warn", fix: '<link rel="preload" as="image" href="poster" fetchpriority="high"> (Next: ReactDOM.preload in the layout), or show an <Image fetchPriority="high"> first frame and fade the video in; preload="none" on the video' });
  if (L.bg) F.add({ ...base, type: "lcp-background", detail: "the LCP is a CSS background image, found late", severity: "warn", fix: 'make it an <img>/<Image> with fetchpriority="high", or <link rel="preload" as="image" fetchpriority="high">' });
  if (L.initiator === "script" || L.initiator === "fetch" || L.initiator === "xmlhttprequest") F.add({ ...base, type: "lcp-client", detail: "the LCP is rendered by JavaScript on the client", severity: "warn", fix: "render the hero on the server (Server Component); push 'use client' down to the interactive leaf" });
  if (L.renderDelay > Math.max(400, S.lcp * 0.3)) F.add({ ...base, type: "lcp-render-delay", kind: S.lcp > 2500 ? "issue" : "suggestion", detail: `the LCP paints ${Math.round(L.renderDelay)}ms after it's ready${L.anim ? ` (entrance animation on ${L.anim})` : " (hidden, animated in, waiting for fonts/JS, or client-rendered)"}`, severity: "warn", fix: "don't start the LCP element at opacity:0 or animate it in; animate a wrapper from opacity 0.01 or skip the first-paint animation" });
  if (L.transfer > 200 * 1024) F.add({ ...base, type: "lcp-heavy", detail: `the LCP image is ${Math.round(L.transfer / 1024)} KB`, severity: "warn", fix: "AVIF/WebP via next/image (images.formats: ['image/avif','image/webp']) and correct sizes; target ≤ 150 KB" });
}

// Weight.
const kb = (b) => Math.round(b / 1024);
const heaviest = Object.entries(m.byType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, b]) => `${t} ${kb(b)} KB`).join(", ");
if (S.kb > 4000) F.add({ type: "weight", el: "page", detail: `${S.kb} KB transferred (${heaviest})`, severity: "fail", fix: "start with the biggest type above" });
else if (S.kb > 2000) F.add({ type: "weight", el: "page", detail: `${S.kb} KB transferred (${heaviest}; aim ≤ 1.5 MB on phones)`, severity: "warn", fix: "start with the biggest type above" });
if ((m.byType.js || 0) > 1024 * 1024) F.add({ type: "js-weight", el: "JavaScript", detail: `${kb(m.byType.js)} KB of JS (compressed)`, severity: "fail", fix: "next analyze (Turbopack) / @next/bundle-analyzer; Server Components; dynamic() heavy client parts; optimizePackageImports for icon/util barrels" });
else if ((m.byType.js || 0) > 350 * 1024) F.add({ type: "js-weight", el: "JavaScript", detail: `${kb(m.byType.js)} KB of JS (aim ≤ 300 KB)`, severity: "warn", fix: "next analyze / @next/bundle-analyzer to see what's big; Server Components; dynamic() for heavy client parts; optimizePackageImports" });
if (m.dom > 3000) F.add({ type: "dom-size", el: "DOM", detail: `${m.dom} elements`, severity: "fail", fix: "virtualise long lists, paginate, don't render hidden mobile+desktop copies; content-visibility:auto on below-fold sections" });
else if (m.dom > 1500) F.add({ type: "dom-size", el: "DOM", detail: `${m.dom} elements (aim ≤ 1500)`, severity: "warn", fix: "virtualise long lists, paginate, content-visibility:auto on below-fold sections" });

// A first paint far behind the server: something blocks rendering.
if (S.fcp && S.ttfb != null && S.fcp - S.ttfb > 1500) {
  const files = [...(m.blockingFiles || [])].sort((a, b) => b.end - a.end).slice(0, 4);
  F.add({ type: "fcp", el: "first paint", detail: `first paint at ${Math.round(S.fcp)}ms, ${Math.round(S.fcp - S.ttfb)}ms after the HTML arrived${files.length ? `; blocked by ${files.map((f) => `${f.url.split("/").pop().split("?")[0].slice(0, 40)} (${f.kb} KB, done at ${f.end}ms)`).join(", ")}` : " (no render-blocking file reported: large HTML, a client-rendered shell or fonts)"}`, severity: S.fcp > 3000 ? "fail" : "warn", fix: "smaller critical CSS (Tailwind purges by default: check for a huge global CSS import or a CSS-in-JS runtime), no blocking scripts in <head>, fonts via next/font, and for a client-rendered shell: render the first screen on the server" });
}

// Render-blocking: scripts and third-party CSS are the actionable ones.
const own = (u) => { try { return new URL(u).origin === m.origin; } catch { return true; } };
const badBlock = m.blocking.filter((u) => /\.m?js(\?|$)/.test(u) || !own(u));
if (badBlock.length) F.add({ type: "render-blocking", el: badBlock.map((u) => u.split("/").slice(2).join("/").slice(0, 60)).slice(0, 3).join(", "), detail: `${badBlock.length} render-blocking file(s) (scripts or third-party CSS)`, severity: "warn", fix: "defer/async scripts (next/script strategy afterInteractive/lazyOnload); self-host fonts with next/font instead of Google Fonts <link>" });

// Images.
for (const i of m.imgs.filter((i) => i.ratio > 2 && i.bytes > 60 * 1024).slice(0, 4)) F.add({ type: "image-oversized", el: i.el, selector: i.selector, owner: i.owner, classes: i.classes, detail: `${i.natural}px wide shown at ${i.shown}px (${kb(i.bytes)} KB)`, severity: "warn", fix: "next/image with correct sizes (e.g. sizes=\"(min-width: 1024px) 33vw, 100vw\"); or srcset" });
for (const i of m.imgs.filter((i) => /\.(jpe?g|png)(\?|$)/i.test(i.src) && !/_next\/image|\/cdn-cgi\/image|format=|fm=/.test(i.src) && i.bytes > 100 * 1024).slice(0, 3)) F.add({ type: "image-format", el: i.el, selector: i.selector, owner: i.owner, classes: i.classes, detail: `${kb(i.bytes)} KB ${i.src.match(/\.(jpe?g|png)/i)?.[1]} (no AVIF/WebP)`, severity: "warn", fix: "serve AVIF/WebP (next/image does it; images.formats ['image/avif','image/webp'])" });
for (const i of m.imgs.filter((i) => i.above && i.lazy && (!L || i.src !== L.url)).slice(0, 3)) F.add({ type: "lazy-above-fold", el: i.el, selector: i.selector, owner: i.owner, classes: i.classes, detail: "lazy-loaded but on the first screen", severity: "warn", fix: "loading=\"eager\" for first-screen images" });

// Fonts and video.
if (m.fonts.length > 4) F.add({ type: "fonts", el: `${m.fonts.length} font files`, detail: `${m.fonts.length} font files, ${kb(m.fonts.reduce((s, f) => s + f.bytes, 0))} KB`, severity: "warn", fix: "one variable font via next/font with subsets: ['latin']; drop unused weights" });
for (const v of m.videos.filter((v) => v.autoplay && (v.preload === "auto" || !v.poster)).slice(0, 2)) F.add({ type: "video", el: v.el, selector: v.selector, owner: v.owner, detail: `autoplay video${v.poster ? "" : " without a poster"}${v.preload === "auto" ? ", preload=auto" : ""}`, severity: "warn", fix: '<video muted playsInline autoPlay loop preload="none" poster="/hero.avif">; a still on phones; keep it ≤ 1-2 MB' });

// Third parties and long frames.
const third = Object.entries(m.scriptTime).filter(([o]) => o !== m.origin && o.startsWith("http")).sort((a, b) => b[1] - a[1]);
for (const [o, ms] of third.filter(([, ms]) => ms > 150).slice(0, 4)) F.add({ type: "third-party", el: o, detail: `${Math.round(ms)}ms of main-thread time${m.byOrigin[o] ? `, ${kb(m.byOrigin[o])} KB` : ""}`, severity: ms > 500 ? "fail" : "warn", fix: "next/script strategy=\"lazyOnload\" (chat, widgets), afterInteractive only for analytics; a facade for embeds (YouTube, maps, chat)" });
for (const f of m.longFrames) F.add({ type: "long-frame", el: "main thread", detail: `long animation frame ${f}`, severity: "warn", fix: "break up the work (scheduler.yield / setTimeout), move it off load, or lazy-load the component" });
for (const f of m.forced) F.add({ type: "layout-thrash", el: "script", detail: `forced synchronous layout: ${f}`, severity: "warn", fix: "read layout (offsetWidth, getBoundingClientRect) before writing styles, batched in requestAnimationFrame" });
for (const c of pick.coverage || []) F.add({ type: "unused-js", el: c.url.split("/").slice(-2).join("/"), detail: `${Math.round(c.unused * 100)}% of ${kb(c.total)} KB unused at load`, severity: "warn", fix: "split it: dynamic() import on interaction, or move to Server Components" });

// Interaction latency on the median run's page: click the main controls with the CPU still throttled.
let interactions = [];
if (!has("--no-interact")) {
  const page = pick.page;
  try {
    await dismissPopups(page);
    const n = await page.evaluate(() => { const sr = window.__sr; const els = [...document.querySelectorAll('button,[role=tab],[role=button],[aria-expanded],summary')].filter((e) => sr.visible(e) && !e.disabled && !e.closest("form") && e.getBoundingClientRect().top < innerHeight * 2).slice(0, 6); els.forEach((e, i) => e.setAttribute("data-sr-click", String(i))); return els.length; });
    for (let i = 0; i < n; i++) { await page.locator(`[data-sr-click="${i}"]`).click({ timeout: 2000, trial: false }).catch(() => {}); await page.waitForTimeout(500); await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(200); }
    interactions = await page.evaluate(() => { const by = new Map(); for (const e of window.__perf.events) { const p = by.get(e.id); if (!p || e.d > p.d) by.set(e.id, e); } return [...by.values()].map((e) => ({ d: Math.round(e.d), delay: Math.round(e.delay), proc: Math.round(e.proc), pres: Math.round(e.pres), name: e.name, el: e.target && e.target.nodeType === 1 ? window.__sr.label(e.target) : "?", selector: e.target && e.target.nodeType === 1 ? window.__sr.cssPath(e.target) : null, owner: e.target && e.target.nodeType === 1 ? window.__sr.owner(e.target) : null })).sort((a, b) => b.d - a.d); });
    for (const x of interactions.filter((x) => x.d > 200).slice(0, 4)) {
      const worst = x.delay >= x.proc && x.delay >= x.pres ? "input delay (main thread busy)" : x.proc >= x.pres ? "processing (the handler or re-render)" : "presentation (layout/paint after it)";
      F.add({ type: "slow-interaction", el: x.el, selector: x.selector, owner: x.owner, detail: `${x.name} took ${x.d}ms (good ≤ 200): delay ${x.delay} · processing ${x.proc} · presentation ${x.pres}; worst: ${worst}`, severity: x.d > 500 ? "fail" : "warn", fix: /delay/.test(worst) ? "less work on the main thread at that moment (hydration, timers, third parties): scheduler.yield(), defer scripts" : /processing/.test(worst) ? "update the UI first, then the heavy work (startTransition, await scheduler.yield()); memoise; smaller state updates" : "smaller DOM and re-render scope; content-visibility:auto; avoid layout-heavy styles on toggle" });
    }
  } catch {}
}
await pick.ctx.close().catch(() => {});
await browser.close();

console.log(`\n${mode}`);
console.log(`TTFB ${Math.round(S.ttfb ?? 0)} · FCP ${Math.round(S.fcp ?? 0)} · LCP ${Math.round(S.lcp ?? 0)}ms (±${spread("lcp")}%) · CLS ${S.cls} · TBT ${S.tbt}ms · ${S.kb} KB in ${S.requests} requests · DOM ${m.dom}`);
if (L) console.log(`LCP element: ${L.el}${L.url ? ` (${L.url.split("/").pop().slice(0, 60)})` : ""}`);
if (third.length) console.log(`third-party main-thread time: ${third.slice(0, 4).map(([o, ms]) => `${o.replace(/^https?:\/\//, "")} ${Math.round(ms)}ms`).join(", ")}`);
if (interactions.length) console.log(`interactions tested: ${interactions.length}, slowest ${interactions[0].d}ms (${interactions[0].el})`);
if (runs.length > 1 && spread("lcp") > 20) console.log(`note: LCP varied ${spread("lcp")}% between runs; use --runs 5+ before comparing`);
// Field data (opt-in, public URLs only).
let field = null;
if (has("--field")) {
  const pub = /^https:\/\//.test(url) && !/^https:\/\/(localhost|127\.|10\.|192\.168\.|[^/]*\.local\b)/.test(url);
  if (!pub) console.log("field data: skipped (only for public https URLs)");
  else {
    try {
      const metric = (p75, good, poor) => ({ p75, rating: p75 == null ? null : p75 <= good ? "good" : p75 <= poor ? "needs improvement" : "poor" });
      if (process.env.CRUX_API_KEY) {
        const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${process.env.CRUX_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, formFactor: profile === "desktop" ? "DESKTOP" : "PHONE" }) });
        const j = await res.json();
        if (j.record) { const m2 = j.record.metrics; const p = (k) => (m2[k] ? Number(m2[k].percentiles.p75) : null);
          field = { source: "CrUX API (this URL)", lcp: metric(p("largest_contentful_paint"), 2500, 4000), inp: metric(p("interaction_to_next_paint"), 200, 500), cls: metric(p("cumulative_layout_shift"), 0.1, 0.25), fcp: metric(p("first_contentful_paint"), 1800, 3000), ttfb: metric(p("experimental_time_to_first_byte"), 800, 1800) }; }
        else field = { source: "CrUX API", none: j.error?.message || "no record (not enough traffic)" };
      } else {
        const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${profile === "desktop" ? "desktop" : "mobile"}&category=performance${process.env.PSI_API_KEY ? `&key=${process.env.PSI_API_KEY}` : ""}`);
        const j = await res.json();
        const le = j.loadingExperience?.metrics && Object.keys(j.loadingExperience.metrics).length ? j.loadingExperience : j.originLoadingExperience;
        if (le?.metrics) { const p = (k) => le.metrics[k]?.percentile ?? null; const scope = le === j.loadingExperience ? "this URL" : "whole origin";
          field = { source: `PageSpeed Insights field data (${scope})`, lcp: metric(p("LARGEST_CONTENTFUL_PAINT_MS"), 2500, 4000), inp: metric(p("INTERACTION_TO_NEXT_PAINT"), 200, 500), cls: metric(p("CUMULATIVE_LAYOUT_SHIFT_SCORE") != null ? p("CUMULATIVE_LAYOUT_SHIFT_SCORE") / 100 : null, 0.1, 0.25), fcp: metric(p("FIRST_CONTENTFUL_PAINT_MS"), 1800, 3000), ttfb: metric(p("EXPERIMENTAL_TIME_TO_FIRST_BYTE"), 800, 1800) }; }
        else field = { source: "PageSpeed Insights", none: j.error?.message || "no field data (not enough Chrome traffic)" };
      }
      if (field.none) console.log(`field data: ${/quota/i.test(field.none) ? "the shared key-less quota is used up today; set CRUX_API_KEY (or PSI_API_KEY), a free Google Cloud key, for your own quota" : field.none}`);
      else {
        console.log(`field (p75, ${field.source}): ${["lcp", "inp", "cls", "fcp", "ttfb"].filter((k) => field[k].p75 != null).map((k) => `${k.toUpperCase()} ${field[k].p75}${k === "cls" ? "" : "ms"} ${field[k].rating}`).join(" · ")}`);
        for (const k of ["lcp", "inp", "cls"]) if (field[k].rating && field[k].rating !== "good") F.add({ type: `field-${k}`, el: "real visitors (p75)", detail: `${k.toUpperCase()} ${field[k].p75}${k === "cls" ? "" : "ms"} is ${field[k].rating} for real visitors (${field.source})`, severity: field[k].rating === "poor" ? "fail" : "warn", fix: "the lab findings above show the likely causes; field numbers move about 28 days after a fix ships" });
      }
    } catch (e) { console.log(`field data: failed (${String(e.message).split("\n")[0]})`); }
  }
}
const summary = F.print();
F.write(out, { url, mode, field, medians: S, lcp: L, byType: Object.fromEntries(Object.entries(m.byType).map(([k, v]) => [k, kb(v)])), thirdParty: Object.fromEntries(third.slice(0, 8)), interactions: interactions.slice(0, 8), runs: runs.map((r) => ({ lcp: r.m.lcp?.t, cls: r.m.cls, tbt: r.m.tbt, kb: kb(r.m.total) })), seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(summary.fails ? 1 : 0);
