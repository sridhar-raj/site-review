#!/usr/bin/env node
// compare.mjs: before vs after for any check's JSON. Says what was fixed, what is still there and what is new,
// so a fix is kept only when its finding is gone and nothing else broke.
//
//   node compare.mjs .review/before/layout.json .review/after/layout.json
//
// Exit code 1 when anything new appeared (a regression), so it can gate a fix loop.

import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: compare.mjs <before.json> <after.json>"); process.exit(2); }
const before = JSON.parse(readFileSync(a, "utf8")), after = JSON.parse(readFileSync(b, "utf8"));
const keys = (r) => new Map(r.findings.map((f) => [f.key, f]));
const B = keys(before), A = keys(after);
const fixed = [...B.values()].filter((f) => !A.has(f.key));
const still = [...A.values()].filter((f) => B.has(f.key));
const added = [...A.values()].filter((f) => !B.has(f.key));
const line = (f) => `${f.severity.toUpperCase().padEnd(5)} ${f.type}: ${f.el ?? ""}${f.count > 1 ? ` (+${f.count - 1})` : ""}${f.detail ? ` — ${f.detail}` : ""}`;
console.log(`${before.check}: ${B.size} before → ${A.size} after`);
if (fixed.length) { console.log(`\n✓ fixed (${fixed.length})`); fixed.forEach((f) => console.log("  " + line(f))); }
if (added.length) { console.log(`\n✗ new (${added.length}) — a fix broke something, or the page changed`); added.forEach((f) => console.log("  " + line(f))); }
if (still.length) { console.log(`\n· still there (${still.length})`); still.forEach((f) => console.log("  " + line(f))); }
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
process.exit(added.length ? 1 : 0);
