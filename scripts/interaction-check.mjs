#!/usr/bin/env node
// interaction-check.mjs: hover, focus, menus and modals, touch, reduced motion, accessibility. Finds the
// states a screenshot never shows, and points at the source.
//
//   node interaction-check.mjs <url | file.html> [--out .review] [--max 60] [--no-axe] [--no-overlays] [--no-nav]
//
// Desktop (1440×900, real scrollbars): every interactive element's hover forced through CDP (no pointer
// side effects): no visible feedback, hover that moves the layout, transition: all or layout properties
// animated, durations out of range, missing pointer cursor, hover menus off-screen or covered. Keyboard:
// a Tab walk for missing or clipped focus rings, focus hidden under sticky bars, positive tabindex, invisible
// stops, traps. Overlays: each menu/dialog trigger opened: Esc closes, focus returns, background scroll locked,
// no page jump when the scrollbar disappears. Phone (390×844, touch): tap targets (WCAG 2.5.8 with the
// spacing exception), form fields under 16px (iOS zooms), zoom disabled, hover-only content invisible on touch,
// sticky bars covering the screen, the mobile menu staying open after navigating. Reduced motion: animations
// still running. axe-core when @axe-core/playwright is installed.
//
// Silence an intentional case with data-review-allow="hover|focus|target|motion|all".

import { parseArgs, toUrl, loadChromium, tryRequire, outDir, settle, HELPERS, installHelpers, dismissPopups, pixelDiff, Findings } from "./lib.mjs";

const { opt, has, target } = parseArgs(["--out", "--max"]);
if (!target) { console.error("usage: interaction-check.mjs <url | file.html> [--out .review] [--max 60] [--no-axe] [--no-overlays] [--no-nav]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const MAX = Number(opt("--max", 60)) || 60;
const F = new Findings("interaction");
const { chromium } = loadChromium();
const t0 = Date.now();
// Real scrollbars, so a modal that removes the scrollbar shows its page jump.
const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });

const ENUMERATE = (max) => {
  const sr = window.__sr;
  const sel = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],[role=checkbox],summary,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[onclick]';
  const set = new Set(document.querySelectorAll(sel));
  for (const el of document.querySelectorAll("body *")) {
    const pk = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    if (pk && el[pk] && (el[pk].onClick || el[pk].onMouseEnter || el[pk].onPointerDown)) set.add(el);
    else if (getComputedStyle(el).cursor === "pointer" && el.parentElement && getComputedStyle(el.parentElement).cursor !== "pointer") set.add(el);
  }
  let list = [...set].filter((el) => sr.visible(el) && !sr.ignored(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
  list = list.filter((el) => !list.some((o) => o !== el && o.contains(el) && Math.abs(o.getBoundingClientRect().width - el.getBoundingClientRect().width) < 4)); // one target per hit box
  list = list.filter((el) => !list.some((o) => o !== el && el.contains(o) && el.matches("li,div,section"))); // wrappers of a real control
  // Priority: header/nav, buttons, then the first screen, then the rest in document order.
  const score = (el) => (el.closest("header,nav") ? 0 : el.matches("button,[role=button]") ? 1 : el.getBoundingClientRect().top < innerHeight ? 2 : 3);
  list.sort((a, b) => score(a) - score(b));
  // Same-looking controls (a grid of 20 cards) are probed once each kind, up to 3.
  const kinds = new Map(); const pick = [];
  for (const el of list) { const k = el.tagName + "|" + sr.classes(el); const n = kinds.get(k) || 0; if (n >= 3) continue; kinds.set(k, n + 1); pick.push(el); if (pick.length >= max) break; }
  pick.forEach((el, i) => el.setAttribute("data-sr-id", String(i)));
  return pick.map((el, i) => {
    const pk = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return { id: i, ...sr.describe(el), tag: el.tagName, link: el.matches("a[href]"), jsHover: Boolean(pk && el[pk] && el[pk].onMouseEnter), popup: el.getAttribute("aria-haspopup") || null };
  });
};

const PROPS = ["color", "backgroundColor", "borderTopColor", "boxShadow", "outlineColor", "outlineStyle", "opacity", "transform", "textDecorationLine", "filter", "backgroundImage", "width", "height", "paddingTop", "paddingLeft", "borderTopWidth", "fontWeight", "letterSpacing", "scale", "translate"];
const SNAP = ([id, props]) => {
  const el = document.querySelector(`[data-sr-id="${id}"]`); if (!el) return null;
  const nodes = [el, ...el.querySelectorAll("*")].slice(0, 12);
  const styles = nodes.map((n) => { const c = getComputedStyle(n); return props.map((p) => c[p]).join("|"); });
  const cs = getComputedStyle(el);
  const nb = [el.previousElementSibling, el.nextElementSibling, el.parentElement?.nextElementSibling].filter(Boolean).map((n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const r = el.getBoundingClientRect();
  return { styles, rect: [r.left, r.top, r.width, r.height], nb, cursor: cs.cursor, tprop: cs.transitionProperty, tdur: cs.transitionDuration, overflowHidden: Boolean(window.__sr.clipper(el)) };
};

async function hoverProbe(page, cdp, items) {
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  for (const it of items) {
    try {
      const loc = page.locator(`[data-sr-id="${it.id}"]`);
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-sr-id="${it.id}"]` });
      if (!nodeId) continue;
      const box = await loc.boundingBox(); if (!box || box.width < 2) continue;
      const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.min(box.width + 12, 1440), height: Math.min(box.height + 12, 900) };
      const a = await page.evaluate(SNAP, [it.id, PROPS]);
      const shotA = await page.screenshot({ clip, animations: "disabled" }).catch(() => null);
      // Force :hover on the element and its ancestors up to 3 levels (group-hover cards).
      const ids = [nodeId];
      let cur = nodeId;
      for (let k = 0; k < 3; k++) { const d = await cdp.send("DOM.describeNode", { nodeId: cur }).catch(() => null); if (!d?.node?.parentId) break; cur = d.node.parentId; ids.push(cur); }
      for (const n of ids) await cdp.send("CSS.forcePseudoState", { nodeId: n, forcedPseudoClasses: ["hover"] }).catch(() => {});
      await page.waitForTimeout(Math.min(450, 60 + maxMs(a.tdur)));
      const b = await page.evaluate(SNAP, [it.id, PROPS]);
      const shotB = await page.screenshot({ clip, animations: "disabled" }).catch(() => null);
      for (const n of ids) await cdp.send("CSS.forcePseudoState", { nodeId: n, forcedPseudoClasses: [] }).catch(() => {});
      if (!a || !b) continue;
      const base = { el: it.el, selector: it.selector, owner: it.owner, classes: it.classes, width: 1440 };
      const changed = a.styles.some((s, i) => s !== b.styles[i]);
      const diff = shotA && shotB ? await pixelDiff(page, shotA, shotB) : 1;
      if (!changed && diff < 0.003 && !it.link && !/^(INPUT|SELECT|TEXTAREA)$/.test(it.tag)) F.add({ ...base, type: "no-hover", detail: "nothing changes on hover", severity: "warn", fix: "add a visible hover state: hover:bg-* / hover:text-* / an underline, more contrast than the rest state" });
      const sizeMoved = Math.abs(a.rect[2] - b.rect[2]) > 0.5 || Math.abs(a.rect[3] - b.rect[3]) > 0.5;
      const nbMoved = a.nb.some((r, i) => b.nb[i] && r.some((v, j) => Math.abs(v - b.nb[i][j]) > 0.5));
      if (sizeMoved || nbMoved) F.add({ ...base, type: "hover-shift", detail: `hover changes its size${nbMoved ? " and moves what's next to it" : ""}`, severity: "fail", fix: "keep the box the same: border-transparent at rest instead of adding a border, ring/shadow instead of padding, no font-weight change (or reserve the bold width)" });
      if (/(^|,\s*)all(,|$)/.test(a.tprop) && maxMs(a.tdur) > 0) F.add({ ...base, type: "transition-all", detail: `transition: all (${a.tdur})`, severity: "warn", fix: "transition-[color,background-color,transform] (or transition-colors) instead of transition-all" });
      else if (/(width|height|top|left|margin|padding|border-width|font-size)/.test(a.tprop)) F.add({ ...base, type: "layout-transition", detail: `animates layout properties (${a.tprop})`, severity: "warn", fix: "animate transform and opacity only" });
      const dur = maxMs(a.tdur);
      if (changed && dur > 0 && dur < 50) F.add({ ...base, type: "hover-duration", detail: `${dur}ms transition reads as a snap`, severity: "warn", fix: "duration-150 ease-out" });
      if (changed && dur > 400) F.add({ ...base, type: "hover-duration", detail: `${dur}ms hover transition feels slow`, severity: "warn", fix: "100–250ms for hover (duration-150/200)" });
      if (!it.link && /^(BUTTON|DIV|SPAN|LI|SUMMARY)$/.test(it.tag) && /^(auto|default)$/.test(a.cursor)) F.add({ ...base, type: "cursor", detail: "clickable but the cursor stays an arrow", severity: "warn", fix: "cursor-pointer (Tailwind v4 buttons default to cursor: default: add @layer base { button:not(:disabled),[role=button]{cursor:pointer} })" });
    } catch {}
  }
}

const maxMs = (d) => Math.max(0, ...String(d || "0s").split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000) || 0));

// Hover menus (JS or aria-haspopup): real hover, then check what opened.
async function hoverMenus(page, items) {
  for (const it of items.filter((x) => x.jsHover || x.popup).slice(0, 8)) {
    try {
      const before = await page.evaluate(() => new Set([...document.querySelectorAll("body *")].filter((e) => window.__sr.visible(e)).map((e) => e)).size);
      await page.locator(`[data-sr-id="${it.id}"]`).hover({ timeout: 1500 });
      await page.waitForTimeout(400);
      const res = await page.evaluate(() => {
        const sr = window.__sr; const pops = [...document.querySelectorAll('[role=menu],[role=tooltip],[role=listbox],[data-radix-popper-content-wrapper],[popover]')].filter(sr.visible);
        return pops.map((p) => { const r = p.getBoundingClientRect(); const off = r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < -1;
          const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 6, r.top + 6], [r.right - 6, r.bottom - 6]];
          const covered = pts.filter(([x, y]) => { const h = document.elementFromPoint(x, y); return h && !p.contains(h); }).length >= 2;
          return { ...sr.describe(p), off, covered }; });
      });
      for (const p of res) {
        if (p.off) F.add({ ...p, type: "popup-offscreen", detail: `opens past the screen edge (from ${it.el})`, severity: "fail", width: 1440, fix: "collision handling: Floating UI flip()/shift(), Radix avoidCollisions, or anchor positioning" });
        if (p.covered) F.add({ ...p, type: "popup-covered", detail: `opens behind other content (from ${it.el})`, severity: "fail", width: 1440, fix: "render it in a portal (Radix Portal / createPortal to body) or the popover attribute; a transform/filter on an ancestor traps its z-index" });
      }
      await page.mouse.move(2, 2);
    } catch {}
  }
}

async function focusWalk(page) {
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  const seen = new Map(); let first = null; let stops = 0; let reachedEnd = false;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const r = await page.evaluate(async () => {
      const sr = window.__sr; const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      if (el.tagName === "IFRAME") return { end: false, key: "iframe" };
      const key = sr.cssPath(el);
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const snap = (x) => { const c = getComputedStyle(x); return [c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0 ? c.outlineWidth + c.outlineColor : "", c.boxShadow, c.borderColor, c.backgroundColor, c.textDecorationLine, c.color].join("|"); };
      const chain = [el, el.parentElement].filter(Boolean);
      const on = chain.map(snap);
      el.blur(); await new Promise((r) => requestAnimationFrame(r)); const off = chain.map(snap); el.focus({ preventScroll: true });
      const changed = on.some((s, k) => s !== off[k]);
      // Ring clipped: outline/shadow extends outside a clipping ancestor.
      const ring = (parseFloat(cs.outlineWidth) || 0) + Math.max(0, parseFloat(cs.outlineOffset) || 0);
      const c = sr.clipper(el); let clipped = false;
      if (c && ring > 0 && c !== document.body) { const b = c.getBoundingClientRect(); clipped = rect.left - ring < b.left - 0.5 || rect.right + ring > b.right + 0.5 || rect.top - ring < b.top - 0.5 || rect.bottom + ring > b.bottom + 0.5; }
      // Hidden under a sticky/fixed bar.
      let under = null;
      const pts = [[rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.left + 3, rect.top + 3], [rect.right - 3, rect.bottom - 3]];
      const hidden = pts.filter(([x, y]) => { const h = document.elementFromPoint(x, y); if (!h || el.contains(h) || h.contains(el)) return false; for (let n = h; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") { under = n; return true; } } return false; }).length;
      const invisible = rect.width < 1 || rect.height < 1 || Number(cs.opacity) < 0.05 || rect.right < 0 || rect.left > innerWidth;
      return { end: false, key, ...sr.describe(el), changed, clipped, hidden, underBar: under ? sr.label(under) : null, invisible, tabindex: el.tabIndex, allowed: sr.allowed(el, "focus"), skip: el.matches('a[href^="#"]') && /skip|main|content/i.test(el.innerText) };
    });
    if (r.end) { reachedEnd = true; break; }
    if (r.key === "iframe") continue;
    if (!first) { first = r; if (!r.skip) F.add({ type: "no-skip-link", el: r.el, detail: "the first Tab stop is not a skip link", severity: "info", width: 1440, fix: 'first in <body>: <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">Skip to content</a>' }); }
    if (seen.has(r.key)) { if (seen.size > 3) { if (!reachedEnd && seen.size < 6) F.add({ type: "focus-trap", el: r.el, detail: `Tab cycles through ${seen.size} elements and never leaves`, severity: "fail", width: 1440, fix: "only trap focus inside an open modal; release it on close" }); break; } continue; }
    seen.set(r.key, true); stops++;
    if (r.allowed) continue;
    const base = { el: r.el, selector: r.selector, owner: r.owner, classes: r.classes, width: 1440 };
    if (r.invisible) F.add({ ...base, type: "invisible-focus-stop", detail: "Tab lands on something you can't see (closed menu, off-screen, opacity 0)", severity: "fail", fix: "inert (or visibility:hidden / invisible) on closed panels, not just a transform" });
    else if (!r.changed) F.add({ ...base, type: "no-focus-ring", detail: "no visible focus indicator", severity: "fail", fix: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color] (replace outline-none with outline-hidden plus a visible ring)" });
    if (r.clipped) F.add({ ...base, type: "focus-ring-clipped", detail: "focus ring cut by an overflow-hidden parent", severity: "warn", fix: "focus-visible:outline-offset-[-2px] (inset ring), or p-1 -m-1 on the clipping parent" });
    if (r.hidden >= 2) F.add({ ...base, type: "focus-obscured", detail: `focused element hidden under ${r.underBar}`, severity: "fail", fix: "html { scroll-padding-top / scroll-padding-bottom } equal to the bar's height (WCAG 2.4.11)" });
    if (r.tabindex > 0) F.add({ ...base, type: "positive-tabindex", detail: `tabindex=${r.tabindex} reorders the keyboard path`, severity: "warn", fix: "tabindex 0 (or none); order the DOM instead" });
  }
  return stops;
}

// Each menu / dialog trigger: open, then Esc, focus return, scroll lock, page jump.
async function overlays(page) {
  // A classic 15px scrollbar (Windows), so a dialog that removes it shows the jump even on a Mac, where
  // headless scrollbars overlay the page and take no space.
  await page.addStyleTag({ content: "::-webkit-scrollbar{width:15px;height:15px}::-webkit-scrollbar-thumb{background:#999}" }).catch(() => {});
  await page.waitForTimeout(100);
  const triggers = await page.evaluate(() => {
    const sr = window.__sr;
    return [...document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]),[aria-expanded="false"],button[aria-controls]')].filter((el) => sr.visible(el) && !sr.ignored(el)).slice(0, 6).map((el, i) => { el.setAttribute("data-sr-trig", String(i)); return { i, ...sr.describe(el) }; });
  });
  for (const t of triggers) {
    try {
      await page.evaluate(() => scrollTo(0, 0));
      const before = await page.evaluate(() => ({ cw: document.documentElement.clientWidth, pad: parseFloat(getComputedStyle(document.body).paddingRight) || 0, scrollY, sw: innerWidth - document.documentElement.clientWidth, gutter: getComputedStyle(document.documentElement).scrollbarGutter }));
      await page.locator(`[data-sr-trig="${t.i}"]`).click({ timeout: 2000 });
      await page.waitForTimeout(450);
      const opened = await page.evaluate((i) => {
        const sr = window.__sr; const trig = document.querySelector(`[data-sr-trig="${i}"]`);
        const id = trig.getAttribute("aria-controls"); let el = id && document.getElementById(id);
        if (!el || !sr.visible(el)) el = [...document.querySelectorAll('[role=dialog],[aria-modal="true"],[role=menu],[role=listbox],dialog[open],[data-state="open"][role]')].find(sr.visible);
        if (!el) return null;
        el.setAttribute("data-sr-open", "1");
        return { ...sr.describe(el), modal: el.matches('[role=dialog],[aria-modal="true"],dialog'), focusInside: el.contains(document.activeElement), cw: document.documentElement.clientWidth, pad: parseFloat(getComputedStyle(document.body).paddingRight) || 0 };
      }, t.i);
      if (!opened) continue;
      const base = { el: t.el, selector: t.selector, owner: t.owner, classes: t.classes, width: 1440 };
      // The scrollbar went away (the page got wider) and nothing made up for it: centred content jumps sideways.
      const gained = opened.cw - before.cw, padded = opened.pad - before.pad;
      if (before.sw > 0 && !/stable/.test(before.gutter || "") && gained > 1 && padded < gained - 1) F.add({ ...base, type: "scrollbar-jump", detail: `opening it widens the page by ${gained}px (the scrollbar disappears), so centred content jumps`, severity: "warn", fix: "html { scrollbar-gutter: stable } (or let the dialog library add padding-right to body and fixed bars)" });
      if (opened.modal && !opened.focusInside) F.add({ ...base, type: "dialog-focus", detail: "focus stays behind the dialog when it opens", severity: "warn", fix: "move focus into the dialog (native <dialog>.showModal() or Radix Dialog do this)" });
      if (opened.modal) {
        const box = await page.locator('[data-sr-open="1"]').boundingBox().catch(() => null);
        const y0 = await page.evaluate(() => scrollY);
        const px = box && box.x > 30 ? 10 : 1430; await page.mouse.move(px, 450); await page.mouse.wheel(0, 600); await page.waitForTimeout(250);
        const y1 = await page.evaluate(() => scrollY);
        if (y1 !== y0) F.add({ ...base, type: "scroll-not-locked", detail: "the page scrolls behind the open dialog", severity: "warn", fix: "lock body scroll while open (overflow:hidden on html, or the dialog library's scroll lock) and overscroll-contain inside" });
      }
      await page.keyboard.press("Escape"); await page.waitForTimeout(350);
      const after = await page.evaluate((i) => { const el = document.querySelector('[data-sr-open="1"]'); const trig = document.querySelector(`[data-sr-trig="${i}"]`); const still = el && window.__sr.visible(el); if (el) el.removeAttribute("data-sr-open"); return { still, back: document.activeElement === trig || trig.contains(document.activeElement) }; }, t.i);
      if (after.still) { F.add({ ...base, type: "esc-no-close", detail: `Esc doesn't close the ${opened.modal ? "dialog" : "menu"}`, severity: "fail", fix: "close on Escape (native <dialog>, popover, Radix and Headless UI do it)" }); await page.mouse.click(2, 890).catch(() => {}); await page.waitForTimeout(300); }
      else if (!after.back) F.add({ ...base, type: "focus-not-returned", detail: "after closing, focus doesn't go back to the button that opened it", severity: "warn", fix: "return focus to the trigger on close" });
    } catch {}
  }
}

const PHONE = () => {
  const sr = window.__sr; const out = [];
  const targets = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch]')].filter((t) => sr.visible(t) && !sr.ignored(t) && !sr.allowed(t, "target"));
  const rects = targets.map((t) => ({ t, r: t.getBoundingClientRect() }));
  for (const { t, r } of rects) {
    if (t.tagName === "A" && getComputedStyle(t).display === "inline" && t.closest("p,li,td,dd,blockquote")) continue; // inline link in text: exempt
    const host = t.matches("input,select") ? (t.closest("label") || t) : t; const hr = host.getBoundingClientRect();
    if (hr.width >= 24 && hr.height >= 24) { if ((hr.width < 44 || hr.height < 44) && t.matches("button,[role=button]") && hr.width * hr.height < 44 * 44 * 0.6) out.push({ type: "small-tap", ...sr.describe(t), detail: `${Math.round(hr.width)}×${Math.round(hr.height)}px (44px recommended on touch)`, severity: "info" }); continue; }
    const cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
    const crowded = rects.some(({ t: o, r: q }) => o !== t && !o.contains(t) && !t.contains(o) && Math.hypot(Math.max(q.left - cx, 0, cx - q.right), Math.max(q.top - cy, 0, cy - q.bottom)) < 12);
    out.push({ type: "tap-target", ...sr.describe(t), detail: `${Math.round(hr.width)}×${Math.round(hr.height)}px${crowded ? ", another target within 24px" : ""}`, severity: crowded ? "fail" : "warn" });
  }
  for (const i of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea")) if (sr.visible(i) && parseFloat(getComputedStyle(i).fontSize) < 16) out.push({ type: "ios-zoom", ...sr.describe(i), detail: `font-size ${getComputedStyle(i).fontSize}: iPhone zooms the page in when it's tapped`, severity: "warn" });
  const vm = document.querySelector('meta[name="viewport"]')?.content || "";
  if (!vm) out.push({ type: "viewport-meta", el: "<head>", detail: "no viewport meta tag", severity: "fail" });
  else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*(1(\.0)?|0?\.\d)\b/.test(vm)) out.push({ type: "zoom-disabled", el: '<meta name="viewport">', detail: `pinch-zoom disabled (${vm})`, severity: "fail" });
  // Hover-only content: :hover rules that reveal another element, which stays invisible on touch.
  const reveal = new Set();
  const walk = (rules) => { for (const r of rules) { if (r.selectorText && /:hover\b[^,]*\s+[^,]+/.test(r.selectorText) && r.style && (r.style.opacity === "1" || r.style.visibility === "visible" || /translate|none/.test(r.style.transform || ""))) reveal.add(r.selectorText); if (r.cssRules) walk(r.cssRules); } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  for (const sel of [...reveal].slice(0, 80)) {
    for (const part of sel.split(",")) {
      const m = part.match(/:hover\b(.*)$/); if (!m || !m[1].trim()) continue;
      const target = part.replace(/:hover/g, ""); let els = []; try { els = [...document.querySelectorAll(target)].slice(0, 3); } catch {}
      for (const el of els) { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); if (r.width > 4 && r.height > 4 && (Number(c.opacity) < 0.1 || c.visibility === "hidden") && !sr.ignored(el) && (el.innerText || el.querySelector("a,button,svg,img"))) out.push({ type: "hover-only", ...sr.describe(el), detail: "only appears on hover, so touch users never see it", severity: "warn" }); }
    }
  }
  // Fixed/sticky bars covering the phone screen.
  const bars = [...document.querySelectorAll("body *")].filter((el) => { const p = getComputedStyle(el).position; return (p === "fixed" || p === "sticky") && sr.visible(el); }).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.bottom > 0 && r.top < innerHeight && r.width > innerWidth * 0.6);
  const area = bars.filter(({ el }) => !bars.some((o) => o.el !== el && o.el.contains(el))).reduce((s, { r }) => s + Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.min(r.width, innerWidth), 0);
  if (area > innerWidth * innerHeight * 0.25) out.push({ type: "sticky-cover", el: bars.map((b) => sr.label(b.el)).slice(0, 2).join(" + "), detail: `fixed/sticky bars cover ${Math.round((area / (innerWidth * innerHeight)) * 100)}% of the phone screen`, severity: "warn" });
  return out;
};

const MOTION = () => {
  const sr = window.__sr; const out = [];
  const anims = document.getAnimations ? document.getAnimations() : [];
  const running = anims.filter((a) => a.playState === "running" && a.effect && (a.effect.getTiming().iterations === Infinity || a.effect.getTiming().duration > 300));
  const seen = new Set();
  for (const a of running) { const el = a.effect.target; if (!el || el.nodeType !== 1 || seen.has(el) || sr.allowed(el, "motion") || !sr.visible(el)) continue; seen.add(el); out.push({ type: "reduced-motion", ...sr.describe(el), detail: `${a.animationName || a.transitionProperty || "an animation"} keeps running with reduced motion on`, severity: "warn" }); if (out.length >= 5) break; }
  return out;
};

const fixFor = {
  "tap-target": "min-h-11 min-w-11 (44px) or an invisible hit area: relative after:absolute after:-inset-2; gap-2 between icon buttons",
  "small-tap": "min-h-11 min-w-11 on touch, or an after:-inset-2 hit area",
  "ios-zoom": "text-base md:text-sm on inputs (16px on phones); never maximum-scale=1",
  "viewport-meta": 'Next: export const viewport = { width: "device-width", initialScale: 1 }',
  "zoom-disabled": "remove user-scalable=no and maximum-scale (Next viewport: no maximumScale/userScalable)",
  "hover-only": "visible by default on touch: opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100",
  "sticky-cover": "a compact sticky header (h-14) that hides on scroll down; pb-[calc(bar+env(safe-area-inset-bottom))] for bottom bars",
  "reduced-motion": "motion-safe:animate-* / motion-reduce:animate-none; Framer Motion <MotionConfig reducedMotion=\"user\">; canvas/WebGL: render one still frame",
};

// ── run ─────────────────────────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await desk.addInitScript(HELPERS);
const page = await desk.newPage();
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(page); await installHelpers(page);
await page.mouse.move(1, 1);
const popup = await dismissPopups(page);
if (popup) console.log(`(a popup was open on arrival: "${popup}"; closed it to test the page behind it)`);

const items = await page.evaluate(ENUMERATE, MAX);
console.log(`interaction: ${items.length} interactive elements probed`);
const cdp = await desk.newCDPSession(page);
await hoverProbe(page, cdp, items);
await hoverMenus(page, items);
// Each phase on a freshly loaded page: hover probes can leave a menu open, which would steer the Tab walk.
async function fresh(p) { await p.goto(url, { waitUntil: "load", timeout: 60_000 }); await settle(p); await installHelpers(p); await dismissPopups(p); await p.mouse.move(1, 1); }
await fresh(page);
const stops = await focusWalk(page);
if (!has("--no-overlays")) { await fresh(page); await overlays(page); }

let axeCount = 0;
const axeMod = has("--no-axe") ? null : tryRequire("@axe-core/playwright");
async function runAxe(p, width) {
  if (!axeMod) return;
  const AxeBuilder = axeMod.default || axeMod.AxeBuilder || axeMod;
  try {
    const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) { axeCount++; F.add({ type: `axe:${v.id}`, el: v.nodes[0]?.target.join(" ") || v.id, detail: `${v.help} (${v.nodes.length} element${v.nodes.length > 1 ? "s" : ""})`, severity: v.impact === "critical" ? "fail" : "warn", width, fix: v.helpUrl }); }
  } catch {}
}
await runAxe(page, 1440);
await desk.close();

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
await phone.addInitScript(HELPERS);
const pp = await phone.newPage();
await pp.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(pp); await installHelpers(pp);
for (const f of await pp.evaluate(PHONE)) F.add({ ...f, width: 390, fix: fixFor[f.type] || "" });
await runAxe(pp, 390);
// The mobile menu should close after following one of its links.
if (!has("--no-nav")) {
  try {
    const menu = await pp.evaluate(() => { const sr = window.__sr; const b = [...document.querySelectorAll('header button[aria-expanded="false"], nav button[aria-expanded="false"], button[aria-label*="menu" i]')].find(sr.visible); if (!b) return null; b.setAttribute("data-sr-menu", "1"); return sr.describe(b); });
    if (menu) {
      await pp.locator('[data-sr-menu="1"]').tap({ timeout: 2000 }); await pp.waitForTimeout(500);
      const link = await pp.evaluate(() => { const sr = window.__sr; const a = [...document.querySelectorAll("a[href]")].filter((a) => sr.visible(a) && (a.getAttribute("href").startsWith("#") || a.origin === location.origin) && a.getBoundingClientRect().top > 40)[0]; if (!a) return null; a.setAttribute("data-sr-link", "1"); return a.getAttribute("href"); });
      if (link) {
        await pp.locator('[data-sr-link="1"]').tap({ timeout: 2000 }); await pp.waitForTimeout(1200); await installHelpers(pp).catch(() => {});
        const state = await pp.evaluate(() => { const b = document.querySelector('[data-sr-menu="1"]') || [...document.querySelectorAll('header button[aria-expanded], nav button[aria-expanded]')][0]; return { open: b?.getAttribute("aria-expanded") === "true", locked: getComputedStyle(document.body).overflow === "hidden" || getComputedStyle(document.documentElement).overflow === "hidden" }; }).catch(() => null);
        if (state?.open || state?.locked) F.add({ ...menu, type: "menu-stays-open", detail: `after tapping a menu link (${link}) the menu ${state.open ? "stays open" : "closed but the page is still scroll-locked"}`, severity: "fail", width: 390, fix: "close it on navigation: const pathname = usePathname(); useEffect(() => setOpen(false), [pathname]) and close in the link's onClick for hash links" });
      }
    }
  } catch {}
}
await phone.close();

// Reduced motion.
const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await rm.addInitScript(HELPERS);
const rp = await rm.newPage();
await rp.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(rp); await installHelpers(rp); await rp.waitForTimeout(1200);
for (const f of await rp.evaluate(MOTION)) F.add({ ...f, width: 1440, fix: fixFor[f.type] });
const s1 = await rp.screenshot(); await rp.waitForTimeout(1000); const s2 = await rp.screenshot();
const moving = await pixelDiff(rp, s1, s2);
if (moving > 0.01) F.add({ type: "reduced-motion", el: "first screen", detail: `${Math.round(moving * 100)}% of the first screen still moves with reduced motion on (JS, canvas or video)`, severity: "warn", width: 1440, fix: fixFor["reduced-motion"] });
await rm.close();
await browser.close();

const summary = F.print();
console.log(`(${stops} keyboard stops walked${axeMod ? `, axe: ${axeCount} serious/critical` : ", axe not installed: pnpm add -D @axe-core/playwright for WCAG rules"})`);
F.write(out, { url, probed: items.length, stops, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(summary.fails ? 1 : 0);
