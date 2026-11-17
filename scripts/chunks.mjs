#!/usr/bin/env node
// chunks.mjs: the pixel pass. Every page, at every width, in screen-sized pieces you look at one by one.
//
//   node chunks.mjs <url | file.html> [more urls…] [--out .review/chunks] [--widths 320,390,768,1440] [--storage s.json]
//
// Why: in the Arcline review the automated checks were clean while a person still found ~30 small defects one
// screenshot at a time (a label wrapping inside a pill, an empty column at 768, a stray arc of a clipped tag,
// an icon not centred on its text). Those are only seen by looking. This makes the looking complete:
//   - it scrolls the page slowly first, so scroll-triggered entrance animations have all run (a full-page
//     screenshot taken without scrolling shows blank sections and half-faded cards: false alarms);
//   - it then scrolls to each screen-height chunk and captures it as a person sees it (sticky header included);
//   - 768 is in the default widths on purpose: tablet is where grid flow breaks and nobody looks.
// Writes <out>/<page>/<width>-<n>.png and an index.md listing every image to open. Open every one.

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { newContext, parseArgs, toUrl, loadChromium, outDir, settle, dismissPopups } from "./lib.mjs";

const { opt, argv } = parseArgs(["--out", "--widths", "--storage"]);
// every flag here takes a value, so a positional argument is anything not a flag and not right after one
const targets = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").startsWith("--"));
if (!targets.length) { console.error("usage: chunks.mjs <url | file.html> [more…] [--out .review/chunks] [--widths 320,390,768,1440]"); process.exit(2); }
const out = outDir(opt("--out", ".review/chunks"));
const widths = opt("--widths", "320,390,768,1440").split(",").map(Number).filter((n) => n >= 200);
const { chromium } = loadChromium();
const browser = await chromium.launch();
const index = ["# Pixel pass", "", "Open every image. Look for: text cut, wrapping a word per line or inside a pill/button; overlaps;",
  "a clipped ring, tag or border (a stray arc); invisible text; edges of stacked elements that don't line up;",
  "an empty column or a lone card; uneven gaps; an icon or number not centred on its text; a page wider than the screen.",
  "Widths marked SIDEWAYS scroll horizontally; CONSOLE marks errors.", ""];

for (const t of targets) {
  const url = toUrl(t);
  const name = (new URL(url).pathname.replace(/\/$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home").slice(0, 60);
  const dir = join(out, name); mkdirSync(dir, { recursive: true });
  index.push(`## ${url}`);
  for (const w of widths) {
    const h = w < 600 ? 844 : w < 1024 ? 1024 : 900;
    const ctx = await newContext(browser, url, { viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 600, hasTouch: w < 600, ...(opt("--storage") ? { storageState: opt("--storage") } : {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      await settle(page);
      await dismissPopups(page);
      // slow pass so every in-view animation fires once
      await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } });
      await page.waitForTimeout(800);
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const files = [];
      for (let y = 0, n = 0; y < H; y += h, n++) {
        await page.evaluate((yy) => scrollTo(0, yy), y);
        // wait until the scroll has stopped and nothing on screen is mid-fade (a fixed pause caught reveals half-way)
        await page.evaluate(() => new Promise((done) => {
          const t0 = performance.now(); let last = scrollY, still = 0;
          const fading = () => [...document.querySelectorAll("body *")].some((e) => { const r = e.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.width < 2) return false; const o = +getComputedStyle(e).opacity; return o > 0.05 && o < 0.95; });
          const tick = () => { if (scrollY === last) still++; else { still = 0; last = scrollY; } if ((still >= 3 && !fading()) || performance.now() - t0 > 1800) done(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        }));
        const f = `${w}-${String(n).padStart(2, "0")}.png`;
        await page.screenshot({ path: join(dir, f) });
        files.push(f);
      }
      index.push(`- ${w}px${sw > w ? ` · SIDEWAYS ${sw}px` : ""}${errors.length ? ` · CONSOLE ${errors[0]}` : ""}: ${files.map((f) => `${name}/${f}`).join(", ")}`);
    } catch (e) { index.push(`- ${w}px: failed (${e.message.slice(0, 100)})`); }
    await ctx.close();
  }
  index.push("");
}
writeFileSync(join(out, "index.md"), index.join("\n"));
console.log(`pixel pass → ${join(out, "index.md")}`);
await browser.close();
