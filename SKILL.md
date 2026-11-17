---
name: site-review
description: >-
  Review a website, landing page, hero or app screen in a real browser and fix what's wrong, with proof.
  Measures responsive breakage across widths (overflow, cut or overlapping text, fragile layouts), layout
  shift, hover/focus/keyboard, menus and dialogs, touch, contrast (incl. dark and Windows contrast themes),
  screen-reader names, and speed (LCP and why). Proposes a numbered change list to approve, fixes only what
  is approved at the root, then re-checks findings and pixel snapshots. Use when asked to review, audit, QA,
  check, critique, fix or polish a site or section, when it looks broken on mobile, jumps, feels wrong on
  hover or focus, or is slow, or when a URL or localhost is shared for an opinion.
---

# Site review

Find every visible bug a careful person would find in an hour, in minutes, with proof; propose the fixes as a
list a person approves; fix only what was approved, at the root; prove each fix. Look first, measure second,
judge against a bar, ask, fix in the source, measure again.

`<skill>` is this skill's folder. The scripts need Node 20+ and Playwright in the current project (`pnpm add -D
playwright && npx playwright install chromium`; `@axe-core/playwright` adds the full WCAG rules, otherwise a
built-in basic set runs). Any project with Playwright can review any URL.

## Modes

| The ask | Do | Budget |
|---|---|---|
| "Review / audit / what's wrong with this site" | Review (1-3), then the change list (4) | 10-15 min a page |
| "Review and fix" / "fix the mobile issues" | Review, change list, **wait for approval**, then Fix (5-6) | + 20-40 min |
| "Just fix everything" / "fix without asking" | Review, change list, fix all of it (say so at the top of the list) | + 20-40 min |
| "Is it slow? / make it faster" | `perf-check.mjs` (add `--field` for a public URL), then the list | 10 min + fixes |
| "Text is cut / overlapping / broken on phones" | `layout-check.mjs` only, then the list | 5 min + fixes |
| "Review our hero / first screen" | `site-review.mjs --hero`, then `interaction-check` and `perf-check` on it | 5-10 min |
| An app, dashboard or tool screen | Review with `--kind app` (auto-detected; the overview says which): no CTA, SEO, share-card or template-tell checks; score States instead of Trust | 10 min a screen |
| A whole site | `review.mjs <url> --crawl 5` (its own nav and footer links, one folder per page) | 5-10 min a page |
| Behind a login | `login.mjs <url>` once (sign in by hand, the session is saved), then `--storage .review/state.json` on any script | + 1 min |
| Only a screenshot, no URL | Judge the picture with `references/rubric.md`; say nothing was measured | 5 min |

Fixing needs the site's source in the working directory. Reviewing doesn't.

## 1. Run the checks (2-4 min, in the background)

```bash
node <skill>/scripts/review.mjs http://localhost:3000 --out .review/before
```

That runs five scripts into one folder (each can run alone with the same flags), four of them side by side and
perf alone afterwards (`--serial` for one at a time). Every finding says who it affects and its WCAG criterion.

| Script | Finds | Time |
|---|---|---|
| `site-review.mjs` | screenshots: first screen at desktop and phone, every section, the full page; contrast against what is actually painted behind each text (a pill behind it counts; text in scrolling panels is scrolled into view; pictures and gradients are left to the screenshot); a second contrast pass in the dark theme when the CSS has one (`desktop-first-dark.jpg`); popups, headline and CTA position, SEO basics, template tells (the last three only for a website) | ~15 s |
| `layout-check.mjs` | at every breakpoint (and 1 px below it), common devices and a 320-1440 sweep: sideways scroll and its culprit, clipped text (including a select's chosen option), text wider than its button or tab, text over text, covered text, protrusion, orphan wraps, clashing breakpoints, 100vh on phones, anchors under sticky headers, layout shift with its cause, unsized images. Overlaps are confirmed by hiding one element and diffing pixels. Then a **stress pass**: every text 30% longer and every number bigger, the audit again; what breaks only then is "fragile". Outlined screenshots in `layout-shots/` | 20-50 s |
| `interaction-check.mjs` | hover (forced, every interactive element; the selected item is exempt, one that only looks selected is flagged), the Tab walk (focus judged by screenshot, focused vs not), custom widgets with the keyboard (clickable things Tab can't reach, fake buttons Enter/Space don't press, tabs and sliders without arrow keys), each menu/dialog opened, phone touch checks, the mobile menu after navigating, reduced motion; screen-reader basics (image names, label in name, h1, main landmark) and `reader.txt`, the page as a screen reader lists it; Windows contrast themes (borderless filled buttons, fixed-colour icons) and `forced-colors.jpg`; video captions to check; axe (or the built-in basics: names, labels, lang, heading order) | 15-45 s |
| `perf-check.mjs` | 3 throttled cold runs (phone, Slow 4G, 4× CPU), medians, LCP split into its 4 parts with the cause, CLS, TBT, FCP blockers, images, fonts, video, third-party main-thread time, long frames, slow clicks; `--field` adds real visitors' p75 from the Chrome UX Report (public URLs only; the URL is sent to Google) | 1-2 min |
| `snapshots.mjs` | full-page screenshots at 390, 768 and 1440, with cells that change by themselves (clocks, carousels) recorded as noise: the baseline the visual compare needs | ~15 s |

Use a **production build** for performance (`next build && next start`, or the deployed URL); layout and
interaction checks are fine on a dev server, and a dev server gives file:line for each component. Popups open on
arrival are closed first, the way a visitor would (and reported). `--scheme dark` runs everything in dark mode;
`--motion` runs the layout audit with animations on.

Every finding has: what's wrong, where (element, selector, React component, classes to grep), the widths it
happens at, how many elements share it ("and 14 more like it": one shared style, one fix; each element keeps its
own widths), and a fix hint.

## 2. Look (the step that makes it a review)

While the checks run, open the site yourself and read it as a first-time visitor. Then open **every**
screenshot: both first screens, the dark one, `forced-colors.jpg`, each section, each `layout-shots/` image,
and read `reader.txt` top to bottom as a screen-reader user would (✗ marks what has no name). Confirm or dismiss
each finding on the picture: the numbers point, the pictures decide. Record each verdict, so the checks learn
which of them to trust:

```bash
node <skill>/scripts/verdicts.mjs list .review/before/layout.json
node <skill>/scripts/verdicts.mjs mark .review/before/layout.json 1,2,4 real
node <skill>/scripts/verdicts.mjs mark .review/before/layout.json 3 false --note "pill behind the text"
node <skill>/scripts/verdicts.mjs report        # precision per type, across every review so far
```

Before listing a behaviour bug (Esc, focus, hover, a selected state), prove it the way people meet it:
- **Every way in.** A panel opened by hover, by click and by keyboard can behave differently (on one site Esc
  closed it after hover but not after click, because opening by click moved focus into its form).
- **Read the page's own code** for that behaviour when it's served (its scripts and CSS are public): the
  handler or the `:hover` rule settles it, and gives the fix its line number.
- **A highlight in a screenshot may be the pointer.** Move the mouse away (or blur) before calling something
  selected; check what the state means in the code before proposing ARIA for it (a chip that adds a field is
  not a toggle, so `aria-pressed` would be wrong).
- **Test the form:** submit it empty and with a wrong value (safe when the script blocks it; never a real
  submission on a live site), then check focus moves to the first error and each error is tied to its field
  (`aria-invalid`, `aria-describedby`).

Then the two walks and a Lighthouse pass (`references/accessibility.md`):
- **Keyboard only:** Tab every flow without a mouse; each stop visible, never hidden under sticky chrome, in
  reading order, nothing a pointer can do that the keyboard can't.
- **Screen reader:** every control announces a name, a role and its state (`reader.txt`, or the accessibility
  tree via Chrome DevTools `take_snapshot`).
- **Lighthouse** accessibility, SEO and best practices per page: Chrome DevTools MCP `lighthouse_audit`
  (snapshot mode keeps state; it never covers performance), or the Lighthouse CLI. Its failing nodes point to
  the component; a 100 is not conformance.

Read the stress pass with `references/worst-case.md`: each break has a signature, a cause and a fix; a choice
between truncate, wrap and clamp is a design decision, so it goes on the list as a suggestion.

Before a report, run `verdicts.mjs report`: a type under 80 % gets an extra look before it is listed. Add what
no script sees: the hierarchy, the copy, the look (`references/rubric.md`, with its premium bar, template tells
and worked examples).

## 3. Report

```
Score 21/30 · Clarity 4 · Look 3 · Hierarchy 3 · Mobile 3 · Speed 4 · Trust 4

Must fix (broken for users)          ← fails: overflow, cut text, overlaps, no focus, Esc, tap targets, LCP > 4 s
1. <what> — where: <component · classes · widths> — evidence: <number/screenshot> — fix: <exact change>
Should fix (feels unfinished)        ← warns that are real on the screenshot
Fragile                              ← the stress pass: fine today, breaks with longer copy
Polish
What works (keep it)
Measured: <scripts, settings>. Judged: <the taste calls>.
```

Group by root cause, not by symptom: one `truncate` class on a card title is one item even if 15 cards show
it. Attach the outlined screenshots for the top items.

**Issues vs suggestions.** Every finding is one or the other, and the report keeps them apart. An issue is
broken or fails a WCAG criterion, reproduced and measured (no visible focus, Esc that never closes a modal,
a button over a field, errors a screen reader never hears). A suggestion works as it is and could be better
(no hover on a chip, an orphan in a wrap, an entrance animation on a page that is already fast, a small target
that passes WCAG through spacing). Never present a suggestion as a bug; when unsure, it is a suggestion. When the
person says something works, check it again every way in and believe what you can reproduce.

**Responsiveness, shown.** Look at the snapshots at every width (or screenshot 320, 375, 414, phone landscape,
768, 1024, 1280 and 1920) and say plainly what holds and what doesn't; the layout check's numbers are the
evidence, the pictures are the answer.

## 4. The change list (always, before touching code)

```bash
node <skill>/scripts/plan.mjs propose .review/before        # → .review/before/changes.md
```

One numbered change per root cause (C1, C2…), worst first: what's wrong, who sees it (widths, how many
elements), where it is in the source, the proposed fix, **what else the fix could change**, the evidence, and
related changes (same component, same widths: usually one root cause, approve them together). Remove the ones
the Look step dismissed (they were marked false) and add the judgement items from the report as plain changes.
Give the person the file's path and the short list, then **stop and wait**: they tick boxes in the file, or
reply "approve C1, C3" (or "all", or "all but C7"). Only skip the wait when they said up front to fix without
asking, and then say so at the top of the list.

```bash
node <skill>/scripts/plan.mjs approved .review/before/changes.md      # the ticked IDs, or --ids C1,C3
```

## 5. Fix (only what was approved)

For each approved change, worst first:
1. **Find it in the source:** the component name (`in Hero (app/components/Hero.tsx:42)` on a dev server) or
   grep the classes the finding lists. Fix the **shared component or class**, not one instance.
2. **Fix the root cause** with the tables in `references/layout.md`, `interaction.md`, `performance.md`,
   `accessibility.md` (every fix cites its WCAG criterion) and `worst-case.md`.
   Prefer removing the cause (a fixed width, `truncate`, `outline-none`, `transition-all`, `loading="lazy"`)
   over adding an override. Never hide a problem with `overflow-x: hidden` on body, `maximum-scale=1`, or
   `data-review-allow` unless it is truly intended (then say why in a comment).
3. **Keep the design:** same look at the widths that were fine; a fix for 390 px must not change 1440 px.
4. **Stay inside the approval.** Something else you notice while fixing goes on a new list for approval, not
   into the same commit.
5. Batch related fixes, then re-run the affected check and the snapshots into a new folder:

```bash
node <skill>/scripts/review.mjs http://localhost:3000 --out .review/after --only layout,snapshots
node <skill>/scripts/compare.mjs .review/before .review/after --allow 320-767
```

`compare.mjs` lists **fixed**, **still there** and **new** for every check, then compares the snapshots pixel
by pixel: each width says same or changed, with the changed regions outlined in
`.review/after/snapshots/diff-<width>.png`. `--allow` names the widths the fixes were meant to change; a change
anywhere else fails (exit 1), and so does anything new. Open every diff image: an intended fix shows up where
the finding was, and nowhere else. Two rounds per change at most; then report it as open with what was tried.

## 6. Prove

Re-run `review.mjs --out .review/after` with the same flags, then:

```bash
node <skill>/scripts/compare.mjs .review/before .review/after --allow <widths>
node <skill>/scripts/plan.mjs report .review/before .review/after        # → .review/after/done.md
```

`done.md` says, for each approved change, fixed or still there (from the re-check, not from memory), anything
new, and what was not approved. Report it with the before/after screenshots and diff images, the before/after
speed medians (same settings; claim a speed win only if the mechanism changed too), and what is left and why.
Never claim a fix the re-run didn't confirm.

## Rules

- **Nothing changes without approval** (unless the person said to fix without asking).
- **Root cause over override.** One class change in a shared component beats ten patches.
- **Evidence for every finding.** A measurement, a screenshot, or a named rule. Judgment calls are labelled.
- **A clean run is not conformance.** Scripts reach only part of WCAG; say so, and list what needs a person
  (captions, reading order of complex layouts, meaningful alt text, error messages).
- **No false confidence:** lab speed is a floor, not the field (use `--field` when the site is public); say
  when something couldn't be measured (text over images for contrast, cross-origin iframes, axe not installed).
- **Never break what works:** the snapshot compare at every width after a fix, not just the one that failed.
- **Never disable zoom, never hide focus, never remove a feature** to make a check pass.
- **Sessions are secrets:** a `--storage` file is a live login; keep it in `.review/` and out of git.

## Files

| Path | What |
|---|---|
| `scripts/review.mjs` | runs every check into one folder; `--crawl N` for more pages |
| `scripts/site-review.mjs` | screenshots and the overview (first screen, sections, contrast, dark theme, SEO, popups, tells) |
| `scripts/layout-check.mjs` | responsive layout across widths, layout shift, the stress pass, with visual confirmation |
| `scripts/interaction-check.mjs` | hover, focus, keyboard widgets, overlays, touch, motion, axe or the basics |
| `scripts/perf-check.mjs` | throttled cold runs, LCP diagnosis, main thread, slow clicks, field data |
| `scripts/snapshots.mjs` | full-page screenshots per width with self-changing regions recorded |
| `scripts/compare.mjs` | before vs after: findings (fixed, still there, new) and snapshots (pixel diff per width) |
| `scripts/plan.mjs` | the change list to approve, the approved IDs, the done report |
| `scripts/verdicts.mjs` | record real/false per finding; precision per check type |
| `scripts/login.mjs` | sign in by hand once, save the session for `--storage` |
| `scripts/lib.mjs` | shared helpers (sessions, component lookup, hide-and-diff, image diff, findings) |
| `references/layout.md` | layout failures: causes and fixes (Tailwind, CSS, Next.js), the stress pass |
| `references/interaction.md` | hover, focus, keyboard, overlays, touch, motion: causes and fixes |
| `references/performance.md` | measuring honestly, field data, the LCP/JS/image/font/third-party fix playbook |
| `references/accessibility.md` | WCAG 2.2 A/AA criteria and severity, the keyboard and screen-reader walks, Lighthouse, fix rules, the before-you-finish grep |
| `references/worst-case.md` | realistic worst-case data, what breaks (signature → cause → fix), truncate vs wrap vs clamp |
| `references/rubric.md` | the six scores, the premium bar, template tells, worked examples, the hero checklist |
| `references/sources.md` | the research behind the checks |
| `calibration/verdicts.jsonl` | every recorded verdict (grows with use) |
| `tests/` | fixtures with planted bugs, a clean page and a test server; `tests/run.sh` checks the checks |
