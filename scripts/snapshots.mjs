#!/usr/bin/env node
// snapshots.mjs: full-page screenshots at fixed widths, so a fix can be checked for what it changed visually,
// not only for which findings went away. compare.mjs <before-dir> <after-dir> diffs two runs.
//
//   node snapshots.mjs <url | file.html> [--out .review/before] [--widths 390,768,1440] [--mask ".clock,.ticker"]
//        [--max-height 6000]
//
// Each width is shot twice, 1.5 s apart, after the page settles with animations stopped and reduced motion on.
// Cells that change between the two shots by themselves (clocks, "updated just now", carousels, video) are
// saved as noise and ignored by the compare. --mask hides elements you already know change.

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { newContext, parseArgs, toUrl, loadChromium, outDir, settle, dismissPopups, diffImages } from "./lib.mjs";

const { opt, target } = parseArgs(["--out", "--widths", "--mask", "--max-height"]);
if (!target) { console.error("usage: snapshots.mjs <url | file.html> [--out .review/before] [--widths 390,768,1440] [--mask sel,sel] [--max-height 6000]"); process.exit(2); }
const url = toUrl(target);
const out = outDir(opt("--out", ".review"));
const dir = join(out, "snapshots"); mkdirSync(dir, { recursive: true });
const widths = opt("--widths", "390,768,1440").split(",").map(Number).filter((n) => n >= 200);
const mask = opt("--mask", "");
const maxH = Number(opt("--max-height", 6000)) || 6000;
const { chromium } = loadChromium();
const browser = await chromium.launch();
const t0 = Date.now();
const shots = [];

// Freeze what can be frozen: CSS animations and transitions, carets, smooth scrolling, autoplaying video.
const FREEZE = `*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

for (const w of widths) {
  const h = w < 600 ? 844 : 900;
  const ctx = await newContext(browser, url, { viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: "reduce", isMobile: w < 600, hasTouch: w < 600 });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await settle(page);
    await dismissPopups(page);
    await page.addStyleTag({ content: FREEZE + (mask ? `${mask}{visibility:hidden!important}` : "") });
    await page.evaluate(() => { for (const v of document.querySelectorAll("video")) { try { v.pause(); v.currentTime = 0; } catch {} } });
    // Lazy content in: scroll through once, back to the top.
    await page.evaluate(async () => { const end = Math.min(document.documentElement.scrollHeight, 8000); for (let y = 0; y < end; y += innerHeight * 0.8) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 300)); });
    const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), maxH);
    const shoot = () => page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: w, height }, animations: "disabled", caret: "hide" });
    const a = await shoot();
    await page.waitForTimeout(1500);
    const b = await shoot();
    const noise = await diffImages(page, a, b);
    const file = `${w}.png`;
    writeFileSync(join(dir, file), b);
    shots.push({ width: w, file: `snapshots/${file}`, height, noise: noise.cells });
    console.log(`snapshot ${w}px: ${height}px tall${noise.cells.length ? `, ${noise.cells.length} cell(s) change by themselves (ignored when comparing)` : ""}`);
  } catch (e) { console.log(`snapshot ${w}px failed: ${String(e.message).split("\n")[0]}`); }
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, "snapshots.json"), JSON.stringify({ check: "snapshots", url, at: new Date().toISOString(), mask, shots }, null, 2));
console.log(`→ ${join(out, "snapshots.json")} · ${Math.round((Date.now() - t0) / 1000)} s`);
