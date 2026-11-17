# Consistency: one scale, one family, measured

A page feels designed when the same job always gets the same value: one spacing scale, one type scale, colours
from a few roles, buttons/inputs/cards that share radius, height and states. Drift is invisible per element and
obvious in sum ("assembled from parts"). Measure it on the rendered page (computed styles, not source), count
distinct values per property, then judge each outlier against the scale. Fix the **token or shared class**, never
one instance: five near-identical radii are one change.

## How to measure (in-page, visible elements only)

Skip `display:none`, zero-size, `aria-hidden` decoration, `<svg>` internals, and anything under
`data-review-allow="consistency"`. Record each value with a count, the share of visible area or text it covers,
and two example selectors with their React component. Lengths to px (16 px root unless the page sets another),
line height as a ratio, colours to OKLCH + alpha, compared by ΔE OK (OKLab distance × 100).

| Property | Collect from | Judge with |
|---|---|---|
| Type | `fontFamily` (first face actually loaded), `fontSize`, `fontWeight`, `lineHeight`/size, `letterSpacing` on elements with own text | distinct counts, step ratios, role groups (h1-h6, p, label, button, nav a) |
| Spacing | `padding*`, `margin*`, `gap`/`rowGap`/`columnGap` (non-zero, non-auto) | share on the base grid (4 or 8 px), distinct count |
| Colour | `color`, `backgroundColor` (non-transparent), `borderColor` (where border > 0), `outlineColor` on focus, `fill`/`stroke` of icons | clusters by role: text, surface, border, action, status |
| Shape | `borderRadius` (each corner), `borderWidth`, `boxShadow` | distinct counts; same-role agreement; nesting |
| Controls | buttons, links styled as buttons, inputs, selects, toggles: height, padding-x, radius, font size/weight, border, `cursor` | same row → same height and top; family → same radius and states |
| Motion | `transitionDuration`, `transitionTimingFunction` on interactive elements | distinct counts |
| Icons | inline `<svg>`: rendered size, `stroke-width` × scale, filled vs stroked paths | one size per context, one stroke, one style |

Also read the page's own token list: custom properties on `:root` (`getComputedStyle(documentElement)` over
`document.styleSheets` names), Tailwind's `--spacing`, `--text-*`, `--radius-*`, `--color-*`. A framework
default theme is not the team's list. Map **purpose first, then value**: a grey that equals the border token but
colours text is a text-token question, not a match (token-mapping).

## Thresholds (per page; a design system page or a docs page with specimens is exempt)

| Measure | Fine | Warn ("too many") | Notes |
|---|---|---|---|
| Font families | ≤ 2 (+ mono for code) | 3+ | a third face is almost always drift |
| Font sizes | ≤ 8 | > 10, or two sizes within 1 px used for the same role | 15/16/17 is mush: adjacent steps want ≥ 1.2× (1.125 in dense UI) |
| Weights (body family) | ≤ 3 | 4+ | over two heavy weights on one screen dilutes emphasis |
| Line height | headings 1.0-1.3, body 1.4-1.7 | display set at body leading, or body under 1.3 | |
| Spacing values | ≥ 90 % of occurrences on the 4 px grid; ≤ 12 distinct | off-grid values (13, 17, 23 px) on more than 3 elements | one-offs inside third-party widgets: note, don't count |
| Text colours | ≤ 4 clusters (primary, secondary, muted, disabled) + link/status | pairs ΔE 2-5 apart that serve one role | they "likely mean one muted text" |
| Accent hues | 1 (chroma > 0.06 on actions and links) | 2+ action hues, or the accent on non-actions | status colours don't count as accents |
| Neutrals | one hue family | warm and cool greys mixed (hue spread > 30° at chroma > 0.01) | |
| Radii | ≤ 4 non-zero + full | 5+, or buttons and inputs on one form differ | cards ≥ controls; pills always full |
| Border widths | ≤ 2 (e.g. 1 and 2-4 px) | 3+ | the 2-step rule |
| Shadows | ≤ 3 elevations, one strategy | borders and heavy shadows both used for lift | dark mode: shadows weak, borders carry it |
| Control heights | ≤ 3 sizes (sm/md/lg) | > 3, or siblings in one row > 1 px apart | equal `top` too, or the row is not on one line |
| Transitions | ≤ 3 durations, ≤ 2 easings | 4+ durations, or different hover responses on siblings (lift vs tint vs scale) | |
| Icons | one stroke width, one style, ≤ 3 sizes | mixed filled/outline in one nav or row; strokes differing > 0.5 px | |

Values used once are the drift candidates: list singletons first, with the nearest scale value and its distance.

## How to judge

1. **Roles before counts.** Group by job: all card titles, all form labels, all primary buttons. Two values
   inside one role is drift; two roles with two values may be design. A page with 9 sizes in a clean 1.25 ratio
   beats one with 6 that sit 1 px apart.
2. **Near pairs are one value.** Within the tolerance below the second value is a typo of the first: 2 px for
   spacing/size/radius, 1 px for font size, 0.05 for line height, ΔE OK 2 for colour, 30 ms for duration.
3. **Look at it.** Open the screenshot of each cluster: a button row whose heights differ by 2 px reads broken; a
   one-off 18 px gap in a footer usually doesn't matter. Numbers point, pictures decide.
4. **Squint test.** With labels unreadable, can you still tell buttons from badges from inputs? A badge with
   `cursor: pointer` or a hover change promises a click it can't keep.
5. **Shape language agrees.** Radius, typeface and icon corners tell one story: rounded type with 0 px cards, or
   sharp 1.5 px outline icons beside 3 px filled ones, reads as two products.
6. **Nested corners are concentric:** outer radius = inner radius + padding. A 12 px card around an 8 px button
   with 12 px padding wants 20 px.

## Signature → cause → fix

| Signature | Cause | Fix |
|---|---|---|
| Off-grid spacing (`17px`, `23px`), many distinct paddings | arbitrary values `p-[17px]`, inline `style` | the nearest scale step (`p-4`); Tailwind v4 `@theme { --spacing: 4px }` and only multiples; grep `-\[\d+px\]` |
| Same padding pattern repeated in different class orders, heights drift 1-2 px | height derived from padding + line-height + border | one shared class owns the box: `h-10 inline-flex items-center px-3`; borderless variants keep `border border-transparent` |
| Button 40 px beside input 42 px | outlined vs ghost under `content-box`, or different font size | `box-sizing: border-box` (Tailwind preflight has it), set `min-h-*` on both from one token (`--control-h`) |
| 15/16/17 px sizes, labels bold in one card and regular in the next | sizes picked by feel per component | a ratio scale in `@theme` (`--text-sm`, `--text-base`…); move each stray to the nearest step; weights to 400/500/600 |
| A third font family | a component library or embed bringing its own face, or `font-[Arial]` | `next/font` per family exposed as a CSS variable, `font-sans`/`font-display` only; remove the stray `fontFamily` |
| Display type at 1.5 leading, or body at 1.1 | one `leading-*` on a shared wrapper | `leading-tight` on headings, `leading-relaxed`/1.5 on body, set in the type tokens, not per element |
| `#666`, `gray-500`, `#6b7280` all as muted text | raw palette classes and hex bypassing roles | one semantic token (`text-muted-foreground` / `--color-text-muted`); palette classes count as untokened |
| Two accent hues on buttons and links | a second brand colour or a library default (blue links) | one `--color-primary`; links and focus ring from it; the other hue only for status |
| Warm and cool greys side by side | Tailwind `gray` beside `zinc`/`slate`, or a library's neutrals | one neutral scale; map the library's variables onto it |
| 6px, 8px, 10px, 12px radii on buttons/inputs/cards | `rounded-*` chosen per component | `--radius` tokens: control, card (≥ control), modal, full; derive nested ones with `calc()` |
| Card and its inner button at the same large radius | radius copied, not derived | `rounded-[calc(var(--radius)+theme(spacing.3))]` on the outer, or reduce the inner |
| 1, 2, 3 px borders | per-component borders | two widths only; `divide-*`/`border` from tokens; collapse abutting borders in button groups |
| Shadows of many shapes, plus borders for lift | no depth strategy | pick one (borders, soft shadow, layered, or tonal); `shadow-sm`/`md` scale only; elevation by level |
| Sibling buttons lift, tint and scale on hover | hover written per instance | states on the shared class/variant only; one press response (`active:scale-[0.97]`), one focus ring |
| `duration-[247ms]`, `transition-all` | ad-hoc transitions | 2-3 duration tokens (150/200/300 ms), named properties (`transition-colors`) |
| Outline and filled icons mixed, strokes 1.5 vs 2 | icons from two libraries, or SVGs pasted from different sets | one library, pinned; `strokeWidth` from one constant; `size-4`/`size-5` per context |
| Badge with pointer cursor or hover | badge built from the Button component | a separate `Tag`/`Badge` with muted fill, smaller type, `cursor-default`, no hover |
| Bordered chip in a bordered cell in a bordered card | grouping with boxes instead of space | one border at most; flatten inner cards; group with spacing and headings |
| `<button>` shows the arrow cursor | Tailwind v4 preflight does not set it | `@layer base { button:not(:disabled), [role=button] { cursor: pointer } }` |
| A hand-rolled select/modal next to the library's own | native or bespoke element where a component exists | use the project's component; lint `no-restricted-syntax` on the bare element in app code |
| The shared class lands but instances lose their colour utilities | class loaded after utilities, or written with shorthands | put it in `@layer components`; longhands (`border-width`, not `border`) |

## Issues vs suggestions

Most consistency findings are **suggestions** (works, looks less finished): extra sizes, off-grid gaps, a
second shadow style, mixed icon strokes. List them grouped by root cause under *Should fix* or *Polish*.
They are **issues** only when the drift breaks something a person meets:
- controls in one row visibly misaligned (heights or tops ≥ 2 px apart, confirmed on the screenshot);
- a false affordance: a badge or label that looks clickable (pointer, hover) and does nothing, or a button that
  looks like a static label (no fill, border or cursor);
- a hardcoded colour that does not follow the theme and fails contrast in dark or forced-colours mode (cite
  1.4.3 / 1.4.11 from the contrast checks; consistency only names the cause);
- focus or error styles that differ so much a control has none (2.4.7).
Never call taste ("too many fonts") a bug. A deliberate second face or a display size outside the scale, used
once with a reason, is fine: ask, don't flag.

## Sources

- jsmastery-pro `imprint` — https://github.com/jsmastery-pro/jsm-agent-skill (not in jsmastery-pro/skills): the
  property list that matters for consistency (bg, border, radius, text tiers, spacing, states, shadow, accent),
  what to ignore (width, layout, position), and "list every variant, recommend the majority baseline".
- dembrandt `component-family-consistency`, `brand-visual-language` — https://github.com/dembrandt/dembrandt-skills:
  shared DNA table, set-not-derived control heights, `border-box` and transparent borders, the 2-step border
  rule, concentric radii, one interaction language, badge vs button roles and the squint test, shape language
  across radius/type/icons, one icon library and stroke, the in-browser height/top measurement.
- arla6ka `token-mapping` — https://github.com/arla6ka/design.how: purpose before value, OKLCH and ΔE OK,
  tolerances, near pairs under ΔE 5 as one role, palette classes counted apart, "consistency by role" output.
- dammyjay93 `interface-design` — https://github.com/dammyjay93/interface-design: type scale ratios (1.2-1.333),
  four text levels, 4/8 px base, one depth strategy, radius scale, one accent and 60/30/10, motion durations.
- owl-listener `critique-typography`, `critique-color`, `critique-brand-consistency` —
  https://github.com/owl-listener/designer-skills: scale steps ≥ 1.25×, leading ranges, weight overuse, same role
  same style, one-off hex as the common failure, list each non-compliant value with its token.
- shipshitdev `design-consistency-auditor` — https://github.com/shipshitdev/skills (removed in 258b1f91, read from
  its parent): the grep set for arbitrary Tailwind values, inline styles, duplicated card/button patterns.
- ibelick `baseline-ui` — https://github.com/ibelick/ui-skills: one accent per view, default shadow scale, fixed
  z-index scale, no arbitrary values unless the project already has them.

## Script: `scripts/consistency-check.mjs` (built from this proposal; not built: hover/focus-state families, icon fill mixing per row, the "Look" step, which stays yours: open `consistency-shots/`)

`consistency-check.mjs <url>` (or `review.mjs --only consistency`), at 1440 and 390, after fonts load:
1. In-page walk of visible elements (same filters as above) collecting, per element: role (tag, ARIA role,
   button-like by `cursor`/background/border, heading level), font family/size/weight/line-height/tracking,
   padding/margin/gap, colour/background/border colour, radius per corner, border width, box-shadow, height and
   top for controls, transition duration/easing, and for inline SVG icons size, stroke width and fill mode.
2. Read `:root` custom properties as the token list; note Tailwind v4 theme variables when present.
3. Node side: normalise (px, ratio, OKLCH), merge near pairs by the tolerances, cluster colours by role.
Report `consistency.json` + a summary block:
- per property: distinct count vs threshold, the scale it fits (grid share, type ratio), singletons with nearest
  step and distance, two selectors + component each;
- role conflicts: same role, different values (e.g. "card title: 18 px ×6, 20 px ×2 in PricingCard");
- control rows: siblings whose height or top differs > 1 px (with an outlined screenshot);
- false affordances: non-interactive elements with pointer cursor or hover change; buttons with `cursor: default`;
- nesting: rounded child inside rounded parent where outer < inner + padding;
- untokened values: colours/lengths matching no `:root` token (purpose unknown → "inferred");
- each finding typed `consistency-*`, severity warn (suggestion) except misaligned rows and false affordances
  (fail after the Look step confirms), so `verdicts.mjs` can track precision per type and `plan.mjs` groups them
  by the token or class to change.
