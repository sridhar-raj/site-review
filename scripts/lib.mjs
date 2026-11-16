// Shared by every check: arguments, launching Chromium from the project's Playwright, the in-page helpers,
// visual confirmation (hide-and-diff), findings and the report.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseArgs(valueFlags) {
  const argv = process.argv.slice(2);
  const flags = new Set(valueFlags);
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
      const r = x.getBoundingClientRect(), c = getComputedStyle(x);
      if (r.width <= 1.5 && r.height <= 1.5 && (c.overflow !== "visible" || c.clip !== "auto" || c.clipPath !== "none")) return true;
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

/** Findings: one shape for every check, so compare.mjs can tell fixed / still there / new. */
export class Findings {
  constructor(check) { this.check = check; this.items = []; }
  add(f) {
    // Keyed on what the element is, not its position (positions shift when content is inserted). Elements that
    // share their classes and component are one finding with a count: the fix belongs in the shared style.
    const norm = (f.detail || "").replace(/\d+(\.\d+)?/g, "#").replace(/"[^"]*"/g, '"…"');
    const who = f.classes ? `${f.classes}|${f.owner || ""}` : f.el || f.selector || "";
    const key = [f.type, who, norm].join("|");
    const prev = this.items.find((x) => x.key === key);
    if (prev) {
      if (f.width && !prev.widths.includes(f.width)) prev.widths.push(f.width);
      if (f.el && !prev.examples.includes(f.el)) { prev.examples.push(f.el); prev.count = prev.examples.length; }
      if (f.severity === "fail") prev.severity = "fail";
      return;
    }
    this.items.push({ key, check: this.check, severity: f.severity || "warn", type: f.type, el: f.el, selector: f.selector, owner: f.owner || null, classes: f.classes || "", detail: f.detail || "", fix: f.fix || "", widths: f.width ? [f.width] : [], confirmed: f.confirmed ?? null, count: 1, examples: f.el ? [f.el] : [], ...(f.extra || {}) });
  }
  print(limit = 40) {
    const order = { fail: 0, warn: 1, info: 2 };
    const list = [...this.items].sort((a, b) => order[a.severity] - order[b.severity]);
    for (const f of list.slice(0, limit)) {
      const w = f.widths.length ? ` @${compactWidths(f.widths)}` : "";
      const more = f.count > 1 ? ` (and ${f.count - 1} more like it)` : "";
      console.log(`${f.severity.toUpperCase().padEnd(5)} ${f.type}${w}: ${f.el ?? ""}${more}${f.detail ? ` — ${f.detail}` : ""}`);
      if (f.owner || f.classes) console.log(`      ${f.owner ? `in ${f.owner}` : ""}${f.owner && f.classes ? " · " : ""}${f.classes ? `class="${f.classes.slice(0, 90)}"` : ""}`);
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
