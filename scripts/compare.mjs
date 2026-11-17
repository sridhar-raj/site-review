#!/usr/bin/env node
// compare.mjs: before vs after.
//
//   node compare.mjs .review/before/layout.json .review/after/layout.json     findings: fixed, still there, new
//   node compare.mjs .review/before .review/after [--allow 320-430]            every check in both folders, plus
//                                                                              the snapshots, pixel by pixel
//
// Findings: a fix is kept only when its finding is gone and nothing new appeared.
// Snapshots: each width's change is measured (cells that changed by themselves in either run are ignored) and
// the changed regions are outlined in <after>/snapshots/diff-<width>.png. A fix for one range of widths must
// not change the others: with --allow 320-430 (or 390,768), any change outside the allowed widths fails.
//
// Exit code 1 when anything new appeared or a width outside --allow changed.

import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const [a, b] = args.filter((x, i) => !x.startsWith("--") && args[i - 1] !== "--allow");
if (!a || !b) { console.error("usage: compare.mjs <before.json|dir> <after.json|dir> [--allow 320-430]"); process.exit(2); }
let bad = false;

function compareFindings(fa, fb) {
  const before = JSON.parse(readFileSync(fa, "utf8")), after = JSON.parse(readFileSync(fb, "utf8"));
  const keys = (r) => new Map(r.findings.map((f) => [f.key, f]));
  const B = keys(before), A = keys(after);
  const fixed = [...B.values()].filter((f) => !A.has(f.key));
  const still = [...A.values()].filter((f) => B.has(f.key));
  const added = [...A.values()].filter((f) => !B.has(f.key) && f.severity !== "info");
  const line = (f) => `${f.severity.toUpperCase().padEnd(5)} ${f.type}: ${f.el ?? ""}${f.count > 1 ? ` (+${f.count - 1})` : ""}${f.detail ? ` — ${f.detail}` : ""}`;
  console.log(`\n${before.check}: ${B.size} before → ${A.size} after`);
  if (fixed.length) { console.log(`✓ fixed (${fixed.length})`); fixed.forEach((f) => console.log("  " + line(f))); }
  if (added.length) { console.log(`✗ new (${added.length}) — a fix broke something, or the page changed`); added.forEach((f) => console.log("  " + line(f))); bad = true; }
  if (still.length) { console.log(`· still there (${still.length})`); still.forEach((f) => console.log("  " + line(f))); }
  if (before.medians && after.medians) {
    console.log("\nmetric      before    after");
    for (const k of ["ttfb", "fcp", "lcp", "cls", "tbt", "kb", "requests"]) {
      const x = before.medians[k], y = after.medians[k]; if (x == null && y == null) continue;
      const fmt = (v) => (v == null ? "—" : k === "cls" ? String(v) : String(Math.round(v)));
      const better = y != null && x != null && (y < x * 0.9 || (k === "cls" && y < x - 0.02)) ? "  better" : y != null && x != null && (y > x * 1.1 || (k === "cls" && y > x + 0.02)) ? "  WORSE" : "";
      console.log(`${k.padEnd(10)} ${fmt(x).padStart(7)}  ${fmt(y).padStart(7)}${better}`);
    }
    if (before.mode !== after.mode) console.log(`\nwarning: different measurement settings (${before.mode} vs ${after.mode}); the numbers are not comparable`);
  }
}

function allowed(w) {
  const spec = flag("--allow"); if (!spec) return null;
  return spec.split(",").some((p) => { const [lo, hi] = p.split("-").map(Number); return hi ? w >= lo && w <= hi : w === lo; });
}

async function compareSnapshots(da, db) {
  const sa = JSON.parse(readFileSync(join(da, "snapshots.json"), "utf8")), sb = JSON.parse(readFileSync(join(db, "snapshots.json"), "utf8"));
  const { loadChromium, diffImages, cellBoxes } = await import("./lib.mjs");
  const { chromium } = loadChromium();
  const browser = await chromium.launch(); const page = await browser.newPage();
  console.log("\nsnapshots: what changed on screen");
  for (const shot of sb.shots) {
    const prev = sa.shots.find((s) => s.width === shot.width);
    if (!prev) { console.log(`  ${shot.width}px: no before shot`); continue; }
    const ignore = [...new Set([...(prev.noise || []), ...(shot.noise || [])])];
    const d = await diffImages(page, readFileSync(join(da, prev.file)), readFileSync(join(db, shot.file)), { overlay: true, ignore });
    const pct = Math.round(d.share * 10000) / 100;
    const grew = d.after[1] - d.before[1];
    const changed = (d.cells.length > 0 && d.share > 0.0002) || grew !== 0;
    const ok = allowed(shot.width);
    let verdict = changed ? "changed" : "same";
    if (changed && ok === false) { verdict = "CHANGED outside --allow"; bad = true; }
    let where = "";
    if (changed && d.png) {
      writeFileSync(join(db, "snapshots", `diff-${shot.width}.png`), Buffer.from(d.png, "base64"));
      where = " · " + cellBoxes(d.cells).slice(0, 3).map((r) => `${r.width}×${r.height} at ${r.x},${r.y}`).join("; ") + ` · snapshots/diff-${shot.width}.png`;
    }
    console.log(`  ${String(shot.width).padStart(5)}px: ${verdict}${changed ? ` (${pct}% of pixels${grew ? `, page ${grew > 0 ? "+" : ""}${grew}px tall` : ""})` : ""}${where}`);
  }
  await browser.close();
}

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
if (isDir(a) && isDir(b)) {
  // Same site? The page's own files carry version stamps (?v=…, hashed names): a change means the site was
  // redeployed between the two runs, so "fixed" may be someone else's change and "new" may be theirs too.
  try {
    const va = JSON.parse(readFileSync(join(a, "overview.json"), "utf8")).assets || [], vb = JSON.parse(readFileSync(join(b, "overview.json"), "utf8")).assets || [];
    if (va.length && vb.length && va.join() !== vb.join()) console.log(`note: the page's files changed between the two runs (${vb.filter((x) => !va.includes(x)).slice(0, 3).join(", ")}): it was redeployed, so not every difference below comes from your fixes`);
  } catch {}
  for (const f of ["overview.json", "layout.json", "interaction.json", "perf.json"]) if (existsSync(join(a, f)) && existsSync(join(b, f))) compareFindings(join(a, f), join(b, f));
  if (existsSync(join(a, "snapshots.json")) && existsSync(join(b, "snapshots.json"))) await compareSnapshots(a, b);
} else compareFindings(a, b);
process.exit(bad ? 1 : 0);
