#!/usr/bin/env node
// review.mjs: run every check on one URL into one folder.
//
//   node review.mjs <url | file.html> [--out .review/before] [--only overview,layout,interaction,perf]
//        [--runs 3] [--step 40] [--hero]
//
// overview → site-review.mjs (screenshots: first screen, sections, full page; SEO, popups, template tells)
// layout → layout-check.mjs · interaction → interaction-check.mjs · perf → perf-check.mjs
// Each writes its JSON next to the others; a summary of fails and warns is printed at the end.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, outDir } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { opt, has, target } = parseArgs(["--out", "--only", "--runs", "--step"]);
if (!target) { console.error("usage: review.mjs <url | file.html> [--out .review/before] [--only overview,layout,interaction,perf] [--runs 3] [--step 40] [--hero]"); process.exit(2); }
const out = outDir(opt("--out", ".review/before"));
const only = opt("--only", "overview,layout,interaction,perf").split(",");
const steps = [
  ["overview", "site-review.mjs", ["--out", out, ...(has("--hero") ? ["--hero"] : [])]],
  ["layout", "layout-check.mjs", ["--out", out, "--step", opt("--step", "40")]],
  ["interaction", "interaction-check.mjs", ["--out", out]],
  ["perf", "perf-check.mjs", ["--out", out, "--runs", opt("--runs", "3")]],
];
const t0 = Date.now(); const totals = [];
for (const [name, script, extra] of steps) {
  if (!only.includes(name)) continue;
  if (name === "perf" && !/^https?:/.test(target)) { console.log("\n── perf skipped: needs a URL (serve the file, or a production build)"); continue; }
  console.log(`\n── ${name} ${"─".repeat(Math.max(4, 60 - name.length))}`);
  const r = spawnSync(process.execPath, [join(here, script), target, ...extra], { stdio: "inherit" });
  const file = join(out, `${name}.json`);
  if (name !== "overview" && existsSync(file)) {
    const j = JSON.parse(readFileSync(file, "utf8"));
    totals.push([name, j.findings.filter((f) => f.severity === "fail").length, j.findings.filter((f) => f.severity === "warn").length]);
  } else if (r.status === 2) totals.push([name, "error", ""]);
}
console.log(`\n── summary (${Math.round((Date.now() - t0) / 1000)} s) → ${out}`);
for (const [n, f, w] of totals) console.log(`${n.padEnd(12)} ${f} fail, ${w} warn`);
