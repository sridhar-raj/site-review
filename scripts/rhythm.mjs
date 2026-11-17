#!/usr/bin/env node
// rhythm.mjs: the vertical rhythm between sections, measured as a person sees it.
//
//   node rhythm.mjs <url | file.html> [more urls…] [--widths 390,768,1440] [--tolerance 8]
//
// Measures the visible gap between consecutive sections (main > section…, footer): from the last painted
// content of one to the first painted content of the next. A section with its own background (a band, an
// image) counts from its edge. Reports every gap and flags the ones that differ from the page's usual gap by
// more than the tolerance.
//
// Why: in the Arcline review the gaps ran from 80 to 224px. Some sections padded top and bottom (py-28) and
// others only the bottom, so two py sections met at double the gap; a band with a background needed padding
// inside and the section after it padding on top. The fix that held: one token (--section-gap) as each
// section's bottom padding only, padding on both sides inside bands, and the page footer without its own top.
// Notes: run after scrolling (done here) so entrance animations aren't counted as offsets; absolutely
// positioned decoration and content clipped inside a panel are ignored.

import { parseArgs, toUrl, loadChromium, newContext, settle, dismissPopups } from "./lib.mjs";

const { opt, argv } = parseArgs(["--widths", "--tolerance"]);
// every flag here takes a value, so a positional argument is anything not a flag and not right after one
const targets = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").startsWith("--"));
if (!targets.length) { console.error("usage: rhythm.mjs <url | file.html> [more…] [--widths 390,768,1440] [--tolerance 8]"); process.exit(2); }
const widths = opt("--widths", "390,768,1440").split(",").map(Number);
const tol = Number(opt("--tolerance", 8));
const { chromium } = loadChromium();
const browser = await chromium.launch();
let flagged = 0;

for (const t of targets) {
  const url = toUrl(t);
  for (const w of widths) {
    const ctx = await newContext(browser, url, { viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await settle(page); await dismissPopups(page);
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
    await page.waitForTimeout(800);
    const gaps = await page.evaluate(() => {
      // page sections only: sections inside an <article> are the document's own parts (a legal page, a post)
      const secs = [...document.querySelectorAll("main section, footer")].filter((s) => !s.parentElement.closest("main section, article") && s.getBoundingClientRect().height > 0);
      const paper = getComputedStyle(document.body).backgroundColor;
      const own = (s) => { const cs = getComputedStyle(s); return (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== paper) || cs.backgroundImage !== "none" || !!s.querySelector(":scope > img, :scope > picture"); };
      const box = (s) => {
        const sr = s.getBoundingClientRect();
        if (own(s)) return { top: sr.top + scrollY, bottom: sr.bottom + scrollY };
        let top = Infinity, bottom = -Infinity;
        for (const el of s.querySelectorAll("*")) {
          const cs = getComputedStyle(el); if (cs.position === "absolute" || cs.position === "fixed" || cs.visibility === "hidden") continue;
          let clipped = false; for (let x = el.parentElement; x && x !== s; x = x.parentElement) { const o = getComputedStyle(x).overflow; if (o !== "visible") { clipped = true; break; } }
          if (clipped) continue;
          const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
          top = Math.min(top, r.top + scrollY); bottom = Math.max(bottom, r.bottom + scrollY);
        }
        return { top, bottom };
      };
      const name = (s) => s.getAttribute("aria-labelledby") || s.id || s.querySelector("h1,h2")?.textContent.trim().slice(0, 28) || s.tagName.toLowerCase();
      const out = [];
      for (let i = 0; i < secs.length - 1; i++) { const a = box(secs[i]), b = box(secs[i + 1]); if (isFinite(a.bottom) && isFinite(b.top)) out.push([name(secs[i]), name(secs[i + 1]), Math.round(b.top - a.bottom)]); }
      return out;
    });
    if (!gaps.length) { console.log(`\n${url} @ ${w}px: no top-level sections to measure (one-block page, or sections are divs)`); await ctx.close(); continue; }
    const pos = gaps.map((g) => g[2]).filter((g) => g > 0).sort((a, b) => a - b);
    const usual = pos[Math.floor(pos.length / 2)] ?? 0;
    console.log(`\n${url} @ ${w}px (usual gap ${usual}px)`);
    for (const [a, b, g] of gaps) { const off = g > 0 && Math.abs(g - usual) > tol; if (off) flagged++; console.log(`  ${off ? "✗" : "·"} ${a} → ${b}: ${g}px${g <= 0 ? " (overlaps: a hero or a panel running into the next section, check the picture)" : ""}`); }
    await ctx.close();
  }
}
console.log(flagged ? `\n${flagged} gap(s) off the page's rhythm` : "\nrhythm even");
await browser.close();
