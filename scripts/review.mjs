#!/usr/bin/env node
// review.mjs: run every check on one URL (or a crawl of a site) into one folder.
//
//   node review.mjs <url | file.html> [--out .review/before] [--only overview,layout,interaction,perf,snapshots]
//        [--runs 3] [--step 40] [--hero] [--kind auto|site|app] [--crawl 5] [--perf-all] [--field] [--motion]
//        [--storage state.json] [--cookie "a=1"] [--scheme dark]
//
// overview → site-review.mjs (screenshots, contrast, SEO, popups, template tells) · layout → layout-check.mjs
// interaction → interaction-check.mjs · perf → perf-check.mjs · snapshots → snapshots.mjs (for compare.mjs)
//
// --crawl N   also review up to N more pages of the same site, found in the page's nav, header, footer and
//             main links (same origin, no files or hashes). Each page gets its own folder; perf runs on the
//             first page only unless --perf-all.
// --storage / --cookie   review signed-in pages (save a session with login.mjs).
// --serial    run the checks one at a time (default: up to 4 side by side, perf always alone).

import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, outDir, loadChromium, newContext } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { opt, has, target } = parseArgs(["--out", "--only", "--runs", "--step", "--kind", "--crawl"]);
if (!target) { console.error("usage: review.mjs <url | file.html> [--out .review/before] [--only overview,layout,interaction,perf,snapshots] [--runs 3] [--step 40] [--hero] [--kind auto|site|app] [--crawl 5] [--storage state.json] [--cookie a=1] [--scheme dark]"); process.exit(2); }
const root = outDir(opt("--out", ".review/before"));
const only = opt("--only", "overview,layout,interaction,perf,snapshots").split(",");
const session = ["--storage", "--cookie", "--scheme"].flatMap((f) => (opt(f) ? [f, opt(f)] : []));
const t0 = Date.now();

// Pages: the target, plus a crawl of its own links.
const pages = [target];
const crawl = Number(opt("--crawl", 0)) || 0;
if (crawl > 0 && /^https?:/.test(target)) {
  const { chromium } = loadChromium(); const browser = await chromium.launch();
  const ctx = await newContext(browser, target, { viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  try {
    await p.goto(target, { waitUntil: "load", timeout: 60_000 }); await p.waitForTimeout(800);
    const links = await p.evaluate(() => {
      const seen = new Set([location.pathname.replace(/\/+$/, "") || "/"]); const out = [];
      const pick = [...document.querySelectorAll("nav a[href], header a[href], [role=navigation] a[href], footer a[href], main a[href]")];
      for (const a of pick) {
        let u; try { u = new URL(a.getAttribute("href"), location.href); } catch { continue; }
        if (u.origin !== location.origin || /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|xml|txt)$/i.test(u.pathname) || /logout|sign-?out/i.test(u.pathname)) continue;
        const key = u.pathname.replace(/\/+$/, "") || "/";
        if (seen.has(key)) continue; seen.add(key); out.push(u.origin + u.pathname + u.search);
      }
      return out;
    });
    pages.push(...links.slice(0, crawl));
    console.log(`crawl: ${links.length} same-site link(s) found, reviewing ${Math.min(crawl, links.length)} more: ${links.slice(0, crawl).map((u) => new URL(u).pathname).join(", ")}`);
  } catch (e) { console.log(`crawl failed: ${String(e.message).split("\n")[0]}`); }
  await browser.close();
}

const slug = (u) => { try { return (new URL(u).pathname.replace(/\/+$/, "").replace(/^\//, "") || "home").replace(/[^\w-]+/g, "-"); } catch { return "page"; } };
const all = [];
for (const [pi, page] of pages.entries()) {
  const out = pages.length > 1 ? outDir(join(root, slug(page))) : root;
  if (pages.length > 1) console.log(`\n══ ${page} → ${out}`);
  const steps = [
    ["overview", "site-review.mjs", ["--out", out, "--kind", opt("--kind", "auto"), ...(has("--hero") ? ["--hero"] : [])]],
    ["layout", "layout-check.mjs", ["--out", out, "--step", opt("--step", "40"), ...(has("--motion") ? ["--motion"] : [])]],
    ["interaction", "interaction-check.mjs", ["--out", out]],
    ["perf", "perf-check.mjs", ["--out", out, "--runs", opt("--runs", "3"), ...(has("--field") ? ["--field"] : [])]],
    ["snapshots", "snapshots.mjs", ["--out", out]],
  ];
  const totals = [];
  // The checks that don't measure speed run side by side (each in its own browser; output shown as each
  // finishes); perf runs alone afterwards, so nothing else competes for the CPU while it times the page.
  const run = ([name, script, extra]) => new Promise((done) => {
    const t = Date.now(); let buf = "";
    const child = spawn(process.execPath, [join(here, script), page, ...extra, ...session], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (buf += d)); child.stderr.on("data", (d) => (buf += d));
    child.on("close", (code) => {
      console.log(`\n── ${name} (${Math.round((Date.now() - t) / 1000)} s) ${"─".repeat(Math.max(4, 54 - name.length))}\n${buf.trimEnd()}`);
      const file = join(out, `${name}.json`);
      if (name !== "snapshots" && existsSync(file)) {
        const j = JSON.parse(readFileSync(file, "utf8"));
        totals.push({ check: name, fail: j.findings.filter((f) => f.severity === "fail").length, warn: j.findings.filter((f) => f.severity === "warn").length, axe: j.axe });
      } else if (code === 2) totals.push({ check: name, error: true });
      done();
    });
  });
  const chosen = steps.filter(([name]) => only.includes(name));
  const together = chosen.filter(([name]) => name !== "perf");
  const parallel = has("--serial") ? 1 : 4;
  for (let i = 0; i < together.length; i += parallel) await Promise.all(together.slice(i, i + parallel).map(run));
  const perf = chosen.find(([name]) => name === "perf");
  if (perf && !/^https?:/.test(page)) console.log("\n── perf skipped: needs a URL (serve the file, or a production build)");
  else if (perf && !(pi > 0 && !has("--perf-all"))) await run(perf);
  const order = ["overview", "layout", "interaction", "perf"]; totals.sort((x, y) => order.indexOf(x.check) - order.indexOf(y.check));
  all.push({ page, out, totals });
}

console.log(`\n── summary (${Math.round((Date.now() - t0) / 1000)} s) → ${root}`);
for (const p of all) {
  if (all.length > 1) console.log(p.page);
  for (const t of p.totals) console.log(`${all.length > 1 ? "  " : ""}${t.check.padEnd(12)} ${t.error ? "error" : `${t.fail} fail, ${t.warn} warn`}`);
}
const interaction = all.flatMap((p) => p.totals).find((t) => t.check === "interaction");
if (interaction && interaction.axe === false) console.log("\nNOTE axe is not installed: only the built-in accessibility basics ran. Install @axe-core/playwright for the WCAG rules.");
writeFileSync(join(root, "summary.json"), JSON.stringify({ at: new Date().toISOString(), pages: all }, null, 2));
