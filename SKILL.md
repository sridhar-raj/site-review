---
name: site-review
description: >-
  Review a website, landing page or hero like a demanding design lead and front-end QA engineer, then fix what
  it finds. It looks at the page in a real browser across many widths and measures what the eye misses:
  responsive breakage (sideways scroll, text cut off, overlapping or covered text, content sticking out, items
  wrapping alone, clashing breakpoints), layout shift with its cause, hover and focus states, menus and
  dialogs (Esc, focus, scroll lock, page jumps), touch targets and phone issues, reduced motion, accessibility,
  and page speed (LCP and why, render-blocking files, images, fonts, JavaScript, third parties, slow clicks).
  Each finding is confirmed visually, traced to its component and classes, and fixed at the root in the
  source, then re-checked so a fix is kept only when the problem is gone and nothing else broke. Use it
  whenever someone asks to review, audit, QA, test, check, critique, rate, fix or polish a website, landing
  page, hero or section; says it looks broken on mobile, text is cut off or overlapping, the layout jumps,
  hover or focus feels wrong, or the site is slow; or shares a URL or localhost for an opinion.
---

# Site review

Find every visible bug a careful person would find in an hour, in minutes, with proof; then fix them at the
root and prove the fix. Look first, measure second, judge against a bar, fix in the source, measure again.

`<skill>` is this skill's folder. The scripts need Node 20+ and Playwright in the current project (`pnpm add -D
playwright && npx playwright install chromium`; `@axe-core/playwright` adds WCAG rules). Any project with
Playwright can review any URL.

## Modes

| The ask | Do | Budget |
|---|---|---|
| "Review / audit / what's wrong with this site" | Review (steps 1-3) | 10-15 min a page |
| "Review and fix" / "fix the mobile issues" / it's our code | Review, then Fix (4-5) | + 20-40 min |
| "Is it slow? / make it faster" | `perf-check.mjs` only, then performance fixes | 10 min + fixes |
| "Text is cut / overlapping / broken on phones" | `layout-check.mjs` only, then fixes | 5 min + fixes |
| "Review our hero / first screen" | `site-review.mjs --hero`, then `interaction-check` and `perf-check` on it | 5-10 min |
| Only a screenshot, no URL | Judge the picture with `references/rubric.md`; say nothing was measured | 5 min |

Fixing needs the site's source in the working directory. Reviewing doesn't.

## 1. Run the checks (2-4 min, in the background)

```bash
node <skill>/scripts/review.mjs http://localhost:3000 --out .review/before
```

That runs four scripts into one folder (each can run alone with the same flags):

| Script | Finds | Time |
|---|---|---|
| `site-review.mjs` | screenshots: first screen at desktop and phone, every section, the full page; popups covering the page, headline and CTA position, SEO basics, template tells | ~15 s |
| `layout-check.mjs` | at every breakpoint (and 1 px below it), common devices and a 320-1440 sweep: sideways scroll and its culprit, clipped text, text over text, covered text, protrusion, orphan wraps, clashing breakpoints, 100vh on phones, anchors under sticky headers, layout shift with its cause, unsized images. Overlaps are confirmed by hiding one element and diffing pixels. Outlined screenshots in `layout-shots/` | 15-40 s |
| `interaction-check.mjs` | hover (forced, every interactive element), the Tab walk, each menu/dialog opened, phone touch checks, the mobile menu after navigating, reduced motion, axe | 10-40 s |
| `perf-check.mjs` | 3 throttled cold runs (phone, Slow 4G, 4× CPU), medians, LCP split into its 4 parts with the cause, CLS, TBT, FCP blockers, images, fonts, video, third-party main-thread time, long frames, slow clicks | 1-2 min |

Use a **production build** for performance (`next build && next start`, or the deployed URL); layout and
interaction checks are fine on a dev server, and a dev server gives file:line for each component. Popups open on
arrival are closed first, the way a visitor would (and reported).

Every finding has: what's wrong, where (element, selector, React component, classes to grep), the widths it
happens at, how many elements share it ("and 14 more like it": one shared style, one fix), and a fix hint.

## 2. Look (the step that makes it a review)

While the checks run, open the site yourself and read it as a first-time visitor. Then open **every**
screenshot: both first screens, each section, each `layout-shots/` image. Confirm or dismiss each finding on
the picture: the numbers point, the pictures decide. Add what no script sees: the hierarchy, the copy, the
look (`references/rubric.md`, with its premium bar and template tells).

## 3. Report

```
Score 21/30 · Clarity 4 · Look 3 · Hierarchy 3 · Mobile 3 · Speed 4 · Trust 4

Must fix (broken for users)          ← fails: overflow, cut text, overlaps, no focus, Esc, tap targets, LCP > 4 s
1. <what> — where: <component · classes · widths> — evidence: <number/screenshot> — fix: <exact change>
Should fix (feels unfinished)        ← warns that are real on the screenshot
Polish
What works (keep it)
Measured: <scripts, settings>. Judged: <the taste calls>.
```

Group by root cause, not by symptom: one `truncate` class on a card title is one item even if 15 cards show
it. Attach the outlined screenshots for the top items.

## 4. Fix (when the source is here)

For each item, worst first:
1. **Find it in the source:** the component name (`in Hero (app/components/Hero.tsx:42)` on a dev server) or
   grep the classes the finding lists. Fix the **shared component or class**, not one instance.
2. **Fix the root cause** with the tables in `references/layout.md`, `interaction.md` and `performance.md`.
   Prefer removing the cause (a fixed width, `truncate`, `outline-none`, `transition-all`, `loading="lazy"`)
   over adding an override. Never hide a problem with `overflow-x: hidden` on body, `maximum-scale=1`, or
   `data-review-allow` unless it is truly intended (then say why in a comment).
3. **Keep the design:** same look at the widths that were fine; a fix for 390 px must not change 1440 px.
4. Batch related fixes, then re-run only the affected check into a new folder:

```bash
node <skill>/scripts/layout-check.mjs http://localhost:3000 --out .review/after
node <skill>/scripts/compare.mjs .review/before/layout.json .review/after/layout.json
```

`compare.mjs` lists **fixed**, **still there** and **new**. A fix is kept only when its finding is gone and
nothing new appeared (exit code 1 on anything new). Two rounds per item at most; then report it as open with
what was tried.

## 5. Prove

Re-run `review.mjs --out .review/after` with the same flags, `compare.mjs` per check, look at the new
screenshots at the widths that failed, and report: what was fixed (with before/after screenshots), the
before/after numbers for speed (medians, same settings; claim a speed win only if the mechanism changed too),
what is left and why. Never claim a fix the re-run didn't confirm.

## Rules

- **Root cause over override.** One class change in a shared component beats ten patches.
- **Evidence for every finding.** A measurement, a screenshot, or a named rule. Judgment calls are labelled.
- **No false confidence:** lab speed is a floor, not the field; say when something couldn't be measured
  (text over images for contrast, sites behind a login, cross-origin iframes).
- **Never break what works:** re-check every width after a layout fix, not just the one that failed.
- **Never disable zoom, never hide focus, never remove a feature** to make a check pass.

## Files

| Path | What |
|---|---|
| `scripts/review.mjs` | runs every check into one folder |
| `scripts/site-review.mjs` | screenshots and the overview (first screen, sections, SEO, popups, tells) |
| `scripts/layout-check.mjs` | responsive layout across widths, layout shift, with visual confirmation |
| `scripts/interaction-check.mjs` | hover, focus, overlays, touch, motion, axe |
| `scripts/perf-check.mjs` | throttled cold runs, LCP diagnosis, main thread, slow clicks |
| `scripts/compare.mjs` | before vs after: fixed, still there, new |
| `scripts/lib.mjs` | shared helpers (component lookup, hide-and-diff, findings) |
| `references/layout.md` | layout failures: causes and fixes (Tailwind, CSS, Next.js) |
| `references/interaction.md` | hover, focus, overlays, touch, motion: causes and fixes |
| `references/performance.md` | measuring honestly, the LCP/JS/image/font/third-party fix playbook |
| `references/rubric.md` | the six scores, the premium bar, template tells, the hero checklist |
| `references/sources.md` | the research behind the checks |
| `tests/` | fixtures with planted bugs and a clean page; `tests/run.sh` checks the checks |
