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
trap 'kill $srv 2>/dev/null; wait $srv 2>/dev/null || true; rm -rf "$out"' EXIT
for _ in $(seq 50); do [ -s "$out/port" ] && break; sleep 0.1; done
base="http://127.0.0.1:$(head -1 "$out/port")"

echo "layout-check: broken.html"
node "$s/layout-check.mjs" "$f/broken.html" --out "$out/lb" --step 80 --no-shots >/dev/null || true
has "$out/lb/layout.json" overflow clipped-text text-overlap covered-text protrusion orphan-wrap breakpoint-overlap vh-height anchor-under-header layout-shift unsized-image text-overflow floating-over-content heading-break wrapped-label
ok "node -e \"const j=require('$out/lb/layout.json'); const f=j.findings.find(x=>x.type==='floating-over-content'); process.exit(f&&/Feedback/.test(f.el)&&/Hero that uses/.test(f.detail)&&f.steps?0:1)\"" "floating button over the headline, with steps to see it"
detail "$out/lb/layout.json" clipped-text "chosen option \"Template: Auto\"" "select whose chosen option is cut"
detail "$out/lb/layout.json" text-overflow "wider than its button" "tab label running past its pill"
detail "$out/lb/layout.json" wrapped-label "Pause agents" "button label wrapping onto two lines"
ok "node -e \"const j=require('$out/lb/layout.json'); process.exit(j.findings.some(x=>x.stress&&/Get+ start/.test(x.el))&&!j.findings.some(x=>!x.stress&&/Get+ start/.test(x.el))?0:1)\"" "stress pass: a button that fits today's copy only, flagged only under longer text"
ok "node -e \"const j=require('$out/lb/layout.json'); const g=j.findings.find(x=>x.count>1&&x.each); process.exit(g&&Object.keys(g.each).length===g.count?0:1)\"" "grouped findings keep each element's own widths"
echo "layout-check: clean.html"
node "$s/layout-check.mjs" "$f/clean.html" --out "$out/lc" --step 80 --no-shots >/dev/null || true
clean "$out/lc/layout.json"

echo "interaction-check: interaction-broken.html"
node "$s/interaction-check.mjs" "$f/interaction-broken.html" --out "$out/ib" --no-axe >/dev/null || true
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

# consistency-check: lines to merge into tests/run.sh (after the interaction-check block). Uses has/detail/ok
# from run.sh.

echo "consistency-check: consistency-broken.html"
node "$s/consistency-check.mjs" "$f/consistency-broken.html" --out "$out/kb" --no-shots >/dev/null && kbst=0 || kbst=$?
ok "[ $kbst = 1 ]" "exit 1 on fails"
has "$out/kb/consistency.json" consistency-font-families consistency-font-sizes consistency-type-steps consistency-weights consistency-line-height consistency-role consistency-spacing-grid consistency-text-colors consistency-near-colors consistency-accents consistency-neutrals consistency-untokened consistency-untokened-contrast consistency-radii consistency-control-radius consistency-nested-radius consistency-border-widths consistency-shadows consistency-control-heights consistency-control-row consistency-false-affordance consistency-transitions consistency-icons
detail "$out/kb/consistency.json" consistency-control-row "Start free\" 36px, button \"Book a demo\" 44px" "two buttons in one row at 36 and 44 px"
detail "$out/kb/consistency.json" consistency-control-row "Email\" 40px, select \"Team plan\" 46px" "input and select side by side at 40 and 46 px"
detail "$out/kb/consistency.json" consistency-control-radius "Email\" 4px, select \"Team plan\" 12px" "input and select with different radii"
detail "$out/kb/consistency.json" consistency-spacing-grid "13px.*17px.*22px" "off-grid 13/17/22 px spacing, each with its nearest step"
detail "$out/kb/consistency.json" consistency-near-colors "#666666.*#6a6a6a.*#6b7280.*#707070.*#737373" "five near-identical greys as one role"
detail "$out/kb/consistency.json" consistency-untokened-contrast "#a3a3a3" "hardcoded grey off the tokens failing contrast"
ok "node -e \"const j=require('$out/kb/consistency.json'); const by=(t)=>j.findings.filter(x=>x.type===t); process.exit(by('consistency-control-row').every(x=>x.severity==='fail'&&x.kind==='issue')&&by('consistency-false-affordance').every(x=>x.severity==='fail')&&by('consistency-radii').every(x=>x.kind==='suggestion')&&by('consistency-spacing-grid').every(x=>x.kind==='suggestion')?0:1)\"" "misaligned rows and false affordances are issues; scale drift is a suggestion"
ok "node -e \"const m=require('$out/kb/consistency.json').measured; const d=m['1440']; process.exit(d.fontSizes.length>10&&d.spacing.gridShare<90&&d.radii.values.length===5&&d.controlHeights.button&&Object.keys(m.tokens.colors).length===5?0:1)\"" "measured summary: sizes, grid share, radii, control heights, :root tokens"
sed 's/<html lang="en">/<html lang="en" data-review-allow="consistency">/' "$f/consistency-broken.html" > "$out/consistency-allowed.html"
node "$s/consistency-check.mjs" "$out/consistency-allowed.html" --out "$out/ka" >/dev/null && kast=0 || kast=$?
ok "[ $kast = 0 ] && node -e \"const j=require('$out/ka/consistency.json'); process.exit(j.exempt&&j.findings.every(x=>x.severity==='info')?0:1)\"" "data-review-allow=\"consistency\" exempts the page"

echo "consistency-check: clean.html"
node "$s/consistency-check.mjs" "$f/clean.html" --out "$out/kc" --no-shots >/dev/null || true
clean "$out/kc/consistency.json"

# seo-check.mjs tests: paste into run.sh after the interaction-check block (uses has/detail/clean/ok, $s $f $out $base $here).
echo "seo-check: seo-broken.html (file)"
node "$s/seo-check.mjs" "$f/seo-broken.html" --out "$out/sb" >/dev/null && sbst=0 || sbst=$?
has "$out/sb/seo.json" seo-noindex seo-canonical seo-raw-missing seo-title-generic seo-broken-link seo-viewport seo-jsonld-invalid seo-jsonld-required seo-jsonld-fact seo-jsonld-value seo-og-url seo-hreflang seo-anchor-text seo-link-js seo-image-filename seo-twitter-card seo-skipped
detail "$out/sb/seo.json" seo-canonical "relative.*another page" "canonical relative and pointing at another page"
detail "$out/sb/seo.json" seo-raw-missing "h1 .Pricing that grows.*price .49" "h1 and price only rendered by JS"
detail "$out/sb/seo.json" seo-jsonld-fact "offers.price .79" "JSON-LD price not on the page"
detail "$out/sb/seo.json" seo-jsonld-required "image, offers.priceCurrency" "Product missing its required fields"
detail "$out/sb/seo.json" seo-image-filename "IMG_4021" "camera-style image filename"
detail "$out/sb/seo.json" seo-hreflang "en-GB" "hreflang en-UK told to use en-GB"
ok "[ $sbst = 1 ]" "exit 1 on fails"
ok "node -e \"const j=require('$out/sb/seo.json'); process.exit(['seo-anchor-text','seo-image-filename','seo-twitter-card'].every(t=>j.findings.find(x=>x.type===t).kind==='suggestion')&&j.findings.find(x=>x.type==='seo-noindex').kind==='issue'?0:1)\"" "judgment calls are suggestions, noindex an issue"
echo "seo-check: clean.html (file and served)"
node "$s/seo-check.mjs" "$f/clean.html" --out "$out/sc" >/dev/null || true
clean "$out/sc/seo.json"
node "$s/seo-check.mjs" "$base/clean.html" --out "$out/scs" >/dev/null || true
clean "$out/scs/seo.json"
echo "seo-check: seo-broken.html (served)"
node "$s/seo-check.mjs" "$base/seo-broken.html" --out "$out/sbs" >/dev/null || true
has "$out/sbs/seo.json" seo-og-size seo-broken-link
detail "$out/sbs/seo.json" seo-og-size "600×600" "share image dimensions decoded"
echo "seo-check: a broken site (robots.txt, sitemap, 404)"
SERVE_SITE=broken node "$here/serve.mjs" > "$out/port2" & srv2=$!
for _ in $(seq 50); do [ -s "$out/port2" ] && break; sleep 0.1; done
node "$s/seo-check.mjs" "http://127.0.0.1:$(head -1 "$out/port2")/seo-broken.html" --out "$out/sbb" >/dev/null || true
kill $srv2 2>/dev/null; wait $srv2 2>/dev/null || true
has "$out/sbb/seo.json" seo-robots-blocked seo-robots-groups seo-robots-sitemap seo-sitemap seo-sitemap-url seo-soft-404
detail "$out/sbb/seo.json" seo-robots-blocked "carries noindex" "robots.txt blocks a page that carries noindex"
detail "$out/sbb/seo.json" seo-sitemap-url "gone.html \\(404\\)" "sitemap URL that 404s"
detail "$out/sbb/seo.json" seo-sitemap-url "noindex.*seo-broken" "noindex page listed in the sitemap"
detail "$out/sbb/seo.json" seo-hreflang "doesn't link back" "hreflang not reciprocal"

# cro-check.mjs: paste into tests/run.sh after the "site-review: clean.html" block (it uses has, detail, ok,
# clean, $s, $f, $out and $base, which run.sh defines above that point).

echo "cro-check: cro-broken.html"
node "$s/cro-check.mjs" "$f/cro-broken.html" --out "$out/crb" >/dev/null || true
has "$out/crb/cro.json" cro-competing-cta cro-generic-cta cro-dead-cta cro-form-fields cro-autocomplete cro-input-type cro-password-toggle cro-popup-intrusive cro-popup-no-memory cro-cta-covered cro-analytics-duplicate
detail "$out/crb/cro.json" cro-competing-cta "3 buttons look equally primary" "three equal filled buttons in the first screen"
detail "$out/crb/cro.json" cro-generic-cta "submit says \"Submit\"" "form submit labelled Submit"
detail "$out/crb/cro.json" cro-form-fields "9 fields on a lead form \\(7 required\\)" "9-field lead form, required counted"
detail "$out/crb/cro.json" cro-input-type "type=text on an email field" "email input type=text"
detail "$out/crb/cro.json" cro-input-type "without inputmode on a phone field" "phone input without inputmode"
ok "node -e \"const j=require('$out/crb/cro.json'); const a=j.findings.filter(x=>x.type==='cro-autocomplete'); process.exit(a.length===2&&a.every(x=>x.wcag==='1.3.5'&&x.severity==='fail')&&a.some(x=>/email/.test(x.detail))&&a.some(x=>/tel/.test(x.detail))?0:1)\"" "autocomplete missing on email and phone only (fields that have it pass), WCAG 1.3.5"
ok "node -e \"const j=require('$out/crb/cro.json'); const p=j.findings.find(x=>x.type==='cro-popup-intrusive'); process.exit(p&&p.severity==='fail'&&p.widths.join()==='390'&&p.coverage>=90&&p.appearedAt>0?0:1)\"" "popup judged at phone width only, with coverage and time to appear"
ok "node -e \"const j=require('$out/crb/cro.json'); const d=j.findings.filter(x=>x.type==='cro-dead-cta'); process.exit(d.some(x=>x.severity==='fail'&&/pricing-missing/.test(x.detail))&&d.some(x=>x.severity==='warn'&&/href=\\\"#\\\"/.test(x.detail))?0:1)\"" "missing page is a fail, href=\"#\" a warning"
ok "node -e \"const j=require('$out/crb/cro.json'); const k=(t)=>j.findings.find(x=>x.type===t).kind; process.exit(k('cro-cta-covered')==='issue'&&k('cro-competing-cta')==='suggestion'&&k('cro-form-fields')==='suggestion'&&j.analytics.clicked==='Start free trial'?0:1)\"" "measured breakage is an issue, judgement a suggestion; the CTA was clicked"
echo "cro-check: cro-broken.html served (HEAD, request blocking)"
node "$s/cro-check.mjs" "$base/cro-broken.html" --out "$out/crh" >/dev/null || true
detail "$out/crh/cro.json" cro-dead-cta "answers HTTP 404" "CTA link answering 404"
echo "cro-check: clean.html"
node "$s/cro-check.mjs" "$f/clean.html" --out "$out/crc" >/dev/null || true
clean "$out/crc/cro.json"

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
