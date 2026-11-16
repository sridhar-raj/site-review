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
