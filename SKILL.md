---
name: site-review
description: >-
  Review a website, landing page or hero the way a demanding design lead would: look at it in a real browser at
  desktop and phone, measure what the eye can't (speed, layout shift, sideways scroll, contrast, tap sizes,
  broken images, console errors, popups, SEO basics, template tells), score it on six areas against a premium
  bar, and hand back the worst problems first with the exact fix for each. Fast: a hero in about 5 minutes, a
  page in about 10, a few pages in about 20. Use it whenever someone asks to review, critique, audit, rate,
  roast, check or give feedback on a website, landing page, hero, homepage or section, asks "is this good?",
  "what's wrong with this site?", "why doesn't it convert?", or shares a URL or screenshot of a site for an
  opinion; and as the check step of the originkit-hero-revamp skill.
---

# Site review

Look first, measure second, judge against a bar, and give fixes someone can make today. Never a vague
"improve the visual hierarchy": every finding names the element, the evidence and the change.

`<skill>` is this skill's folder. The script needs Node 20+ and Playwright in the current project (`pnpm add -D
playwright && npx playwright install chromium`); any project with Playwright works, the site does not have to be
in it.

## Pick the mode

| The ask | Mode | Budget |
|---|---|---|
| "Review our hero / first screen", or checking a hero revamp | `--hero` | 5 min |
| "Review this page / landing page" | default | 10 min |
| "Review our site" | `--pages /,/pricing,/about` (3-5 key pages) | 20 min |
| Only a screenshot, no URL | skip the script; judge the picture with the rubric, say nothing was measured | 5 min |

## 1. Capture (under a minute)

```bash
node <skill>/scripts/site-review.mjs https://example.com --out .review [--hero] [--pages /,/pricing]
```

It writes `desktop-first.jpg` and `phone-first.jpg` (the first screen), `desktop-full.jpg` and `phone-full.jpg`
(the page, up to 14,000 px), `sections/NN.jpg` (each section, or screen-sized slices when the page has no
clear sections), `review.json`, and PASS / WARN / FAIL lines. It handles pages that scroll inside a container
and notes popups covering the first screen. A local file or `localhost` works too.

## 2. Look (the main step)

Open **every** screenshot: both first screens, then the sections in order. For each, note in one line what
works and what doesn't. Read the page as a first-time visitor: in 5 seconds, can you say what it is, who it's
for and what to click? Then read the script's lines and check each WARN on the screenshot: the numbers point,
the pictures decide (a contrast WARN on text you can read fine is noise; text over an image it couldn't
measure may be unreadable).

## 3. Score (six areas, 1-5 each)

Use `references/rubric.md`: what a 1, 3 and 5 look like for each area, and the premium bar.

| Area | The question |
|---|---|
| **Clarity** | In 5 seconds: what it is, for whom, what to do? |
| **Look** | Would it stand next to the bar, or does it read as a template? |
| **Hierarchy & layout** | One focal point per screen, rhythm, alignment, whitespace, nothing cramped? |
| **Mobile** | At 390 px: readable, tappable, no sideways scroll, the CTA reachable? |
| **Speed & stability** | LCP, CLS, page weight, broken things, errors? |
| **Trust & copy** | Specific, credible words; real proof; no filler ("unlock", "seamless", "next-gen")? |

Give each score one line of evidence (a measurement or a screenshot). Total out of 30.

## 4. Report

Reply in this shape, short:

```
Score: 19/30 · Clarity 3 · Look 2 · Hierarchy 3 · Mobile 4 · Speed 4 · Trust 3

Biggest problems (worst first)
1. <what's wrong, where> — evidence: <number or screenshot> — fix: <the exact change>
2. …  (5-8 items; the first three are the ones that matter most)

Quick wins (under 10 minutes each)
- …

What works (keep it)
- …

Measured: <the script's numbers used>. Judged: <the taste calls>.
```

- Fixes are concrete: the copy rewritten, the CSS value, the element to remove, the size to set.
- For a hero that scores **Look ≤ 2** or **Clarity ≤ 2**, offer the **originkit-hero-revamp** skill to rebuild
  it rather than patching.
- Attach the first-screen screenshots. If the user wants a shareable page, make an HTML report with the
  screenshots and the table.
- Never invent numbers; anything not measured is called a judgment.

## Reviewing a hero revamp (`--hero`)

When the originkit-hero-revamp skill hands a rebuilt hero over for checking (its step 4), run `--hero` on the
new hero, score it with the rubric, and also answer the revamp's pre-show checklist
(`references/rubric.md`, "Hero checklist"). A revamp is ready to show when **Look ≥ 4, Clarity ≥ 4, no FAIL**,
and every checklist item is yes, or the reply says which one isn't and why. Compare with the before capture
if there is one: the score must go up in the areas the revamp targeted.

## Files

| Path | What |
|---|---|
| `scripts/site-review.mjs` | Capture and measure at desktop and phone (`--hero`, `--pages`, `--no-sections`) |
| `references/rubric.md` | The six areas with 1/3/5 anchors, the premium bar, template tells, the hero checklist |
