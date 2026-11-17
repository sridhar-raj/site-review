// Shared by every check: arguments, launching Chromium from the project's Playwright, the in-page helpers,
// visual confirmation (hide-and-diff), findings and the report.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Flags every script understands (sessions, theme), so their values are never mistaken for the target.
const GLOBAL_VALUE_FLAGS = ["--storage", "--cookie", "--scheme"];

export function parseArgs(valueFlags) {
  const argv = process.argv.slice(2);
  const flags = new Set([...valueFlags, ...GLOBAL_VALUE_FLAGS]);
  const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; };
  const has = (name) => argv.includes(name);
  const target = argv.find((a, i) => !a.startsWith("--") && !flags.has(argv[i - 1]));
  return { argv, opt, has, target };
}

export function toUrl(target) {
  return /^https?:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href;
}

export function loadChromium() {
  const req = createRequire(join(process.cwd(), "package.json"));
  for (const mod of ["playwright", "playwright-core"]) {
    try { return req(mod); } catch {}
  }
  console.error("Playwright isn't installed in this project. Run: pnpm add -D playwright && npx playwright install chromium");
  process.exit(2);
}

/**
 * A browser context with the run's session and theme applied:
 *   --storage state.json   a Playwright storage state (cookies + localStorage), e.g. saved by login.mjs
 *   --cookie "a=1; b=2"    cookies for the target's host
 *   --scheme dark|light    prefers-color-scheme for the whole run
 * Every check opens its contexts through this, so signed-in pages review the same as public ones.
 */
export async function newContext(browser, url, options = {}) {
  const argv = process.argv.slice(2);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const storage = val("--storage"), cookie = val("--cookie"), scheme = val("--scheme");
  const ctx = await browser.newContext({ ...(storage ? { storageState: resolve(storage) } : {}), ...(scheme && !options.colorScheme ? { colorScheme: scheme } : {}), ...options });
  if (cookie && /^https?:/.test(url)) {
    const { hostname, protocol } = new URL(url);
    await ctx.addCookies(cookie.split(";").map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), domain: hostname, path: "/", secure: protocol === "https:" }; }));
  }
  return ctx;
}

export function tryRequire(name) {
  try { return createRequire(join(process.cwd(), "package.json"))(name); } catch { return null; }
}

export function outDir(path) { const d = resolve(path); mkdirSync(d, { recursive: true }); return d; }

/** A dev server inflates timings and adds React dev overhead; layout checks are fine on it, perf is not. */
export async function isDevServer(page) {
  return page.evaluate(() => Boolean(document.querySelector("script[src*='webpack'], script[src*='turbopack'], nextjs-portal, script[id='__NEXT_DATA__']") && /localhost|127\.0\.0\.1/.test(location.host) && (window.__NEXT_HMR_CB || document.querySelector("script[src*='react-refresh'], script[src*='hmr']") || window.next?.version?.includes?.("canary"))));
}

/** Wait until fonts are in, two frames have passed and no layout shift happened for `quietMs`. */
export async function settle(page, quietMs = 500, maxMs = 6000) {
  await page.evaluate(async ({ quietMs, maxMs }) => {
    await document.fonts?.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let last = performance.now();
    const po = new PerformanceObserver(() => { last = performance.now(); });
    try { po.observe({ type: "layout-shift", buffered: false }); } catch {}
    const start = performance.now();
    while (performance.now() - last < quietMs && performance.now() - start < maxMs) await new Promise((r) => setTimeout(r, 100));
    po.disconnect();
  }, { quietMs, maxMs }).catch(() => {});
}

// In-page helpers, installed on window.__sr in every page (addInitScript) and re-installable on demand.
export const HELPERS = String.raw`(() => {
  if (window.__sr) return;
  const sr = {};
  sr.visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || c.visibility === "hidden" || c.display === "none") return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (Number(getComputedStyle(n).opacity) < 0.05) return false; }
    return true;
  };
  // Screen-reader-only text, aria-hidden decoration, inert panels: never a visual bug.
  sr.ignored = (el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden], [data-review-allow~="all"]')) return true;
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      if (x.inert) return true;
      const r = x.getBoundingClientRect(), c = getComputedStyle(x);
      // A clip box collapsed in either direction: a closed accordion or panel (sr-only text is 1×1).
      if ((r.width <= 1.5 || r.height <= 1.5) && (c.overflow !== "visible" || c.clip !== "auto" || c.clipPath !== "none")) return true;
    }
    return false;
  };
  sr.allowed = (el, kind) => Boolean(el.closest('[data-review-allow~="' + kind + '"]'));
  sr.cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift('#' + n.id); break; }
      let p = n.tagName.toLowerCase();
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2) : [];
      if (cls.length) p += '.' + cls.join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter((s) => s.tagName === n.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
      parts.unshift(p);
      if (n === document.body) break;
    }
    return parts.join(' > ');
  };
  sr.label = (el) => {
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return 'select' + (el.id ? '#' + el.id : '') + (o ? ' "' + o.text.trim().slice(0, 48) + '"' : ''); }
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (t ? ' "' + t + '"' : '');
  };
  sr.classes = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 12).join(' ');
  // The React component (and, in dev builds, the file:line) that rendered this element.
  sr.owner = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const k = Object.keys(n).find((k) => k.startsWith('__reactFiber$'));
      if (!k) continue;
      for (let f = n[k]; f; f = f.return) {
        const t = f.type;
        if (!t || typeof t === 'string') continue;
        const name = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name));
        if (!name || /^(Fragment|Suspense|StrictMode|Provider|Consumer|ForwardRef|Memo|Router|Layout|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|ErrorBoundary|RedirectBoundary|NotFoundBoundary|LoadingBoundary|HotReload|AppRouter|ServerRoot)/.test(name)) continue;
        const src = f._debugSource;
        return name + (src && src.fileName ? ' (' + src.fileName.split('/').slice(-3).join('/') + ':' + src.lineNumber + ')' : '');
      }
      return null;
    }
    return null;
  };
  sr.describe = (el) => ({ el: sr.label(el), selector: sr.cssPath(el), owner: sr.owner(el), classes: sr.classes(el) });
  // The nearest ancestor that clips (overflow other than visible, paint containment or clip-path).
  sr.clipper = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible' || (c.contain || '').includes('paint') || c.clipPath !== 'none') return a;
    }
    return null;
  };
  sr.scroller = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (/(auto|scroll)/.test(c.overflowX + c.overflowY)) return a;
    }
    return null;
  };
  sr.animating = (el) => (el.getAnimations ? el.getAnimations({ subtree: false }).some((a) => a.playState === 'running') : false) || [...(el.parentElement ? [el.parentElement] : [])].some((p) => p.getAnimations && p.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity));
  sr.textEls = () => {
    const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const t = w.currentNode; if (t.textContent.trim().length > 0 && t.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(t.parentElement.tagName)) out.add(t.parentElement); }
    return [...out].filter((el) => sr.visible(el) && !sr.ignored(el) && !el.closest('svg'));
  };
  sr.important = (el) => el.matches('h1,h2,h3,h4,[role=heading],button,a,label,nav *,[role=button],th,dt') || /price|cta|title|heading/i.test(sr.classes(el));
  window.__sr = sr;
})();`;

export async function installHelpers(page) { await page.evaluate(HELPERS); }

/**
 * Visual confirmation (VISER): hide the elements with opacity 0, screenshot the region again, compare.
 * Returns the share of pixels that changed (0..1). Under ~0.004 means the "bug" is not visible.
 */
export async function hideAndDiff(page, selectors, clip) {
  const pad = 4;
  const vp = page.viewportSize();
  const box = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: Math.min(clip.width + pad * 2, vp.width), height: Math.min(clip.height + pad * 2, 3000) };
  if (box.width < 2 || box.height < 2) return 1;
  const shot = () => page.screenshot({ clip: box, fullPage: true, animations: "disabled", caret: "hide" }).catch(() => null);
  const a = await shot();
  await page.evaluate((sels) => { window.__srHidden = []; for (const s of sels) for (const el of document.querySelectorAll(s)) { window.__srHidden.push([el, el.style.opacity]); el.style.setProperty("opacity", "0", "important"); } }, selectors);
  const b = await shot();
  await page.evaluate(() => { for (const [el, o] of window.__srHidden || []) el.style.opacity = o; });
  if (!a || !b) return 1;
  return pixelDiff(page, a, b);
}

let diffPage = null;
/** Share of differing pixels between two PNG buffers, computed on a canvas in a blank page. */
export async function pixelDiff(page, a, b) {
  if (!diffPage || diffPage.isClosed()) diffPage = await page.context().browser().newPage();
  return diffPage.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    const w = Math.min(x.width, y.width), h = Math.min(x.height, y.height);
    if (!w || !h) return 1;
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
    g.drawImage(x, 0, 0); const d1 = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h); g.drawImage(y, 0, 0); const d2 = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 40) n++;
    return n / (w * h);
  }, [a.toString("base64"), b.toString("base64")]);
}

/**
 * Compare two screenshots cell by cell (16 px). Returns the share of changed pixels, the changed cells, the
 * images' sizes and, when asked, a PNG of the after image with changed cells outlined in red. `ignore` is a
 * list of cells ("x:y") known to change on their own (clocks, carousels), left out of the count.
 */
export async function diffImages(page, a, b, { cell = 16, overlay = false, ignore = [] } = {}) {
  if (!diffPage || diffPage.isClosed()) diffPage = await page.context().browser().newPage();
  return diffPage.evaluate(async ([a, b, cell, overlay, ignore]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    const w = Math.max(x.width, y.width), h = Math.max(x.height, y.height);
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#ff00ff"; g.fillRect(0, 0, w, h); g.drawImage(x, 0, 0); const d1 = g.getImageData(0, 0, w, h).data;
    g.fillRect(0, 0, w, h); g.drawImage(y, 0, 0); const d2 = g.getImageData(0, 0, w, h).data;
    const skip = new Set(ignore); const cells = new Map(); let n = 0, counted = 0;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const k = Math.floor(px / cell) + ":" + Math.floor(py / cell);
      if (skip.has(k)) continue;
      counted++;
      const i = (py * w + px) * 4;
      if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 40) { n++; cells.set(k, (cells.get(k) || 0) + 1); }
    }
    const changed = [...cells].filter(([, v]) => v >= 3).map(([k]) => k);
    let png = null;
    if (overlay && changed.length) {
      g.drawImage(y, 0, 0); g.fillStyle = "rgba(255,0,60,0.28)"; g.strokeStyle = "#ff003c"; g.lineWidth = 1;
      for (const k of changed) { const [cx, cy] = k.split(":").map(Number); g.fillRect(cx * cell, cy * cell, cell, cell); }
      const blob = await c.convertToBlob({ type: "image/png" }); const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); png = btoa(bin);
    }
    return { share: counted ? n / counted : 0, cells: changed, before: [x.width, x.height], after: [y.width, y.height], png };
  }, [a.toString("base64"), b.toString("base64"), cell, overlay, ignore]);
}

/** Changed cells → a few boxes (cells within 3 of each other merge), largest first, in page px. */
export function cellBoxes(cells, cell = 16) {
  const pts = cells.map((k) => k.split(":").map(Number)); const boxes = [];
  for (const [x, y] of pts) {
    const b = boxes.find((b) => x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3);
    if (b) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++; } else boxes.push({ x0: x, x1: x, y0: y, y1: y, n: 1 });
  }
  return boxes.sort((a, b) => b.n - a.n).map((b) => ({ x: b.x0 * cell, y: b.y0 * cell, width: (b.x1 - b.x0 + 1) * cell, height: (b.y1 - b.y0 + 1) * cell }));
}

/**
 * Who each kind of finding affects and the WCAG 2.2 success criterion it maps to (null when it is a quality
 * issue, not a WCAG failure). Attached to every finding, carried into the change list.
 */
export const IMPACT = {
  overflow: ["1.4.10", "people who zoom in (320px is a 1280px screen at 400%), phone users"],
  "clipped-text": [null, "everyone at these widths"], "text-overflow": [null, "everyone at these widths"],
  "text-overlap": [null, "everyone at these widths"], "covered-text": [null, "everyone at these widths"], protrusion: [null, "everyone at these widths"],
  "low-contrast": ["1.4.3", "people with low vision, anyone on a dim screen or in sunlight"],
  "small-text": [null, "people with low vision, older readers"],
  "no-focus-ring": ["2.4.7", "keyboard and switch users"], "invisible-focus-stop": ["2.4.7", "keyboard and switch users"],
  "focus-ring-clipped": ["2.4.7", "keyboard users"], "focus-obscured": ["2.4.11", "keyboard users"],
  "positive-tabindex": ["2.4.3", "keyboard and screen-reader users"], "focus-trap": ["2.1.2", "keyboard users"],
  "no-skip-link": ["2.4.1", "keyboard and screen-reader users"],
  "not-focusable": ["2.1.1", "keyboard and switch users"], "no-key-activation": ["2.1.1", "keyboard and switch users"],
  "tablist-arrows": ["2.1.1", "keyboard and screen-reader users"], "slider-keys": ["2.1.1", "keyboard users"],
  "esc-no-close": [null, "keyboard users"], "dialog-focus": ["2.4.3", "keyboard and screen-reader users"], "focus-not-returned": ["2.4.3", "keyboard users"],
  "tap-target": ["2.5.8", "touch users, people with tremors"], "small-tap": [null, "touch users"],
  "ios-zoom": [null, "iPhone users"], "zoom-disabled": ["1.4.4", "people with low vision"],
  "hover-only": [null, "touch users"], "reduced-motion": ["2.3.3", "people with vestibular disorders or migraines"],
  "no-accessible-name": ["4.1.2", "screen-reader and voice-control users"], "image-name": ["1.1.1", "screen-reader users"],
  "label-in-name": ["2.5.3", "voice-control users (they say what they see)"],
  "no-label": ["3.3.2", "screen-reader users"], "placeholder-label": ["3.3.2", "screen-reader users, and everyone once they start typing"],
  "no-lang": ["3.1.1", "screen-reader users"], "heading-skip": ["1.3.1", "screen-reader users who move by headings"],
  "no-h1": ["1.3.1", "screen-reader users who move by headings"], "no-main-landmark": ["1.3.1", "screen-reader users who jump to the main content"],
  "state-unannounced": ["4.1.2", "screen-reader users"],
  "forced-colors-edge": ["1.4.11", "people using Windows contrast themes"], "forced-colors-icon": ["1.4.11", "people using Windows contrast themes"],
  "silent-submit": ["3.3.1", "anyone who mistypes; keyboard users, who can't even reach the disabled button"],
  "floating-over-content": [null, "everyone at these screen sizes"],
  "captions-review": ["1.2.2", "deaf and hard-of-hearing people"],
  "layout-shift": [null, "everyone (misclicks, lost place)"], cls: [null, "everyone (misclicks, lost place)"],
  "slow-interaction": [null, "everyone, most on slower phones"],
};

/** Kinds of finding that are polish or a design choice, not a bug (see Findings.add). */
export const SUGGESTION_TYPES = new Set(["vh-height", "heading-break", "orphan-wrap", "template-tell", "small-text", "no-hover", "hover-duration", "transition-all", "layout-transition", "cursor", "no-skip-link", "heading-skip", "small-tap", "breakpoint-gap", "protrusion", "state-unannounced", "focus-not-returned", "oversized-image", "image-format", "dom-size", "unused-js", "layout-thrash", "long-frame", "fonts", "no-alt"]);

/**
 * What an element is, independent of where it sits: its tag and classes plus the component that rendered it,
 * or, for elements with no classes, its CSS path without sibling positions. Content inserted after load
 * shifts every :nth-of-type, so positions can't identify an element between two loads of the same page.
 */
export function ident(f) {
  const tag = (f.el || "").split(/[\s#"]/)[0] || "";
  if (f.classes) return `${tag}.${f.classes}|${f.owner || ""}`;
  if (f.selector) return f.selector.replace(/:nth-of-type\(\d+\)/g, "") + "|" + (f.owner || "");
  return f.el || "";
}

/** Findings: one shape for every check, so compare.mjs can tell fixed / still there / new. */
export class Findings {
  constructor(check) { this.check = check; this.items = []; }
  add(f) {
    // Keyed on what the element is, not its position (positions shift when content is inserted). Elements that
    // share their classes and component are one finding with a count: the fix belongs in the shared style.
    const norm = (f.detail || "").replace(/\d+(\.\d+)?/g, "#").replace(/"[^"]*"/g, '"…"');
    const who = ident(f);
    const key = [f.type, who, norm].join("|");
    const prev = this.items.find((x) => x.key === key);
    if (prev) {
      if (f.width && !prev.widths.includes(f.width)) prev.widths.push(f.width);
      if (f.el && !prev.examples.includes(f.el)) { prev.examples.push(f.el); prev.count = prev.examples.length; prev.each[f.el] = { widths: [], detail: f.detail || "" }; }
      // Each element keeps its own widths and numbers: a group's widths are the union, which can mislead.
      if (f.el && f.width && !prev.each[f.el].widths.includes(f.width)) prev.each[f.el].widths.push(f.width);
      if (f.severity === "fail") prev.severity = "fail";
      return;
    }
    const [wcag, affects] = IMPACT[f.type] || [null, null];
    // Issue: objectively broken or a WCAG failure, measured. Suggestion: polish, consistency or a design choice
    // that works as it is; listed separately and never counted as a bug.
    const kind = f.kind || (f.severity === "fail" ? "issue" : SUGGESTION_TYPES.has(f.type) || f.stress ? "suggestion" : "issue");
    this.items.push({ key, kind, ...(f.steps ? { steps: f.steps } : {}), ...(f.shot ? { shot: f.shot } : {}), ...(f.shot2 ? { shot2: f.shot2 } : {}), check: this.check, ...(wcag ? { wcag } : {}), ...(affects ? { who: affects } : {}), severity: f.severity || "warn", type: f.type, el: f.el, selector: f.selector, owner: f.owner || null, classes: f.classes || "", detail: f.detail || "", fix: f.fix || "", widths: f.width ? [f.width] : [], confirmed: f.confirmed ?? null, ...(f.stress ? { stress: true } : {}), count: 1, examples: f.el ? [f.el] : [], each: f.el ? { [f.el]: { widths: f.width ? [f.width] : [], detail: f.detail || "" } } : {}, ...(f.extra || {}) });
  }
  print(limit = 40) {
    const order = { fail: 0, warn: 1, info: 2 };
    const list = [...this.items].sort((a, b) => order[a.severity] - order[b.severity]);
    for (const f of list.slice(0, limit)) {
      const w = f.widths.length ? ` @${compactWidths(f.widths)}` : "";
      const more = f.count > 1 ? ` (and ${f.count - 1} more like it)` : "";
      console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.type}${w}: ${f.el ?? ""}${more}${f.detail ? ` — ${f.detail}` : ""}`);
      if (f.owner || f.classes) console.log(`      ${f.owner ? `in ${f.owner}` : ""}${f.owner && f.classes ? " · " : ""}${f.classes ? `class="${f.classes.slice(0, 90)}"` : ""}`);
      if (f.count > 1) {
        const parts = Object.entries(f.each || {}).slice(0, 4).map(([el, e]) => `${el}${e.widths.length ? ` @${compactWidths(e.widths)}` : ""}${e.detail && e.detail !== f.detail ? ` (${e.detail.slice(0, 60)})` : ""}`);
        console.log(`      each: ${parts.join("; ")}${f.count > 4 ? `; +${f.count - 4} more` : ""}`);
      }
      if (f.fix) console.log(`      fix: ${f.fix}`);
    }
    if (list.length > limit) console.log(`… and ${list.length - limit} more in the JSON`);
    const fails = list.filter((f) => f.severity === "fail").length, warns = list.filter((f) => f.severity === "warn").length;
    console.log(`\n${this.check}: ${fails} fail, ${warns} warn`);
    return { fails, warns };
  }
  write(dir, extra = {}) {
    const file = join(dir, `${this.check}.json`);
    writeFileSync(file, JSON.stringify({ check: this.check, at: new Date().toISOString(), ...extra, findings: this.items }, null, 2));
    console.log(`→ ${file}`);
    return file;
  }
}

export function compactWidths(ws) {
  const s = [...new Set(ws)].sort((a, b) => a - b);
  const out = []; let start = s[0], prev = s[0];
  for (const w of s.slice(1).concat([Infinity])) {
    if (w - prev > 48) { out.push(start === prev ? `${start}` : `${start}–${prev}`); start = w; }
    prev = w;
  }
  return out.join(",");
}

/**
 * Close a dialog that is open on arrival (newsletter, promo), the way a visitor would: Esc, then its close
 * button. Returns its label, or null. Cookie banners are left alone: they are part of the real first view.
 */
export async function dismissPopups(page) {
  const open = () => page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog],[aria-modal="true"],dialog[open]')].find((el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 40 && r.height > 40 && c.visibility !== "hidden" && c.display !== "none"; });
    if (!d) return null;
    if (/cookie|consent|gdpr/i.test(d.innerText.slice(0, 300))) return null;
    return (d.querySelector("h1,h2,h3,p")?.innerText || d.getAttribute("aria-label") || "a dialog").trim().slice(0, 60);
  }).catch(() => null);
  const label = await open();
  if (!label) return null;
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  if (await open()) {
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role=dialog],[aria-modal="true"],dialog[open]')][0];
      const b = d && [...d.querySelectorAll("button,[role=button],a")].find((b) => /close|dismiss|×|✕|no thanks|later/i.test((b.getAttribute("aria-label") || "") + " " + b.innerText));
      b?.click();
    }).catch(() => {});
    await page.waitForTimeout(400);
  }
  return (await open()) ? null : label;
}
