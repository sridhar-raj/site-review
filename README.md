# site-review

A Claude Code skill that reviews a website like a demanding design lead and front-end QA engineer, then fixes
what it finds in the source and proves each fix.

It looks at the page in headless Chromium across many widths and measures what the eye misses:

- **Responsive layout** at every breakpoint (and 1 px below it), common devices and a 320-1440 px sweep:
  sideways scroll and its culprit, text cut off (including descenders), text over text, text covered by other
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

Every finding names the element, its React component (file:line on a dev server) and its classes, the widths
it happens at, and how many elements share it, with a fix. `compare.mjs` checks a fix: fixed, still there, new.

```bash
node scripts/review.mjs https://example.com --out .review/before        # everything
node scripts/layout-check.mjs http://localhost:3000 --out .review/after   # one check
node scripts/compare.mjs .review/before/layout.json .review/after/layout.json
bash tests/run.sh                                                         # the checks' own tests
```

Needs Node 20+ and Playwright in the project you run it from (`pnpm add -D playwright`); `@axe-core/playwright`
adds WCAG rules. Built on published research (ReDeCheck, VISER, LayoutDR, IFix), WCAG 2.2, web.dev and the
Vercel Web Interface Guidelines: see `references/sources.md`.

## Install

Copy this folder to `~/.claude/skills/site-review` (all projects) or `.claude/skills/site-review` (one project).

MIT licence.
