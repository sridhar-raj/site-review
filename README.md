# site-review

A Claude Code skill that reviews a website like a demanding design lead and front-end QA engineer, then fixes
what it finds in the source and proves each fix.

It looks at the page in headless Chromium across many widths and measures what the eye misses:

- **Responsive layout** at every breakpoint (and 1 px below it), common devices and a 320-1440 px sweep:
  sideways scroll and its culprit, text cut off (including descenders and a select's chosen option), text
  wider than its button or tab, text over text, text covered by other
  elements, content sticking out of its box, items wrapping alone, clashing breakpoints, `100vh` on phones,
  anchors hidden under sticky headers. Overlaps are confirmed by hiding one element and diffing pixels, so
  invisible "bugs" are dropped.
- **Layout shift** on a slowed network, with what moved and why (inserted content, unsized images, font swaps).
- **Interaction:** hover forced on every interactive element (no feedback, layout jumps, `transition: all`,
  durations, cursor, menus off-screen or behind content), the keyboard Tab walk (missing or clipped focus
  rings, focus under sticky bars, traps), every menu and dialog (Esc, focus, scroll lock, the scrollbar jump),
  phone checks (tap targets, iOS input zoom, zoom disabled, hover-only content, the mobile menu after
  navigating), reduced motion, and axe when installed.
- **Performance:** throttled cold runs (phone, Slow 4G, 4× CPU) with medians; LCP split into its four parts
  with the cause (lazy, no priority, a video poster, client-rendered, an entrance animation); what blocks the
  first paint; images, fonts, video; JavaScript weight; third-party main-thread time; long frames; slow clicks
  with their phases. A dev server is detected.

- **Fragile layouts:** a stress pass makes every text 30% longer and every number bigger, the way translations and
  real data grow, and reports what breaks only then.
- **Screen readers and contrast themes:** `reader.txt` lists the page as a screen reader does (unnamed items
  marked), focus is judged by screenshot, label-in-name, h1 and main landmark, captions to check, and the page
  in a Windows contrast theme (borderless buttons and fixed-colour icons that vanish). Every finding says who
  it affects and its WCAG criterion.
- **Dark themes, signed-in pages, whole sites:** a second contrast pass in the dark theme; `login.mjs` saves a
  session for `--storage`; `--crawl N` follows the site's own links.

The four page checks run side by side (about 30 s for a page), speed alone afterwards.

Every finding names the element, its React component (file:line on a dev server) and its classes, the widths
it happens at, and how many elements share it, with a fix.

**Nothing is fixed without approval.** `plan.mjs` turns a review into a numbered change list (`changes.md`:
what, who sees it, where in the source, the fix, what else it could change). The person ticks what to fix;
only that is fixed. `compare.mjs` then proves it: findings fixed / still there / new, plus full-page snapshots
diffed pixel by pixel at every width (a phone fix must not change the desktop). `plan.mjs report` writes
`done.md`. `verdicts.mjs` records which findings were real, so each check's precision is known.

```bash
node scripts/review.mjs https://example.com --out .review/before         # everything
node scripts/plan.mjs propose .review/before                              # → changes.md to approve
node scripts/review.mjs http://localhost:3000 --out .review/after --only layout,snapshots
node scripts/compare.mjs .review/before .review/after --allow 320-767     # findings + pixels per width
node scripts/plan.mjs report .review/before .review/after                 # → done.md
node scripts/review.mjs http://localhost:3000/app --kind app              # a tool screen: no marketing checks
node scripts/login.mjs https://app.example.com && node scripts/review.mjs https://app.example.com --storage .review/state.json
bash tests/run.sh                                                          # the checks' own tests
```

Needs Node 20+ and Playwright in the project you run it from (`pnpm add -D playwright`); `@axe-core/playwright`
adds the full WCAG rules (a basic set runs without it). Built on published research (ReDeCheck, VISER, LayoutDR,
IFix), WCAG 2.2, web.dev and the Vercel Web Interface Guidelines: see `references/sources.md`.

## Install

Copy this folder to `~/.claude/skills/site-review` (all projects) or `.claude/skills/site-review` (one project).

MIT licence.
