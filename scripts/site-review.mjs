#!/usr/bin/env node
// site-review.mjs: look at a website the way a visitor does, at desktop and phone, and measure what the eye
// can't: speed, layout shift, overflow, contrast, tap sizes, broken images, console errors, SEO basics and
// template tells. Writes screenshots (first screen, each section, the full page) and review.json.
//
//   node site-review.mjs <url | file.html> [--out dir] [--pages /,/pricing] [--max-sections 12]
//        [--desktop 1440x900] [--phone 390x844] [--no-sections] [--hero]
//
//   --hero   the first screen only (no full page, no sections): fast, for judging a hero
//
// Needs Playwright (or playwright-core with a Chromium) in the current project: pnpm add -D playwright

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { newContext, HELPERS, Findings } from "./lib.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--out", "--pages", "--max-sections", "--desktop", "--phone", "--kind", "--storage", "--cookie", "--scheme"]);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const target = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
if (!target) {
  console.error("usage: site-review.mjs <url | file.html> [--out dir] [--pages /,/pricing] [--max-sections 12] [--no-sections]");
  process.exit(2);
}
const outDir = resolve(opt("--out", "site-review"));
const maxSections = Math.max(0, Number(opt("--max-sections", 12)) || 12);
const heroOnly = args.includes("--hero");
// site: a marketing page (CTA, SEO, share card, template tells are judged). app: a tool or dashboard screen
// (those are skipped). auto: app when the page has no description and no share image, or looks like a tool
// (one screen tall, tabs or form controls, no footer).
const kindOpt = opt("--kind", "auto");
if (!/^(auto|site|app)$/.test(kindOpt)) { console.error("--kind must be auto, site or app"); process.exit(2); }
let kind = kindOpt === "auto" ? null : kindOpt;
const withSections = !args.includes("--no-sections") && !heroOnly;
const size = (s, d) => { const [w, h] = String(s).split("x").map(Number); return w > 0 && h > 0 ? { width: w, height: h } : d; };
const VIEWS = [
  { name: "desktop", ...size(opt("--desktop", "1440x900"), { width: 1440, height: 900 }), mobile: false },
  { name: "phone", ...size(opt("--phone", "390x844"), { width: 390, height: 844 }), mobile: true },
];

let chromium;
const req = createRequire(join(process.cwd(), "package.json"));
for (const mod of ["playwright", "playwright-core"]) {
  try { ({ chromium } = req(mod)); break; } catch {}
}
if (!chromium) { console.error("Playwright isn't installed in this project. Run: pnpm add -D playwright && npx playwright install chromium"); process.exit(2); }

const base = /^https?:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href;
const pages = (opt("--pages", "") || "").split(",").map((p) => p.trim()).filter(Boolean);
const urls = pages.length && /^https?:/.test(base) ? pages.map((p) => new URL(p, base).href) : [base];

mkdirSync(outDir, { recursive: true });
const lines = [];
const O = new Findings("overview");
const say = (level, msg) => { lines.push(`${level.padEnd(5)} ${msg}`); console.log(`${level.padEnd(5)} ${msg}`); };
const slug = (u) => { try { const p = new URL(u).pathname.replace(/\/+$/, "") || "/home"; return p.replace(/^\//, "").replace(/[^\w-]+/g, "-") || "home"; } catch { return "page"; } };

// Runs in the page before anything else: LCP and CLS observers.
const OBSERVE = () => {
  window.__rv = { lcp: null, lcpEl: null, cls: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__rv.lcp = e.startTime; window.__rv.lcpEl = e.element ? (e.element.tagName.toLowerCase() + (e.url ? ` ${e.url.split("/").pop().slice(0, 60)}` : "")) : null; } }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__rv.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  } catch {}
};

// Sites that scroll inside a container (body fixed, a div scrolls) look one screen tall to a full-page
// screenshot. Unroll that container so the document is the page again. Returns what it changed.
const UNROLL = () => {
  if (document.documentElement.scrollHeight > innerHeight + 40) return null;
  let best = null;
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight < el.clientHeight * 1.5 || el.clientHeight < innerHeight * 0.5) continue;
    if (!best || el.scrollHeight > best.scrollHeight) best = el;
  }
  if (!best) return null;
  for (let n = best; n && n !== document; n = n.parentElement) {
    n.style.setProperty("overflow", "visible", "important");
    n.style.setProperty("height", "auto", "important");
    n.style.setProperty("max-height", "none", "important");
  }
  return `${best.tagName.toLowerCase()}${best.id ? "#" + best.id : ""}${best.className && typeof best.className === "string" ? "." + best.className.trim().split(/\s+/)[0] : ""}`;
};

// Runs in the page after load: everything measured from the DOM.
const INSPECT = (opts) => {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const label = (el) => { const t = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 50); return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${t ? ` "${t}"` : ""}`; };
  const rgb = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // Pictures, videos and canvases anywhere on the page: text on top of one can't be measured from CSS.
  const media = [...document.querySelectorAll("img, video, canvas, picture, iframe")].filter(visible).map((m) => m.getBoundingClientRect()).filter((r) => r.width > 60 && r.height > 60);
  const overMedia = (el) => { const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return media.some((m) => cx > m.left && cx < m.right && cy > m.top && cy < m.bottom); };
  const pageBg = () => { for (const n of [document.body, document.documentElement]) { const c = rgb(getComputedStyle(n).backgroundColor); if (c && c.a > 0.9) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  // Composite the background layers under a list of elements, top first, down to the first opaque one.
  // null when a picture, video, canvas or gradient is behind the text: judge that on the screenshot.
  const composite = (nodes, el) => {
    const layers = [];
    for (const n of nodes) {
      if (n !== el && el.contains(n)) continue;
      if (/^(IMG|VIDEO|CANVAS|IFRAME|PICTURE)$/.test(n.tagName) || n.tagName.toLowerCase() === "image") return null;
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = rgb(s.backgroundColor);
      if (c && c.a > 0.02) { layers.push(c); if (c.a > 0.98) break; }
    }
    return layers.reverse().reduce((acc, c) => over(c, acc), pageBg());
  };
  // What is painted under the text: the hit-test stack at the middle of its first line. This sees a selected
  // pill or card that is a positioned sibling behind the text, not an ancestor (a segmented control).
  const bgOf = (el) => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const line = [...rg.getClientRects()].find((q) => q.width > 2 && q.height > 2);
    if (line) {
      const x = line.left + line.width / 2, y = line.top + line.height / 2;
      if (x > 0 && y > 0 && x < vw && y < vh) {
        const stack = document.elementsFromPoint(x, y);
        let i = stack.indexOf(el);
        if (i < 0) i = stack.findIndex((n) => n.contains(el)); // pointer-events: none text: start at its nearest ancestor
        if (i >= 0) return composite(stack.slice(i), el);
      }
    }
    if (overMedia(el)) return null;
    const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    return composite(chain, el);
  };

  // Text: small sizes, contrast.
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) { const el = walker.currentNode.parentElement; if (el && walker.currentNode.textContent.trim().length > 1 && !seen.has(el)) { seen.add(el); texts.push(el); } }
  let small = 0; const smallSamples = []; const smallList = []; const lowContrast = []; let unmeasured = 0; let measured = 0;
  const who = (el) => (window.__sr ? window.__sr.describe(el) : { el: label(el) });
  // Every text is brought into view before its background is hit-tested (scrollIntoView scrolls the window
  // and any scrolling panel it sits in), in page order so the scrolling is mostly forward. Scroll positions
  // are put back afterwards, so the screenshots that follow are unchanged.
  const scrollers = [document.scrollingElement, ...[...document.querySelectorAll("body *")].filter((n) => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY))].filter(Boolean);
  const saved = scrollers.map((n) => [n, n.scrollTop, n.scrollLeft]);
  const pageY = (el) => el.getBoundingClientRect().top + scrollY;
  const queue = texts.slice(0, 2500).filter((el) => visible(el) && !(window.__sr && window.__sr.ignored(el))).sort((a, b) => pageY(a) - pageY(b));
  for (const el of queue) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const s = getComputedStyle(el); const px = parseFloat(s.fontSize);
    if (px < 12) { small++; if (smallSamples.length < 5) smallSamples.push(`${label(el)} ${px}px`); if (smallList.length < 40) smallList.push({ ...who(el), size: px }); }
    let fg = rgb(s.color); const bg = bgOf(el);
    if (!fg) continue; if (!bg) { unmeasured++; continue; }
    if (fg.a < 1) fg = over(fg, bg);
    measured++;
    const cr = ratio(fg, bg); const large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
    if (cr < (large ? 3 : 4.5)) lowContrast.push({ ...who(el), label: label(el), ratio: Math.round(cr * 100) / 100, size: px, need: large ? 3 : 4.5 });
  }
  for (const [n, t, l] of saved) { n.scrollTop = t; n.scrollLeft = l; }

  // Tap targets (phone).
  const taps = [];
  if (opts.mobile) for (const el of document.querySelectorAll("a[href], button, [role=button], input, select, textarea")) {
    if (!visible(el)) continue; const r = el.getBoundingClientRect();
    if (r.width < 44 && r.height < 44 || r.height < 32) taps.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  // Overflow.
  const overflow = document.documentElement.scrollWidth > vw + 1;
  const wide = [];
  if (overflow) for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.right > vw + 2 && r.width > 0 && getComputedStyle(el).position !== "fixed") { wide.push(`${label(el)} right edge ${Math.round(r.right)}px`); if (wide.length >= 5) break; } }

  // Images.
  const imgs = [...document.images];
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src")).map((i) => (i.currentSrc || i.src).split("/").pop().slice(0, 60));
  const noAlt = imgs.filter((i) => !i.hasAttribute("alt") && visible(i)).length;
  const oversized = imgs.filter((i) => visible(i) && i.naturalWidth > 0 && i.naturalWidth > i.getBoundingClientRect().width * 2.5 * devicePixelRatio && i.naturalWidth > 1200).map((i) => `${(i.currentSrc || i.src).split("/").pop().slice(0, 50)} ${i.naturalWidth}px shown at ${Math.round(i.getBoundingClientRect().width)}px`).slice(0, 5);

  // Headings, SEO, fonts.
  const h1s = [...document.querySelectorAll("h1")].filter(visible).map((h) => h.innerText.trim().replace(/\s+/g, " ").slice(0, 120));
  const meta = (n) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute("content") || null;
  const families = new Set();
  for (const el of texts.slice(0, 1500)) if (visible(el)) families.add(getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim());

  // First screen: the h1 and the first clear call to action.
  const h1 = document.querySelector("h1");
  const h1Box = h1 && visible(h1) ? h1.getBoundingClientRect() : null;
  const ctas = [...document.querySelectorAll("a[href], button")].filter((el) => {
    if (!visible(el)) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const filled = (rgb(s.backgroundColor)?.a ?? 0) > 0.5 || (s.backgroundImage && s.backgroundImage !== "none");
    return filled && r.height >= 32 && r.width >= 80 && (el.innerText || "").trim().length > 1 && !el.closest("nav, header");
  });
  // A form's submit is its call to action even while it's disabled or dimmed until the form is filled in.
  const submit = [...document.querySelectorAll("form button[type=submit], form button:not([type]), form input[type=submit]")].find((el) => visible(el) && !el.closest("nav, header") && [...el.form.elements].some((e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && e.type !== "hidden" && visible(e)));
  const firstCta = [...ctas, ...(submit ? [submit] : [])].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  // A form's submit button sits at the end by design: there the first action is the form's first field.
  const formStart = firstCta && firstCta.form ? [...firstCta.form.elements].find((e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && e.type !== "hidden" && visible(e)) : null;
  const ctaBox = (formStart || firstCta)?.getBoundingClientRect();

  // Template tells.
  const tells = [];
  const gradText = [...document.querySelectorAll("h1, h2, h1 *, h2 *")].filter((el) => { const s = getComputedStyle(el); return (s.backgroundClip === "text" || s.webkitBackgroundClip === "text") && s.backgroundImage.includes("gradient"); });
  if (gradText.length) tells.push(`gradient text in a heading (${label(gradText[0])})`);
  const purple = [...document.querySelectorAll("body *")].slice(0, 3000).some((el) => { const g = getComputedStyle(el).backgroundImage; if (!g.includes("gradient")) return false; const cs = [...g.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(/[ ,]+/).map(Number)); return cs.some(([r, gg, b]) => b > 150 && r > 80 && r < 200 && gg < 120); });
  if (purple) tells.push("purple / indigo gradient");
  if (h1) {
    let prev = h1.previousElementSibling || h1.parentElement?.previousElementSibling;
    if (prev && visible(prev)) { const s = getComputedStyle(prev); const r = prev.getBoundingClientRect(); if (parseFloat(s.borderRadius) >= 12 && r.height < 44 && (prev.innerText || "").trim().split(/\s+/).length <= 8) tells.push(`eyebrow pill above the h1 ("${prev.innerText.trim().slice(0, 40)}")`); }
  }
  const rows = new Map();
  for (const el of document.querySelectorAll("section *, main *")) {
    const p = el.parentElement; if (!p || rows.has(p)) continue;
    const kids = [...p.children].filter(visible); if (kids.length !== 3) continue;
    const rs = kids.map((k) => k.getBoundingClientRect());
    if (rs[0].width > 200 && rs.every((r) => Math.abs(r.top - rs[0].top) < 4 && Math.abs(r.width - rs[0].width) < 4 && r.height > 150)) rows.set(p, true);
  }
  if (rows.size >= 2) tells.push(`${rows.size} rows of three equal cards`);
  const logoStrips = [...document.querySelectorAll("section, div")].filter((d) => { const im = [...d.children].filter((c) => c.tagName === "IMG" || c.querySelector?.(":scope > img, :scope > svg")); if (im.length < 4) return false; const f = getComputedStyle(d).filter + im.map((c) => getComputedStyle(c).filter + getComputedStyle(c).opacity).join(); return /grayscale|0\.[3-6]/.test(f); });
  if (logoStrips.length) tells.push("grey logo strip");

  // A popup, cookie wall or overlay in front of the first screen.
  const cover = [...document.querySelectorAll("body *")].find((el) => {
    const st = getComputedStyle(el); if (st.position !== "fixed" || !visible(el)) return false;
    const r = el.getBoundingClientRect(); const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return area > vw * vh * 0.18 && r.height > 160 && el.querySelector("button, a, [role=dialog], [aria-modal]") && !el.matches("header, nav") && !el.closest("header, nav") && !el.querySelector("h1");
  });
  const overlay = cover ? label(cover.querySelector("h1, h2, h3, p, button") || cover) : null;

  // Sections: the page's big blocks, for cropping.
  const root = document.querySelector("main") || document.body;
  // A section spans most of the width; a grid's cards don't.
  const big = (el) => { if (!visible(el)) return false; const r = el.getBoundingClientRect(); return r.height > 160 && r.width >= vw * 0.7; };
  let blocks = [...root.children].filter(big);
  // Wrappers: while one block holds most of the page, open it up (a few levels at most).
  for (let depth = 0; depth < 8 && blocks.length <= 2; depth++) {
    const inner = blocks.flatMap((b) => { const k = [...b.children].filter(big); return k.length ? k : [b]; });
    if (inner.length < blocks.length || inner.every((el, i) => el === blocks[i])) break;
    blocks = inner;
  }
  const tops = new Set();
  blocks = blocks.filter((el) => { const t = Math.round(el.getBoundingClientRect().top); if (tops.has(t)) return false; tops.add(t); return true; });
  const header = document.querySelector("header");
  let sections = blocks.map((el) => { const r = el.getBoundingClientRect(); const h = el.querySelector("h1, h2, h3"); return { tag: el.tagName.toLowerCase(), top: Math.round(r.top + scrollY), height: Math.round(r.height), heading: h ? h.innerText.trim().replace(/\s+/g, " ").slice(0, 70) : null }; });
  // No clear sections (one long grid, a canvas page): slice it into screens instead.
  if (sections.length < 3) {
    const H = document.documentElement.scrollHeight; sections = [];
    for (let y = 0; y < Math.min(H, vh * 10); y += vh) sections.push({ tag: "screen", top: y, height: Math.min(vh, H - y), heading: null });
  }

  return {
    assets: [...document.querySelectorAll("script[src], link[rel=stylesheet][href]")].map((e) => e.getAttribute("src") || e.getAttribute("href")).filter((u) => !/googletagmanager|analytics|cdn-cgi/.test(u)).sort(),
    signals: { footer: !!document.querySelector("footer, [role=contentinfo]"), tablist: !!document.querySelector("[role=tablist], [role=application], [role=toolbar]"), controls: [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(visible).length },
    title: document.title, description: meta("description"), ogImage: meta("og:image"), lang: document.documentElement.lang || null,
    viewportMeta: !!document.querySelector('meta[name="viewport"]'), pageHeight: document.documentElement.scrollHeight,
    h1s, fonts: [...families].slice(0, 12),
    firstScreen: { h1Words: h1 ? h1.innerText.trim().split(/\s+/).length : null, h1Bottom: h1Box ? Math.round(h1Box.bottom) : null, h1Lines: h1Box && h1 ? Math.round(h1Box.height / (parseFloat(getComputedStyle(h1).lineHeight) || parseFloat(getComputedStyle(h1).fontSize) * 1.1)) : null, h1Size: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null, cta: firstCta ? { text: formStart ? `${firstCta.innerText.trim().slice(0, 30)} (a form: its first field)` : firstCta.innerText.trim().replace(/\s+/g, " ").slice(0, 40), top: Math.round(ctaBox.top), height: Math.round(ctaBox.height), inView: ctaBox.bottom <= vh } : null },
    text: { small, smallSamples, smallList, lowContrast: lowContrast.slice(0, 60), lowContrastCount: lowContrast.length, measured, unmeasured },
    themes: (() => { let media = false, darkClass = false; const walk = (rules) => { for (const r of rules) { const m = r.conditionText || r.media?.mediaText || ""; if (/prefers-color-scheme:\s*dark/.test(m)) media = true; if (r.selectorText && /(^|[\s,])\.dark[\s:,]|:where\(\.dark/.test(r.selectorText)) darkClass = true; if (r.cssRules) walk(r.cssRules); } }; for (const st of document.styleSheets) { try { walk(st.cssRules); } catch {} } return { media, darkClass, current: matchMedia("(prefers-color-scheme: dark)").matches || document.documentElement.classList.contains("dark") ? "dark" : "light" }; })(),
    taps: { count: taps.length, samples: taps.slice(0, 6) }, overflow: { overflow, wide },
    images: { total: imgs.length, broken, noAlt, oversized }, tells, overlay, sections, headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
  };
};

const browser = await chromium.launch();
const report = { target: base, when: new Date().toISOString(), pages: [] };
try {
  for (const url of urls) {
    const pageDir = urls.length > 1 ? join(outDir, slug(url)) : outDir;
    mkdirSync(pageDir, { recursive: true });
    const pageReport = { url, views: {} };
    say("INFO", `── ${url}`);
    for (const v of VIEWS) {
      const ctx = await newContext(browser, base, { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile, userAgent: v.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
      await ctx.addInitScript(OBSERVE); await ctx.addInitScript(HELPERS);
      const page = await ctx.newPage();
      const errors = []; const failed = [];
      page.on("console", (m) => { if (m.type() === "error" && !/status of 413|cdn-cgi/.test(m.text())) errors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
      const noise = (u) => /\/cdn-cgi\/(challenge-platform|rum)|google-analytics|googletagmanager|doubleclick|clarity\.ms|hotjar/.test(u);
      page.on("response", (r) => { if (r.status() >= 400 && !noise(r.url())) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
      page.on("requestfailed", (r) => { const f = r.failure()?.errorText || ""; if (!/ERR_ABORTED/.test(f) && !noise(r.url())) failed.push(`${f} ${r.url().slice(0, 120)}`); });
      const t0 = Date.now();
      try { await page.goto(url, { waitUntil: "load", timeout: 45_000 }); } catch (e) { say("FAIL", `${v.name}: page did not load: ${String(e.message).split("\n")[0]}`); await ctx.close(); continue; }
      const loadMs = Date.now() - t0;
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(pageDir, `${v.name}-first.jpg`), type: "jpeg", quality: 82 });
      const vitals = await page.evaluate(() => ({ ...window.__rv, transfer: performance.getEntriesByType("resource").reduce((s, e) => s + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0), requests: performance.getEntriesByType("resource").length }));
      const unrolled = heroOnly ? null : await page.evaluate(UNROLL);
      if (unrolled) say("INFO", `${v.name} the page scrolls inside ${unrolled}; unrolled it to capture the whole page`);
      // Scroll through once so lazy content and scroll animations settle, then measure.
      if (!heroOnly) await page.evaluate(async () => { const step = innerHeight * 0.8; const end = Math.min(document.documentElement.scrollHeight, 14000); for (let y = 0; y < end; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400)); });
      const dom = await page.evaluate(INSPECT, { mobile: v.mobile });
      const cls = await page.evaluate(() => window.__rv.cls);
      const fullH = Math.min(dom.pageHeight, 14_000);
      if (!heroOnly) await page.screenshot({ path: join(pageDir, `${v.name}-full.jpg`), type: "jpeg", quality: 70, fullPage: true, clip: { x: 0, y: 0, width: v.width, height: fullH } }).catch(() => {});
      const crops = [];
      if (withSections && !v.mobile) {
        mkdirSync(join(pageDir, "sections"), { recursive: true });
        for (const [i, s] of dom.sections.slice(0, maxSections).entries()) {
          const h = Math.min(s.height, 2400); if (s.top >= fullH) break;
          const file = join(pageDir, "sections", `${String(i + 1).padStart(2, "0")}.jpg`);
          await page.screenshot({ path: file, type: "jpeg", quality: 78, fullPage: true, clip: { x: 0, y: s.top, width: v.width, height: Math.min(h, fullH - s.top) } }).catch(() => {});
          if (existsSync(file)) crops.push({ file: `sections/${String(i + 1).padStart(2, "0")}.jpg`, ...s });
        }
      }
      if (!kind) {
        const sg = dom.signals;
        // A tool fits one screen and is driven by tabs and inputs; a website scrolls through sections.
        const oneScreen = dom.pageHeight <= v.height * 1.3;
        // A page with both a description and a share image is made to be found and shared: a website.
        const shared = dom.description && dom.ogImage;
        kind = heroOnly || shared ? "site" : (!dom.description && !dom.ogImage) || (oneScreen && !sg.footer && (sg.tablist || sg.controls >= 2)) ? "app" : "site";
        say("INFO", `judged as ${kind === "app" ? "an app screen: call-to-action, SEO, share card and template-tell checks skipped" : "a website"} (--kind ${kind === "app" ? "site" : "app"} to change)`);
      }
      const view = { ...v, loadMs, lcpMs: vitals.lcp != null ? Math.round(vitals.lcp) : null, lcpEl: vitals.lcpEl, cls: Math.round(cls * 1000) / 1000, transferKB: Math.round(vitals.transfer / 1024), requests: vitals.requests, consoleErrors: [...new Set(errors)].slice(0, 8), failedRequests: [...new Set(failed)].slice(0, 8), ...dom, crops };
      pageReport.views[v.name] = view;
      await ctx.close();

      // Verdict lines.
      const n = v.name;
      const lcp = view.lcpMs;
      if (lcp != null) say(lcp > 4000 ? "FAIL" : lcp > 2500 ? "WARN" : "PASS", `${n} LCP ${lcp} ms${view.lcpEl ? ` (${view.lcpEl})` : ""}, unthrottled from this machine`);
      say(view.cls > 0.25 ? "FAIL" : view.cls > 0.1 ? "WARN" : "PASS", `${n} CLS ${view.cls}`);
      say(view.transferKB > 5000 ? "FAIL" : view.transferKB > 2500 ? "WARN" : "PASS", `${n} page weight ${view.transferKB} KB in ${view.requests} requests`);
      if (view.consoleErrors.length) say("WARN", `${n} ${view.consoleErrors.length} console error(s): ${view.consoleErrors[0]}`);
      if (view.failedRequests.length) say("WARN", `${n} ${view.failedRequests.length} failed request(s): ${view.failedRequests[0]}`);
      if (view.overflow.overflow) say("FAIL", `${n} sideways scroll: ${view.overflow.wide[0] ?? "content wider than the screen"}`);
      const site = kind === "site";
      if (view.h1s.length !== 1) say(site ? "WARN" : "INFO", `${n} ${view.h1s.length} visible <h1> (want exactly one)`);
      if (view.overlay) say("WARN", `${n} a popup covers the first screen on arrival (${view.overlay}); the call-to-action check below may be reading it`);
      const fs = view.firstScreen;
      if (!site) {} else if (fs.cta) say(fs.cta.inView ? "PASS" : "FAIL", `${n} first call to action "${fs.cta.text}" at ${fs.cta.top}px, ${fs.cta.inView ? "in" : "below"} the first screen`);
      else say("WARN", `${n} no filled call-to-action button found outside the nav`);
      if (fs.h1Lines != null) say(v.mobile && fs.h1Lines > 4 ? "WARN" : "INFO", `${n} headline ${fs.h1Size}px, ${fs.h1Lines} line(s), ${fs.h1Words} words`);
      if (heroOnly && !v.mobile && fs.h1Words > 12) say("WARN", `${n} headline is ${fs.h1Words} words (a hero reads best at 8 or fewer)`);
      if (view.text.lowContrastCount) say("WARN", `${n} ${view.text.lowContrastCount} text element(s) under WCAG contrast, e.g. ${view.text.lowContrast[0].label} ${view.text.lowContrast[0].ratio}:1 (${view.text.unmeasured} over images not measured)`);
      if (view.text.small) say("WARN", `${n} ${view.text.small} text element(s) under 12px, e.g. ${view.text.smallSamples[0]}`);
      // Tap targets: interaction-check.mjs measures them against WCAG 2.5.8 (24px with spacing); not repeated here.
      if (view.images.broken.length) say("FAIL", `${n} ${view.images.broken.length} broken image(s): ${view.images.broken[0]}`);
      if (view.images.oversized.length) say("WARN", `${n} oversized image(s): ${view.images.oversized[0]}`);
      if (view.images.noAlt) say("WARN", `${n} ${view.images.noAlt} visible image(s) without alt`);
      if (view.fonts.length > 3) say("WARN", `${n} ${view.fonts.length} font families: ${view.fonts.join(", ")}`);
      // The same verdicts as findings, so compare.mjs can tell fixed / still there / new.
      const w = v.width;
      for (const c of view.text.lowContrast) O.add({ type: "low-contrast", el: c.el, selector: c.selector, owner: c.owner, classes: c.classes, detail: `${c.ratio}:1 at ${c.size}px (needs ${c.need}:1)`, severity: c.ratio < c.need - 1.5 ? "fail" : "warn", width: w, fix: "darken/lighten the text (or its background) until it reaches the ratio; muted text on dark grounds usually needs ~#a1a1aa or lighter" });
      for (const t of view.text.smallList) O.add({ type: "small-text", el: t.el, selector: t.selector, owner: t.owner, classes: t.classes, detail: `${t.size}px text`, severity: "info", width: w, fix: "12px is the floor for anything people need to read; badges and keyboard hints can stay small" });
      for (const b of view.images.broken) O.add({ type: "broken-image", el: b, detail: "image failed to load", severity: "fail", width: w });
      for (const b of view.images.oversized) O.add({ type: "oversized-image", el: b, detail: "much larger than shown", severity: "warn", width: w, fix: "serve a size near the displayed width (srcset/sizes, next/image)" });
      if (view.images.noAlt) O.add({ type: "no-alt", el: `${view.images.noAlt} image(s)`, detail: "visible image without alt", severity: "warn", width: w, fix: 'alt="what it shows" (alt="" for decoration)' });
      for (const e of view.consoleErrors) O.add({ type: "console-error", el: e.slice(0, 80), detail: "", severity: "warn", width: w });
      for (const e of view.failedRequests) O.add({ type: "failed-request", el: e.slice(0, 100), detail: "", severity: "warn", width: w });
      if (site && view.h1s.length !== 1) O.add({ type: "h1-count", el: "<h1>", detail: `${view.h1s.length} visible h1`, severity: "warn", width: w, fix: "exactly one h1 that says what the page is" });
      if (site && !fs.cta) O.add({ type: "no-cta", el: "first screen", detail: "no filled call-to-action outside the nav", severity: "warn", width: w });
      else if (site && !fs.cta.inView) O.add({ type: "cta-below-fold", el: fs.cta.text, detail: `first call to action at ${fs.cta.top}px, below the first screen`, severity: "fail", width: w });
      if (site) for (const t of view.tells) O.add({ type: "template-tell", el: t, detail: "", severity: "info", width: w });
      if (site) for (const t of view.tells) say("WARN", `${n} template tell: ${t}`);
    }
    const d = pageReport.views.desktop;
    if (d && kind === "site") {
      if (!d.description) O.add({ type: "seo", el: "<head>", detail: "no meta description", severity: "warn" });
      if (!d.ogImage) O.add({ type: "seo", el: "<head>", detail: "no og:image", severity: "warn" });
    }
    if (d && !d.viewportMeta) O.add({ type: "viewport-meta", el: "<head>", detail: "no viewport meta tag", severity: "fail" });

    // Dark theme: when the CSS has one (prefers-color-scheme or a .dark class) and the run used the other,
    // look again in dark: contrast is where a second theme usually breaks.
    if (d && (d.themes.media || d.themes.darkClass) && d.themes.current !== "dark" && !args.includes("--no-dark")) {
      const ctx = await newContext(browser, base, { viewport: { width: VIEWS[0].width, height: VIEWS[0].height }, colorScheme: "dark" });
      await ctx.addInitScript(HELPERS);
      if (!d.themes.media) await ctx.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.add("dark")); });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: 45_000 }); await page.waitForTimeout(1200);
        await page.screenshot({ path: join(pageDir, "desktop-first-dark.jpg"), type: "jpeg", quality: 82 });
        const dark = await page.evaluate(INSPECT, { mobile: false });
        for (const c of dark.text.lowContrast) O.add({ type: "low-contrast", el: c.el, selector: c.selector, owner: c.owner, classes: c.classes, detail: `${c.ratio}:1 at ${c.size}px in the dark theme (needs ${c.need}:1)`, severity: c.ratio < c.need - 1.5 ? "fail" : "warn", width: VIEWS[0].width, fix: "set the dark theme's own text colour for it (dark:text-…); colours tuned on white rarely survive on black" });
        say(dark.text.lowContrastCount ? "WARN" : "PASS", `dark theme (${d.themes.media ? "prefers-color-scheme" : ".dark class"}): ${dark.text.lowContrastCount} text element(s) under WCAG contrast${dark.text.lowContrastCount ? `, e.g. ${dark.text.lowContrast[0].label} ${dark.text.lowContrast[0].ratio}:1` : ""} · desktop-first-dark.jpg`);
      } catch (e) { say("INFO", `dark theme not checked: ${String(e.message).split("\n")[0]}`); }
      await ctx.close();
    }
    if (d && kind === "app") {
      if (!d.title) say("WARN", "no <title> (tabs and history show the URL)");
      if (!d.viewportMeta) say("FAIL", "no viewport meta tag");
    } else if (d) {
      if (!d.title) say("WARN", "no <title>"); else if (d.title.length > 65) say("WARN", `title is ${d.title.length} characters (search results cut at about 60)`);
      if (!d.description) say("WARN", "no meta description"); if (!d.ogImage) say("WARN", "no og:image (links shared on X, Slack and LinkedIn show no picture)");
      if (!d.viewportMeta) say("FAIL", "no viewport meta tag");
      if (!heroOnly) say("INFO", `${d.sections.length} sections found; ${d.crops.length} cropped to sections/`);
    }
    report.pages.push(pageReport);
  }
} finally {
  await browser.close();
}
writeFileSync(join(outDir, "review.json"), JSON.stringify({ ...report, kind, lines }, null, 2));
O.write(outDir, { url: base, kind, assets: report.pages[0]?.views?.desktop?.assets || [] });
console.log(`\n→ ${outDir}/review.json · screenshots: desktop-first.jpg, phone-first.jpg${heroOnly ? "" : ", *-full.jpg, sections/"}`);
