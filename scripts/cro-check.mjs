#!/usr/bin/env node
// cro-check.mjs: the measured half of references/conversion.md. At 1440×900 and 390×844 (touch):
//   primary CTA: where it is, whether an overlay covers it on arrival, how many primary-looking buttons compete in
//     the first screen, vague labels ("Submit", "Learn more"), CTA links that go nowhere (#, javascript:, 404)
//   forms: field and required counts, autocomplete tokens on name/email/tel/organization/address fields (WCAG
//     1.3.5), the keyboard a phone opens (type / inputmode), the submit label, password fields without a show toggle
//   popups: overlays covering the phone's first screen on arrival (Google's intrusive-interstitial guidance), when
//     they appear, whether Esc or a close button closes them, whether they come back after a reload
//   trust near the CTA (testimonial, rating, customer count, logo row, "no card" line), as information
//   analytics: which tools load, and what the primary CTA's click sends (dataLayer, gtag, PostHog, Segment, …
//     calls and beacons), duplicates, emails in the payloads. Observe only: beacons are recorded and dropped,
//     navigation and every non-GET request during the click are blocked, form submits are never clicked.
//
//   node cro-check.mjs <url | file.html> [--out .review] [--storage state.json] [--cookie "a=1"]
//
// Not repeated here: no CTA / CTA below the fold (site-review.mjs), labels and placeholder-only labels, inputs
// under 16px on phones, silent disabled submits (interaction-check.mjs). Judgement (copy, offer, which fields to
// cut) is left to the Look step and the cro skill.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newContext, parseArgs, toUrl, loadChromium, outDir, settle, HELPERS, installHelpers, dismissPopups, Findings } from "./lib.mjs";

const { opt, target } = parseArgs(["--out"]);
if (!target) { console.error("usage: cro-check.mjs <url | file.html> [--out .review] [--storage state.json] [--cookie \"a=1\"]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const isHttp = /^https?:/.test(url);
const F = new Findings("cro");
const { chromium } = loadChromium();
const t0 = Date.now();
const browser = await chromium.launch();
const VIEWS = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844, mobile: true }];
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WATCH_MS = 3500; // how long after the page settles a popup may take to appear and still count as "on arrival"

// Analytics collection endpoints: recorded, then dropped, so a review never sends events to the owner's analytics.
const BEACON = /google-analytics\.com\/(g\/)?collect|analytics\.google\.com\/g\/collect|\/g\/collect\?|posthog\.com\/(e|i\/v0\/e|batch|capture)\b|\/i\/v0\/e\/|api\.segment\.io\/v1\/|plausible\.io\/api\/event|facebook\.com\/tr\b|mixpanel\.com\/track|amplitude\.com\/(2\/httpapi|batch)|clarity\.ms\/collect|\/_vercel\/insights\/(event|view)|usefathom\.com\/?\?|heapanalytics\.com\/h|matomo\.php|piwik\.php|\/api\/send$/;
const GENERIC = /^(submit|send|go|ok|okay|click|click here|here|learn more|read more|more|more info|find out more|discover more|details|continue|enter|button|next)$/i;
const PAGEVIEW = /^(page_view|\$pageview|\$pageleave|pageview|page|PageView|user_engagement|scroll|gtm\.(js|dom|load))$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// ── in the page ─────────────────────────────────────────────────────────────

// Fixed layers over the first screen: a 13×26 grid of points, each attributed to the outermost fixed (or top-layer)
// element on top there. Header bars are left out; cookie/consent layers are counted apart (Google exempts them).
const COVERAGE = () => {
  const vw = innerWidth, vh = innerHeight;
  document.querySelectorAll("[data-cro-overlay]").forEach((e) => e.removeAttribute("data-cro-overlay"));
  const rootOf = (el) => { let root = null; for (let n = el; n && n !== document.documentElement && n !== document.body; n = n.parentElement) { if (getComputedStyle(n).position === "fixed" || (n.tagName === "DIALOG" && n.open)) root = n; } return root; };
  const headerLike = (el) => { const r = el.getBoundingClientRect(); return el.matches("header,nav,[role=banner],[role=navigation]") || (r.top <= 1 && r.height <= 140 && r.width >= vw * 0.9 && !el.querySelector("[role=dialog],[aria-modal=true],dialog")); };
  const groups = new Map(); const NX = 13, NY = 26; const hitAny = new Set(), hitCookie = new Set();
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const el = document.elementFromPoint((i + 0.5) * vw / NX, (j + 0.5) * vh / NY); if (!el) continue;
    const root = rootOf(el); if (!root || headerLike(root)) continue;
    groups.set(root, (groups.get(root) || 0) + 1);
  }
  const dialogNear = (root) => root.matches("[role=dialog],[aria-modal=true],dialog") ? root : root.querySelector("[role=dialog],[aria-modal=true],dialog[open]") || [...document.querySelectorAll("[role=dialog],[aria-modal=true],dialog[open]")].find((d) => { const r = d.getBoundingClientRect(); return r.width > 40 && r.height > 40 && getComputedStyle(d).visibility !== "hidden"; });
  const overlays = [...groups].map(([root, n]) => {
    const dlg = dialogNear(root); const textOf = (e) => (e?.innerText || "").trim();
    const text = textOf(root) || textOf(dlg);
    const cookie = /cookie|consent|gdpr|privacy (choices|preferences|settings)/i.test(text.slice(0, 600));
    const head = (root.querySelector("h1,h2,h3,[role=heading]") || dlg?.querySelector("h1,h2,h3,[role=heading]") || root.querySelector("p,button") || dlg?.querySelector("p,button"));
    const label = (head ? head.innerText : text || root.getAttribute("aria-label") || root.tagName.toLowerCase()).trim().replace(/\s+/g, " ").slice(0, 60);
    return { root, n, cookie, label, pct: Math.round((n / (NX * NY)) * 100) };
  }).sort((a, b) => b.n - a.n);
  // Union per point: re-walk the grid once with the classification known.
  const cookieRoots = new Set(overlays.filter((o) => o.cookie).map((o) => o.root));
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    const el = document.elementFromPoint((i + 0.5) * vw / NX, (j + 0.5) * vh / NY); const root = el && rootOf(el);
    if (!root || !groups.has(root)) continue;
    (cookieRoots.has(root) ? hitCookie : hitAny).add(i + ":" + j);
  }
  overlays.filter((o) => !o.cookie && o.pct >= 10).forEach((o) => o.root.setAttribute("data-cro-overlay", "1"));
  const sr = window.__sr;
  return {
    now: Math.round(performance.now()),
    coverage: Math.round((hitAny.size / (NX * NY)) * 100), cookieCoverage: Math.round((hitCookie.size / (NX * NY)) * 100),
    overlays: overlays.slice(0, 4).map((o) => ({ pct: o.pct, cookie: o.cookie, label: o.label, ...(sr ? sr.describe(o.root) : {}), el: o.label ? `overlay "${o.label}"` : "overlay" })),
  };
};

// The close control of the open overlay, marked for a click; its size.
const CLOSE_CONTROL = () => {
  const sr = window.__sr;
  const scopes = [...document.querySelectorAll("[data-cro-overlay],[role=dialog],[aria-modal=true],dialog[open]")].filter(sr.visible);
  for (const s of scopes) {
    const b = [...s.querySelectorAll("button,[role=button],a")].find((b) => sr.visible(b) && (/close|dismiss|no,? thanks|not now|later|skip|×|✕|✖/i.test((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.innerText || "")) || /^\s*[x×✕✖]\s*$/i.test(b.innerText || "")));
    if (b) { b.setAttribute("data-cro-close", "1"); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: sr.label(b) }; }
  }
  return null;
};

// Primary-looking buttons, forms and trust signals. Run while an arrival popup may still be open: what it covers is
// measured, what is inside it is left out.
const MEASURE = () => {
  const sr = window.__sr; const vh = innerHeight;
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const g = cv.getContext("2d", { willReadFrequently: true }); const cache = new Map();
  // Any CSS colour (rgb, oklch, color(), hex) to sRGB through a 1 px canvas.
  const toRgb = (s) => { if (!s || s === "transparent") return null; if (cache.has(s)) return cache.get(s); g.clearRect(0, 0, 1, 1); g.fillStyle = "rgba(0,0,0,0)"; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; const v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; cache.set(s, v); return v; };
  const firstColor = (img) => (img.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/i) || [])[0];
  const fill = (el) => { const s = getComputedStyle(el); const c = toRgb(s.backgroundColor); if (c && c.a >= 0.5) return c; if (s.backgroundImage.includes("gradient")) { const f = toRgb(firstColor(s.backgroundImage)); if (f && f.a >= 0.5) return f; } return null; };
  const behind = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const c = fill(n); if (c) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const inOverlay = (el) => el.closest('[role=dialog],[aria-modal="true"],dialog,[data-cro-overlay]');
  const textOf = (el) => (el.tagName === "INPUT" ? el.value || (el.type === "submit" ? "Submit" : "") : el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
  const rootOf = (el) => { let root = null; for (let n = el; n && n !== document.documentElement && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "fixed" || (n.tagName === "DIALOG" && n.open)) root = n; return root; };

  // Buttons and button-styled links: filled, standing out from what is behind them (contrast ≥ 1.8), not nav.
  document.querySelectorAll("[data-cro-cta]").forEach((e) => e.removeAttribute("data-cro-cta"));
  const ctas = [];
  for (const el of document.querySelectorAll("a[href],button,input[type=submit],input[type=button],[role=button]")) {
    if (!sr.visible(el) || sr.ignored(el) || el.closest("nav,header,[role=navigation],[role=banner]") || inOverlay(el) || el.disabled) continue;
    if (el.matches('[role=tab],[aria-selected],[aria-pressed],[aria-current]:not([aria-current="false"])')) continue;
    const r = el.getBoundingClientRect(); if (r.height < 32 || r.width < 64) continue;
    const text = textOf(el); if (text.length < 2 || text.length > 40) continue;
    const f = fill(el); if (!f) continue;
    const contrast = ratio(f, behind(el)); if (contrast < 1.8) continue;
    const i = ctas.length; el.setAttribute("data-cro-cta", String(i));
    const submit = /^(BUTTON|INPUT)$/.test(el.tagName) && el.type === "submit" && !!el.form;
    const inFirst = r.top < vh && r.bottom <= vh && r.top >= 0;
    let coveredBy = null;
    if (inFirst) {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el)) { const root = rootOf(hit) || hit; const h = root.querySelector?.("h1,h2,h3,[role=heading]") || root.querySelector?.("p,button"); coveredBy = (h ? h.innerText : root.innerText || sr.label(root)).trim().replace(/\s+/g, " ").slice(0, 50) || sr.label(root); }
    }
    ctas.push({ i, ...sr.describe(el), text, href: el.tagName === "A" ? el.getAttribute("href") : null, abs: el.tagName === "A" ? el.href : null, submit, top: Math.round(r.top), docTop: Math.round(r.top + scrollY), height: Math.round(r.height), inFirst, coveredBy, fill: hex(f), sig: hex(f) + "|" + Math.round(r.height / 6), contrast: +contrast.toFixed(1) });
  }

  // Forms.
  const labelOf = (e) => { const parts = [...(e.labels || [])].map((l) => l.innerText); const lb = e.getAttribute("aria-labelledby"); if (lb) for (const id of lb.split(/\s+/)) parts.push(document.getElementById(id)?.innerText || ""); parts.push(e.getAttribute("aria-label") || "", e.getAttribute("placeholder") || "", e.name || "", e.id || ""); return parts.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\[\].]+/g, " ").toLowerCase(); };
  const purposeOf = (e, t) => {
    if (e.tagName === "SELECT") return /\bcountry\b/.test(t) && !/code/.test(t) ? "country" : null;
    if (e.tagName === "TEXTAREA") return /\b(street|address)\b/.test(t) && !/e ?mail/.test(t) ? "street-address" : null;
    if (/^(password|search|checkbox|radio|file|range|color|date|datetime-local|month|week|time|url)$/.test(e.type)) return null;
    if (e.type === "email" || /e ?mail/.test(t)) return "email";
    if (e.type === "tel" || /\b(phone|tel|telephone|mobile|cell)\b/.test(t)) return "tel";
    if (/one ?time|\botp\b|verification code|security code|\b2fa\b/.test(t)) return "one-time-code";
    if (/\b(zip|postal|post ?code|postcode)\b/.test(t)) return "postal-code";
    if (/\b(company|organi[sz]ation|employer)\b/.test(t) && !/\b(size|employees|industry|type|role|website|url|domain)\b/.test(t)) return "organization";
    if (/\b(user|file|project|display|team|workspace|domain|card|account|nick|screen|site|event|product|pet|company|business) ?name\b/.test(t)) return null;
    if (/\b(first ?name|given ?name|fname|forename)\b/.test(t)) return "given-name";
    if (/\b(last ?name|surname|family ?name|lname)\b/.test(t)) return "family-name";
    if (/\b(city|town|locality)\b/.test(t)) return "address-level2";
    if (/\bcountry\b/.test(t)) return "country";
    if (/\b(street|address)\b/.test(t)) return "street-address";
    if (/\b(full ?name|your name|name)\b/.test(t)) return "name";
    return null;
  };
  const ACCEPT = { email: ["email", "username"], tel: ["tel", "tel-national", "tel-local"], "one-time-code": ["one-time-code"], "postal-code": ["postal-code"], organization: ["organization"], "given-name": ["given-name", "name"], "family-name": ["family-name"], "address-level2": ["address-level2"], country: ["country", "country-name"], "street-address": ["street-address", "address-line1", "address-line2", "address-line3"], name: ["name", "given-name", "family-name", "nickname"] };
  const forms = [];
  [...document.querySelectorAll("form")].filter((f) => sr.visible(f) && !sr.ignored(f) && !inOverlay(f) && !f.matches("[role=search]")).forEach((form, fi) => {
    const all = [...form.elements].filter((e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && !/^(hidden|submit|button|reset|image)$/.test(e.type));
    const vis = all.filter((e) => sr.visible(e) || (/^(checkbox|radio)$/.test(e.type) && e.closest("label") && sr.visible(e.closest("label"))));
    if (!vis.length || (vis.length === 1 && vis[0].type === "search")) return;
    const radios = new Set(); let count = 0, required = 0, checks = 0; const fields = [];
    for (const e of vis) {
      if (e.type === "checkbox") { checks++; continue; }
      if (e.type === "radio") { if (radios.has(e.name)) continue; radios.add(e.name); }
      count++; if (e.required || e.getAttribute("aria-required") === "true") required++;
      const t = labelOf(e); const purpose = purposeOf(e, t);
      const attr = (e.getAttribute("autocomplete") || "").trim().toLowerCase();
      const token = attr.split(/\s+/).filter((x) => x && !/^(section-|shipping$|billing$|home$|work$|mobile$|fax$|pager$|webauthn$)/.test(x)).pop() || "";
      let ac = null;
      if (purpose && (!token || token === "on" || token === "off")) ac = { want: ACCEPT[purpose][0], had: attr || null };
      else if (purpose && !ACCEPT[purpose].includes(token)) ac = { want: ACCEPT[purpose][0], had: attr, wrong: true };
      const im = (e.getAttribute("inputmode") || "").toLowerCase(); let kb = null;
      if (purpose === "email" && e.type !== "email" && im !== "email") kb = { severity: "fail", detail: `type=${e.type}${im ? ` inputmode=${im}` : ""} on an email field: the phone keyboard has no @ key and the browser offers no saved emails`, want: 'type="email"' };
      else if (purpose === "tel" && e.type !== "tel" && !/^(tel|numeric)$/.test(im)) kb = { severity: "fail", detail: e.type === "number" ? "type=number on a phone field: drops a leading 0 or +, adds spinner arrows" : `type=${e.type} without inputmode on a phone field: phones open the full letter keyboard`, want: 'type="tel"' };
      else if (purpose === "one-time-code" && im !== "numeric" && e.type !== "number") kb = { severity: "warn", detail: "a numeric code field without inputmode=\"numeric\": phones open the letter keyboard", want: 'inputmode="numeric"' };
      else if (purpose === "postal-code" && e.type === "number") kb = { severity: "warn", detail: "type=number on a postal code: drops leading zeros, adds spinners, rejects letters (UK, Canada)", want: 'type="text" autocomplete="postal-code"' };
      else if (!purpose && e.tagName === "INPUT" && e.type === "text" && /\b(quantity|qty|age|how many|number of|seats|budget)\b/.test(t) && !/^(numeric|decimal)$/.test(im)) kb = { severity: "warn", detail: "a number field without inputmode: phones open the letter keyboard", want: 'inputmode="numeric"' };
      let pw = null;
      if (e.type === "password") {
        const scope = e.parentElement?.parentElement || form;
        const toggle = [...scope.querySelectorAll("button,[role=button],input[type=checkbox],[role=switch]")].find((b) => b !== e && /show|hide|reveal|view|toggle|eye|visib/i.test([b.getAttribute("aria-label"), b.getAttribute("title"), b.innerText, b.closest("label")?.innerText, typeof b.className === "string" ? b.className : ""].join(" ")));
        pw = { toggle: !!toggle, isNew: attr.includes("new-password") };
      }
      const shown = ([...(e.labels || [])].map((l) => l.innerText).join(" ") || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      fields.push({ ...sr.describe(e), el: `${e.tagName.toLowerCase()}${e.name ? `[name=${e.name}]` : e.id ? `#${e.id}` : ""}${shown ? ` "${shown}"` : ""}`, type: e.type || e.tagName.toLowerCase(), purpose, ac, kb, pw });
    }
    const sub = [...form.querySelectorAll("button,input[type=submit],input[type=image]")].find((b) => sr.visible(b) && (b.type === "submit" || b.type === "image"));
    const submit = sub ? textOf(sub) : null;
    const ps = fields.map((x) => x.purpose); const hasPw = fields.some((x) => x.pw);
    const kind = hasPw ? (fields.some((x) => x.pw?.isNew) || fields.filter((x) => x.pw).length > 1 || /sign ?up|create|register|join|start|get started/i.test(submit || "") ? "signup" : "login")
      : ps.includes("street-address") || ps.includes("postal-code") ? "checkout" : ps.includes("email") || ps.includes("tel") ? "lead" : "other";
    const head = form.querySelector("h1,h2,h3,legend") || (form.previousElementSibling?.matches("h1,h2,h3") ? form.previousElementSibling : null);
    const name = (form.getAttribute("aria-label") || head?.innerText || form.id || `form ${fi + 1}`).trim().replace(/\s+/g, " ").slice(0, 40);
    forms.push({ ...sr.describe(form), el: `form "${name}"`, name, kind, count, required, checks, submit, submitDesc: sub ? sr.describe(sub) : null, fields });
  });

  // Trust signals within 450 px (page y) of the main CTA.
  const main = ctas.find((c) => c.inFirst && !c.submit) || ctas.find((c) => !c.submit) || ctas[0];
  let trust = null;
  if (main) {
    const top = main.docTop - 450, bottom = main.docTop + main.height + 450;
    const near = (el) => { const r = el.getBoundingClientRect(); const y = r.top + scrollY; return r.height > 0 && y < bottom && y + r.height > top; };
    const text = sr.textEls().filter((e) => near(e) && !e.closest("[data-cro-cta]")).map((e) => e.innerText).join(" \n ").slice(0, 20000);
    const found = [];
    if ([...document.querySelectorAll("blockquote,q,[class*=testimonial i],[itemprop=review]")].some((e) => sr.visible(e) && near(e))) found.push("testimonial");
    if (/★|⭐|\b[1-5](\.\d)?\s*(\/\s*5|out of 5|stars?)\b|\brated\b/i.test(text)) found.push("rating");
    if (/\b\d[\d,.]*\s*k?\+?\s*(reviews|ratings|customers|users|teams|companies|businesses|developers|members|downloads)\b/i.test(text)) found.push("customer count");
    if (/no credit card|no card|free trial|cancel any ?time|money.back|guarantee|refund|no spam|secure|encrypted|soc ?2|gdpr|hipaa|iso ?27001/i.test(text)) found.push("reassurance line");
    const logoRow = [...document.querySelectorAll("body *")].some((d) => { if (d.children.length < 4 || d.children.length > 24 || !near(d)) return false; const kids = [...d.children].filter((c) => sr.visible(c) && (c.matches("img,svg") || (c.children.length === 1 && c.firstElementChild.matches("img,svg")))); if (kids.length < 4) return false; const t = kids.map((k) => Math.round(k.getBoundingClientRect().top / 20)); return new Set(t).size <= 2; });
    if (logoRow) found.push("logo row");
    trust = { cta: main.text, found };
  }
  return { ctas, forms, trust };
};

const TOOLS = () => {
  const srcs = [...document.scripts].map((s) => s.src || "").join(" ");
  const inline = [...document.scripts].filter((s) => !s.src).map((s) => s.textContent.slice(0, 4000)).join(" ");
  const t = [];
  if (/googletagmanager\.com\/gtm\.js/.test(srcs) || /GTM-[A-Z0-9]{4,}/.test(inline) || window.google_tag_manager) t.push("Google Tag Manager");
  if (/googletagmanager\.com\/gtag\/js/.test(srcs) || /\bgtag\(/.test(inline) || typeof window.gtag === "function") t.push("GA4 (gtag)");
  if (window.posthog || /posthog/i.test(srcs)) t.push("PostHog");
  if ((window.analytics && typeof window.analytics.track === "function") || /segment\.(com|io)\/analytics/.test(srcs)) t.push("Segment");
  if (typeof window.plausible === "function" || /plausible\.io/.test(srcs)) t.push("Plausible");
  if (window.fathom || /usefathom/.test(srcs)) t.push("Fathom");
  if (window.mixpanel || /mixpanel/.test(srcs)) t.push("Mixpanel");
  if (window.amplitude || /amplitude/.test(srcs)) t.push("Amplitude");
  if (typeof window.fbq === "function" || /connect\.facebook\.net/.test(srcs)) t.push("Meta Pixel");
  if (window.hj || /hotjar/.test(srcs)) t.push("Hotjar");
  if (window.clarity || /clarity\.ms/.test(srcs)) t.push("Microsoft Clarity");
  if (window.va || /_vercel\/insights|vercel-insights/.test(srcs)) t.push("Vercel Analytics");
  if (window.umami || /umami/.test(srcs)) t.push("Umami");
  if (window._paq || /matomo|piwik/.test(srcs)) t.push("Matomo");
  if (window.heap || /heapanalytics/.test(srcs)) t.push("Heap");
  if (Array.isArray(window.dataLayer) && !t.length) t.push("dataLayer");
  let dl = []; try { dl = JSON.parse(JSON.stringify(window.dataLayer || [], (k, v) => (typeof v === "function" || v instanceof Node ? undefined : v))).slice(0, 200); } catch {}
  return { tools: t, dataLayer: dl.length, dlText: JSON.stringify(dl).slice(0, 50000) };
};

// Record analytics calls from here on; keep the click from leaving the page or submitting anything.
const HOOK = (blockLinks) => {
  window.__croEvents = [];
  const clean = (v) => { try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "function" || x instanceof Node ? undefined : x))); } catch { return String(v); } };
  const rec = (tool, a) => window.__croEvents.push({ tool, args: clean([...a]) });
  const wrap = (obj, key, tool) => { try { if (!obj || typeof obj[key] !== "function" || obj[key].__cro) return; const orig = obj[key]; const w = function () { rec(tool, arguments); return orig.apply(this, arguments); }; w.__cro = 1; obj[key] = w; } catch {} };
  if (Array.isArray(window.dataLayer)) wrap(window.dataLayer, "push", "dataLayer");
  wrap(window.posthog, "capture", "posthog"); wrap(window.analytics, "track", "segment"); wrap(window.mixpanel, "track", "mixpanel"); wrap(window.amplitude, "track", "amplitude");
  wrap(window.umami, "track", "umami"); wrap(window.heap, "track", "heap"); wrap(window.fathom, "trackEvent", "fathom"); wrap(window.fathom, "trackGoal", "fathom");
  wrap(window, "plausible", "plausible"); wrap(window, "fbq", "fbq"); wrap(window, "va", "vercel");
  if (Array.isArray(window._paq)) wrap(window._paq, "push", "matomo");
  window.addEventListener("submit", (e) => e.preventDefault(), true);
  if (blockLinks) window.addEventListener("click", (e) => { const a = e.target.closest?.("a[href]"); if (a && !a.getAttribute("href").startsWith("#")) e.preventDefault(); }, true);
  window.open = () => null;
};

// ── helpers ─────────────────────────────────────────────────────────────────
function eventName(c) {
  const a = Array.isArray(c.args) ? c.args : [];
  switch (c.tool) {
    case "dataLayer": { const o = a[0]; if (!o || typeof o !== "object") return null; if (o.event) return String(o.event); if (o["0"] === "event") return String(o["1"]); return null; }
    case "fbq": return /^track/.test(a[0]) ? String(a[1]) : null;
    case "vercel": return a[0] === "event" ? String(a[1]?.name) : null;
    case "matomo": return Array.isArray(a[0]) && a[0][0] === "trackEvent" ? a[0].slice(1, 4).join("/") : null;
    case "amplitude": return String(a[0]?.event_type ?? a[0]);
    default: return a[0] == null ? null : String(a[0]);
  }
}
function beaconNames(b) {
  const s = b.url + "\n" + b.body; const host = (() => { try { return new URL(b.url).host; } catch { return "beacon"; } })(); const names = [];
  for (const m of s.matchAll(/(?:^|[?&\n])en=([^&\n]+)/g)) names.push(decodeURIComponent(m[1]));
  for (const m of s.matchAll(/[?&]ev=([^&\n]+)/g)) names.push(decodeURIComponent(m[1]));
  for (const m of s.matchAll(/"event"\s*:\s*"([^"]+)"/g)) names.push(m[1]);
  if (/plausible/.test(host)) for (const m of s.matchAll(/"n"\s*:\s*"([^"]+)"/g)) names.push(m[1]);
  return names.map((n) => ({ source: host, name: n }));
}
const pick = (o) => (o ? { el: o.el, selector: o.selector, owner: o.owner, classes: o.classes } : {});
const piiIn = (s) => [...new Set((s.match(EMAIL) || []).filter((m) => !/\.(png|jpe?g|svg|webp|gif|avif|js|css|woff2?)$/i.test(m)))];

const statusCache = new Map();
async function statusOf(page, u) {
  if (statusCache.has(u)) return statusCache.get(u);
  let st = null;
  try {
    let r = await page.request.fetch(u, { method: "HEAD", timeout: 8000, maxRedirects: 5, failOnStatusCode: false });
    if ([403, 405, 501].includes(r.status())) r = await page.request.fetch(u, { method: "GET", timeout: 8000, maxRedirects: 5, failOnStatusCode: false });
    st = r.status();
  } catch {}
  statusCache.set(u, st);
  return st;
}

async function watchOverlay(page, ms = WATCH_MS) {
  const start = Date.now(); let first = null, peak = null, last = null;
  while (Date.now() - start < ms) {
    last = await page.evaluate(COVERAGE).catch(() => null);
    if (last) {
      if (!first && last.coverage >= 10) first = last;
      if (!peak || last.coverage > peak.coverage) peak = last;
    }
    await page.waitForTimeout(250);
  }
  return { first, peak, last };
}

const FIX = {
  covered: "don't open anything over the first screen on arrival; if a popup must show, delay it (scroll 25-50 % or exit intent) and keep the CTA reachable",
  intrusive: "show it after a scroll (25-50 %), on exit intent (desktop) or on a click, or make it a small banner (under ~15 % of the screen). Google treats content covered on arrival on phones as an intrusive interstitial. Timing and copy: the cro skill (popups)",
  noClose: "a visible close button (≥ 44 px), Esc closes it, a click outside closes it, focus returns to the page",
  memory: "remember the dismissal (localStorage or a cookie for 7-30 days) and don't show it again on the next page or reload",
  competing: "one filled primary per screen; make the others outline or text buttons. Which action leads is a judgement: the cro skill (`/cro`) picks it from the page's goal",
  generic: "verb + what they get (\"Start free trial\", \"Get my quote\", \"Send my message\"); the cro skill writes alternatives from the page's offer",
  dead: "point it at a real page or section; a button that runs a script is a <button>, not <a href=\"#\">",
  fields: "keep only what the follow-up actually uses (often email alone, or name + email); mark the rest optional or ask later. Which to cut is a judgement: run the cro skill on this form",
  autocomplete: (want) => `autocomplete="${want}" (WCAG 1.3.5: browsers and assistive tech fill and label it); never autocomplete="off" on personal details`,
  keyboard: (want) => `${want}: phones show the right keyboard and offer saved values`,
  password: "a show/hide toggle (button type=\"button\" aria-pressed, switches type between password and text); paste allowed",
  trust: "put one piece of proof by the CTA: a named testimonial, a review score with its count, known logos, or the next step's cost (\"No card required\"). What fits is the cro skill's call",
  noEvent: "fire one named event on the CTA click (GA4: gtag('event', 'cta_click', { location: 'hero' }); PostHog: posthog.capture('cta_clicked', { location }))",
  duplicate: "fire it once: two listeners (an inline handler and a tag, or a tag firing on both click and link click) usually",
  pii: "never put emails or names in event parameters or URLs; send an opaque user id instead (GA4 and most tools forbid PII)",
};

// ── run ─────────────────────────────────────────────────────────────────────
const report = { url, views: {}, analytics: null };

for (const v of VIEWS) {
  const ctx = await newContext(browser, url, v.mobile ? { viewport: { width: v.width, height: v.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE } : { viewport: { width: v.width, height: v.height } });
  await ctx.addInitScript(HELPERS);
  const net = { phase: "load", beacons: [], blocked: [] };
  let main = null;
  ctx.on("page", (p) => { if (main && p !== main) { net.blocked.push(`new tab ${p.url()}`); p.close().catch(() => {}); } });
  if (isHttp) await ctx.route("**/*", (route) => {
    const req = route.request(); const u = req.url();
    if (BEACON.test(u)) { net.beacons.push({ phase: net.phase, url: u.slice(0, 3000), body: (req.postData() || "").slice(0, 6000) }); return route.abort().catch(() => {}); }
    if (net.phase === "click") {
      if (req.isNavigationRequest() && main && req.frame() === main.mainFrame()) { net.blocked.push(`navigation to ${u}`); return route.abort("aborted").catch(() => {}); }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) { net.blocked.push(`${req.method()} ${u}`); return route.abort().catch(() => {}); }
    }
    return route.continue().catch(() => {});
  });
  const page = main = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await settle(page, 500, 4000); await installHelpers(page);
  const ov = await watchOverlay(page);
  const m = await page.evaluate(MEASURE);
  const w = v.width; const n = `${v.name} ${w}:`;
  const view = { ctas: m.ctas.map(({ text, top, inFirst, coveredBy, fill, submit }) => ({ text, top, inFirst, coveredBy, fill, submit })), overlay: null, forms: m.forms.map(({ name, kind, count, required, checks, submit }) => ({ name, kind, count, required, checks, submit })), trust: m.trust };
  report.views[v.name] = view;

  // CTA: position (verdict left to site-review), covered on arrival, competing, vague, dead.
  const first = m.ctas.filter((c) => c.inFirst);
  const lead = first.find((c) => !c.submit) || first[0] || m.ctas.find((c) => !c.submit) || m.ctas[0];
  console.log(`${n} primary CTA ${lead ? `"${lead.text}" at ${lead.top}px (${lead.inFirst ? "in" : "below"} the first screen)` : "none found (a filled button outside the nav)"}; ${first.length} primary-looking in the first screen`);
  const covered = first.find((c) => c.coveredBy);
  if (covered) F.add({ type: "cro-cta-covered", ...pick(covered), detail: `"${covered.text}" is in the first screen but covered on arrival by "${covered.coveredBy}"`, severity: "fail", width: w, fix: FIX.covered });
  const distinct = (list) => [...new Map(list.map((c) => [c.text.toLowerCase(), c])).values()];
  const bySig = new Map(); for (const c of distinct(first)) bySig.set(c.sig, [...(bySig.get(c.sig) || []), c]);
  const same = [...bySig.values()].sort((a, b) => b.length - a.length)[0] || [];
  const all = distinct(first);
  if (same.length >= 2) F.add({ type: "cro-competing-cta", el: "first screen", detail: `${same.length} buttons look equally primary (same fill ${same[0].fill}): ${same.map((c) => `"${c.text}"`).join(", ")}`, severity: "warn", width: w, fix: FIX.competing, extra: { buttons: same.map((c) => c.text) } });
  else if (all.length >= 3) F.add({ type: "cro-competing-cta", el: "first screen", detail: `${all.length} filled buttons compete in the first screen: ${all.map((c) => `"${c.text}"`).join(", ")}`, severity: "warn", width: w, fix: FIX.competing, extra: { buttons: all.map((c) => c.text) } });
  for (const c of m.ctas.filter((c) => !c.submit && GENERIC.test(c.text))) F.add({ type: "cro-generic-cta", ...pick(c), detail: `CTA says "${c.text}": it doesn't say what happens next or what they get`, severity: "warn", width: w, fix: FIX.generic });
  for (const c of m.ctas.filter((c) => c.href != null).slice(0, 20)) {
    const h = c.href.trim(); let problem = null, severity = "fail";
    if (h === "" || h === "#" || /^javascript:/i.test(h)) { problem = `href="${h}": goes nowhere unless a script catches the click`; severity = "warn"; }
    else if (h.startsWith("#")) { const id = decodeURIComponent(h.slice(1)); if (!(await page.evaluate((id) => !!(document.getElementById(id) || document.getElementsByName(id).length), id))) problem = `links to ${h}, which isn't on the page`; }
    else if (/^(mailto|tel|sms):/i.test(h)) {}
    else if (c.abs?.startsWith("file:")) { let p = null; try { p = fileURLToPath(c.abs.split("#")[0].split("?")[0]); } catch {} if (p && !existsSync(p)) problem = `links to ${h}, which doesn't exist`; }
    else if (/^https?:/.test(c.abs || "")) { const st = await statusOf(page, c.abs.split("#")[0]); if (st >= 400) problem = `links to ${h}, which answers HTTP ${st}`; }
    if (problem) F.add({ type: "cro-dead-cta", ...pick(c), detail: `"${c.text}" ${problem}`, severity, width: w, fix: FIX.dead });
  }

  // Overlays on arrival: judged at phone width (Google's rule is about phones); recorded at both.
  const pk = ov.peak && ov.peak.coverage >= 10 ? ov.peak : null;
  if (pk) {
    const o = pk.overlays.find((x) => !x.cookie) || pk.overlays[0];
    const at = ov.first ? (ov.first.now / 1000).toFixed(1) : null;
    view.overlay = { coverage: pk.coverage, label: o?.label, appearedAt: at ? Number(at) : null };
    console.log(`${n} an overlay covers ${pk.coverage}% of the first screen ("${o?.label}")${at ? `, there ${at} s after the page started loading` : ""}`);
    if (v.mobile && pk.coverage >= 30) {
      const close = await page.evaluate(CLOSE_CONTROL).catch(() => null);
      await page.keyboard.press("Escape"); await page.waitForTimeout(450);
      let now = await page.evaluate(COVERAGE).catch(() => null);
      const esc = now && now.coverage < 10;
      if (!esc && close) { await page.locator("[data-cro-close]").first().click({ timeout: 2000, force: true }).catch(() => {}); await page.waitForTimeout(450); now = await page.evaluate(COVERAGE).catch(() => null); }
      const closed = now && now.coverage < 10;
      Object.assign(view.overlay, { escCloses: esc, close, closed });
      F.add({ type: "cro-popup-intrusive", ...pick(o), detail: `covers ${pk.coverage}% of the ${v.width}×${v.height} first screen ${at ? `${at} s after the page starts loading` : "on arrival"}; ${esc ? "Esc closes it" : "Esc does nothing"}${close ? `, close button ${close.w}×${close.h}px` : ", no close button found"}`, severity: "fail", width: w, fix: FIX.intrusive, extra: { coverage: pk.coverage, appearedAt: at ? Number(at) : null } });
      if (!esc && !close) F.add({ type: "cro-popup-no-close", ...pick(o), detail: "neither Esc nor a visible close button closes it", severity: "fail", width: w, fix: FIX.noClose });
      if (closed) {
        await page.reload({ waitUntil: "load", timeout: 60_000 }); await settle(page, 500, 4000); await installHelpers(page);
        const again = await watchOverlay(page);
        view.overlay.backAfterReload = !!(again.peak && again.peak.coverage >= 30);
        if (view.overlay.backAfterReload) F.add({ type: "cro-popup-no-memory", ...pick(o), detail: "closed, then back again after a reload", severity: "warn", width: w, fix: FIX.memory });
      }
    }
  }

  // Forms.
  for (const f of m.forms) {
    console.log(`${n} ${f.kind} form "${f.name}": ${f.count} field(s), ${f.required} required, submit ${f.submit ? `"${f.submit}"` : "none"}`);
    F.add({ type: "cro-form", ...pick(f), detail: `${f.kind} form: ${f.count} field(s), ${f.required} required${f.checks ? `, ${f.checks} checkbox(es)` : ""}; submit ${f.submit ? `"${f.submit}"` : "button: none"}`, severity: "info", width: w });
    if ((f.kind === "lead" || f.kind === "signup") && f.count > 3) F.add({ type: "cro-form-fields", ...pick(f), detail: `${f.count} fields on a ${f.kind} form (${f.required} required); each field past the first few costs completions`, severity: "warn", width: w, fix: FIX.fields });
    if (f.submit && GENERIC.test(f.submit)) F.add({ type: "cro-generic-cta", ...pick(f.submitDesc), detail: `form submit says "${f.submit}": it doesn't say what happens next`, severity: "warn", width: w, fix: FIX.generic });
    for (const x of f.fields) {
      if (x.ac) F.add({ type: "cro-autocomplete", ...pick(x), detail: x.ac.wrong ? `${x.purpose} field has autocomplete="${x.ac.had}" (wrong token)` : `${x.purpose} field ${x.ac.had ? `has autocomplete="${x.ac.had}"` : "has no autocomplete"}`, severity: "fail", width: w, fix: FIX.autocomplete(x.ac.want), extra: { wcag: "1.3.5", who: "people with motor or memory impairments, and everyone filling it on a phone (no autofill)" } });
      if (x.kb) F.add({ type: "cro-input-type", ...pick(x), detail: x.kb.detail, severity: x.kb.severity, width: w, fix: FIX.keyboard(x.kb.want) });
      if (x.pw && !x.pw.toggle) F.add({ type: "cro-password-toggle", ...pick(x), detail: "password field without a show/hide toggle", severity: "info", width: w, fix: FIX.password });
    }
  }

  // Trust near the main CTA (information for the Look step).
  if (m.trust) {
    F.add({ type: "cro-trust", el: `near "${m.trust.cta}"`, detail: m.trust.found.length ? `within 450px of the CTA: ${m.trust.found.join(", ")}` : "nothing within 450px of the CTA: no testimonial, rating, customer count, logo row or reassurance line", severity: "info", width: w, ...(m.trust.found.length ? {} : { fix: FIX.trust }) });
  }

  // Analytics: once, at desktop, after any arrival popup is closed.
  if (!v.mobile) {
    await dismissPopups(page);
    const tools = await page.evaluate(TOOLS).catch(() => ({ tools: [], dataLayer: 0, dlText: "[]" }));
    const target = m.ctas.find((c) => c.inFirst && !c.submit) || m.ctas.find((c) => !c.submit);
    const a = { tools: tools.tools, dataLayerAtLoad: tools.dataLayer, clicked: null, events: [], blocked: [], note: null };
    report.analytics = a;
    let piiText = tools.dlText + "\n" + net.beacons.map((b) => b.url + "\n" + b.body).join("\n");
    if (!target) a.note = m.ctas.length ? "the only primary-looking buttons submit forms: not clicked (forms are never submitted)" : "no primary CTA to click";
    else {
      await page.evaluate(HOOK, !isHttp).catch(() => {});
      const before = net.beacons.length; const startUrl = page.url();
      net.phase = "click";
      await page.locator(`[data-cro-cta="${target.i}"]`).click({ timeout: 3000 }).catch((e) => { a.note = `click failed: ${String(e.message).split("\n")[0]}`; });
      await page.waitForTimeout(1500);
      net.phase = "after";
      const calls = await page.evaluate(() => window.__croEvents || []).catch(() => []);
      const beacons = net.beacons.slice(before);
      a.clicked = target.text; a.blocked = net.blocked.slice(0, 10);
      if (page.url() !== startUrl && !/#/.test(page.url())) a.note = `the click navigated to ${page.url()} (events after it may be missing)`;
      a.events = [...calls.map((c) => ({ source: c.tool, name: eventName(c) })), ...beacons.flatMap(beaconNames)].filter((e) => e.name && e.name !== "undefined");
      piiText += "\n" + JSON.stringify(calls) + "\n" + beacons.map((b) => b.url + "\n" + b.body).join("\n");
      const conv = a.events.filter((e) => !PAGEVIEW.test(e.name) && !/^gtm\./.test(e.name));
      if (a.tools.length && !conv.length) F.add({ type: "cro-analytics-no-event", ...pick(target), detail: `clicking "${target.text}" sends no named event to ${a.tools.join(", ")}${a.events.length ? ` (only ${[...new Set(a.events.map((e) => e.name))].join(", ")})` : ""}`, severity: "warn", width: w, fix: FIX.noEvent });
      const counts = new Map(); for (const e of conv) { const k = `${e.source}|${e.name}`; counts.set(k, (counts.get(k) || 0) + 1); }
      for (const [k, c] of counts) if (c > 1) { const [source, name] = k.split("|"); F.add({ type: "cro-analytics-duplicate", ...pick(target), detail: `one click on "${target.text}" sends "${name}" ${c} times (${source})`, severity: "warn", width: w, fix: FIX.duplicate }); }
    }
    const pii = piiIn(piiText);
    if (pii.length) F.add({ type: "cro-analytics-pii", el: "analytics payloads", detail: `${pii.length} email address(es) in analytics data, e.g. ${pii[0].replace(/^(.).*@/, "$1…@")}`, severity: "fail", width: w, fix: FIX.pii });
    const ev = a.events.length ? [...new Map(a.events.map((e) => [`${e.source}|${e.name}`, e])).values()].map((e) => `${e.source}: ${e.name}`).join(", ") : "nothing";
    const summary = a.tools.length ? `${a.tools.join(", ")}${a.clicked ? `; clicking "${a.clicked}" sent ${ev}` : ""}${a.note ? ` (${a.note})` : ""}` : `no analytics found, so conversions can't be measured${a.note ? ` (${a.note})` : ""}`;
    console.log(`${n} analytics: ${summary}`);
    F.add({ type: "cro-analytics", el: "analytics", detail: summary, severity: "info", width: w });
  }
  await ctx.close();
}
await browser.close();

const res = F.print();
console.log("(not repeated here: CTA position and no CTA → site-review.mjs; labels, placeholder labels, inputs under 16px, silent submits → interaction-check.mjs)");
F.write(out, { ...report, seconds: Math.round((Date.now() - t0) / 1000) });
console.log(`${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(res.fails ? 1 : 0);
