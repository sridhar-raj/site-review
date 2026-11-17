#!/usr/bin/env node
// consistency-check.mjs: measure how consistent the rendered page is (type, spacing, colour, shape, controls).
//
//   node consistency-check.mjs <url | file.html> [--out .review] [--widths 1440,390] [--no-shots]
//
// At each width, after fonts load: a walk of visible elements (no aria-hidden decoration, no <svg> internals,
// nothing under data-review-allow="consistency") collecting computed font family/size/weight/line height,
// padding/margin/gap, text/background/border colours, radius per corner, border widths, shadows, control
// heights and tops, transitions on interactive elements, inline icon sizes and strokes; plus the page's :root
// custom properties as its token list. Node side: near values merged (1 px font size, 2 px spacing/radius/
// height, ΔE OK < 2 for colour), then counted against the thresholds in references/consistency.md.
//
// Most findings are suggestions (the page works, it looks less finished). Issues (fail): controls in one row
// whose heights or tops differ by 2 px or more, a non-interactive element with a pointer cursor and no click
// handler anywhere, and a hardcoded text colour off the page's tokens that fails contrast.
//
// A design-system or specimen page (title/h1 "Design system", "Style guide", "Type scale", Storybook) is
// exempt, as is any page with data-review-allow="consistency" on <html> or <body>.

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { newContext, parseArgs, toUrl, loadChromium, outDir, settle, HELPERS, installHelpers, dismissPopups, Findings } from "./lib.mjs";

const { opt, has, target } = parseArgs(["--out", "--widths"]);
if (!target) { console.error("usage: consistency-check.mjs <url | file.html> [--out .review] [--widths 1440,390] [--storage state.json] [--cookie \"a=1\"] [--no-shots]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const widths = (opt("--widths", "1440,390")).split(",").map(Number).filter((n) => n >= 200);
const F = new Findings("consistency");
const { chromium } = loadChromium();
const browser = await chromium.launch();
const t0 = Date.now();

// Thresholds (references/consistency.md, "Thresholds" and "How to judge" → near pairs).
const T = {
  families: 2, fontSizes: 10, stepRatio: 1.125, weights: 3, headingLh: 1.4, bodyLh: 1.3,
  gridShare: 0.9, offGridEls: 3, spacingDistinct: 12, textColors: 4, nearColor: [2, 5], accentHues: 1,
  neutralSpread: 30, radii: 4, borderWidths: 2, shadows: 3, controlHeights: 3, durations: 3, easings: 2,
  iconSizes: 3, strokeDiff: 0.5, tolPx: 2, tolFont: 1, tolDE: 2, tolLh: 0.05, tolMs: 30,
};

// ── in-page: exemption, tokens, the walk ─────────────────────────────────────

const EXEMPT = () => {
  const de = document.documentElement, b = document.body;
  if ([de, b].some((x) => x && /(^|\s)(consistency|all)(\s|$)/.test(x.getAttribute("data-review-allow") || ""))) return 'data-review-allow="consistency" on the page';
  const words = /design[ -]?system|style ?guide|styleguide|pattern library|component library|type (scale|specimen)|specimen|design tokens|storybook/i;
  const h1 = document.querySelector("h1")?.innerText || "";
  if (words.test(document.title) || words.test(h1)) return `a design-system / specimen page ("${(words.exec(document.title) || words.exec(h1))[0]}")`;
  if (/\/(design-system|styleguide|style-guide|storybook|tokens)(\/|$)|iframe\.html\?.*id=/i.test(location.pathname + location.search) || document.getElementById("storybook-root")) return "a design-system / Storybook page (URL)";
  return null;
};

const TOKENS = () => {
  const names = new Set();
  const walk = (rules) => { for (const r of rules) { try {
    if (r.cssRules && !r.selectorText) walk(r.cssRules);
    if (r.selectorText && /(^|,)\s*(:root|html)\b/.test(r.selectorText)) for (const p of r.style) if (p.startsWith("--")) names.add(p);
  } catch {} } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  const cs = getComputedStyle(document.documentElement);
  for (let i = 0; i < cs.length; i++) if (cs[i].startsWith("--")) names.add(cs[i]);
  const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true });
  const rgba = (v) => { g.clearRect(0, 0, 1, 1); g.fillStyle = "#010203"; g.fillStyle = v; if (g.fillStyle === "#010203" && !/^#010203$/i.test(v)) return null; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; };
  const out = { colors: {}, lengths: {}, other: 0, all: 0 };
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim(); if (!v) continue; out.all++;
    if (/^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch|hwb|color)a?\(.*\))$/i.test(v)) { const x = rgba(v); if (x) { out.colors[n] = x; continue; } }
    const m = /^(-?[\d.]+)(px|rem)$/.exec(v);
    if (m) { out.lengths[n] = m[2] === "rem" ? parseFloat(m[1]) * parseFloat(getComputedStyle(document.documentElement).fontSize) : parseFloat(m[1]); continue; }
    out.other++;
  }
  return out;
};

const COLLECT = () => {
  const sr = window.__sr;
  const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (v) => { if (!v || v === "transparent" || v === "rgba(0, 0, 0, 0)") return null; if (cache.has(v)) return cache.get(v); g.clearRect(0, 0, 1, 1); g.fillStyle = v; g.fillRect(0, 0, 1, 1); const x = [...g.getImageData(0, 0, 1, 1).data]; const r = x[3] === 0 ? null : x; cache.set(v, r); return r; };
  const px = (v) => parseFloat(v) || 0;
  const UA_MARGIN = { P: 1, UL: 1, OL: 1, DL: 1, BLOCKQUOTE: 1, FIGURE: 1, H1: 0.67, H2: 0.83, H3: 1, H4: 1.33, H5: 1.67, H6: 2.33, PRE: 1, MENU: 1, HR: 0.5, FIELDSET: 0 };
  const INTERACTIVE = "a[href],button,input,select,textarea,summary,label[for],[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=radio],[onclick],[tabindex]:not([tabindex='-1']),[contenteditable=''],[contenteditable=true]";
  const STATUS = /error|danger|success|warning|alert|invalid|destructive|positive|negative/i;
  // Effective background behind an element: the first opaque-enough ancestor background (null over images).
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none" && !/^linear-gradient\(rgba?\(0, 0, 0, 0\)/.test(cs.backgroundImage)) return null;
      const b = rgba(cs.backgroundColor); if (b) { layers.push(b); if (b[3] >= 250) break; }
    }
    let base = [255, 255, 255];
    for (const l of layers.reverse()) { const a = l[3] / 255; base = base.map((v, i) => v * (1 - a) + l[i] * a); }
    return base.map(Math.round);
  };
  const kindOf = (el, cs, r) => {
    const t = el.tagName;
    if (t === "SELECT") return "select";
    if (t === "INPUT") { const ty = (el.type || "text").toLowerCase(); if (/^(button|submit|reset)$/.test(ty)) return "button"; if (/^(text|email|search|tel|url|password|number|date|datetime-local|month|time|week)$/.test(ty)) return "input"; return null; }
    if (t === "BUTTON" || el.getAttribute("role") === "button") return r.height >= 20 && r.height <= 80 ? "button" : null;
    if (t === "A" && el.hasAttribute("href")) {
      const boxed = rgba(cs.backgroundColor) || px(cs.borderTopWidth) > 0;
      if (boxed && px(cs.paddingLeft) >= 8 && r.height >= 24 && r.height <= 72 && !/^inline$/.test(cs.display)) return "button";
    }
    return null;
  };
  const els = []; window.__srCons = els;
  const recs = [];
  for (const el of document.querySelectorAll("body *")) {
    if (recs.length >= 6000) break;
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|BR|WBR|OPTION|HEAD|LINK|META)$/.test(el.tagName)) continue;
    if (!sr.visible(el) || sr.ignored(el) || sr.allowed(el, "consistency")) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const i = els.length; els.push(el);
    const rec = { i, tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height * 10) / 10 };
    // Icons: an inline <svg> up to 64 px.
    if (el.tagName.toLowerCase() === "svg") {
      if (r.width <= 64 && r.height <= 64) {
        const shape = el.querySelector("path,circle,rect,line,polyline,polygon,ellipse");
        const scs = shape ? getComputedStyle(shape) : cs;
        const vb = el.viewBox?.baseVal; const scale = vb && vb.width ? r.width / vb.width : 1;
        const stroked = scs.stroke && scs.stroke !== "none" && px(scs.strokeWidth) > 0;
        rec.icon = { size: Math.round(Math.max(r.width, r.height)), stroke: stroked ? Math.round(px(scs.strokeWidth) * scale * 100) / 100 : 0, style: stroked ? "outline" : "filled" };
      }
      recs.push(rec); continue;
    }
    // Type: elements with their own text.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    if (own) {
      const fs = px(cs.fontSize);
      const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      const mono = /monospace|mono\b|courier|consolas|menlo|monaco|code/i.test(cs.fontFamily.split(",")[0]) || !!el.closest("code,pre,kbd,samp");
      const lh = cs.lineHeight === "normal" ? 1.2 : px(cs.lineHeight) / fs;
      const text = el.tagName === "SELECT" ? "" : [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      rec.type = { fam, mono, fs: Math.round(fs * 100) / 100, fw: Number(cs.fontWeight) || 400, lh: Math.round(lh * 100) / 100, chars: text.length, heading: /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading" };
      const col = rgba(cs.color); const bg = bgOf(el);
      if (col) rec.text = { c: col, bg, link: !!el.closest("a[href]"), status: STATUS.test(sr.classes(el) + " " + (el.getAttribute("role") || "")) || el.closest("[role=alert]") != null, large: fs >= 24 || (fs >= 18.66 && rec.type.fw >= 700) };
    }
    // Spacing.
    const sp = [];
    const ua = UA_MARGIN[el.tagName];
    const fsz = px(cs.fontSize);
    for (const p of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) { const v = px(cs[p]); if (v > 1) sp.push([p, v]); }
    const parent = el.parentElement; const pcs = parent ? getComputedStyle(parent) : null;
    const ml = px(cs.marginLeft), mr = px(cs.marginRight);
    const centred = ml > 0 && Math.abs(ml - mr) < 1 && parent && Math.abs((parent.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight) - r.width) / 2 - ml) < 2;
    for (const p of ["marginTop", "marginRight", "marginBottom", "marginLeft"]) {
      const v = Math.abs(px(cs[p])); if (v <= 1) continue;
      if ((p === "marginLeft" || p === "marginRight") && centred) continue; // margin: auto
      if (ua != null && (p === "marginTop" || p === "marginBottom") && Math.abs(v - ua * fsz) < 0.6) continue; // browser default
      if (el.tagName === "BLOCKQUOTE" || el.tagName === "FIGURE") { if ((p === "marginLeft" || p === "marginRight") && v === 40) continue; }
      sp.push([p, v]);
    }
    if (/flex|grid/.test(cs.display)) for (const p of ["rowGap", "columnGap"]) { const v = px(cs[p]); if (v > 1 && cs[p] !== "normal") sp.push([p, v]); }
    if (sp.length) rec.sp = sp;
    // Surfaces and borders.
    const bgc = rgba(cs.backgroundColor); if (bgc) rec.bg = bgc;
    const bws = ["Top", "Right", "Bottom", "Left"].map((s) => px(cs["border" + s + "Width"]));
    const bstyle = ["Top", "Right", "Bottom", "Left"].map((s) => cs["border" + s + "Style"]);
    const bw = bws.filter((v, k) => v > 0 && bstyle[k] !== "none" && bstyle[k] !== "hidden");
    if (bw.length) { rec.bw = [...new Set(bw.map((v) => Math.round(v * 100) / 100))]; const bc = rgba(cs.borderTopColor) || rgba(cs.borderLeftColor); if (bc) rec.bc = bc; }
    // Shape.
    const rad = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((p) => { const v = cs[p]; if (/%/.test(v)) return Math.min(r.width, r.height) * parseFloat(v) / 100; return px(v); });
    if (rad.some((v) => v > 0) && (bgc || bw.length || /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(el.tagName) || cs.boxShadow !== "none")) rec.rad = rad.map((v) => Math.round(v * 10) / 10);
    rec.full = rec.rad ? rec.rad.every((v) => v >= Math.min(r.width, r.height) / 2 - 0.5) : false;
    if (cs.boxShadow !== "none") rec.shadow = cs.boxShadow.replace(/rgba?\(([^)]*)\)/g, (m) => { const x = rgba(m) || [0, 0, 0, 0]; return `rgba(${x.slice(0, 3).join(",")},${Math.round(x[3] / 255 * 20) / 20})`; });
    // Controls.
    const kind = kindOf(el, cs, r);
    if (kind) rec.control = { kind, h: Math.round(r.height * 10) / 10, top: Math.round(r.top * 10) / 10, left: r.left, right: r.right, native: cs.appearance !== "none" && kind === "select" }; // a native select draws its own corners
    // Transitions on interactive elements.
    if (el.matches(INTERACTIVE)) {
      const d = cs.transitionDuration.split(",").map((s) => Math.round(parseFloat(s) * (/ms/.test(s) ? 1 : 1000)));
      const props = cs.transitionProperty.split(",").map((s) => s.trim());
      const e = cs.transitionTimingFunction.split(/,(?![^(]*\))/).map((s) => s.trim());
      const live = d.map((v, k) => [v, e[k % e.length], props[k % props.length]]).filter(([v, , p]) => v > 0 && p !== "none");
      if (live.length) rec.tr = live.map(([v, ez]) => [v, ez]);
    }
    recs.push(rec);
  }

  // Rows of controls: pairs whose vertical centres line up, horizontally close, with a near common ancestor.
  const ctl = recs.filter((x) => x.control);
  const uf = ctl.map((_, k) => k); const root = (k) => (uf[k] === k ? k : (uf[k] = root(uf[k])));
  const depthTo = (a, anc) => { let d = 0; for (let n = a; n && n !== anc; n = n.parentElement) d++; return d; };
  for (let a = 0; a < ctl.length; a++) for (let b = a + 1; b < ctl.length; b++) {
    const A = ctl[a], B = ctl[b]; const ea = els[A.i], eb = els[B.i];
    if (ea.contains(eb) || eb.contains(ea)) continue;
    const ca = A.control.top + A.control.h / 2, cb = B.control.top + B.control.h / 2;
    if (Math.abs(ca - cb) > Math.min(A.control.h, B.control.h) / 2) continue;
    const gap = Math.max(B.control.left - A.control.right, A.control.left - B.control.right);
    if (gap > 64) continue;
    let anc = ea.parentElement; while (anc && !anc.contains(eb)) anc = anc.parentElement;
    if (!anc || depthTo(ea, anc) > 3 || depthTo(eb, anc) > 3) continue;
    uf[root(a)] = root(b);
  }
  const rows = new Map();
  ctl.forEach((x, k) => { const r0 = root(k); if (!rows.has(r0)) rows.set(r0, []); rows.get(r0).push(x.i); });

  // Nested corners: a rounded child near its rounded parent's corner with a radius as big as the parent's.
  const nesting = [];
  for (const x of recs) {
    if (!x.rad || x.full) continue;
    const el = els[x.i]; const r = el.getBoundingClientRect(); const rr = Math.max(...x.rad); if (rr < 6) continue;
    for (let p = el.parentElement, d = 0; p && d < 4; p = p.parentElement, d++) {
      const prec = recs.find((y) => els[y.i] === p); if (!prec || !prec.rad || prec.full) continue;
      const pr = p.getBoundingClientRect(); const inset = Math.min(r.left - pr.left, r.top - pr.top);
      const R = Math.max(...prec.rad);
      if (inset >= 1 && inset <= 24 && R <= rr) nesting.push({ child: x.i, parent: prec.i, inner: rr, outer: R, inset: Math.round(inset) });
      break;
    }
  }

  // False affordances: a pointer cursor set on something nothing can click.
  const fa = [];
  for (const x of recs) {
    const el = els[x.i]; const cs = getComputedStyle(el);
    if (cs.cursor !== "pointer" || (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer")) continue;
    if (el.matches(INTERACTIVE) || el.closest(INTERACTIVE)) continue;
    let react = false;
    for (let n = el; n && n !== document.body && !react; n = n.parentElement) { const k = Object.keys(n).find((k) => k.startsWith("__reactProps$")); if (k) { const p = n[k] || {}; react = !!(p.onClick || p.onPointerDown || p.onMouseDown || p.onPointerUp); } }
    if (react) continue;
    fa.push(x.i);
  }
  window.__srFA = fa.map((i) => els[i]);
  return { recs, rows: [...rows.values()].filter((r) => r.length > 1), nesting, fa, vw: innerWidth };
};

// ── node side: colour maths and grouping ─────────────────────────────────────

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function oklab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const oklch = (c) => { const [L, a, b] = oklab(c); const C = Math.hypot(a, b); let H = (Math.atan2(b, a) * 180) / Math.PI; if (H < 0) H += 360; return [L, C, H]; };
const dE = (x, y) => { const p = oklab(x), q = oklab(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100; };
const hex = (c) => "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") + (c[3] != null && c[3] < 255 ? c[3].toString(16).padStart(2, "0") : "");
const fmtLch = (c) => { const [L, C, H] = oklch(c); return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 0.005 ? 0 : Math.round(H)})`; };
const relLum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg) => { const a = (fg[3] ?? 255) / 255; return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))); };
const r1 = (v) => Math.round(v * 10) / 10;
const pxs = (v) => `${r1(v)}px`;

/** Merge sorted numbers into clusters: a value joins the cluster while within tol of its first member. */
function clusterNums(entries, tol) { // entries: [{v, i}]
  const s = [...entries].sort((a, b) => a.v - b.v); const out = [];
  for (const e of s) { const last = out[out.length - 1]; if (last && e.v - last.min <= tol) { last.items.push(e); } else out.push({ min: e.v, items: [e] }); }
  for (const c of out) { const counts = new Map(); for (const e of c.items) counts.set(e.v, (counts.get(e.v) || 0) + 1); c.values = [...counts].sort((a, b) => b[1] - a[1]); c.v = c.values[0][0]; c.count = c.items.length; }
  return out;
}
/** Colours: most-used first; each joins the first cluster whose lead is within ΔE OK 2. */
function clusterColors(entries) { // [{c, i, role}]
  const byHex = new Map();
  for (const e of entries) { const k = hex(e.c); if (!byHex.has(k)) byHex.set(k, { c: e.c, items: [] }); byHex.get(k).items.push(e); }
  const list = [...byHex.values()].sort((a, b) => b.items.length - a.items.length);
  const out = [];
  for (const x of list) { const cl = out.find((o) => (o.c[3] ?? 255) === (x.c[3] ?? 255) && dE(o.c, x.c) < T.tolDE); if (cl) { cl.members.push(hex(x.c)); cl.items.push(...x.items); } else out.push({ c: x.c, members: [hex(x.c)], items: [...x.items] }); }
  return out.map((o) => ({ ...o, hex: hex(o.c), count: o.items.length }));
}

const DE_LABEL = new Map();
async function describe(page, idxs) {
  const need = idxs.filter((i) => !DE_LABEL.has(i));
  if (need.length) { const got = await page.evaluate((ids) => ids.map((i) => { const el = window.__srCons[i]; return el ? window.__sr.describe(el) : null; }), need).catch(() => need.map(() => null)); need.forEach((i, k) => DE_LABEL.set(i, got[k])); }
  return idxs.map((i) => DE_LABEL.get(i)).filter(Boolean);
}
const ex = (d) => d.map((x) => x.el + (x.owner ? ` in ${x.owner}` : "")).join(", ");

// ── fix hints (signature → fix in references/consistency.md) ─────────────────
const FIX = {
  "consistency-font-families": "one family per role via next/font exposed as CSS variables (font-sans / font-display, + font-mono for code); remove the stray font-family / font-[Arial]",
  "consistency-font-sizes": "a ratio type scale in @theme (--text-xs … --text-4xl, ≥ 1.2× per step); move each stray size to its nearest step (text-sm / text-base / text-lg)",
  "consistency-type-steps": "adjacent sizes under 1.125× read as one size set badly: merge them onto one step of the scale (e.g. 15/16/17 → text-base)",
  "consistency-weights": "three weights for the body family (400/500/600 or 400/600/700): font-normal / font-medium / font-semibold only",
  "consistency-line-height": "leading in the type tokens, not per element: leading-tight (1.1-1.25) on headings, leading-relaxed / 1.5 on body",
  "consistency-role": "one style per role: give these elements the same shared class / variant (the majority value), not per-instance utilities",
  "consistency-spacing-grid": "the nearest scale step (13→12 p-3, 17→16 p-4, 22→24 p-6); Tailwind v4 @theme { --spacing: 4px } and only multiples; grep -E '-\\[\\d+px\\]' and inline style= for the strays",
  "consistency-spacing-scale": "fewer spacing values: map paddings/gaps onto 4/8-px steps (gap-2/4/6/8, p-3/4/6) from one spacing token",
  "consistency-text-colors": "text colours from four roles: --color-text (primary), -secondary, -muted, -disabled (+ link/status); replace raw hex and palette classes",
  "consistency-near-colors": "near-identical colours likely mean one role: one semantic token (text-muted-foreground / --color-text-muted) for all of them",
  "consistency-accents": "one --color-primary for actions, links and the focus ring; keep the other hue for status only",
  "consistency-neutrals": "one neutral scale (gray or zinc or slate, not two); map the library's grey variables onto it",
  "consistency-untokened": "use the page's tokens (var(--color-…) / bg-primary / text-muted-foreground) instead of raw hex; add a token if the role is real",
  "consistency-untokened-contrast": "replace the hardcoded colour with the matching text token (it follows the theme); if none fits, add one that passes 4.5:1 (3:1 large) in light and dark",
  "consistency-radii": "--radius tokens: control, card (≥ control), modal, full; rounded-md / rounded-lg / rounded-xl / rounded-full only",
  "consistency-control-radius": "one control radius for buttons, inputs and selects on a form (--radius-control / rounded-md on the shared class); pills always rounded-full",
  "consistency-nested-radius": "concentric corners: outer = inner + padding (rounded-[calc(var(--radius)+theme(spacing.3))] on the outer), or reduce the inner",
  "consistency-border-widths": "two border widths only (1px and 2px): border / border-2 from tokens; collapse abutting borders in groups",
  "consistency-shadows": "one depth strategy and a shadow scale (shadow-sm / shadow-md / shadow-lg), elevation by level",
  "consistency-control-heights": "set control heights from tokens, not from padding + line-height: sm/md/lg (h-8 / h-10 / h-12) on the shared button/input class",
  "consistency-control-row": "one shared class owns the box: h-10 inline-flex items-center px-3 on every control in the row (borderless variants keep border border-transparent), box-sizing: border-box; items-center on the row",
  "consistency-transitions": "2-3 duration tokens (150/200/300 ms) and one or two easings; named properties (transition-colors), not transition-all",
  "consistency-icons": "one icon library, pinned; strokeWidth from one constant; size-4 / size-5 per context",
  "consistency-false-affordance": "remove cursor-pointer (and hover styles) from what does nothing, or make it a real <button>/<a>; badges get cursor-default and no hover",
};

// ── analysis per width ───────────────────────────────────────────────────────

async function analyse(page, w, data, tokens) {
  const { recs } = data;
  const add = (type, d) => F.add({ type, width: w, fix: FIX[type], severity: "warn", ...d });
  const m = {};

  // Type.
  const typed = recs.filter((x) => x.type);
  const fams = new Map(); for (const x of typed) { const k = x.type.fam + (x.type.mono ? " (mono)" : ""); if (!fams.has(k)) fams.set(k, { n: 0, chars: 0, i: [] }); const f = fams.get(k); f.n++; f.chars += x.type.chars; f.i.push(x.i); }
  m.families = [...fams].map(([name, f]) => ({ name, count: f.n, chars: f.chars })).sort((a, b) => b.chars - a.chars);
  const nonMono = [...fams].filter(([k]) => !k.endsWith("(mono)"));
  if (nonMono.length > T.families) {
    const minor = nonMono.sort((a, b) => b[1].chars - a[1].chars).slice(T.families);
    const d = await describe(page, minor.flatMap(([, f]) => f.i.slice(0, 2)));
    add("consistency-font-families", { el: "font families", detail: `${nonMono.length} families (fine ≤ ${T.families} + mono): ${nonMono.map(([k, f]) => `${k} ×${f.n}`).join(", ")}; the least used: ${ex(d)}`, extra: { values: m.families } });
  }
  const sizeCl = clusterNums(typed.map((x) => ({ v: x.type.fs, i: x.i })), T.tolFont);
  m.fontSizes = sizeCl.map((c) => ({ px: r1(c.v), count: c.count, merged: c.values.length > 1 ? c.values.map(([v]) => r1(v)) : undefined }));
  if (sizeCl.length > T.fontSizes) {
    const single = sizeCl.filter((c) => c.count <= 2).slice(0, 4);
    const d = await describe(page, single.map((c) => c.items[0].i));
    add("consistency-font-sizes", { el: "font sizes", detail: `${sizeCl.length} distinct font sizes (fine ≤ 8, warn > ${T.fontSizes}): ${sizeCl.map((c) => `${r1(c.v)}px×${c.count}`).join(" ")}; rarely used: ${single.map((c, k) => `${r1(c.v)}px (${d[k] ? d[k].el : "?"})`).join(", ")}`, extra: { values: m.fontSizes } });
  }
  const near = [];
  for (let k = 1; k < sizeCl.length; k++) { const a = sizeCl[k - 1].v, b = sizeCl[k].v; if (b / a < T.stepRatio && b < 40) near.push([a, b]); }
  const mergedNear = sizeCl.filter((c) => c.values.length > 1);
  if (near.length >= 2 || mergedNear.length) {
    add("consistency-type-steps", { el: "type scale", detail: `${near.length ? `${near.length} adjacent size steps under ${T.stepRatio}×: ${near.map(([a, b]) => `${r1(a)}→${r1(b)}px (${(b / a).toFixed(2)}×)`).join(", ")}` : ""}${near.length && mergedNear.length ? "; " : ""}${mergedNear.length ? `sizes within 1 px of each other: ${mergedNear.map((c) => c.values.map(([v]) => r1(v) + "px").join("/")).join(", ")}` : ""}` });
  }
  const bodyFam = m.families.find((f) => !f.name.endsWith("(mono)"))?.name;
  const wts = new Map(); for (const x of typed) if (x.type.fam === bodyFam && !x.type.mono) { if (!wts.has(x.type.fw)) wts.set(x.type.fw, []); wts.get(x.type.fw).push(x.i); }
  m.weights = [...wts].map(([wgt, is]) => ({ weight: wgt, count: is.length })).sort((a, b) => a.weight - b.weight);
  if (wts.size > T.weights) {
    const rare = [...wts].sort((a, b) => a[1].length - b[1].length).slice(0, 2); const d = await describe(page, rare.map(([, is]) => is[0]));
    add("consistency-weights", { el: "font weights", detail: `${wts.size} weights in ${bodyFam} (fine ≤ ${T.weights}): ${m.weights.map((x) => `${x.weight}×${x.count}`).join(" ")}; rarest: ${rare.map(([wg], k) => `${wg} (${d[k]?.el || "?"})`).join(", ")}` });
  }
  const lhCl = clusterNums(typed.map((x) => ({ v: x.type.lh, i: x.i })), T.tolLh);
  m.lineHeights = lhCl.map((c) => ({ ratio: Math.round(c.v * 100) / 100, count: c.count }));
  const loose = typed.filter((x) => x.type.fs >= 32 && x.type.lh > T.headingLh);
  const tight = typed.filter((x) => !x.type.heading && x.type.fs <= 20 && x.type.chars >= 60 && x.type.lh < T.bodyLh);
  for (const [list, what] of [[loose, "display text at body leading"], [tight, "body text set tight"]]) {
    if (!list.length) continue;
    const d = await describe(page, list.slice(0, 3).map((x) => x.i));
    add("consistency-line-height", { el: d[0]?.el || what, selector: d[0]?.selector, owner: d[0]?.owner, classes: d[0]?.classes, detail: `${what} (headings 1.0-1.3, body 1.4-1.7): ${list.slice(0, 3).map((x, k) => `${d[k]?.el || x.tag} ${r1(x.type.fs)}px at ${x.type.lh}`).join("; ")}${list.length > 3 ? ` (+${list.length - 3} more)` : ""}` });
  }
  // Role conflicts: the same heading level / label / button at different sizes or weights.
  const roles = new Map();
  for (const x of typed) { const role = /^H[1-6]$/.test(x.tag) ? x.tag.toLowerCase() : x.tag === "LABEL" ? "label" : null; if (!role) continue; if (!roles.has(role)) roles.set(role, []); roles.get(role).push(x); }
  for (const x of recs.filter((r) => r.control && r.type)) { const role = `${x.control.kind} text`; if (!roles.has(role)) roles.set(role, []); roles.get(role).push(x); }
  for (const [role, list] of roles) {
    if (list.length < 2) continue;
    const cl = clusterNums(list.map((x) => ({ v: x.type.fs, i: x.i })), T.tolFont);
    const wcl = new Map(); for (const x of list) wcl.set(x.type.fw, (wcl.get(x.type.fw) || 0) + 1);
    if (cl.length < 2 && wcl.size < 2) continue;
    const minority = cl.length >= 2 ? cl.sort((a, b) => b.count - a.count).slice(1).flatMap((c) => c.items.slice(0, 1).map((e) => e.i)) : [];
    const d = await describe(page, minority.slice(0, 3));
    add("consistency-role", { el: `${role} style`, detail: `${role}: ${cl.length >= 2 ? cl.map((c) => `${r1(c.v)}px ×${c.count}`).join(", ") : ""}${cl.length >= 2 && wcl.size >= 2 ? "; " : ""}${wcl.size >= 2 ? `weights ${[...wcl].map(([k, v]) => `${k} ×${v}`).join(", ")}` : ""}${d.length ? `; odd ones: ${ex(d)}` : ""}` });
  }

  // Spacing.
  const spv = recs.flatMap((x) => (x.sp || []).map(([p, v]) => ({ v: Math.round(v * 100) / 100, i: x.i, p })));
  const onGrid = (v) => { const s = v <= 14 ? 2 : 4; return Math.abs(v - Math.round(v / s) * s) < 0.26; };
  const off = spv.filter((e) => !onGrid(e.v));
  const share = spv.length ? 1 - off.length / spv.length : 1;
  const spCl = clusterNums(spv, T.tolPx);
  m.spacing = { occurrences: spv.length, distinct: spCl.length, gridShare: Math.round(share * 1000) / 10, grid: "4px (2px half-steps up to 14px)", values: spCl.map((c) => ({ px: r1(c.v), count: c.count, merged: c.values.length > 1 ? c.values.map(([v]) => r1(v)) : undefined })) };
  const offEls = new Set(off.map((e) => e.i));
  if (spv.length >= 10 && (share < T.gridShare || offEls.size > T.offGridEls)) {
    const byV = new Map(); for (const e of off) { const k = r1(e.v); if (!byV.has(k)) byV.set(k, []); byV.get(k).push(e); }
    const worst = [...byV].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const d = await describe(page, worst.map(([, es]) => es[0].i));
    const near4 = (v) => Math.round(v / 4) * 4;
    add("consistency-spacing-grid", { el: "spacing grid", detail: `${Math.round(share * 100)}% of ${spv.length} spacing values on the 4 px grid (fine ≥ ${T.gridShare * 100}%), ${offEls.size} elements off it: ${worst.map(([v, es], k) => `${v}px ×${es.length} → ${near4(v)}px (${es[0].p} on ${d[k]?.el || "?"})`).join("; ")}`, extra: { offGrid: worst.map(([v, es], k) => ({ px: v, count: es.length, nearest: near4(v), example: d[k] || null })) } });
  }
  if (spCl.length > T.spacingDistinct) add("consistency-spacing-scale", { el: "spacing values", detail: `${spCl.length} distinct spacing values after merging within 2 px (fine ≤ ${T.spacingDistinct}): ${spCl.map((c) => `${r1(c.v)}×${c.count}`).join(" ")}` });

  // Colour.
  const texts = recs.filter((x) => x.text);
  const roleText = texts.filter((x) => !x.text.link && !x.text.status && x.text.bg);
  const polar = (x) => (oklab(x.text.bg)[0] < 0.55 ? "on dark" : "on light");
  m.colors = {};
  for (const side of ["on light", "on dark"]) {
    const list = roleText.filter((x) => polar(x) === side);
    if (!list.length) continue;
    const cl = clusterColors(list.map((x) => ({ c: x.text.c, i: x.i })));
    m.colors[`text ${side}`] = cl.map((c) => ({ hex: c.hex, oklch: fmtLch(c.c), count: c.count, merged: c.members.length > 1 ? c.members : undefined }));
    if (cl.length > T.textColors) {
      const d = await describe(page, cl.slice(T.textColors).map((c) => c.items[0].i).slice(0, 4));
      add("consistency-text-colors", { el: `text colours ${side}`, detail: `${cl.length} text colours ${side} after merging ΔE < 2 (fine ≤ ${T.textColors}: primary, secondary, muted, disabled): ${cl.map((c) => `${c.hex}×${c.count}`).join(" ")}; least used: ${ex(d)}` });
    }
    const pairs = [];
    for (let a = 0; a < cl.length; a++) for (let b = a + 1; b < cl.length; b++) { const e = dE(cl[a].c, cl[b].c); if (e >= T.nearColor[0] && e < T.nearColor[1]) pairs.push([cl[a], cl[b], e]); }
    // Near-identical: merged members (ΔE < 2) count too: three hexes that look alike are the same drift.
    const mergedHex = cl.filter((c) => c.members.length > 1);
    if (pairs.length || mergedHex.length) {
      const group = new Set(); for (const [a, b] of pairs) { group.add(a); group.add(b); } for (const c of mergedHex) group.add(c);
      const hexes = [...group].flatMap((c) => c.members);
      if (hexes.length >= 3 || pairs.length) {
        const d = await describe(page, [...group].map((c) => c.items[0].i).slice(0, 3));
        add("consistency-near-colors", { el: `near-identical text colours ${side}`, detail: `${hexes.length} text colours within ΔE OK 5 of each other likely mean one role: ${hexes.join(", ")}${pairs.length ? ` (closest pair ΔE ${Math.min(...pairs.map((p) => p[2])).toFixed(1)})` : ""}; e.g. ${ex(d)}`, extra: { values: hexes } });
      }
    }
  }
  const surfaces = clusterColors(recs.filter((x) => x.bg).map((x) => ({ c: x.bg, i: x.i })));
  m.colors.surfaces = surfaces.map((c) => ({ hex: c.hex, oklch: fmtLch(c.c), count: c.count, merged: c.members.length > 1 ? c.members : undefined }));
  const borders = clusterColors(recs.filter((x) => x.bc).map((x) => ({ c: x.bc, i: x.i })));
  m.colors.borders = borders.map((c) => ({ hex: c.hex, count: c.count, merged: c.members.length > 1 ? c.members : undefined }));
  // Accents: chromatic colours on actions (buttons' fill, links' text).
  const actionCols = [];
  for (const x of recs) {
    if (x.control?.kind === "button" && x.bg && (x.bg[3] ?? 255) > 200) actionCols.push({ c: x.bg, i: x.i });
    if (x.text?.link && !x.text.status) actionCols.push({ c: x.text.c, i: x.i });
  }
  const chromatic = actionCols.filter((e) => oklch(e.c)[1] > 0.06);
  const hues = [];
  for (const e of chromatic) { const H = oklch(e.c)[2]; const h = hues.find((x) => Math.min(Math.abs(x.h - H), 360 - Math.abs(x.h - H)) <= 30); if (h) h.items.push(e); else hues.push({ h: H, items: [e] }); }
  m.accents = hues.map((h) => ({ hue: Math.round(h.h), count: h.items.length, example: hex(h.items[0].c) }));
  if (hues.length > T.accentHues) {
    const d = await describe(page, hues.map((h) => h.items[0].i));
    add("consistency-accents", { el: "accent hues", detail: `${hues.length} accent hues on buttons and links (fine: 1): ${hues.map((h, k) => `${hex(h.items[0].c)} hue ${Math.round(h.h)}° ×${h.items.length} (${d[k]?.el || "?"})`).join("; ")}` });
  }
  // Neutrals: warm and cool greys mixed.
  const neutrals = [...surfaces, ...borders, ...clusterColors(texts.map((x) => ({ c: x.text.c, i: x.i })))].filter((c) => { const [, C] = oklch(c.c); return C > 0.01 && C <= 0.06; });
  if (neutrals.length >= 2) {
    const hs = neutrals.map((c) => oklch(c.c)[2]);
    let spread = 0, pair = null;
    for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) { const dd = Math.min(Math.abs(hs[a] - hs[b]), 360 - Math.abs(hs[a] - hs[b])); if (dd > spread) { spread = dd; pair = [neutrals[a], neutrals[b]]; } }
    m.neutralHueSpread = Math.round(spread);
    if (spread > T.neutralSpread) {
      const d = await describe(page, pair.map((c) => c.items[0].i));
      add("consistency-neutrals", { el: "neutral greys", detail: `warm and cool greys mixed: hue spread ${Math.round(spread)}° (fine ≤ ${T.neutralSpread}°): ${pair.map((c, k) => `${c.hex} ${fmtLch(c.c)} (${d[k]?.el || "?"})`).join(" vs ")}` });
    }
  }
  // Tokens: colours off the team's own list (a framework's default palette is not the team's list).
  const team = Object.entries(tokens.colors).filter(([n]) => !/^--tw-/.test(n) && !/^--color-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\d+)?$/.test(n));
  if (team.length >= 3) {
    const matchTok = (c) => team.find(([, t]) => dE(t, c) < T.tolDE && Math.abs((t[3] ?? 255) - (c[3] ?? 255)) < 20);
    const failing = [], untok = new Map();
    for (const x of texts) {
      if (matchTok(x.text.c)) continue;
      const k = hex(x.text.c); if (!untok.has(k)) untok.set(k, []); untok.get(k).push(x);
      if (x.text.bg) { const ratio = contrast(over(x.text.c, x.text.bg), x.text.bg); const need = x.text.large ? 3 : 4.5; if (ratio < need) failing.push({ x, ratio, need }); }
    }
    for (const x of recs.filter((r) => r.bg)) { if (matchTok(x.bg)) continue; const k = hex(x.bg); if (!untok.has(k)) untok.set(k, []); untok.get(k).push(x); }
    m.untokened = [...untok].map(([k, xs]) => ({ hex: k, count: xs.length })).sort((a, b) => b.count - a.count);
    for (const { x, ratio, need } of failing) {
      const [d] = await describe(page, [x.i]); if (!d) continue;
      const nearest = team.map(([n, t]) => [n, dE(t, x.text.c)]).sort((a, b) => a[1] - b[1])[0];
      F.add({ type: "consistency-untokened-contrast", width: w, severity: "fail", ...d, detail: `hardcoded text colour ${hex(x.text.c)} matches no token and fails contrast: ${ratio.toFixed(2)}:1 on ${hex(x.text.bg)} (needs ${need}:1); nearest token ${nearest[0]} (ΔE ${nearest[1].toFixed(1)})`, fix: FIX["consistency-untokened-contrast"], extra: { wcag: "1.4.3", who: "people with low vision, anyone on a dim screen; and it won't follow a theme change" } });
    }
    const top = m.untokened.filter((u) => !failing.some((f) => hex(f.x.text.c) === u.hex)).slice(0, 6);
    if (top.length) {
      const d = await describe(page, top.map((u) => untok.get(u.hex)[0].i));
      add("consistency-untokened", { el: "colours off the tokens", detail: `${m.untokened.length} colour(s) match none of the page's ${team.length} colour tokens (ΔE OK ≥ 2): ${top.map((u, k) => `${u.hex}×${u.count} (${d[k]?.el || "?"})`).join("; ")}` });
    }
  }

  // Shape.
  const radEntries = recs.filter((x) => x.rad && !x.full).flatMap((x) => [...new Set(x.rad.filter((v) => v > 0))].map((v) => ({ v, i: x.i })));
  const radCl = clusterNums(radEntries, T.tolPx);
  m.radii = { full: recs.filter((x) => x.full).length, values: radCl.map((c) => ({ px: r1(c.v), count: c.count, merged: c.values.length > 1 ? c.values.map(([v]) => r1(v)) : undefined })) };
  if (radCl.length > T.radii) {
    const d = await describe(page, radCl.map((c) => c.items[0].i).slice(0, 6));
    add("consistency-radii", { el: "corner radii", detail: `${radCl.length} non-zero radii besides full (fine ≤ ${T.radii}): ${radCl.map((c, k) => `${r1(c.v)}px×${c.count}${d[k] ? ` (${d[k].el})` : ""}`).join(", ")}` });
  }
  const bwCl = clusterNums(recs.filter((x) => x.bw).flatMap((x) => x.bw.map((v) => ({ v, i: x.i }))), 0.5);
  m.borderWidths = bwCl.map((c) => ({ px: r1(c.v), count: c.count }));
  if (bwCl.length > T.borderWidths) {
    const d = await describe(page, bwCl.map((c) => c.items[0].i));
    add("consistency-border-widths", { el: "border widths", detail: `${bwCl.length} border widths (fine ≤ ${T.borderWidths}): ${bwCl.map((c, k) => `${r1(c.v)}px×${c.count} (${d[k]?.el || "?"})`).join(", ")}` });
  }
  const shadows = new Map(); for (const x of recs.filter((r) => r.shadow)) { if (!shadows.has(x.shadow)) shadows.set(x.shadow, []); shadows.get(x.shadow).push(x.i); }
  m.shadows = [...shadows].map(([s, is]) => ({ shadow: s, count: is.length }));
  if (shadows.size > T.shadows) {
    const d = await describe(page, [...shadows.values()].map((is) => is[0]).slice(0, 5));
    add("consistency-shadows", { el: "shadows", detail: `${shadows.size} different shadows (fine ≤ ${T.shadows} elevations): ${[...shadows].slice(0, 5).map(([s, is], k) => `${s.slice(0, 60)} ×${is.length} (${d[k]?.el || "?"})`).join("; ")}` });
  }
  for (const n of data.nesting) {
    const [c, p] = await describe(page, [n.child, n.parent]); if (!c || !p) continue;
    add("consistency-nested-radius", { ...c, detail: `${r1(n.inner)}px corners inside ${p.el} at ${r1(n.outer)}px with ${n.inset}px between them: corners aren't concentric (outer should be ≈ ${r1(n.inner + n.inset)}px)` });
  }

  // Controls.
  const ctl = recs.filter((x) => x.control);
  m.controlHeights = {};
  for (const kind of ["button", "input", "select"]) { const cl = clusterNums(ctl.filter((x) => x.control.kind === kind).map((x) => ({ v: x.control.h, i: x.i })), T.tolPx); if (cl.length) m.controlHeights[kind] = cl.map((c) => ({ px: r1(c.v), count: c.count })); }
  const allH = clusterNums(ctl.map((x) => ({ v: x.control.h, i: x.i })), T.tolPx);
  if (allH.length > T.controlHeights) {
    const d = await describe(page, allH.map((c) => c.items[0].i).slice(0, 6));
    add("consistency-control-heights", { el: "control heights", detail: `${allH.length} control heights (fine ≤ ${T.controlHeights}: sm/md/lg): ${allH.map((c, k) => `${r1(c.v)}px×${c.count} (${d[k]?.el || "?"})`).join(", ")}` });
  }
  const byI = new Map(recs.map((x) => [x.i, x]));
  const rowFindings = [];
  for (const row of data.rows) {
    const xs = row.map((i) => byI.get(i));
    const hs = xs.map((x) => x.control.h), tops = xs.map((x) => x.control.top);
    const dh = Math.max(...hs) - Math.min(...hs), dt = Math.max(...tops) - Math.min(...tops);
    const d = await describe(page, row);
    if (dh > 1 || dt > 1) {
      const sev = dh >= 2 || dt >= 2 ? "fail" : "warn";
      const f = { type: "consistency-control-row", width: w, severity: sev, ...d[0], detail: `controls in one row ${dh > 1 ? `differ in height by ${r1(dh)}px` : ""}${dh > 1 && dt > 1 ? " and " : ""}${dt > 1 ? `don't share a top (${r1(dt)}px apart)` : ""}: ${xs.map((x, k) => `${d[k]?.el || x.tag} ${pxs(x.control.h)}`).join(", ")}`, fix: FIX["consistency-control-row"], extra: { row: d.map((x) => x.selector) } };
      F.add(f); rowFindings.push({ sel: d.map((x) => x.selector), w, type: f.type, el: d[0]?.el });
    }
    // Same row: a button, input and select with different radii.
    const rad = xs.filter((x) => !x.control.native).map((x) => ({ x, r: x.rad ? Math.max(...x.rad) : 0, full: x.full })).filter((e) => !e.full);
    if (rad.length >= 2) {
      const rs = rad.map((e) => e.r);
      if (Math.max(...rs) - Math.min(...rs) > T.tolPx) {
        const dd = await describe(page, rad.map((e) => e.x.i));
        add("consistency-control-radius", { ...dd[0], detail: `controls side by side with different radii: ${rad.map((e, k) => `${dd[k]?.el || e.x.tag} ${pxs(e.r)}`).join(", ")}` });
      }
    }
  }
  // Same kind of control across the page with a different radius (non-native, non-pill).
  const fam = ctl.filter((x) => !x.control.native && !x.full && x.rad);
  const famCl = clusterNums(fam.map((x) => ({ v: Math.max(...x.rad), i: x.i })), T.tolPx);
  m.controlRadii = famCl.map((c) => ({ px: r1(c.v), count: c.count }));
  if (famCl.length > 2) {
    const d = await describe(page, famCl.map((c) => c.items[0].i));
    add("consistency-control-radius", { el: "control radii", detail: `buttons, inputs and selects use ${famCl.length} radii (pills aside): ${famCl.map((c, k) => `${r1(c.v)}px×${c.count} (${d[k]?.el || "?"})`).join(", ")}` });
  }

  // Motion.
  const trs = recs.filter((x) => x.tr).flatMap((x) => x.tr.map(([ms, ez]) => ({ v: ms, ez, i: x.i })));
  const durCl = clusterNums(trs, T.tolMs);
  const eases = new Map(); for (const t of trs) eases.set(t.ez, (eases.get(t.ez) || 0) + 1);
  m.transitions = { durations: durCl.map((c) => ({ ms: c.v, count: c.count })), easings: [...eases].map(([e, n]) => ({ easing: e, count: n })) };
  if (durCl.length > T.durations || eases.size > T.easings) add("consistency-transitions", { el: "transitions", detail: `${durCl.length} durations (fine ≤ ${T.durations}): ${durCl.map((c) => `${c.v}ms×${c.count}`).join(" ")}; ${eases.size} easings (fine ≤ ${T.easings}): ${[...eases].map(([e, n]) => `${e}×${n}`).join(", ")}` });

  // Icons.
  const icons = recs.filter((x) => x.icon);
  const icCl = clusterNums(icons.map((x) => ({ v: x.icon.size, i: x.i })), 1);
  const strokes = clusterNums(icons.filter((x) => x.icon.stroke).map((x) => ({ v: x.icon.stroke, i: x.i })), T.strokeDiff);
  const styles = new Set(icons.map((x) => x.icon.style));
  m.icons = { count: icons.length, sizes: icCl.map((c) => ({ px: c.v, count: c.count })), strokes: strokes.map((c) => ({ px: c.v, count: c.count })), styles: [...styles] };
  if (icCl.length > T.iconSizes || strokes.length > 1) {
    const d = await describe(page, [...(strokes.length > 1 ? strokes : icCl)].map((c) => c.items[0].i).slice(0, 4));
    add("consistency-icons", { el: "icons", detail: `${icCl.length} icon sizes (fine ≤ ${T.iconSizes}): ${icCl.map((c) => `${c.v}px×${c.count}`).join(" ")}${strokes.length > 1 ? `; strokes ${strokes.map((c) => `${c.v}px×${c.count}`).join(", ")} (differ > ${T.strokeDiff}px)` : ""}${styles.size > 1 ? "; outline and filled mixed" : ""}; e.g. ${ex(d)}` });
  }
  return { measured: m, rowFindings };
}

// ── run ──────────────────────────────────────────────────────────────────────

const ctx = await newContext(browser, url, { viewport: { width: widths[0], height: 900 }, reducedMotion: "reduce" });
await ctx.addInitScript(HELPERS);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await settle(page); await installHelpers(page); await dismissPopups(page);
const exempt = await page.evaluate(EXEMPT);
const tokens = await page.evaluate(TOKENS);
const measured = {};
const shotsWanted = [];
let delegated = null;

if (exempt) {
  F.add({ type: "consistency-exempt", el: "page", severity: "info", kind: "suggestion", detail: `not judged: ${exempt}. Specimen pages show every value on purpose.` });
} else {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 600 ? 844 : 900 });
    await page.waitForTimeout(150);
    await settle(page, 300, 3000);
    DE_LABEL.clear();
    const data = await page.evaluate(COLLECT);
    const r = await analyse(page, w, data, tokens);
    measured[w] = { elements: data.recs.length, ...r.measured };
    shotsWanted.push(...r.rowFindings);
    // False affordances: confirm no click listener on the element, its ancestors, document or window.
    if (data.fa.length) {
      const cdp = await ctx.newCDPSession(page);
      const CLICKY = /^(click|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend)$/;
      const listens = async (expr) => { try { const { result } = await cdp.send("Runtime.evaluate", { expression: expr }); if (!result.objectId) return false; const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: 0 }); return listeners.some((l) => CLICKY.test(l.type)); } catch { return false; } };
      if (delegated == null) delegated = (await listens("window")) || (await listens("document")) || (await listens("document.documentElement")) || (await listens("document.body"));
      for (let k = 0; k < data.fa.length && k < 20; k++) {
        let own = false;
        for (let up = 0; up < 6 && !own; up++) own = await listens(`(() => { let n = window.__srFA[${k}]; for (let j = 0; j < ${up} && n; j++) n = n.parentElement; return n && n !== document.body ? n : null; })()`);
        if (own) continue;
        const [d] = await describe(page, [data.fa[k]]); if (!d) continue;
        F.add({ type: "consistency-false-affordance", width: w, severity: delegated ? "warn" : "fail", ...d, detail: `shows a pointer cursor but nothing handles a click on it${delegated ? " (a page-wide click listener exists: click it to confirm)" : ""}: it promises a click it can't keep`, fix: FIX["consistency-false-affordance"] });
      }
      await cdp.detach().catch(() => {});
    }
  }
}

// Screenshots of misaligned rows, outlined, at their width.
if (!has("--no-shots") && shotsWanted.length) {
  const dir = join(out, "consistency-shots"); mkdirSync(dir, { recursive: true });
  let n = 0;
  const seen = new Set();
  for (const s of shotsWanted.filter((x) => !seen.has(x.type + x.el) && seen.add(x.type + x.el)).slice(0, 12)) {
    await page.setViewportSize({ width: s.w, height: s.w < 600 ? 844 : 900 }); await page.waitForTimeout(100);
    const box = await page.evaluate((sels) => {
      const els = sels.map((q) => document.querySelector(q)).filter(Boolean); if (!els.length) return null;
      els[0].scrollIntoView({ block: "center", behavior: "instant" });
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const el of els) { const r = el.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); const o = document.createElement("div"); o.className = "__sr_outline"; Object.assign(o.style, { position: "fixed", left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px", outline: "2px solid #ff2d55", zIndex: 2147483647, pointerEvents: "none" }); document.body.appendChild(o); }
      return { x: Math.max(0, x0 - 40), y: Math.max(0, y0 - 40), width: Math.min(innerWidth - Math.max(0, x0 - 40), x1 - x0 + 80), height: Math.min(innerHeight, y1 - y0 + 80) };
    }, s.sel).catch(() => null);
    if (box && box.width > 4 && box.height > 4) {
      const file = `${String(++n).padStart(2, "0")}-row-${s.w}.png`;
      await page.screenshot({ path: join(dir, file), clip: box }).catch(() => {});
      const f = F.items.find((x) => x.type === s.type && x.el === s.el && !x.shot); if (f) f.shot = `consistency-shots/${file}`;
    }
    await page.evaluate(() => document.querySelectorAll(".__sr_outline").forEach((o) => o.remove())).catch(() => {});
  }
}

await browser.close();
const summary = F.print();
const tokenSummary = { colors: Object.fromEntries(Object.entries(tokens.colors).map(([k, v]) => [k, hex(v)])), lengths: tokens.lengths, otherCount: tokens.other, total: tokens.all };
if (!exempt) for (const w of widths) { const x = measured[w]; if (x) console.log(`@${w}: ${x.fontSizes.length} font sizes, ${x.weights.length} weights, ${x.families.length} families, ${x.spacing.distinct} spacing values (${x.spacing.gridShare}% on grid), ${x.radii.values.length} radii + ${x.radii.full} full, ${x.borderWidths.length} border widths, ${x.shadows.length} shadows; ${tokens.all} :root custom properties (${Object.keys(tokens.colors).length} colours)`); }
F.write(out, { url, widths, exempt, thresholds: T, measured: { ...measured, tokens: tokenSummary }, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(summary.fails ? 1 : 0);
