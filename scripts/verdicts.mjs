#!/usr/bin/env node
// verdicts.mjs: record whether each finding was real, and measure how often each check is right.
//
//   node verdicts.mjs list <findings.json>                         numbered findings
//   node verdicts.mjs mark <findings.json> 1,3,4 real [--note "…"]
//   node verdicts.mjs mark <findings.json> 2 false --note "pill behind the text"
//   node verdicts.mjs report                                       precision per finding type, worst first
//
// Verdicts are kept in <skill>/calibration/verdicts.jsonl, across every project the skill reviews, so the
// numbers grow with use. A type that is often wrong is a check to fix (or a threshold to tune), and its
// findings deserve a second look before they reach a report.

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const store = join(dirname(fileURLToPath(import.meta.url)), "..", "calibration", "verdicts.jsonl");
const [cmd, file, which, verdict] = process.argv.slice(2);
const note = (() => { const i = process.argv.indexOf("--note"); return i >= 0 ? process.argv[i + 1] : ""; })();
const order = { fail: 0, warn: 1, info: 2 };
const load = (f) => { const j = JSON.parse(readFileSync(f, "utf8")); return { j, list: [...j.findings].sort((a, b) => order[a.severity] - order[b.severity]) }; };

if (cmd === "list" && file) {
  const { list } = load(file);
  list.forEach((f, i) => console.log(`${String(i + 1).padStart(3)}. ${f.severity.padEnd(4)} ${f.type}: ${f.el ?? ""}${f.detail ? ` — ${f.detail.slice(0, 100)}` : ""}`));
} else if (cmd === "mark" && file && which && /^(real|false)$/.test(verdict || "")) {
  const { j, list } = load(file);
  const site = (() => { try { const u = new URL(j.url); return u.host + u.pathname; } catch { return j.url || ""; } })();
  mkdirSync(dirname(store), { recursive: true });
  for (const n of which.split(",").map(Number)) {
    const f = list[n - 1]; if (!f) { console.error(`no finding ${n}`); continue; }
    appendFileSync(store, JSON.stringify({ at: new Date().toISOString().slice(0, 10), site, check: j.check, type: f.type, el: f.el, detail: f.detail, verdict, note }) + "\n");
    console.log(`${verdict === "real" ? "✓" : "✗"} ${f.type}: ${f.el}`);
  }
} else if (cmd === "report") {
  if (!existsSync(store)) { console.log("no verdicts yet: mark findings with `verdicts.mjs mark` while reviewing"); process.exit(0); }
  const rows = readFileSync(store, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const by = new Map();
  for (const r of rows) { const k = r.type; if (!by.has(k)) by.set(k, { real: 0, false: 0, notes: [] }); const b = by.get(k); b[r.verdict]++; if (r.verdict === "false" && r.note) b.notes.push(r.note); }
  const list = [...by].map(([type, b]) => ({ type, ...b, n: b.real + b.false, p: b.real / (b.real + b.false) })).sort((a, b) => a.p - b.p || b.n - a.n);
  console.log(`${rows.length} verdicts on ${new Set(rows.map((r) => r.site)).size} page(s)\n\nprecision  real/all  type`);
  for (const t of list) console.log(`${(Math.round(t.p * 100) + "%").padStart(9)}  ${String(t.real).padStart(4)}/${String(t.n).padEnd(4)} ${t.type}${t.n >= 3 && t.p < 0.8 ? "   ← often wrong: double-check these, then fix the check" : ""}${t.notes.length ? `\n${" ".repeat(21)}false because: ${[...new Set(t.notes)].slice(0, 3).join("; ")}` : ""}`);
} else {
  console.error("usage: verdicts.mjs list <findings.json> | mark <findings.json> <n,n> real|false [--note …] | report");
  process.exit(2);
}
