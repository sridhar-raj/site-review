#!/usr/bin/env bash
# Checks the checks: every planted bug in the fixtures is found, and the clean page reports nothing.
# Run from a project that has Playwright:  bash <skill>/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; s="$here/../scripts"; f="$here/fixtures"
out="$(mktemp -d)"; fail=0

has() { # file type...
  local file="$1"; shift
  for t in "$@"; do
    if node -e "const j=require('$file'); process.exit(j.findings.some(x=>x.type==='$t')?0:1)"; then echo "  ok    $t"; else echo "  MISS  $t"; fail=1; fi
  done
}
clean() { # file
  local n; n=$(node -e "const j=require('$1'); console.log(j.findings.filter(x=>x.severity!=='info').length)")
  if [ "$n" = "0" ]; then echo "  ok    clean page: no findings"; else echo "  FALSE ALARMS: $n on the clean page"; node -e "require('$1').findings.forEach(x=>console.log('        '+x.type+' '+x.el))"; fail=1; fi
}

echo "layout-check: broken.html"
node "$s/layout-check.mjs" "$f/broken.html" --out "$out/lb" --step 80 --no-shots >/dev/null || true
has "$out/lb/layout.json" overflow clipped-text text-overlap covered-text protrusion orphan-wrap breakpoint-overlap vh-height anchor-under-header layout-shift unsized-image
echo "layout-check: clean.html"
node "$s/layout-check.mjs" "$f/clean.html" --out "$out/lc" --step 80 --no-shots >/dev/null || true
clean "$out/lc/layout.json"

echo "interaction-check: interaction-broken.html"
node "$s/interaction-check.mjs" "$f/interaction-broken.html" --out "$out/ib" >/dev/null || true
has "$out/ib/interaction.json" no-hover hover-shift transition-all cursor no-focus-ring invisible-focus-stop esc-no-close dialog-focus scrollbar-jump tap-target ios-zoom zoom-disabled hover-only reduced-motion
echo "interaction-check: clean.html"
node "$s/interaction-check.mjs" "$f/clean.html" --out "$out/ic" >/dev/null || true
clean "$out/ic/interaction.json"

echo "compare.mjs: broken → clean"
if node "$s/compare.mjs" "$out/lb/layout.json" "$out/lc/layout.json" >/dev/null; then echo "  ok    all fixed, nothing new"; else echo "  FAIL  compare reported new findings"; fail=1; fi

rm -rf "$out"
[ $fail = 0 ] && echo "All checks pass." || { echo "Some checks failed."; exit 1; }
