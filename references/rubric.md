# Rubric

Score each area 1-5. Give the score that matches the worst thing you saw in that area, not the average: one
unreadable headline makes Clarity a 2 however good the rest is. The scripts feed Mobile and Speed; Clarity,
Look, Hierarchy and Trust are judged on the screenshots.

## The premium bar

What premium first screens share, and what generic ones lack:
- **One focal point per screen, big:** a hero object or product moment taking 40-60 % of the first screen.
- **The product working,** not a stock photo, an abstract blob or a screenshot in a tilted frame.
- **Real, specific words and numbers** (a date, a price, a name, a measured result).
- **Decisive type:** one display line with deliberate size and tracking; everything else small and quiet.
- **One palette, one accent,** from the brand. Light that looks designed (a key light, a spill, a soft
  shadow), not a flat field.
- Dark or light both qualify; what fails is generic.

## The six areas

**Clarity**
- 5: the headline says what it is in plain words, key noun early; one sentence says who it's for; one obvious
  action. A stranger gets it in 5 seconds.
- 3: understandable after reading the subhead or scrolling; the action competes with others.
- 1: a slogan that could belong to anyone ("Build the future"); no clear action, or several equal ones.

**Look**
- 5: holds up next to the best site in its category; you couldn't swap the logo for a competitor's; one
  memorable moment.
- 3: clean and competent but forgettable; a template made tidy.
- 1: template tells everywhere (below), stock imagery, clashing colours, default fonts.

**Hierarchy & layout**
- 5: one focal point per screen; a clear reading order; consistent spacing rhythm; alignment holds at every
  width (layout-check clean).
- 3: mostly ordered, a few sections cramped or same-weight; some misalignment or a layout bug at one width.
- 1: everything shouts; walls of cards; no rhythm; overlapping or cut content.

**Mobile** (from layout-check and interaction-check at 320-430 px)
- 5: no sideways scroll, nothing cut or overlapping, headline ≤ 4 lines, CTA on the first screen, taps ≥ 44 px,
  inputs ≥ 16 px, the menu works and closes, nothing hover-only.
- 3: works but cramped; a few small targets; one layout bug at a narrow width.
- 1: sideways scroll, overlapping or cut text, unreachable menu or CTA, zoom disabled.

**Speed & stability** (from perf-check, phone profile; a lab floor, not the field)
- 5: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms, interactions ≤ 200 ms, page ≤ 1.5 MB, no errors.
- 3: LCP 2.5-4 s, CLS ≤ 0.25, a heavy page or slow third parties.
- 1: LCP > 4 s, visible layout jumps, interactions > 500 ms, broken images, a popup in front of everything.

**Trust & copy**
- 5: specific claims with numbers, real customers or a checkable spec near the CTA; copy reads like a person;
  every state works (hover, focus, menus, errors).
- 3: some specifics, some filler; generic testimonials; rough edges in states.
- 1: filler words ("unlock", "seamless", "supercharge", "next-generation", "the future of"), invented-looking
  stats, logos nobody knows in grey, broken interactions.

## App screens (`--kind app`)

A tool, dashboard or admin screen is not selling anything: there is no call to action to find, no share card,
no template tells to count. Score Clarity as "can a new user tell what this screen does and what to do first",
Look and Hierarchy as usual, Mobile and Speed from the scripts, and replace Trust & copy with **States**:
empty, loading, error, disabled and selected states all exist and look designed; the selected item is
announced (`aria-selected`/`aria-current`/`aria-pressed`); labels are short enough for the controls they sit in.
`--kind auto` (the default) treats a page as an app when it has no description and no share image, or fits one
screen with tabs or form controls and no footer; the overview prints which it chose.

## Worked examples (anchors)

Scores drift between reviewers unless they are anchored. These are real pages scored with the reasons; score a
new page by asking which anchor it is closer to.

**Originkit builder, Maker screen** (`/maker`, an app screen, 2026-11-16) · Clarity 4 · Look 4 · Hierarchy 4 ·
Mobile 2 · Speed — (dev server, not measured) · States 3
- Clarity 4: "What are we building?" plus a drop zone and one Build button: a new user knows what to do. Not 5:
  four mode tabs with equal weight above the form compete with it.
- Look 4: one dark palette, one orange accent, quiet type, a calm glow behind the form. Not 5: nothing on it is
  memorable; it could be any tool.
- Hierarchy 4: one focal column, clear reading order, consistent spacing. Not 5: the selects in the form row
  are squeezed until "Template: Auto" reads "Template: Autc" at 1440 px.
- Mobile 2: at 320-440 px the nav labels pile on top of each other and the status pill runs off the screen; the
  selects show one or two letters. Usable, but visibly broken on every phone.
- States 3: the selected tab has a state for screen readers (`aria-selected`, `aria-pressed`); the prompt box
  has no focus ring; the selects trigger iOS zoom.

**Generic anchors**
- *Mobile 5*: a page where layout-check finds nothing at any width and the stress pass finds nothing either.
  *Mobile 3*: one bug at the narrowest widths. *Mobile 1*: sideways scroll or overlapping text at 390 px.
- *Look 5*: you could not swap the logo for a competitor's and keep the page; one moment you'd remember.
  *Look 3*: a tidy template. *Look 1*: three or more template tells, stock imagery, default fonts.
- *Clarity 5*: a stranger says what it is and who it's for after 5 seconds of the first screen. *Clarity 1*:
  a slogan that fits any company and two equal buttons.

## Template tells

Each is fine once, with a reason; together they read as AI-made or templated: a centred headline with one
gradient word; a purple-to-blue glow; an eyebrow pill above the headline; a filled + ghost button pair; a grey
logo strip; three equal icon cards; "01 / 02 / 03" step labels; a dashboard screenshot in a tilted frame; glassy
cards on a blob gradient; every section the same height and layout; headlines starting "Introducing" or "Meet".

## Hero checklist (with `--hero`)

1. Would it hold up next to the best site in its category?
2. Is the hero object 40-60 % of the screen and clearly the product working?
3. Cover the logo: could a competitor use this hero unchanged? (Must be no.)
4. Does it read in 5 seconds: what it is, for whom, what to click?
5. Real words and numbers, nothing invented or placeholder?
6. One palette, one accent, none of the template tells above?
7. At 390 px: headline ≤ 4 lines, CTA on the first screen, the object still visible?
8. Something answers the pointer, eased, and it is calm with no pointer?
