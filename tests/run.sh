#!/usr/bin/env bash
# Checks the checks: every planted bug in the fixtures is found, the clean page reports nothing, and the tools
# around the checks (compare, snapshots, crawl, sessions, verdicts, speed) do what they say.
# Run from a project that has Playwright:  bash <skill>/tests/run.sh [--quick]   (--quick skips the speed check)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; s="$here/../scripts"; f="$here/fixtures"
out="$(mktemp -d)"; fail=0
quick=0; [ "${1:-}" = "--quick" ] && quick=1

has() { # file type...
  local file="$1"; shift
  for t in "$@"; do
    if node -e "const j=require('$file'); process.exit(j.findings.some(x=>x.type==='$t')?0:1)"; then echo "  ok    $t"; else echo "  MISS  $t"; fail=1; fi
  done
}
detail() { # file type regex label: a finding of that type whose detail (or element) matches
  if node -e "const j=require('$1'); const txt=(x)=>[x.detail,x.el||''].concat(Object.entries(x.each||{}).map(([k,v])=>k+' '+v.detail)).join(' | '); process.exit(j.findings.some(x=>x.type==='$2'&&/$3/.test(txt(x)))?0:1)"; then echo "  ok    $4"; else echo "  MISS  $4"; fail=1; fi
}
line() { # review.json regex label [absent]: a verdict line matches (or, with absent, none does)
  local want=0; [ "${4:-}" = absent ] && want=1
  if node -e "const j=require('$1'); process.exit(j.lines.some(l=>/$2/.test(l))?0:1)"; then got=0; else got=1; fi
  if [ $got = $want ]; then echo "  ok    $3"; else echo "  FAIL  $3"; node -e "require('$1').lines.forEach(l=>console.log('        '+l))"; fail=1; fi
}
clean() { # file
  local n; n=$(node -e "const j=require('$1'); console.log(j.findings.filter(x=>x.severity!=='info').length)")
  if [ "$n" = "0" ]; then echo "  ok    clean page: no findings"; else echo "  FALSE ALARMS: $n on the clean page"; node -e "require('$1').findings.filter(x=>x.severity!=='info').forEach(x=>console.log('        '+x.type+' '+x.el+' — '+x.detail))"; fail=1; fi
}
ok() { if eval "$1"; then echo "  ok    $2"; else echo "  FAIL  $2"; fail=1; fi; }

# The test server (speed, crawl, sessions).
node "$here/serve.mjs" > "$out/port" & srv=$!
trap 'kill $srv 2>/dev/null; wait $srv 2>/dev/null; rm -rf "$out"' EXIT
for _ in $(seq 50); do [ -s "$out/port" ] && break; sleep 0.1; done
base="http://127.0.0.1:$(head -1 "$out/port")"

echo "layout-check: broken.html"
node "$s/layout-check.mjs" "$f/broken.html" --out "$out/lb" --step 80 --no-shots >/dev/null || true
has "$out/lb/layout.json" overflow clipped-text text-overlap covered-text protrusion orphan-wrap breakpoint-overlap vh-height anchor-under-header layout-shift unsized-image text-overflow floating-over-content heading-break
ok "node -e \"const j=require('$out/lb/layout.json'); const f=j.findings.find(x=>x.type==='floating-over-content'); process.exit(f&&/Feedback/.test(f.el)&&/Hero that uses/.test(f.detail)&&f.steps?0:1)\"" "floating button over the headline, with steps to see it"
detail "$out/lb/layout.json" clipped-text "chosen option \"Template: Auto\"" "select whose chosen option is cut"
detail "$out/lb/layout.json" text-overflow "wider than its button" "tab label running past its pill"
ok "node -e \"const j=require('$out/lb/layout.json'); process.exit(j.findings.some(x=>x.stress&&/Get+ start/.test(x.el))&&!j.findings.some(x=>!x.stress&&/Get+ start/.test(x.el))?0:1)\"" "stress pass: a button that fits today's copy only, flagged only under longer text"
ok "node -e \"const j=require('$out/lb/layout.json'); const g=j.findings.find(x=>x.count>1&&x.each); process.exit(g&&Object.keys(g.each).length===g.count?0:1)\"" "grouped findings keep each element's own widths"
echo "layout-check: clean.html"
node "$s/layout-check.mjs" "$f/clean.html" --out "$out/lc" --step 80 --no-shots >/dev/null || true
clean "$out/lc/layout.json"

echo "interaction-check: interaction-broken.html"
node "$s/interaction-check.mjs" "$f/interaction-broken.html" --out "$out/ib" >/dev/null || true
has "$out/ib/interaction.json" no-hover hover-shift transition-all cursor no-focus-ring invisible-focus-stop esc-no-close dialog-focus scrollbar-jump tap-target ios-zoom zoom-disabled hover-only reduced-motion state-unannounced not-focusable no-key-activation tablist-arrows no-accessible-name placeholder-label image-name label-in-name no-h1 no-main-landmark captions-review forced-colors-edge forced-colors-icon silent-submit
ok "grep -q '✗ button, unlabelled' '$out/ib/reader.txt'" "screen-reader list written, unlabelled button marked"
ok "test -f '$out/ib/forced-colors.jpg'" "contrast-theme screenshot saved"
ok "node -e \"const j=require('$out/ib/interaction.json'); const e=j.findings.find(x=>x.type==='esc-no-close'); const h=j.findings.find(x=>x.type==='no-hover'); const fr=j.findings.find(x=>x.type==='no-focus-ring'); process.exit(e&&e.steps&&e.shot&&e.kind==='issue'&&h&&h.kind==='suggestion'&&h.shot&&h.shot2&&fr&&fr.shot&&fr.shot2?0:1)\"" "behaviour findings carry steps and before/after screenshots; Esc on a modal is an issue, no-hover a suggestion"
ok "node -e \"const j=require('$out/ib/interaction.json'); const f=j.findings.find(x=>x.type==='no-focus-ring'); process.exit(f&&f.wcag==='2.4.7'&&/keyboard/.test(f.who)?0:1)\"" "findings say who they affect and the WCAG criterion"
echo "interaction-check: clean.html"
node "$s/interaction-check.mjs" "$f/clean.html" --out "$out/ic" >/dev/null || true
clean "$out/ic/interaction.json"

echo "site-review: app.html (auto kind, layered contrast, dark theme)"
node "$s/site-review.mjs" "$f/app.html" --out "$out/oa" --no-sections >/dev/null || true
line "$out/oa/review.json" "judged as an app screen" "judged as an app"
line "$out/oa/review.json" "^WARN.*(call-to-action|og:image|meta description|template tell)" "marketing checks skipped" absent
line "$out/oa/review.json" "desktop 1 text element\\(s\\) under WCAG contrast, e.g. p \"Drop" "faint hint flagged, text on the sibling pill not"
detail "$out/oa/overview.json" low-contrast "in the dark theme" "dark theme: panel text unreadable in dark, found"
ok "test -f '$out/oa/desktop-first-dark.jpg'" "dark theme screenshot saved"
detail "$out/oa/overview.json" low-contrast "Drop a video" "contrast is a finding (comparable before/after)"
echo "site-review: clean.html (a website)"
node "$s/site-review.mjs" "$f/clean.html" --out "$out/oc" --no-sections >/dev/null || true
line "$out/oc/review.json" "judged as a website" "judged as a website"
line "$out/oc/review.json" "under WCAG contrast" "no contrast false alarms (selected pill)" absent
line "$out/oc/review.json" "first call to action \"Start free\"" "call to action found"

echo "sessions: --cookie"
node "$s/site-review.mjs" "$base/private" --out "$out/p0" --hero >/dev/null 2>&1 || true
node "$s/site-review.mjs" "$base/private" --out "$out/p1" --hero --cookie "sr=1" >/dev/null 2>&1 || true
ok "node -e \"const a=require('$out/p0/review.json').pages[0].views.desktop.h1s[0], b=require('$out/p1/review.json').pages[0].views.desktop.h1s[0]; process.exit(a==='Sign in'&&b==='Signed in'?0:1)\"" "signed-out sees 'Sign in', the cookie sees 'Signed in'"

echo "review.mjs: --crawl"
node "$s/review.mjs" "$base/clean.html" --out "$out/cr" --only overview --crawl 2 >/dev/null 2>&1 || true
ok "node -e \"const j=require('$out/cr/summary.json'); process.exit(j.pages.length===2&&/app\\.html$/.test(j.pages[1].page)?0:1)\"" "crawl found and reviewed the linked page"

echo "snapshots + compare: visual change outside the allowed widths"
node "$s/snapshots.mjs" "$f/clean.html" --out "$out/s1" --widths 390,1440 >/dev/null
node "$s/snapshots.mjs" "$f/clean.html" --out "$out/s2" --widths 390,1440 >/dev/null
ok "node '$s/compare.mjs' '$out/s1' '$out/s2' >/dev/null" "same page twice: no change"
sed 's|</style>|@media (min-width: 768px) { .hero h1 { color: #c00; } }</style>|' "$f/clean.html" > "$out/clean-changed.html"
node "$s/snapshots.mjs" "$out/clean-changed.html" --out "$out/s3" --widths 390,1440 >/dev/null
node "$s/compare.mjs" "$out/s1" "$out/s3" --allow 320-430 > "$out/cmp.txt" && cmpst=0 || cmpst=$?
ok "[ $cmpst = 1 ] && grep -q '1440px: CHANGED outside --allow' '$out/cmp.txt' && grep -q '390px: same' '$out/cmp.txt'" "desktop-only change caught, phone unchanged, exit 1"
ok "test -f '$out/s3/snapshots/diff-1440.png'" "diff image outlines the change"

echo "compare.mjs: broken → clean"
if node "$s/compare.mjs" "$out/lb/layout.json" "$out/lc/layout.json" >/dev/null; then echo "  ok    all fixed, nothing new"; else echo "  FAIL  compare reported new findings"; fail=1; fi

echo "plan.mjs: propose → approve → report"
node "$s/plan.mjs" propose "$out/lb" >/dev/null
ok "grep -q '^- \[ \] \*\*C1 ' '$out/lb/changes.md'" "change list written with unticked IDs"
ok "grep -q '^## Issues: must fix' '$out/lb/changes.md' && grep -q '^## Suggestions' '$out/lb/changes.md' && awk '/^## Suggestions/{s=1} /^## Fragile/{s=0} s' '$out/lb/changes.md' | grep -q 'orphan-wrap'" "issues and suggestions in separate sections"
sed -i.bak 's/^- \[ \] \*\*C1 /- [x] **C1 /' "$out/lb/changes.md"
ok "node '$s/plan.mjs' approved '$out/lb/changes.md' | grep -q '^C1 '" "ticked change read back as approved"
mkdir -p "$out/lb-after" && cp "$out/lc/layout.json" "$out/lb-after/layout.json"
ok "node '$s/plan.mjs' report '$out/lb' '$out/lb-after' | grep -q '1 of 1 approved changes confirmed fixed'" "report: approved change confirmed fixed"

echo "verdicts.mjs"
ok "node '$s/verdicts.mjs' list '$out/lb/layout.json' | grep -q '^  1\\.'" "lists findings to mark"

if [ $quick = 0 ]; then
  echo "perf-check: perf-broken.html (served, 1 run)"
  node "$s/perf-check.mjs" "$base/perf-broken.html" --out "$out/pf" --runs 1 --no-interact >/dev/null 2>&1 || true
  has "$out/pf/perf.json" lcp-lazy render-blocking
  ok "node -e \"const j=require('$out/pf/perf.json'); process.exit(j.medians.lcp>0&&j.medians.fcp>1000?0:1)\"" "medians measured (first paint held back by the slow script)"
fi

[ $fail = 0 ] && echo "All checks pass." || { echo "Some checks failed."; exit 1; }
