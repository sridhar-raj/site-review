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

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { newContext, parseArgs, toUrl, loadChromium, tryRequire, outDir, settle, HELPERS, installHelpers, dismissPopups, pixelDiff, Findings } from "./lib.mjs";

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
// Evidence for behaviour findings: before/after screenshots a person can check without re-running anything.
const shotDir = join(out, "interaction-shots"); mkdirSync(shotDir, { recursive: true }); let shotN = 0;
const keep = (buf, name) => { if (!buf) return null; const f = `${String(++shotN).padStart(2, "0")}-${name}.png`; writeFileSync(join(shotDir, f), buf); return `interaction-shots/${f}`; };

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
    // The current tab / pressed toggle / active page often has no hover on purpose.
    const selected = el.matches('[aria-selected="true"],[aria-current]:not([aria-current="false"]),[aria-pressed="true"],[aria-checked="true"],[data-state="active"],[data-state="on"],[data-state="checked"],[data-active="true"],[data-selected="true"]');
    // Looks different from its same-kind siblings (a segmented control, tabs, a nav): the selected one.
    const sibs = el.parentElement ? [...el.parentElement.children].filter((s) => s !== el && s.tagName === el.tagName && (s.getAttribute("role") || "") === (el.getAttribute("role") || "") && sr.visible(s)) : [];
    const look = (n) => { const c = getComputedStyle(n); return c.color + "|" + c.backgroundColor + "|" + c.fontWeight; };
    const looksSelected = !selected && sibs.length >= 2 && sibs.every((s) => look(s) === look(sibs[0])) && look(el) !== look(sibs[0]);
    return { id: i, ...sr.describe(el), tag: el.tagName, link: el.matches("a[href]"), jsHover: Boolean(pk && el[pk] && el[pk].onMouseEnter), popup: el.getAttribute("aria-haspopup") || null, selected, looksSelected };
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
      // Every ancestor: a hover style can live on an outer card (.card:hover .title, .rq-card:hover).
      for (let k = 0; k < 15; k++) { const d = await cdp.send("DOM.describeNode", { nodeId: cur }).catch(() => null); if (!d?.node?.parentId || d.node.nodeName === "BODY") break; cur = d.node.parentId; ids.push(cur); }
      for (const n of ids) await cdp.send("CSS.forcePseudoState", { nodeId: n, forcedPseudoClasses: ["hover"] }).catch(() => {});
      await page.waitForTimeout(Math.min(450, 60 + maxMs(a.tdur)));
      const b = await page.evaluate(SNAP, [it.id, PROPS]);
      const shotB = await page.screenshot({ clip, animations: "disabled" }).catch(() => null);
      for (const n of ids) await cdp.send("CSS.forcePseudoState", { nodeId: n, forcedPseudoClasses: [] }).catch(() => {});
      if (!a || !b) continue;
      const base = { el: it.el, selector: it.selector, owner: it.owner, classes: it.classes, width: 1440 };
      const changed = a.styles.some((s, i) => s !== b.styles[i]);
      const diff = shotA && shotB ? await pixelDiff(page, shotA, shotB) : 1;
      if (it.looksSelected) F.add({ ...base, type: "state-unannounced", detail: "looks selected (unlike its siblings) but has no aria-selected / aria-current / aria-pressed: screen readers can't tell which one is on", severity: "warn", fix: 'tabs: role="tab" aria-selected; nav links: aria-current="page"; toggles and segmented buttons: aria-pressed' });
      if (!changed && diff < 0.003 && !it.link && !it.selected && !it.looksSelected && !/^(INPUT|SELECT|TEXTAREA)$/.test(it.tag)) {
        // Confirm with a real pointer before saying so: JS hover (pointerenter opening a panel), hover on an
        // element on top of it (an invisible input over a chip) and anything forced hover can't reach.
        const wide = { x: Math.max(0, clip.x - 24), y: Math.max(0, clip.y - 24), width: Math.min(clip.width + 48, 1440 - Math.max(0, clip.x - 24)), height: Math.min(clip.height + 48, 900 - Math.max(0, clip.y - 24)) };
        await page.mouse.move(1, 1); await page.waitForTimeout(150);
        const rest = await page.screenshot({ clip: wide, animations: "disabled" }).catch(() => null);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(350);
        const hov = await page.screenshot({ clip: wide, animations: "disabled" }).catch(() => null);
        await page.mouse.move(1, 1); await page.waitForTimeout(150);
        const real = rest && hov ? await pixelDiff(page, rest, hov) : 1;
        if (real < 0.003) F.add({ ...base, type: "no-hover", detail: "nothing changes on hover (forced :hover on it and every parent, and a real pointer)", severity: "warn", steps: `Point at ${it.el} with the mouse: nothing about it changes.`, shot: keep(rest, "hover-rest"), shot2: keep(hov, "hover-on"), fix: "add a visible hover state: hover:bg-* / hover:text-* / an underline, more contrast than the rest state" });
      }
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
  let pixelBudget = 40;
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
      const offscreen = rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.left > innerWidth;
      const invisible = offscreen || Number(cs.opacity) < 0.05;
      return { end: false, key, ...sr.describe(el), changed, clipped, hidden, underBar: under ? sr.label(under) : null, invisible, offscreen, tabindex: el.tabIndex, allowed: sr.allowed(el, "focus"), skip: el.matches('a[href^="#"]') && /skip|main|content/i.test(el.innerText) };
    });
    if (r.end) { reachedEnd = true; break; }
    if (r.key === "iframe") continue;
    // Is the focus visible? Pixels decide (a style can change without any pixel changing, and a ring can be
    // drawn by a parent or a pseudo-element no style comparison sees): the stop's box, focused and not.
    let pix = null;
    if (pixelBudget-- > 0) {
      const box = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); return { x: b.left - 8, y: b.top - 8, w: b.width + 16, h: b.height + 16 }; });
      const vp = page.viewportSize(); const x = Math.max(0, box.x), y = Math.max(0, box.y);
      const clip = { x, y, width: Math.min(box.w - (x - box.x), vp.width - x), height: Math.min(box.h - (y - box.y), vp.height - y) };
      if (clip.width > 2 && clip.height > 2) {
        const on = await page.screenshot({ clip, animations: "disabled", caret: "hide" }).catch(() => null);
        await page.evaluate(() => { window.__srFocused = document.activeElement; document.activeElement.blur(); });
        const off = await page.screenshot({ clip, animations: "disabled", caret: "hide" }).catch(() => null);
        await page.evaluate(() => window.__srFocused?.focus({ preventScroll: true }));
        if (on && off) { pix = await pixelDiff(page, on, off); r.onShot = on; r.offShot = off; }
      }
    }
    r.shows = pix == null ? r.changed : pix > 0.004;
    // A visually hidden input (opacity 0 over a chip, a custom checkbox) is fine when its focus shows on the
    // chip: only a stop where nothing on screen changes is invisible.
    if (r.invisible && pix != null && pix > 0.004 && !(r.offscreen)) r.invisible = false;
    r.styleOnly = r.changed && pix != null && !r.shows;
    if (!first) { first = r; if (!r.skip) F.add({ type: "no-skip-link", el: r.el, detail: "the first Tab stop is not a skip link", severity: "info", width: 1440, fix: 'first in <body>: <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">Skip to content</a>' }); }
    if (seen.has(r.key)) { if (seen.size > 3) { if (!reachedEnd && seen.size < 6) F.add({ type: "focus-trap", el: r.el, detail: `Tab cycles through ${seen.size} elements and never leaves`, severity: "fail", width: 1440, fix: "only trap focus inside an open modal; release it on close" }); break; } continue; }
    seen.set(r.key, true); stops++;
    if (r.allowed) continue;
    const base = { el: r.el, selector: r.selector, owner: r.owner, classes: r.classes, width: 1440 };
    if (r.invisible) F.add({ ...base, type: "invisible-focus-stop", detail: "Tab lands on something you can't see (closed menu, off-screen, opacity 0)", severity: "fail", fix: "inert (or visibility:hidden / invisible) on closed panels, not just a transform" });
    else if (!r.shows) F.add({ ...base, steps: `Press Tab until ${r.el} is reached: nothing on screen shows it has focus.`, shot: keep(r.offShot, "focus-off"), shot2: keep(r.onShot, "focus-on"), type: "no-focus-ring", detail: r.styleOnly ? "its focus style changes, but no pixel does (a ring the colour of the background, or drawn outside the screen)" : "no visible focus indicator (checked by screenshot, focused vs not)", severity: "fail", fix: "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color] (replace outline-none with outline-hidden plus a visible ring)" });
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
      // After a reload (the Esc test reloads between ways in) the markers are gone: put them back.
      await page.evaluate(() => { if (document.querySelector("[data-sr-trig]")) return; const sr = window.__sr; [...document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]),[aria-expanded="false"],button[aria-controls]')].filter((el) => sr.visible(el) && !sr.ignored(el)).slice(0, 6).forEach((el, i) => el.setAttribute("data-sr-trig", String(i))); });
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
      if (after.still) {
        const stuck = await page.screenshot({ animations: "disabled" }).catch(() => null);
        // Try the other ways in on a fresh page: by keyboard (Tab to it, Enter) and by pointing at it (hover
        // menus and panels). A panel can close on Esc one way and not another.
        const ways = { click: false };
        for (const way of ["keyboard", "hover"]) {
          try {
            await fresh(page);
            const ok = await page.evaluate(({ sel, i }) => { const el = document.querySelector(sel) || [...document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]),[aria-expanded="false"],button[aria-controls]')][i]; if (!el) return false; el.setAttribute("data-sr-trig", String(i)); return true; }, { sel: t.selector, i: t.i });
            if (!ok) continue;
            const loc = page.locator(`[data-sr-trig="${t.i}"]`);
            if (way === "keyboard") { await loc.focus(); await page.keyboard.press("Enter"); } else { const b = await loc.boundingBox(); if (!b) continue; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); }
            await page.waitForTimeout(450);
            const isOpen = () => page.evaluate(({ i, sel }) => { const trig = document.querySelector(`[data-sr-trig="${i}"]`); const ex = trig?.getAttribute("aria-expanded"); if (ex) return ex === "true"; const el = sel ? document.querySelector(sel) : null; return !!(el && window.__sr.visible(el)); }, { i: t.i, sel: opened.selector });
            if (!(await isOpen())) continue; // this way doesn't open it
            await page.keyboard.press("Escape"); await page.waitForTimeout(350);
            ways[way] = !(await isOpen());
          } catch {}
        }
        const failing = Object.entries(ways).filter(([, closed]) => !closed).map(([w]) => w);
        const working = Object.entries(ways).filter(([, closed]) => closed).map(([w]) => w);
        const strict = opened.modal || /menu|listbox/.test(opened.el || "") ;
        const how = { click: "click it", keyboard: "Tab to it and press Enter", hover: "point at it" };
        F.add({ ...base, type: "esc-no-close", kind: strict && !working.length ? "issue" : "suggestion",
          detail: working.length ? `Esc closes it after you ${working.map((w) => how[w]).join(" or ")}, but not after you ${failing.map((w) => how[w]).join(" or ")}` : `Esc doesn't close the ${opened.modal ? "dialog" : "panel"} however it is opened`,
          steps: `${how[failing[0]][0].toUpperCase() + how[failing[0]].slice(1)} (${t.el}), then press Esc: it stays open.`,
          shot: keep(stuck, "esc-still-open"), severity: strict && !working.length ? "fail" : "warn",
          fix: strict ? "close on Escape and return focus to the trigger (native <dialog>, popover, Radix and Headless UI do it)" : "close on Escape whichever way it was opened (keep a draft if something was typed), and return focus to the trigger" });
        await fresh(page);
        continue;
      }
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
    // A wrapping <label> adds to the hit area; an inline label is one line tall, so take the union, not the label.
    const own = t.getBoundingClientRect(); const lab = t.matches("input,select,textarea") ? t.closest("label") : null;
    const lr = lab ? lab.getBoundingClientRect() : own;
    const ux = Math.min(own.left, lr.left), uy = Math.min(own.top, lr.top);
    const hr = { left: ux, top: uy, right: Math.max(own.right, lr.right), bottom: Math.max(own.bottom, lr.bottom) }; hr.width = hr.right - hr.left; hr.height = hr.bottom - hr.top;
    if (hr.width >= 24 && hr.height >= 24) { if ((hr.width < 44 || hr.height < 44) && t.matches("button,[role=button]") && hr.width * hr.height < 44 * 44 * 0.6) out.push({ type: "small-tap", ...sr.describe(t), detail: `${Math.round(hr.width)}×${Math.round(hr.height)}px (44px recommended on touch)`, severity: "info" }); continue; }
    const cx = hr.left + hr.width / 2, cy = hr.top + hr.height / 2;
    const crowded = rects.some(({ t: o, r: q }) => o !== t && !o.contains(t) && !t.contains(o) && Math.hypot(Math.max(q.left - cx, 0, cx - q.right), Math.max(q.top - cy, 0, cy - q.bottom)) < 12);
    // WCAG 2.5.8: under 24px passes when nothing else is within its 24px circle (the spacing exception), so a
    // lone small target is a suggestion (bigger is easier), a crowded one an issue.
    out.push({ type: "tap-target", ...sr.describe(t), kind: crowded ? "issue" : "suggestion", detail: `${Math.round(hr.width)}×${Math.round(hr.height)}px${crowded ? ", another target within 24px: fails WCAG 2.5.8" : ": passes WCAG 2.5.8 through spacing, but a bigger target is easier"}`, severity: crowded ? "fail" : "warn" });
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
  const bars = [...document.querySelectorAll("body *")].filter((el) => { const p = getComputedStyle(el).position; const c = getComputedStyle(el); return (p === "fixed" || p === "sticky") && sr.visible(el) && c.pointerEvents !== "none" && Number(c.opacity) >= 0.3 && !(parseInt(c.zIndex) < 0); }).map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.bottom > 0 && r.top < innerHeight && r.width > innerWidth * 0.6);
  const area = bars.filter(({ el }) => !bars.some((o) => o.el !== el && o.el.contains(el))).reduce((s, { r }) => s + Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.min(r.width, innerWidth), 0);
  if (area > innerWidth * innerHeight * 0.25) out.push({ type: "sticky-cover", el: bars.map((b) => sr.label(b.el)).slice(0, 2).join(" + "), detail: `fixed/sticky bars cover ${Math.round((area / (innerWidth * innerHeight)) * 100)}% of the phone screen`, severity: "warn" });
  return out;
};

// Custom widgets with the keyboard: what a mouse can do, Tab, Enter/Space and the arrow keys must do too.
const KEYS_SCAN = () => {
  const sr = window.__sr; const out = []; const native = "a[href],button,input,select,textarea,summary,[contenteditable=true],iframe";
  const handlers = (el) => { const pk = Object.keys(el).find((k) => k.startsWith("__reactProps$")); const p = pk ? el[pk] || {} : {}; return { click: !!(p.onClick || p.onMouseDown || p.onPointerDown || el.onclick || el.hasAttribute("onclick")), key: !!(p.onKeyDown || p.onKeyUp || p.onKeyPress || el.onkeydown || el.onkeyup || el.hasAttribute("onkeydown") || el.hasAttribute("onkeyup")) }; };
  for (const el of document.querySelectorAll("body *")) {
    if (el.matches(native) || sr.ignored(el) || sr.allowed(el, "focus") || !sr.visible(el)) continue;
    const h = handlers(el); const role = el.getAttribute("role");
    if (!h.click && !(role && /^(button|link|tab|menuitem|switch|checkbox|option)$/.test(role))) continue;
    if (el.closest(native) || [...el.querySelectorAll(native)].some(sr.visible)) continue; // a real control inside or around it
    if (el.tabIndex < 0) out.push({ type: "not-focusable", ...sr.describe(el), detail: "clickable, but Tab never reaches it: keyboard users can't use it", severity: "fail" });
    else if (h.click && !h.key && !/^(tab|option)$/.test(role || "")) out.push({ type: "no-key-activation", ...sr.describe(el), detail: `${role ? `role="${role}"` : "a clickable element"} with a click handler but no key handler: Enter and Space do nothing`, severity: "fail" });
  }
  const lists = [...document.querySelectorAll("[role=tablist]")].filter(sr.visible).slice(0, 3);
  lists.forEach((l, i) => l.setAttribute("data-sr-tablist", String(i)));
  const sliders = [...document.querySelectorAll("[role=slider]")].filter(sr.visible).slice(0, 3);
  sliders.forEach((el, i) => el.setAttribute("data-sr-slider", String(i)));
  return { out: out.slice(0, 12), lists: lists.length, sliders: sliders.length };
};

async function keyboardWidgets(page) {
  const r = await page.evaluate(KEYS_SCAN);
  const fix = { "not-focusable": "use a <button> (or <a href> for navigation); a div needs tabIndex={0}, role and key handlers to match", "no-key-activation": "use a <button>; otherwise onKeyDown: Enter and Space call the same handler as onClick" };
  for (const f of r.out) F.add({ ...f, width: 1440, fix: fix[f.type] });
  for (let i = 0; i < r.lists; i++) {
    const res = await page.evaluate((i) => {
      const l = document.querySelector(`[data-sr-tablist="${i}"]`); const tabs = [...l.querySelectorAll("[role=tab]")].filter(window.__sr.visible);
      if (tabs.length < 2) return null;
      const start = tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]; start.focus(); start.setAttribute("data-sr-start", "1");
      return { ok: document.activeElement === start, ...window.__sr.describe(l) };
    }, i);
    if (!res || !res.ok) continue;
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(80);
    // Moved = focus is on a different tab of the same list (compared with the element focused before, since a
    // list that selects on arrow also moves aria-selected).
    const moved = await page.evaluate((i) => { const l = document.querySelector(`[data-sr-tablist="${i}"]`); const a = document.activeElement; return l.contains(a) && a.getAttribute("role") === "tab" && !a.hasAttribute("data-sr-start"); }, i);
    await page.evaluate(() => document.querySelector("[data-sr-start]")?.removeAttribute("data-sr-start"));
    if (!moved) F.add({ ...res, type: "tablist-arrows", detail: "ArrowRight doesn't move to the next tab (the ARIA tabs pattern: arrows move, Tab leaves the list)", severity: "warn", width: 1440, fix: "Radix Tabs / Headless UI Tab do it; by hand: roving tabIndex (0 on the selected tab, -1 on the rest) and ArrowLeft/ArrowRight/Home/End handlers" });
  }
  for (let i = 0; i < r.sliders; i++) {
    const before = await page.evaluate((i) => { const el = document.querySelector(`[data-sr-slider="${i}"]`); el.focus(); return { v: el.getAttribute("aria-valuenow"), focused: document.activeElement === el, ...window.__sr.describe(el) }; }, i);
    if (!before.focused) { F.add({ ...before, type: "not-focusable", detail: 'role="slider" that Tab never reaches', severity: "fail", width: 1440, fix: "tabIndex={0} on the thumb" }); continue; }
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(80);
    const after = await page.evaluate((i) => document.querySelector(`[data-sr-slider="${i}"]`).getAttribute("aria-valuenow"), i);
    if (after === before.v) F.add({ ...before, type: "slider-keys", detail: "ArrowRight doesn't change the value (aria-valuenow stays the same)", severity: "fail", width: 1440, fix: "arrow keys step the value and update aria-valuenow; or use <input type=range> / Radix Slider" });
  }
}

// A form whose submit stays disabled until the field looks valid: with a typo, Enter does nothing and nothing
// says why, and Tab skips the disabled button. A near-miss value is typed (never a valid one), Enter pressed,
// and the form's text compared; if the near-miss enables the button, the field is cleared and nothing is sent.
async function silentSubmit(page) {
  const forms = await page.evaluate(() => {
    const sr = window.__sr;
    return [...document.querySelectorAll("form")].filter((f) => sr.visible(f) && !sr.ignored(f)).map((f, i) => {
      f.setAttribute("data-sr-form", String(i));
      const sub = f.querySelector("button[type=submit], button:not([type]), input[type=submit]");
      const field = [...f.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea")].find((e) => sr.visible(e));
      if (field) field.setAttribute("data-sr-field", String(i));
      return { i, disabled: !!(sub && sub.disabled), field: !!field, type: field?.type || "text", ...sr.describe(sub || f) };
    }).filter((x) => x.disabled && x.field);
  });
  for (const f of forms) {
    try {
      const near = f.type === "email" ? "name@example" : f.type === "url" ? "example.com" : f.type === "tel" ? "12" : "a";
      const field = page.locator(`[data-sr-field="${f.i}"]`);
      await field.fill(near); await page.waitForTimeout(200);
      const region = () => page.evaluate((i) => { const fm = document.querySelector(`[data-sr-form="${i}"]`); const box = fm.parentElement || fm; return { text: box.innerText, invalid: !!fm.querySelector("[aria-invalid=true]"), disabled: !!fm.querySelector("button[type=submit], button:not([type]), input[type=submit]")?.disabled }; }, f.i);
      const before = await region();
      if (!before.disabled) { await field.fill(""); continue; } // the near-miss counts as valid here: never submit
      await field.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
      const after = await region();
      if (after.text === before.text && !after.invalid) {
        const box = await page.locator(`[data-sr-form="${f.i}"]`).boundingBox();
        const shot = box ? await page.screenshot({ clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(box.width + 24, 1440), height: Math.min(box.height + 60, 900) } }).catch(() => null) : null;
        F.add({ ...f, type: "silent-submit", severity: "fail", width: 1440, shot: keep(shot, "silent-submit"),
          detail: `the submit button stays disabled until the ${f.type === "email" ? "email" : "field"} looks valid; with “${near}” typed, Enter does nothing and nothing says why. Tab also skips the disabled button`,
          steps: `Type “${near}” in the ${f.type === "email" ? "email " : ""}field and press Enter: nothing happens and no message appears.`,
          fix: "keep the button enabled; on submit, check the field and say what's wrong under it (aria-invalid + aria-describedby to the message, focus back on the field). A disabled button can't explain itself" });
      }
      await field.fill("");
    } catch {}
  }
}

// When axe isn't installed: the basics it would catch first, so a review never ships with no a11y check at all.
const A11Y_LITE = () => {
  const sr = window.__sr; const out = [];
  const text = (el) => (el.innerText || el.textContent || "").trim();
  const byIds = (ids) => (ids || "").split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(" ").trim();
  const name = (el) => (el.getAttribute("aria-label") || "").trim() || byIds(el.getAttribute("aria-labelledby")) || text(el) || (el.getAttribute("title") || "").trim() || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ").trim() || [...el.querySelectorAll("svg title")].map(text).join(" ").trim() || (el.matches("input") ? el.value : "");
  for (const el of document.querySelectorAll("a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=button],input[type=submit]")) {
    if (!sr.visible(el) || sr.ignored(el)) continue;
    if (!name(el)) out.push({ type: "no-accessible-name", ...sr.describe(el), detail: `${el.tagName.toLowerCase()} with no name: a screen reader says only "${el.matches("a") ? "link" : "button"}"`, severity: "fail" });
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]),select,textarea")) {
    if (!sr.visible(el) || sr.ignored(el)) continue;
    const labelled = (el.labels && el.labels.length && [...el.labels].some((l) => text(l))) || (el.getAttribute("aria-label") || "").trim() || byIds(el.getAttribute("aria-labelledby")) || (el.getAttribute("title") || "").trim();
    if (labelled) continue;
    if (el.getAttribute("placeholder")) out.push({ type: "placeholder-label", ...sr.describe(el), detail: "labelled only by its placeholder, which disappears once you type", severity: "warn" });
    else out.push({ type: "no-label", ...sr.describe(el), detail: "form field with no label", severity: "fail" });
  }
  if (!document.documentElement.lang) out.push({ type: "no-lang", el: "<html>", detail: "no lang attribute: screen readers guess the language", severity: "warn" });
  let last = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (!sr.visible(h)) continue; const lvl = Number(h.tagName[1]);
    if (last && lvl > last + 1) { out.push({ type: "heading-skip", ...sr.describe(h), detail: `h${last} → h${lvl}: a level is skipped`, severity: "info" }); }
    last = lvl;
  }
  return out.slice(0, 30);
};
// Always (axe or not): what screen-reader and voice-control users meet first, and Windows contrast themes.
const A11Y_EXTRA = (withNames) => {
  const sr = window.__sr; const out = [];
  const norm = (t) => (t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Images: no name, or a name that says nothing ("image", "photo", a file name).
  if (withNames) for (const im of document.querySelectorAll("img, [role=img], svg[role=img]")) {
    if (!sr.visible(im) || sr.ignored(im) || im.getAttribute("role") === "presentation" || im.getAttribute("role") === "none") continue;
    const r = im.getBoundingClientRect(); if (r.width < 16 || r.height < 16) continue;
    if (im.tagName === "IMG" && im.getAttribute("alt") === "") continue; // marked decorative
    const name = (im.getAttribute("aria-label") || im.getAttribute("alt") || im.getAttribute("title") || "").trim();
    if (im.tagName === "IMG" && !im.hasAttribute("alt") && !name) out.push({ type: "image-name", ...sr.describe(im), detail: 'no alt: a screen reader reads the file name, or "image"', severity: "fail" });
    else if (name && /^(image|img|photo|picture|graphic|icon|logo)( \d+)?$|\.(png|jpe?g|gif|webp|avif|svg)$|^(img|dsc|screenshot)[_-]?\d/i.test(name)) out.push({ type: "image-name", ...sr.describe(im), detail: `named "${name}": says nothing about what it shows`, severity: "warn" });
  }
  // Label in name (WCAG 2.5.3): the accessible name must contain the words on screen.
  for (const el of document.querySelectorAll("a[href],button,[role=button],[role=link],[role=tab],[role=menuitem]")) {
    if (!sr.visible(el) || sr.ignored(el)) continue;
    const lab = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
    const shown = norm(el.innerText);
    if (lab && shown && shown.length > 1 && !norm(lab).includes(shown)) out.push({ type: "label-in-name", ...sr.describe(el), detail: `shows "${el.innerText.trim().slice(0, 40)}" but is announced as "${lab.trim().slice(0, 40)}": saying what you see does nothing`, severity: "warn" });
  }
  if (![...document.querySelectorAll("h1,[role=heading][aria-level='1']")].some(sr.visible)) out.push({ type: "no-h1", el: "<h1>", detail: "no visible h1: heading navigation has no top", severity: "warn" });
  if (!document.querySelector("main,[role=main]")) out.push({ type: "no-main-landmark", el: "<main>", detail: "no main landmark: \"skip to main content\" has nowhere to go", severity: "warn" });
  // Media a person has to judge: spoken content needs captions.
  for (const v of document.querySelectorAll("video")) {
    if (!sr.visible(v) || v.getBoundingClientRect().width < 120) continue;
    if ((v.muted && !v.controls) || v.querySelector("track[kind=captions],track[kind=subtitles]")) continue;
    out.push({ type: "captions-review", ...sr.describe(v), detail: "needs a person: if it has speech, it needs captions (no <track kind=captions>)", severity: "warn" });
  }
  // Windows contrast themes replace colours: a control drawn only by its background loses its edge, and an
  // icon in a fixed fill/stroke colour stays that colour on the theme's ground (dark grey on black vanishes).
  const filled = (c) => { const m = c.match(/[\d.]+/g); return m && (m.length < 4 || Number(m[3]) > 0.1) && c !== "transparent"; };
  for (const el of document.querySelectorAll("button,a[href],[role=button],input[type=submit],input[type=button]")) {
    if (!sr.visible(el) || sr.ignored(el)) continue;
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 20 || !filled(c.backgroundColor)) continue;
    const parentBg = getComputedStyle(el.parentElement || document.body).backgroundColor;
    if (c.backgroundColor === parentBg) continue; // not visibly a filled shape
    const edge = ["Top", "Right", "Bottom", "Left"].some((s2) => parseFloat(c["border" + s2 + "Width"]) > 0 && c["border" + s2 + "Style"] !== "none") || (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0);
    if (!edge) out.push({ type: "forced-colors-edge", ...sr.describe(el), detail: "a filled shape with no border: in a Windows contrast theme the fill is removed and it becomes floating text", severity: "warn" });
  }
  for (const svg of document.querySelectorAll("svg")) {
    if (!sr.visible(svg) || sr.ignored(svg)) continue;
    const r = svg.getBoundingClientRect(); if (r.width > 64 || r.height > 64 || r.width < 8) continue; // icons only
    const color = getComputedStyle(svg).color;
    const shape = svg.querySelector("path,circle,rect,polygon,line,polyline,ellipse"); if (!shape) continue;
    const sc = getComputedStyle(shape);
    const fixed = (v) => v && v !== "none" && !v.startsWith("url") && v !== color;
    if (fixed(sc.fill) || fixed(sc.stroke)) out.push({ type: "forced-colors-icon", ...sr.describe(svg.closest("a,button,[role=button]") || svg), detail: `icon drawn in a fixed colour (${fixed(sc.fill) ? "fill " + sc.fill : "stroke " + sc.stroke}): it keeps that colour in a contrast theme and can vanish`, severity: "warn" });
  }
  return out.slice(0, 40);
};

// What a screen reader lists: landmarks, headings, controls and images from Chrome's accessibility tree, in
// page order (the same data screen readers read; a real one adds its own phrasing).
async function readerList(page, cdp) {
  try {
    await cdp.send("Accessibility.enable");
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const keep = /^(banner|navigation|main|contentinfo|complementary|region|form|search|heading|link|button|textbox|searchbox|combobox|checkbox|radio|switch|tab|slider|image|img|video)$/;
    const lines = [];
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = n.role?.value || ""; if (!keep.test(role)) continue;
      const name = (n.name?.value || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const level = (n.properties || []).find((p) => p.name === "level")?.value?.value;
      const label = role === "heading" ? `heading level ${level ?? "?"}` : /^(banner|navigation|main|contentinfo|complementary|region|form|search)$/.test(role) ? `${role} landmark` : role;
      const bad = !name && !/landmark/.test(label);
      lines.push(`${bad ? "✗ " : "  "}${label}, ${name || "unlabelled"}`);
      if (lines.length >= 300) break;
    }
    return lines;
  } catch { return []; }
}

const liteFix = { "image-name": 'alt="what it shows" (alt="" for decoration); for a logo, the company name', "label-in-name": "start the aria-label with the visible words (or drop the aria-label and let the text name it)", "no-h1": "one h1 that says what the page or screen is (it can be visually hidden in an app shell)", "no-main-landmark": "wrap the page's own content in <main id=\"main\">", "captions-review": "<track kind=\"captions\" src=\"…vtt\" srclang=\"en\" label=\"English\"> for any speech; muted decorative loops need none", "forced-colors-edge": "border border-transparent on filled buttons (the transparent border is drawn in contrast themes); or forced-colors:border", "forced-colors-icon": "fill=\"currentColor\" / stroke=\"currentColor\" on icons, colour set by the parent's text colour", "no-accessible-name": 'aria-label="…" on icon-only controls (or visually hidden text: <span class="sr-only">…</span>)', "placeholder-label": "a visible <label> (or aria-label); keep the placeholder as an example", "no-label": "<label htmlFor> or aria-label", "no-lang": 'Next: <html lang="en"> in app/layout.tsx', "heading-skip": "keep heading levels in order; style with classes, not by picking a smaller tag" };

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
const desk = await newContext(browser, url, { viewport: { width: 1440, height: 900 } });
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
await fresh(page); await keyboardWidgets(page).catch(() => {});
await fresh(page); await silentSubmit(page).catch(() => {});
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
if (!axeMod) for (const f of await page.evaluate(A11Y_LITE).catch(() => [])) F.add({ ...f, width: 1440, fix: liteFix[f.type] || "" });
for (const f of await page.evaluate(A11Y_EXTRA, !axeMod).catch(() => [])) F.add({ ...f, width: 1440, fix: liteFix[f.type] || "" });
const reader = await readerList(page, await desk.newCDPSession(page));
if (reader.length) writeFileSync(join(out, "reader.txt"), reader.join("\n") + "\n");
await desk.close();

// Phone.
const phone = await newContext(browser, url, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
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
const rm = await newContext(browser, url, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await rm.addInitScript(HELPERS);
const rp = await rm.newPage();
await rp.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(rp); await installHelpers(rp); await rp.waitForTimeout(1200);
for (const f of await rp.evaluate(MOTION)) F.add({ ...f, width: 1440, fix: fixFor[f.type] });
const s1 = await rp.screenshot(); await rp.waitForTimeout(1000); const s2 = await rp.screenshot();
const moving = await pixelDiff(rp, s1, s2);
if (moving > 0.01) F.add({ type: "reduced-motion", el: "first screen", detail: `${Math.round(moving * 100)}% of the first screen still moves with reduced motion on (JS, canvas or video)`, severity: "warn", width: 1440, fix: fixFor["reduced-motion"] });
await rm.close();

// The page in a Windows contrast theme, for the eye (the forced-colors-* findings say what to look for).
const fc = await newContext(browser, url, { viewport: { width: 1440, height: 900 }, forcedColors: "active", colorScheme: "dark" });
const fp = await fc.newPage();
try { await fp.goto(url, { waitUntil: "load", timeout: 60_000 }); await settle(fp); await fp.screenshot({ path: join(out, "forced-colors.jpg"), type: "jpeg", quality: 80 }); } catch {}
await fc.close();
await browser.close();

const summary = F.print();
console.log(`(${stops} keyboard stops walked${axeMod ? `, axe: ${axeCount} serious/critical` : ", axe not installed: only the built-in basics ran (names, labels, lang, headings). For the full WCAG rules: pnpm add -D @axe-core/playwright"})`);
F.write(out, { url, probed: items.length, stops, axe: !!axeMod, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(summary.fails ? 1 : 0);
