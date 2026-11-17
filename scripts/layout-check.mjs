#!/usr/bin/env node
// layout-check.mjs: find layout bugs across widths, confirm each one visually, point at the source.
//
//   node layout-check.mjs <url | file.html> [--out .review] [--step 40] [--widths 360,390,768,1440]
//        [--no-confirm] [--no-cls] [--no-shots] [--no-stress] [--motion]
//
// Widths: the site's own breakpoints (each one and 1 px below it, where layouts are most squeezed), common
// devices, and a sweep from 320 to 1440 px every --step px. At each width: sideways scroll and its culprits,
// clipped text (own box, clipping ancestor, cut descenders, a select's chosen option), text wider than its
// button or tab, text over text, text covered by other elements,
// content sticking out of its box, items wrapping alone. Once: clashing breakpoints, sticky headers over
// anchor targets, 100vh on phones, layout shift with its cause. Overlaps are confirmed by hiding one element
// and diffing the pixels (drops invisible ones). Each finding names its element, React component and classes.
//
// Stress pass (default on): the page is loaded again with every text about 30% longer and every number
// bigger (translations run 30-40% longer; a badge goes from 7 to 1,274), and the layout audit runs again at
// the device widths. What breaks only then is reported as "fragile" (warn), so a layout that fits today's
// copy by a few pixels is caught before the copy changes. --motion runs with animations on (default: reduced
// motion, so mid-animation positions don't read as bugs).
//
// Silence an intentional case with data-review-allow="overflow|clip|overlap|cover|protrude|wrap|all".

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { ident, newContext, parseArgs, toUrl, loadChromium, outDir, settle, HELPERS, installHelpers, dismissPopups, hideAndDiff, Findings } from "./lib.mjs";

const { opt, has, target } = parseArgs(["--out", "--step", "--widths"]);
if (!target) { console.error("usage: layout-check.mjs <url | file.html> [--out .review] [--step 40] [--widths 360,768,1440] [--no-confirm] [--no-cls] [--no-shots]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const step = Math.max(8, Number(opt("--step", 40)) || 40);
const confirm = !has("--no-confirm");
const F = new Findings("layout");
const { chromium } = loadChromium();
const browser = await chromium.launch();
const t0 = Date.now();

// ── in-page audits ──────────────────────────────────────────────────────────

const AUDIT = () => {
  const sr = window.__sr; const W = document.documentElement.clientWidth; const H = innerHeight;
  const found = [];
  const push = (type, el, detail, extra = {}) => found.push({ type, ...sr.describe(el), detail, ...extra });

  // 1. Sideways scroll: culprits even when body/html hide it (iOS still pans, and content is cut).
  const pageOverflow = document.documentElement.scrollWidth > W + 1;
  const culprits = [];
  for (const el of document.querySelectorAll("body *")) {
    if (sr.ignored(el) || sr.allowed(el, "overflow")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || (r.right <= W + 1 && r.left >= -1)) continue;
    const c = sr.clipper(el);
    if (c && c !== document.body && c !== document.documentElement) continue; // inside a scroller or clip: fine
    if (getComputedStyle(el).position === "fixed" && r.left >= W) continue; // off-canvas drawer
    if (!sr.visible(el)) continue;
    culprits.push(el);
  }
  const outer = culprits.filter((el) => !culprits.some((o) => o !== el && o.contains(el)));
  for (const el of outer.slice(0, 6)) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    let why = "";
    if (Math.abs(r.width - innerWidth) < 2 && innerWidth > W) why = "width is 100vw (includes the scrollbar)";
    else if (/px$/.test(cs.width) && el.style.width) why = `fixed width ${cs.width}`;
    else if (parseFloat(cs.minWidth) > W) why = `min-width ${cs.minWidth}`;
    else if (cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre") why = `white-space: ${cs.whiteSpace}`;
    else if (el.scrollWidth > el.clientWidth + 1 && (el.innerText || "").split(/\s+/).some((w) => w.length > 24)) why = "a long unbroken word or URL";
    else if (cs.transform !== "none") why = "a transform pushes it past the edge";
    else if (/^(IMG|VIDEO|IFRAME|SVG|CANVAS|TABLE|PRE)$/i.test(el.tagName)) why = `${el.tagName.toLowerCase()} wider than the screen`;
    push("overflow", el, `right edge ${Math.round(r.right)}px on a ${W}px screen${why ? `: ${why}` : ""}${pageOverflow ? "" : " (hidden by overflow-x on body, still cut)"}`, { severity: pageOverflow ? "fail" : "warn", why });
  }

  const texts = sr.textEls();

  // 2. Clipped text.
  const clips = (v) => v === "hidden" || v === "clip";
  for (const el of texts) {
    if (sr.allowed(el, "clip") || sr.animating(el)) continue;
    const cs = getComputedStyle(el);
    const important = sr.important(el);
    const titled = el.title || el.getAttribute("aria-label") || el.closest("[title]");
    if (clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      const hidden = 1 - el.clientWidth / el.scrollWidth;
      const ellipsis = cs.textOverflow === "ellipsis";
      if (!ellipsis || important || (hidden > 0.3 && !titled))
        push("clipped-text", el, `${ellipsis ? "truncated with …" : "cut off"}: ${Math.round(hidden * 100)}% of its width hidden`, { severity: important ? "fail" : "warn" });
      continue;
    }
    if (clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) {
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
      if (!clamp || important) push("clipped-text", el, `${clamp ? "line-clamped" : "cut off at the bottom"}: ${el.scrollHeight - el.clientHeight}px hidden (fixed height?)`, { severity: important ? "fail" : "warn" });
      continue;
    }
    // Text wider than its own button, pill or tab (overflow visible): it spills past the box's background and
    // disappears into whatever is behind (dark text past a white pill), so it reads as cut off.
    if (!/^inline$/.test(cs.display) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && !sr.scroller(el)) {
      const boxed = el.matches("button,a,label,[role=button],[role=tab],[role=menuitem]") || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || parseFloat(cs.borderTopWidth) > 0;
      if (boxed) { push("text-overflow", el, `text is ${el.scrollWidth - el.clientWidth}px wider than its ${el.tagName.toLowerCase()} (${el.clientWidth}px): it runs past the box's edge`, { severity: important ? "fail" : "warn" }); continue; }
    }
    // Clipped by an ancestor (cards with overflow-hidden, masks): compare the text's own line boxes.
    const a = sr.clipper(el);
    if (a && a !== document.body && a !== document.documentElement && !sr.scroller(el)) {
      const ac = getComputedStyle(a);
      if (!/(auto|scroll)/.test(ac.overflowX + ac.overflowY)) {
        const rg = document.createRange(); rg.selectNodeContents(el);
        const rects = [...rg.getClientRects()].filter((r) => r.width > 1);
        const b = a.getBoundingClientRect();
        const cut = rects.filter((r) => r.right > b.right + 2 || r.left < b.left - 2 || r.bottom > b.bottom + 2 || r.top < b.top - 2);
        if (cut.length && rects.length) {
          const inside = rects.some((r) => r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom);
          if (inside) push("clipped-text", el, `cut by its container ${sr.label(a)} (overflow ${ac.overflowX}/${ac.overflowY})`, { severity: important ? "fail" : "warn", clipBy: sr.cssPath(a) });
        }
      }
    }
    // Cut descenders: tight leading with a clip or gradient text.
    const lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
    const gradientText = (cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text");
    if (fs >= 28 && lh && lh / fs < 1.02 && (gradientText || clips(cs.overflowY)) && /[gjpqy]/.test(el.innerText)) {
      const c = document.createElement("canvas").getContext("2d");
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = c.measureText(el.innerText.split("\n").pop() || "gy");
      const half = (lh - fs) / 2;
      if (m.actualBoundingBoxDescent - (fs * 0.2 + half) > 1) push("clipped-text", el, `descenders (g, y, p) cut: line-height ${(lh / fs).toFixed(2)} with ${gradientText ? "gradient text" : "overflow hidden"}`, { severity: "warn" });
    }
  }

  // 2b. Form controls: a select's chosen option and a button-type input's label are not text nodes in the
  // page, so the checks above never see them. Measure the text against the room left inside the padding
  // (a custom chevron sits in padding-right).
  const ctx2d = document.createElement("canvas").getContext("2d");
  for (const el of document.querySelectorAll('select, input[type=button], input[type=submit], input[type=reset]')) {
    if (sr.ignored(el) || sr.allowed(el, "clip") || !sr.visible(el) || el.multiple || el.size > 1) continue;
    const text = el.tagName === "SELECT" ? (el.options[el.selectedIndex]?.text || "") : el.value;
    if (!text.trim()) continue;
    const cs = getComputedStyle(el);
    ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx2d.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
    const need = ctx2d.measureText(text).width;
    // Native selects draw their arrow inside the content box (about 20px).
    const arrow = el.tagName === "SELECT" && cs.appearance !== "none" ? 20 : 0;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - arrow;
    if (need > room + 2) {
      const shown = Math.max(0, Math.round((room / need) * 100));
      push("clipped-text", el, `${el.tagName === "SELECT" ? "chosen option" : "label"} "${text.slice(0, 40)}" needs ${Math.round(need)}px, has ${Math.max(0, Math.round(room))}px: ${shown}% shows`, { severity: "fail" });
    }
  }

  // 3. Text over text (line boxes, bucketed).
  // Each line box is trimmed to what its clipping boxes actually show (truncated text measures at full
  // length otherwise, and "overlaps" whatever sits where its hidden part would be).
  const visibleBox = (el) => {
    let b = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX !== "visible" || c.overflowY !== "visible" || (c.contain || "").includes("paint")) {
        const r = n.getBoundingClientRect();
        b = { left: Math.max(b.left, r.left), top: Math.max(b.top, r.top), right: Math.min(b.right, r.right), bottom: Math.min(b.bottom, r.bottom) };
      }
    }
    return b;
  };
  const frags = [];
  for (const el of texts) {
    if (sr.allowed(el, "overlap")) continue;
    const vb = visibleBox(el);
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) {
        const r = { left: Math.max(q.left, vb.left), top: Math.max(q.top, vb.top), right: Math.min(q.right, vb.right), bottom: Math.min(q.bottom, vb.bottom) };
        r.width = r.right - r.left; r.height = r.bottom - r.top;
        if (r.width > 2 && r.height > 2) frags.push({ el, r });
      }
    }
  }
  const grid = new Map(); const G = 96;
  frags.forEach((f, i) => {
    for (let x = Math.floor(f.r.left / G); x <= Math.floor(f.r.right / G); x++)
      for (let y = Math.floor((f.r.top + scrollY) / G); y <= Math.floor((f.r.bottom + scrollY) / G); y++) {
        const k = x + ":" + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  });
  const seenPair = new Set();
  for (const ids of grid.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = frags[ids[i]], b = frags[ids[j]];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const key = ids[i] < ids[j] ? ids[i] + "-" + ids[j] : ids[j] + "-" + ids[i];
    if (seenPair.has(key)) continue; seenPair.add(key);
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w <= 3 || h <= 3) continue;
    const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    const vShare = h / Math.min(a.r.height, b.r.height);
    if (w * h < small * 0.15 && !(vShare > 0.3 && w >= 4)) continue;
    push("text-overlap", a.el, `overlaps ${sr.label(b.el)} by ${Math.round(w)}×${Math.round(h)}px`, {
      severity: "fail", other: sr.cssPath(b.el), otherOwner: sr.owner(b.el),
      clip: { x: Math.max(a.r.left, b.r.left) + scrollX, y: Math.max(a.r.top, b.r.top) + scrollY, width: w, height: h },
    });
  }

  // 4. Content sticking out of its box (a visible card, pill or panel).
  for (const el of document.querySelectorAll("body *")) {
    if (sr.ignored(el) || sr.allowed(el, "protrude") || !sr.visible(el)) continue;
    const isContent = el.matches("img,video,button,a,input,select,textarea,svg") || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!isContent) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.pointerEvents === "none") continue;
    const p = el.parentElement; if (!p || p === document.body) continue;
    const pc = getComputedStyle(p);
    const boxed = (pc.backgroundColor !== "rgba(0, 0, 0, 0)" && pc.backgroundColor !== "transparent") || parseFloat(pc.borderTopWidth) > 0 || pc.boxShadow !== "none";
    if (!boxed || pc.overflow !== "visible") continue;
    const r = el.getBoundingClientRect(), b = p.getBoundingClientRect();
    const over = Math.max(r.right - b.right, b.left - r.left, r.bottom - b.bottom, b.top - r.top);
    if (over > 3 && r.width < b.width * 1.5) push("protrusion", el, `sticks out of its box ${sr.label(p)} by ${Math.round(over)}px`, { severity: "warn", clip: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } });
  }

  // 5. An item wrapping alone onto a new line under a full row.
  for (const c of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(c);
    if (!(cs.display.includes("flex") && cs.flexWrap === "wrap") || sr.allowed(c, "wrap") || !sr.visible(c)) continue;
    const kids = [...c.children].filter(sr.visible); if (kids.length < 4) continue;
    const rows = []; for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top); const row = rows.find((r) => Math.abs(r.t - t) < 6); row ? row.n++ : rows.push({ t, n: 1, el: k }); }
    rows.sort((a, b) => a.t - b.t);
    if (rows.length >= 2 && rows[rows.length - 1].n === 1 && rows[rows.length - 2].n >= 3) push("orphan-wrap", rows[rows.length - 1].el, `wraps alone onto a new line under a row of ${rows[rows.length - 2].n}`, { severity: "warn" });
  }
  // 6. A floating element (a chat bubble, a "feedback" pill, a back-to-top button) fixed over content when the
  // page loads. Full-width bars (headers, cookie banners) are layout and checked elsewhere; this is the small
  // fixed thing that ends up on top of a field or a button at some widths.
  for (const fx of document.querySelectorAll("body *")) {
    const c = getComputedStyle(fx);
    if (c.position !== "fixed" || !sr.visible(fx) || sr.ignored(fx) || sr.allowed(fx, "cover") || c.pointerEvents === "none" || Number(c.opacity) < 0.3 || parseInt(c.zIndex) < 0) continue;
    const a = fx.getBoundingClientRect();
    if (a.width >= W * 0.6 || a.width < 16 || a.height < 16 || a.bottom <= 0 || a.top >= H) continue;
    if (fx.parentElement && getComputedStyle(fx.parentElement).position === "fixed") continue; // its fixed parent is checked
    const under = [...document.querySelectorAll("input:not([type=hidden]),textarea,select,button,a[href],label,h1,h2,h3,p,li")].filter((e) => {
      if (fx.contains(e) || e.contains(fx) || !sr.visible(e) || sr.ignored(e)) return false;
      if (getComputedStyle(e).position === "fixed") return false;
      const r = e.getBoundingClientRect(); const w = Math.min(r.right, a.right) - Math.max(r.left, a.left), h = Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top);
      return w > 4 && h > 4;
    });
    const outer = under.filter((e) => !under.some((o) => o !== e && o.contains(e)));
    if (outer.length) push("floating-over-content", fx, `fixed on top of ${outer.slice(0, 3).map(sr.label).join(", ")} when the page loads`, { severity: outer.some((e) => e.matches("input,textarea,select,button,a[href]")) ? "fail" : "warn", clip: { x: a.left + scrollX, y: a.top + scrollY, width: a.width, height: a.height } });
  }
  // 7. A heading that breaks with one word alone on a line ("New templates and / features, / in your inbox."):
  // usually a <br> or a fixed width meant for desktop. text-wrap: balance (or no <br> on phones) fixes it.
  for (const h of document.querySelectorAll("h1, h2")) {
    if (!sr.visible(h) || sr.ignored(h)) continue;
    const words = []; const tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) { const t = tw.currentNode; const re = /\S+/g; let m; while ((m = re.exec(t.textContent))) { const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length); const r = rg.getBoundingClientRect(); if (r.width) words.push({ w: m[0], top: r.top }); } }
    if (words.length < 4) continue;
    const lines = []; for (const x of words) { const l = lines.find((y) => Math.abs(y.top - x.top) < 6); l ? l.words.push(x.w) : lines.push({ top: x.top, words: [x.w] }); }
    lines.sort((a, b) => a.top - b.top);
    const lone = lines.findIndex((l) => l.words.length === 1 && l.words[0].length < 16);
    if (lines.length >= 2 && lone >= 0) push("heading-break", h, `"${lines[lone].words[0]}" sits alone on line ${lone + 1} of ${lines.length}`, { severity: "warn" });
  }
  return { found, pageOverflow, height: document.documentElement.scrollHeight };
};

// Text covered by something opaque on top of it (checked screen by screen; fixed/sticky bars are normal).
const OCCLUSION = () => {
  const sr = window.__sr; const H = innerHeight, W = innerWidth; const found = [];
  for (const el of sr.textEls()) {
    if (sr.allowed(el, "cover")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.width < 8 || r.height < 8) continue;
    const pts = [[0.5, 0.5], [0.15, 0.25], [0.85, 0.25], [0.15, 0.75], [0.85, 0.75]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]).filter(([x, y]) => x > 0 && y > 0 && x < W && y < H);
    let hidden = 0, by = null;
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      const hc = getComputedStyle(hit);
      let layered = false;
      for (let n = hit; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") { layered = true; break; } }
      if (layered || hit.closest("header, nav, [role=dialog], [aria-modal]")) continue;
      const bg = hc.backgroundColor.match(/[\d.]+/g); const opaque = (bg && (bg[3] === undefined ? Number(bg[0]) + Number(bg[1]) + Number(bg[2]) >= 0 : Number(bg[3]) > 0.5) && hc.backgroundColor !== "rgba(0, 0, 0, 0)") || /^(IMG|VIDEO|CANVAS|SVG)$/i.test(hit.tagName);
      if (!opaque || Number(hc.opacity) < 0.5) continue;
      hidden++; by = hit;
    }
    if (hidden >= 2 && by) found.push({ type: "covered-text", ...sr.describe(el), detail: `covered by ${sr.label(by)}`, severity: sr.important(el) ? "fail" : "warn", other: sr.cssPath(by), clip: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } });
  }
  return found;
};

// Pseudo-localisation: lengthen each word by about 30% (repeating its own letters, so the font and script
// stay the same) and make each number longer. Selects' options and button-type inputs too. Returns how many
// texts were changed.
const STRESS = () => {
  const grow = (t) => t.replace(/\d[\d,.]*/g, (n) => n.replace(/\d/, (d) => "1" + d + "2")).replace(/\p{L}{3,}/gu, (w) => w + w.slice(-Math.ceil(w.length * 0.3)));
  const sr = window.__sr; let n = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const t of nodes) {
    const p = t.parentElement;
    if (!p || !t.textContent.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE|KBD|TEXTAREA)$/.test(p.tagName) || p.closest("[data-review-allow~=all],[data-review-allow~=stress],svg")) continue;
    const g = grow(t.textContent); if (g !== t.textContent) { t.textContent = g; n++; }
  }
  for (const i of document.querySelectorAll("input[type=button],input[type=submit],input[type=reset]")) i.value = grow(i.value);
  return n;
};

// Breakpoints from the CSS: values, plus overlaps (max-width X with min-width X) and gaps.
const BREAKPOINTS = () => {
  const mins = new Set(), maxs = new Set(); const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const px = (v, u) => (u === "px" ? Number(v) : Number(v) * (u === "em" || u === "rem" ? 16 : 1));
  const walk = (rules) => { for (const r of rules) {
    if (r.media && r.conditionText !== undefined || r.type === 4) {
      const t = r.conditionText || r.media?.mediaText || "";
      for (const m of t.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) (m[1] === "min" ? mins : maxs).add(Math.round(px(m[2], m[3]) * 100) / 100);
      for (const m of t.matchAll(/width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)/g)) { const v = px(m[2], m[3]); (m[1].startsWith(">") ? mins : maxs).add(m[1] === ">" ? v + 0.02 : m[1] === "<" ? v - 0.02 : v); }
    }
    if (r.cssRules) walk(r.cssRules);
  } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  const overlaps = [...maxs].filter((m) => mins.has(m) && Number.isInteger(m));
  const gaps = [...maxs].map((m) => [m, [...mins].find((n) => n > m && n - m > 1.01 && n - m < 6)]).filter(([, n]) => n);
  return { mins: [...mins].sort((a, b) => a - b), maxs: [...maxs].sort((a, b) => a - b), overlaps, gaps, rootPx };
};

// Elements sized with 100vh on the first screen (cut under a phone's address bar).
const VH_CHECK = () => {
  const sr = window.__sr; const sels = new Set();
  // Only rules that apply at this width (a lg:min-h-screen does nothing on a phone).
  const walk = (rules, active) => { for (const r of rules) {
    const media = r.media && r.conditionText !== undefined ? r.conditionText : (r.media && r.media.mediaText) || null;
    const on = active && (!media || matchMedia(media).matches);
    if (on && r.style && /100vh/.test(r.style.height + r.style.minHeight + r.style.maxHeight)) sels.add(r.selectorText);
    if (r.cssRules) walk(r.cssRules, on);
  } };
  for (const s of document.styleSheets) { try { walk(s.cssRules, !s.media.mediaText || matchMedia(s.media.mediaText).matches); } catch {} }
  const out = [];
  for (const sel of sels) { let els = []; try { els = [...document.querySelectorAll(sel)]; } catch {} for (const el of els) { const r = el.getBoundingClientRect(); if (r.top < innerHeight && sr.visible(el)) out.push({ type: "vh-height", ...sr.describe(el), detail: `height from 100vh (${sel}): on phones it runs under the address bar, use svh`, severity: "warn" }); } }
  for (const el of document.querySelectorAll("[style*='100vh']")) if (sr.visible(el)) out.push({ type: "vh-height", ...sr.describe(el), detail: "inline 100vh: use 100svh", severity: "warn" });
  return out.slice(0, 5);
};

// Anchor targets hidden under a fixed/sticky header after a jump.
const ANCHORS = async () => {
  const sr = window.__sr;
  const bars = [...document.querySelectorAll("body *")].filter((el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return (c.position === "fixed" || c.position === "sticky") && r.top <= 1 && r.width >= innerWidth * 0.5 && r.height > 20 && r.height < innerHeight * 0.4 && sr.visible(el); });
  if (!bars.length) return [];
  const out = []; const ids = [...new Set([...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id && document.getElementById(id)))].slice(0, 12);
  for (const id of ids) {
    const t = document.getElementById(id); t.scrollIntoView({ block: "start", behavior: "instant" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const hb = Math.max(...bars.map((b) => b.getBoundingClientRect().bottom)); const top = t.getBoundingClientRect().top;
    if (top < hb - 2) out.push({ type: "anchor-under-header", ...sr.describe(t), detail: `#${id} lands ${Math.round(hb - top)}px under the sticky header: add scroll-padding-top to html (or scroll-margin-top on targets)`, severity: "warn" });
  }
  scrollTo(0, 0);
  return out;
};

// Layout shift during load with probable causes (installed before navigation).
const CLS_OBSERVER = () => {
  window.__cls = { shifts: [], adds: [], fonts: [], imgs: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__cls.shifts.push({ v: e.value, t: e.startTime, src: (e.sources || []).slice(0, 3).map((s) => ({ node: s.node, prev: s.previousRect.toJSON(), cur: s.currentRect.toJSON() })) }); } }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/\.(woff2?|ttf|otf)(\?|$)/.test(e.name)) window.__cls.fonts.push(e.responseEnd); else if (e.initiatorType === "img") window.__cls.imgs.push({ t: e.responseEnd, url: e.name }); }).observe({ type: "resource", buffered: true });
    new MutationObserver((ms) => { const t = performance.now(); for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__cls.adds.push({ t, n }); }).observe(document, { childList: true, subtree: true });
  } catch {}
};
const CLS_REPORT = () => {
  const sr = window.__sr; const c = window.__cls; if (!c) return { cls: null, items: [] };
  // Session windows: gaps under 1 s, at most 5 s.
  let best = 0, cur = 0, start = 0, last = -Infinity, worst = [], win = [];
  for (const s of c.shifts) { if (s.t - last > 1000 || s.t - start > 5000) { cur = 0; start = s.t; win = []; } cur += s.v; win.push(s); last = s.t; if (cur > best) { best = cur; worst = [...win]; } }
  const items = [];
  for (const s of worst.sort((a, b) => b.v - a.v).slice(0, 4)) {
    const moved = s.src.find((x) => x.node && x.node.nodeType === 1) || s.src[0];
    if (!moved || !moved.node || moved.node.nodeType !== 1) continue;
    const el = moved.node; const dy = Math.round(moved.cur.y - moved.prev.y); const dx = Math.round(moved.cur.x - moved.prev.x);
    // Sub-pixel and size-only shifts nobody sees (a badge growing by a digit): not worth a line.
    if (s.v < 0.001 || (Math.abs(dy) < 2 && Math.abs(dx) < 2 && Math.abs(moved.cur.height - moved.prev.height) < 2 && Math.abs(moved.cur.width - moved.prev.width) < 2)) continue;
    let cause = "";
    const added = c.adds.filter((a) => a.t <= s.t + 16 && a.t > s.t - 300 && a.n.isConnected && (a.n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)).pop();
    const font = c.fonts.find((t) => t <= s.t + 50 && t > s.t - 400);
    const img = c.imgs.filter((i) => i.t <= s.t + 50 && i.t > s.t - 400).pop();
    const unsized = [...document.images].find((i) => img && i.currentSrc === img.url && !i.getAttribute("width") && getComputedStyle(i).aspectRatio === "auto");
    if (unsized) cause = `image without width/height loaded above it (${img.url.split("/").pop().slice(0, 40)}): set width/height or aspect-ratio`;
    else if (added) cause = `content inserted above it after load (${sr.label(added.n)}): reserve its space or put it below`;
    else if (font && /^(P|H\d|SPAN|A|LI|DIV|BUTTON)$/.test(el.tagName)) cause = "web font swap changed the text size: next/font or size-adjust fallback, or font-display: optional";
    else if (img) cause = `an image finished loading nearby (${img.url.split("/").pop().slice(0, 40)})`;
    items.push({ type: "layout-shift", ...sr.describe(el), detail: `moved ${Math.abs(dy) >= Math.abs(dx) ? `${dy}px down` : `${dx}px across`} at ${Math.round(s.t)}ms (shift ${s.v.toFixed(3)})${cause ? `; likely cause: ${cause}` : ""}`, severity: best > 0.1 ? "fail" : "warn" });
  }
  // Static: images with no reserved size.
  // Would it have a height before it loads? Measure a copy with no source, same classes and attributes.
  const reserved = (i) => {
    const c = document.createElement("img");
    for (const a of ["class", "style", "width", "height", "sizes"]) if (i.hasAttribute(a)) c.setAttribute(a, i.getAttribute(a));
    c.style.visibility = "hidden"; i.parentElement.insertBefore(c, i);
    const h = c.getBoundingClientRect().height; c.remove();
    return h >= 2;
  };
  for (const i of document.images) {
    const cs = getComputedStyle(i);
    if (cs.position !== "absolute" && sr.visible(i) && i.naturalWidth && i.parentElement && !reserved(i)) {
      const p = getComputedStyle(i.parentElement);
      if (p.aspectRatio !== "auto") continue;
      items.push({ type: "unsized-image", ...sr.describe(i), detail: "no width/height or aspect-ratio: the page jumps when it loads", severity: "warn" });
      if (items.filter((x) => x.type === "unsized-image").length >= 4) break;
    }
  }
  return { cls: Math.round(best * 1000) / 1000, items };
};

// ── run ─────────────────────────────────────────────────────────────────────

const ctx = await newContext(browser, url, { viewport: { width: 1280, height: 900 }, reducedMotion: has("--motion") ? "no-preference" : "reduce" });
await ctx.addInitScript(HELPERS);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(page);
await installHelpers(page);

const popup = await dismissPopups(page);
if (popup) console.log(`(a popup was open on arrival: "${popup}"; closed it to test the page behind it)`);

// Widths to test.
const bp = await page.evaluate(BREAKPOINTS);
const DEVICES = [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1440];
let widths;
if (opt("--widths")) widths = opt("--widths").split(",").map(Number).filter((n) => n >= 200);
else {
  const set = new Set(DEVICES);
  for (const v of [...bp.mins, ...bp.maxs]) { const w = Math.round(v); if (w >= 300 && w <= 1600) { set.add(w); set.add(w - 1); } }
  for (let w = 320; w <= 1440; w += step) set.add(w);
  widths = [...set].sort((a, b) => a - b);
}
console.log(`layout: ${widths.length} widths (${bp.mins.length + bp.maxs.length} breakpoints in the CSS)`);
for (const m of bp.overlaps) F.add({ type: "breakpoint-overlap", el: `@media max-width ${m}px and min-width ${m}px`, detail: `both apply at exactly ${m}px: a small-range layout. Use max-width ${m - 0.02}px (or Tailwind's max-* variants) so ranges don't overlap`, severity: "warn" });
for (const [a, b] of bp.gaps) F.add({ type: "breakpoint-gap", el: `@media max-width ${a}px / min-width ${b}px`, detail: `between ${a} and ${b}px neither applies`, severity: "warn" });

const candidates = []; // confirmed visually afterwards
let pageH = 0;
for (const w of widths) {
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
  await page.waitForTimeout(120);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(AUDIT).catch((e) => ({ found: [], error: String(e) }));
  pageH = r.height || pageH;
  for (const f of r.found) {
    if (f.clip && confirm && (f.type === "text-overlap" || f.type === "protrusion")) candidates.push({ ...f, width: w });
    else F.add({ ...f, width: w, fix: hint(f), ...(f.type === "floating-over-content" ? { steps: `Open the page in a window ${w}px wide and look before scrolling: ${f.el} sits on top of the content (${f.detail.replace(/^fixed on top of /, "").replace(/ when the page loads$/, "")}).` } : {}) });
  }
}

// Phone landscape: a short, wide screen where fixed things (a chat bubble, a feedback pill) land on the content
// and where 100vh heroes are tight. The sweep above only uses tall screens.
for (const [w, hh] of [[844, 390], [740, 360]]) {
  await page.setViewportSize({ width: w, height: hh }); await page.waitForTimeout(150);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(AUDIT).catch(() => ({ found: [] }));
  for (const f of r.found) {
    if (f.type === "text-overlap" || f.type === "protrusion" || f.type === "orphan-wrap") continue; // confirmed on tall screens
    F.add({ ...f, width: w, detail: `${f.detail} (phone landscape, ${w}×${hh})`, fix: hint(f), ...(f.type === "floating-over-content" ? { steps: `Turn a phone sideways (or make the window ${w}×${hh}) and look before scrolling: ${f.el.slice(0, 40)} sits on top of ${f.detail.replace(/^fixed on top of /, "").replace(/ when the page loads$/, "")}.` } : {}) });
  }
}

// Occlusion, screen by screen, at a phone and a desktop width.
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
  await page.waitForTimeout(150);
  const screens = Math.min(8, Math.ceil(pageH / (w < 600 ? 844 : 900)));
  for (let s = 0; s < screens; s++) {
    await page.evaluate((y) => scrollTo(0, y), s * (w < 600 ? 844 : 900));
    await page.waitForTimeout(150);
    for (const f of await page.evaluate(OCCLUSION).catch(() => [])) (confirm ? candidates.push({ ...f, width: w }) : F.add({ ...f, width: w, fix: hint(f) }));
  }
  await page.evaluate(() => scrollTo(0, 0));
}

// Visual confirmation: hide one side, diff the pixels; invisible "bugs" are dropped. Candidates are grouped
// first (one overlap seen at 40 widths is one group), and each group is confirmed once at its first width,
// so a bug repeated across the sweep can't crowd the others out of the budget.
let dropped = 0, unconfirmed = 0;
const groups = new Map();
for (const c of candidates) { const k = c.type + "|" + c.selector + "|" + (c.other || ""); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
let budget = 60;
for (const list of groups.values()) {
  const c = list[0];
  if (budget-- <= 0) { unconfirmed++; for (const x of list) F.add({ ...x, confirmed: false, fix: hint(x) }); continue; }
  await page.setViewportSize({ width: c.width, height: c.width < 600 ? 844 : 900 });
  await page.waitForTimeout(120);
  const ratio = await hideAndDiff(page, [c.other || c.selector], c.clip).catch(() => 1);
  if (ratio < 0.004) { dropped++; continue; }
  for (const x of list) F.add({ ...x, confirmed: true, fix: hint(x) });
}
if (unconfirmed) console.log(`(${unconfirmed} candidate group(s) past the confirmation budget, reported unconfirmed)`);

// Phone-only and once-only checks.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
for (const f of await page.evaluate(VH_CHECK).catch(() => [])) F.add({ ...f, width: 390, fix: hint(f) });
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
  for (const f of await page.evaluate(ANCHORS).catch(() => [])) F.add({ ...f, width: w, fix: hint(f) });
}

// Stress: longer text, bigger numbers, the same audit at device widths. Only what is new is reported.
let stressed = 0;
if (!has("--no-stress")) {
  const sp = await ctx.newPage();
  try {
    await sp.goto(url, { waitUntil: "load", timeout: 60_000 }); await settle(sp); await installHelpers(sp); await dismissPopups(sp);
    stressed = await sp.evaluate(STRESS);
    await sp.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const known = new Set(F.items.map((f) => f.type + "|" + ident(f)));
    for (const w of [320, 375, 390, 768, 1024, 1440]) {
      await sp.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
      await sp.waitForTimeout(120);
      const r = await sp.evaluate(AUDIT).catch(() => ({ found: [] }));
      for (const f of r.found) {
        if (known.has(f.type + "|" + ident(f)) || f.type === "orphan-wrap" || f.type === "heading-break") continue; // line breaks move with longer words by design
        F.add({ ...f, width: w, severity: "warn", stress: true, confirmed: false, detail: `with 30% longer text and bigger numbers: ${f.detail}`, fix: hint(f) + " (fragile: fits today's copy only by a few pixels)" });
      }
    }
  } catch (e) { console.log(`(stress pass skipped: ${String(e.message).split("\n")[0]})`); }
  await sp.close();
}

// Layout shift: fresh loads on a slowed network, at phone and desktop, scrolling the page.
let cls = {};
if (!has("--no-cls")) {
  for (const [name, vw, vh, mobile] of [["phone", 390, 844, true], ["desktop", 1440, 900, false]]) {
    const c2 = await newContext(browser, url, { viewport: { width: vw, height: vh }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await c2.addInitScript(HELPERS); await c2.addInitScript(CLS_OBSERVER);
    const p2 = await c2.newPage();
    const cdp = await c2.newCDPSession(p2);
    await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (5 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8 });
    try {
      await p2.goto(url, { waitUntil: "load", timeout: 90_000 });
      await settle(p2, 800, 8000);
      await p2.evaluate(async () => { const end = Math.min(document.documentElement.scrollHeight, 12000); for (let y = 0; y < end; y += innerHeight * 0.7) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 180)); } });
      await p2.waitForTimeout(600);
      const r = await p2.evaluate(CLS_REPORT);
      cls[name] = r.cls;
      for (const f of r.items) F.add({ ...f, width: vw, fix: hint(f) });
    } catch (e) { cls[name] = `failed: ${String(e.message).split("\n")[0]}`; }
    await c2.close();
  }
  for (const [k, v] of Object.entries(cls)) if (typeof v === "number" && v > 0.1) F.add({ type: "cls", el: `${k} page load`, detail: `CLS ${v} (good ≤ 0.1, poor > 0.25), slowed network`, severity: v > 0.25 ? "fail" : "warn", fix: "see the layout-shift findings for what moved and why" });
}

// Screenshots of each finding, outlined, at its first width.
if (!has("--no-shots")) {
  const dir = join(out, "layout-shots"); mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const f of F.items.filter((x) => x.selector && x.widths.length)) {
    if (n >= 24) break;
    const w = f.widths[0];
    await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
    await page.waitForTimeout(100);
    const box = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; el.scrollIntoView({ block: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); const o = document.createElement("div"); o.id = "__sr_outline"; Object.assign(o.style, { position: "fixed", left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px", outline: "3px solid #ff2d55", zIndex: 2147483647, pointerEvents: "none" }); document.body.appendChild(o); return { x: Math.max(0, r.left - 80), y: Math.max(0, r.top - 80), width: Math.min(innerWidth, r.width + 160), height: Math.min(innerHeight, r.height + 160) }; }, f.selector).catch(() => null);
    if (box && box.width > 4 && box.height > 4) {
      const file = `${String(++n).padStart(2, "0")}-${f.type}-${w}.png`;
      await page.screenshot({ path: join(dir, file), clip: box }).catch(() => {});
      f.shot = `layout-shots/${file}`;
    }
    await page.evaluate(() => document.getElementById("__sr_outline")?.remove()).catch(() => {});
  }
}

await browser.close();
const summary = F.print();
if (dropped) console.log(`(${dropped} overlap candidate(s) dropped: hiding them changed no pixels)`);
if (stressed) console.log(`(stress pass: ${stressed} texts lengthened; ${F.items.filter((f) => f.stress).length} finding(s) appear only then)`);
F.write(out, { url, widths, breakpoints: bp, cls, stressed, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(summary.fails ? 1 : 0);

// ── fix hints by finding (details in references/layout.md) ─────────────────
function hint(f) {
  switch (f.type) {
    case "overflow":
      if (/100vw/.test(f.why || f.detail)) return "w-screen / 100vw → w-full (100vw includes the scrollbar)";
      if (/fixed width/.test(f.why || "")) return "w-[Npx] → w-full max-w-[Npx]";
      if (/min-width/.test(f.why || "")) return "drop or lower min-width at small widths; in flex use min-w-0";
      if (/nowrap|pre/.test(f.why || "")) return "allow wrapping (remove whitespace-nowrap) or put it in an overflow-x-auto scroller";
      if (/long unbroken/.test(f.why || "")) return "wrap-anywhere (overflow-wrap:anywhere) and min-w-0 on the flex/grid item";
      if (/transform/.test(f.why || "")) return "overflow-x-clip on the section that holds the moved decoration";
      if (/wider than the screen/.test(f.why || "")) return "max-w-full h-auto on media; tables and pre in overflow-x-auto";
      return "find the fixed width / min-width / nowrap on this element or its flex/grid parent; min-w-0 on flex items, minmax(0,1fr) on grid tracks";
    case "text-overflow": return "let the box fit its text: drop the fixed width/grid-cols share at this width (w-auto, px-3, shrink-0), shorten the label on phones (a short form in a sm:hidden span), or allow it to wrap";
    case "clipped-text":
      if (/chosen option|label "/.test(f.detail)) return "give the control room for its longest option: min-w-[…] or w-auto instead of a squeezed flex/grid share, a shorter label on phones, or let the row wrap (flex-wrap)";
      if (/descenders/.test(f.detail)) return "leading-[1.1] or more, or pb-[0.12em] -mb-[0.12em] on gradient/clipped display text";
      if (/fixed height|bottom/.test(f.detail)) return "h-* → min-h-* (let the text set the height)";
      if (/container/.test(f.detail)) return "move overflow-hidden from the card to its media wrapper, or let the container grow";
      return "remove truncate/whitespace-nowrap on important text; let it wrap (text-balance) or make the type fluid with clamp()";
    case "text-overlap": return "absolute text over a responsive box → stack in one grid cell ([grid-area:1/1]); fixed heights → min-h; negative margins only from md:";
    case "covered-text": return "the covering element sits above the text in paint order: move it into flow at this width (static md:absolute), or fix the z-index on the stacking-context root";
    case "protrusion": return "w-[px] → w-full max-w-…; min-w-0 on flex children; the box needs padding or min-h instead of a fixed height";
    case "floating-over-content": return "keep it clear of the content at these widths: a smaller icon-only form below md, offset it past the content column (right: calc((100vw - content)/2 - size)), or hide it while a form is in view";
    case "heading-break": return "text-wrap: balance on headings, and drop the <br> on small screens (or make it a <span class=\"block md:inline\">)";
    case "orphan-wrap": return "switch the layout at this width (grid-cols-2 / sm:grid-cols-3), or let items grow (basis-0 grow) so the row reflows evenly";
    case "vh-height": return "h-screen / min-h-screen → min-h-svh (h-dvh only for app shells)";
    case "anchor-under-header": return "html { scroll-padding-top: var(--header-h) } (Tailwind: scroll-pt-[72px] on <html>)";
    case "layout-shift": return "reserve the space before it loads (width/height or aspect-ratio, min-h skeletons), never insert above existing content, next/font for font swaps";
    case "unsized-image": return "width and height attributes (or next/image width/height, or aspect-[w/h] on the wrapper)";
    default: return "";
  }
}
