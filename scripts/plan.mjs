#!/usr/bin/env node
// plan.mjs: turn a review into a list of proposed changes for a person to approve, then report on the
// approved ones after fixing.
//
//   node plan.mjs propose .review/before            → .review/before/changes.md (+ changes.json)
//   node plan.mjs approved .review/before/changes.md  the IDs ticked [x] in the file (or pass --ids C1,C3)
//   node plan.mjs report .review/before .review/after [--ids C1,C3]  → .review/after/done.md
//
// One change per root cause: findings that share a component and classes are already one finding; findings
// of the same kind in the same component are merged into one change. Each change says what is wrong, who
// sees it (widths, how many elements), where it is in the source, the proposed fix, what else the fix could
// touch, and the evidence. Nothing is fixed until its box is ticked (or its ID is approved in chat).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { compactWidths } from "./lib.mjs";

const [cmd, a, b] = process.argv.slice(2).filter((x, i, arr) => !x.startsWith("--") && arr[i - 1] !== "--ids");
const idsFlag = (() => { const i = process.argv.indexOf("--ids"); return i >= 0 ? process.argv[i + 1].split(",").map((s) => s.trim().toUpperCase()) : null; })();
const CHECKS = ["overview", "layout", "interaction", "perf"];
const sev = { fail: 0, warn: 1, info: 2 };
const LABEL = { overview: "Look & content", layout: "Layout", interaction: "Interaction & accessibility", perf: "Speed" };

function load(dir) {
  const out = [];
  for (const c of CHECKS) { const f = join(dir, `${c}.json`); if (existsSync(f)) for (const x of JSON.parse(readFileSync(f, "utf8")).findings) out.push({ ...x, check: c }); }
  return out;
}

function propose(dir) {
  const all = load(dir).filter((f) => f.severity !== "info");
  // Merge: same check, same type, same component (or same classes when there's no component).
  const groups = new Map();
  for (const f of all) {
    const comp = (f.owner || "").replace(/\s*\(.*$/, "");
    const k = [f.check, f.type, f.stress ? "stress" : "", comp || f.classes || f.key].join("|");
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f);
  }
  const changes = [...groups.values()].map((list) => {
    list.sort((x, y) => sev[x.severity] - sev[y.severity]);
    const f = list[0];
    const widths = [...new Set(list.flatMap((x) => x.widths || []))];
    const count = list.reduce((n, x) => n + (x.count || 1), 0);
    const els = [...new Set(list.flatMap((x) => x.examples?.length ? x.examples : [x.el]).filter(Boolean))];
    return { kind: list.some((x) => x.kind === "issue") ? "issue" : "suggestion", steps: list.find((x) => x.steps)?.steps, wcag: f.wcag, who: f.who, check: f.check, type: f.type, severity: list.some((x) => x.severity === "fail") ? "fail" : "warn", stress: !!f.stress, owner: f.owner, classes: f.classes, detail: f.detail, fix: f.fix, widths, count, els, shots: list.flatMap((x) => [x.shot, x.shot2]).filter(Boolean), keys: list.map((x) => x.key) };
  });
  const rank = (c) => (c.kind === "suggestion" ? 10 : 0) + (c.stress ? 2 : 0) + sev[c.severity] + (c.check === "overview" && c.type !== "low-contrast" ? 0.5 : 0);
  changes.sort((x, y) => rank(x) - rank(y) || y.count - x.count);
  changes.forEach((c, i) => (c.id = `C${i + 1}`));
  // Related: other changes in the same component at overlapping widths are usually one root cause seen
  // several ways (a squeezed nav overflows, overlaps and loses contrast); approve and fix them together.
  const comp = (c) => (c.owner || "").replace(/\s*\(.*$/, "") || c.classes;
  for (const c of changes) c.related = changes.filter((o) => o !== c && comp(o) && comp(o) === comp(c) && o.check !== "perf" && (!c.widths.length || !o.widths.length || o.widths.some((w) => c.widths.includes(w)))).map((o) => o.id);

  const desktopOnly = (w) => w.length && w.every((x) => x >= 768), phoneOnly = (w) => w.length && w.every((x) => x < 768);
  const risk = (c) => {
    if (c.check === "perf") return "speed only; re-measure with the same settings before claiming a win";
    if (c.check === "interaction") return /hover|focus|transition|cursor/.test(c.type) ? "the control's states; its look at rest stays the same" : "behaviour and accessibility; no visual change expected";
    if (phoneOnly(c.widths)) return `phones only (${compactWidths(c.widths)}); desktop must stay pixel-identical (compare --allow 320-767)`;
    if (desktopOnly(c.widths)) return `wide screens only (${compactWidths(c.widths)}); phones must stay identical`;
    if (c.owner) return `everything rendered by ${c.owner.replace(/\s*\(.*$/, "")}; check its other uses`;
    return "the element and its neighbours";
  };
  const sections = [
    ["Issues: must fix — broken for some users", (c) => c.kind === "issue" && !c.stress && c.severity === "fail"],
    ["Issues: should fix — wrong, but there is a way around it", (c) => c.kind === "issue" && !c.stress && c.severity !== "fail"],
    ["Suggestions — optional polish and design choices; the page works without them", (c) => c.kind === "suggestion" && !c.stress],
    ["Fragile — fine today, breaks with longer text or bigger numbers", (c) => c.stress],
  ];
  const site = (() => { for (const ch of CHECKS) { const f = join(dir, `${ch}.json`); if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).url; } return ""; })();
  let md = `# Proposed changes\n\n${site}\n\nIssues are reproduced and measured; each has steps to see it yourself where it's a behaviour. Suggestions are optional.\nTick the changes to make ([x]), or reply with their IDs ("approve C1, C3"). Nothing is changed until then.\nEach one is fixed at the root, re-checked, and kept only if its finding is gone and nothing else changed.\n`;
  for (const [title, test] of sections) {
    const list = changes.filter(test); if (!list.length) continue;
    md += `\n## ${title}\n`;
    for (const c of list) {
      const who = `${c.els.slice(0, 3).join(", ")}${c.els.length > 3 ? ` and ${c.els.length - 3} more` : ""}`;
      md += `\n- [ ] **${c.id} · ${c.type}** (${LABEL[c.check]}) — ${c.detail.replace(/\s+/g, " ").slice(0, 160)}\n`;
      if (c.steps) md += `  - See it yourself: ${c.steps}\n`;
      if (c.who || c.wcag) md += `  - Affects: ${c.who || ""}${c.wcag ? `${c.who ? " · " : ""}WCAG ${c.wcag}` : ""}\n`;
      md += `  - Who sees it: ${who}${c.widths.length ? ` · at ${compactWidths(c.widths)} px` : ""}${c.count > 1 ? ` · ${c.count} elements` : ""}\n`;
      if (c.owner || c.classes) md += `  - Where: ${c.owner ? `\`${c.owner}\`` : ""}${c.owner && c.classes ? " · " : ""}${c.classes ? `classes \`${c.classes.slice(0, 80)}\`` : ""}\n`;
      if (c.fix) md += `  - Proposed fix: ${c.fix}\n`;
      md += `  - Could also change: ${risk(c)}\n`;
      if (c.related.length) md += `  - Related: ${c.related.join(", ")} (same component, same widths: likely one root cause)\n`;
      if (c.shots.length) md += `  - Evidence: ${c.shots.slice(0, 2).join(", ")}\n`;
    }
  }
  const counts = sections.map(([t, test]) => `${changes.filter(test).length} ${t.split(" — ")[0].toLowerCase()}`).join(" · ");
  md += `\n---\n${changes.length} changes (${counts}) from ${all.length} findings. Judgement calls (copy, hierarchy, look) are in the review itself, not in this list.\n`;
  writeFileSync(join(dir, "changes.md"), md);
  writeFileSync(join(dir, "changes.json"), JSON.stringify({ site, at: new Date().toISOString(), changes }, null, 2));
  console.log(`${changes.length} proposed changes → ${join(dir, "changes.md")}`);
  for (const c of changes.slice(0, 12)) console.log(`  ${c.id.padEnd(4)} ${c.severity.padEnd(4)} ${c.type}: ${c.els[0] ?? ""}${c.count > 1 ? ` (+${c.count - 1})` : ""}`);
  if (changes.length > 12) console.log(`  … ${changes.length - 12} more in the file`);
}

function approvedIds(mdFile) {
  if (idsFlag) return idsFlag;
  return [...readFileSync(mdFile, "utf8").matchAll(/^- \[[xX]\] \*\*(C\d+)/gm)].map((m) => m[1]);
}

if (cmd === "propose" && a) propose(a);
else if (cmd === "approved" && a) {
  const ids = approvedIds(a); const { changes } = JSON.parse(readFileSync(join(dirname(a), "changes.json"), "utf8"));
  if (!ids.length) { console.log("nothing approved yet"); process.exit(1); }
  for (const id of ids) { const c = changes.find((x) => x.id === id); console.log(c ? `${id} ${c.type}: ${c.els[0] ?? ""} — ${c.fix || c.detail}` : `${id}: not in the list`); }
} else if (cmd === "report" && a && b) {
  const { site, changes } = JSON.parse(readFileSync(join(a, "changes.json"), "utf8"));
  const ids = idsFlag || approvedIds(join(a, "changes.md"));
  const after = new Set(load(b).map((f) => f.key));
  const beforeKeys = new Set(changes.flatMap((c) => c.keys));
  const added = load(b).filter((f) => f.severity !== "info" && !beforeKeys.has(f.key) && !load(a).some((x) => x.key === f.key));
  let md = `# Changes made\n\n${site}\n\n| | Change | Result |\n|---|---|---|\n`;
  let fixed = 0;
  for (const id of ids) {
    const c = changes.find((x) => x.id === id); if (!c) continue;
    const left = c.keys.filter((k) => after.has(k)).length;
    const res = left === 0 ? "fixed (gone in the re-check)" : left < c.keys.length ? `partly: ${c.keys.length - left} of ${c.keys.length} gone` : "still there";
    if (left === 0) fixed++;
    md += `| ${left === 0 ? "✓" : "✗"} | **${id}** ${c.type}: ${c.els[0] ?? ""} | ${res} |\n`;
  }
  const notApproved = changes.filter((c) => !ids.includes(c.id));
  md += `\n${fixed} of ${ids.length} approved changes confirmed fixed.\n`;
  if (added.length) md += `\n**New since the review (${added.length})** — a fix broke something, or the page changed:\n${added.map((f) => `- ${f.type}: ${f.el} — ${f.detail}`).join("\n")}\n`;
  else md += "\nNothing new appeared in the re-check.\n";
  if (existsSync(join(b, "snapshots.json"))) md += `\nVisual check: run \`compare.mjs ${relative(process.cwd(), a)} ${relative(process.cwd(), b)} --allow <widths the fixes targeted>\`; diff images are in \`${relative(process.cwd(), join(b, "snapshots"))}/\`.\n`;
  if (notApproved.length) md += `\nNot approved, left as they were: ${notApproved.map((c) => c.id).join(", ")}.\n`;
  writeFileSync(join(b, "done.md"), md);
  console.log(md);
} else {
  console.error("usage: plan.mjs propose <review dir> | approved <changes.md> [--ids C1,C3] | report <before dir> <after dir> [--ids C1,C3]");
  process.exit(2);
}
