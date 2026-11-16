# site-review

A Claude Code skill that reviews a website, landing page or hero like a demanding design lead: it looks at the
page in a real browser at desktop and phone, measures what the eye can't (speed, layout shift, sideways
scroll, contrast, tap sizes, broken images, console errors, popups, SEO basics, template tells), scores six
areas against a premium bar, and returns the worst problems first with the exact fix for each.

- **Hero** (`--hero`): the first screen only, about 10 s to capture. The check step of
  [originkit-hero-revamp](https://github.com/sridhar-raj/originkit-hero-revamp).
- **Page** (default): the first screen, every section and the full page, about 15 s.
- **Site** (`--pages /,/pricing,/about`): several pages in one run.

```bash
node scripts/site-review.mjs https://example.com --out .review [--hero] [--pages /,/pricing]
```

Needs Node 20+ and Playwright in the project you run it from (`pnpm add -D playwright`).
See `SKILL.md` for the method and `references/rubric.md` for the scoring.

## Install

Copy this folder to `~/.claude/skills/site-review` (all projects) or `.claude/skills/site-review` (one project).

MIT licence.
