# Layout: what breaks, how it's found, how to fix it

`layout-check.mjs` finds these. This file is for diagnosing a finding and choosing the fix. Fix the **root
cause in the shared component or class**, not the single instance: when one card's title clips, every card
with those classes does (IFix: Mahajan et al., ICST 2018 — clustering elements by style keeps a repair
consistent).

## How the check works (and why it's trusted)

1. **Widths:** every breakpoint in the CSS and 1 px below it (the wider layout is still active with the least
   room: the most common failure width), common devices (320-1440), and a sweep every `--step` px.
2. **Detect from geometry** (cheap): bounding boxes, `Range.getClientRects()` for the text itself.
3. **Confirm visually** (VISER, Walsh et al., ICST 2019): hide one element and diff the pixels; if nothing
   visible changes, the "bug" is dropped. This removed most false positives in the research.
4. **Point at the source:** the React component (and file:line on a dev server) from the fiber, plus the
   classes to grep for.

Responsive layout failures (ReDeCheck, Walsh, Kapfhammer, McMinn, ISSTA 2017): element collision, element
protrusion, viewport protrusion, wrapping failure, small-range layout. The check covers each.

## Sideways scroll (viewport protrusion) — `overflow`

`body { overflow-x: hidden }` hides the scrollbar but not the bug: content is cut and iOS still pans. The check
finds culprits either way; it reports the outermost element past the edge.

| Cause | Fix |
|---|---|
| `w-screen` / `100vw` (includes the scrollbar) | `w-full`; a full-bleed child of a centred container: `w-[100cqw]` with a container query, or `mx-[calc(50%-50dvw)]` |
| Fixed width `w-[700px]` | `w-full max-w-[700px]` |
| Long word, URL, hash | `wrap-anywhere` (`overflow-wrap:anywhere`, shrinks min-content; `break-words` doesn't inside flex/grid); `break-all` only for code; `hyphens-auto` with `lang` for prose |
| Flex item can't shrink (`min-width:auto`) | `min-w-0` on the item, at every nested flex level |
| Grid blowout (`1fr` = `minmax(auto,1fr)`) | `grid-cols-[minmax(0,1fr)_300px]`; Tailwind's `grid-cols-N` already uses `minmax(0,1fr)` |
| Media, iframes, tables, `pre` | `max-w-full h-auto`; iframes `w-full aspect-video`; tables and `pre` inside `overflow-x-auto` |
| Rotated/translated decoration, glows | `overflow-x-clip` on the section (clip, not hidden: no scroll container, `sticky` keeps working) |
| `white-space: nowrap` rows | allow wrapping, or a deliberate `overflow-x-auto snap-x` scroller |

`overflow-x: clip` on `html`/`body` is a last resort after the culprit is fixed.

## Clipped text — `clipped-text`

Ellipsis and line-clamp are often intended (card excerpts). The check flags them only on important text
(headings, buttons, links, labels, prices, nav) or when over 30 % is hidden with no `title`.

| Cause | Fix |
|---|---|
| Fixed `h-*` on a text box or button | `min-h-*`, or no height |
| `truncate` / `whitespace-nowrap` on a heading or button | remove; `text-balance`/`text-pretty`; less `tracking` |
| Display type too big for the column | fluid: `text-[clamp(2rem,6vw,4.5rem)]` |
| Card `overflow-hidden` (for rounded corners) cutting text | move the clip to the media wrapper; let the card grow |
| Descenders cut: `leading-none`/`leading-[0.9]` with `bg-clip-text` or `overflow-hidden` | `leading-[1.1]`+, or `pb-[0.12em] -mb-[0.12em]` (the gradient paints only inside the line box) |
| Long translations | IFix: change the shared font-size/width for all siblings |
| A `<select>` (or `input type=button`) squeezed by a flex/grid share: the chosen option is cut, often to a letter or two ("Te" for "Template: Auto"). Its text is not a text node, so it is measured separately: option width against the room inside the padding (a custom chevron lives in `padding-right`) | `w-auto`/`min-w-[…]` for the longest option, `flex-wrap` on the row, or a shorter label on phones |

### Text wider than its own button or tab — `text-overflow`

With `overflow: visible` nothing is clipped, yet the text runs past the button's background: in a segmented
control the last letters leave the white pill and vanish into the dark bar ("Create with A"). Flagged on
buttons, links, tabs and labels, and on any box with a background or border, when the text is more than 2 px
wider than the box.

| Cause | Fix |
|---|---|
| Equal grid columns (`grid-cols-4`) narrower than the longest label | `grid-cols-[repeat(4,auto)]` / `flex`, or hide the icon / shorten the label below `sm` |
| `whitespace-nowrap` with a fixed width | drop the width (`px-3`), or allow two lines |

## Text over text, covered text, protrusion — `text-overlap`, `covered-text`, `protrusion`

| Cause | Fix |
|---|---|
| Absolute text positioned in px over a responsive box | stack in one grid cell: `grid` + `[grid-area:1/1]` on both; the cell grows with the text |
| Fixed height + growing content | `min-h-*` |
| Negative margins or `translate` used for layout | real layout, or only from `md:` (`-mt-8 md:-mt-16`) |
| `line-height` below the font's content area on wrapped headings | `leading-tight` (1.25) or more |
| Overlay controls over text at narrow widths | in flow on phones: `static md:absolute` |
| A dropdown/popup under later content | an ancestor creates a stacking context (`transform`, `filter`, `opacity<1`, `will-change`, `isolation`, `contain:paint`); portal it, remove the property, or raise z on the **stacking-context root**. Keep a small z scale: header 40, overlay 50, toast 60 |
| Child wider than its card | `w-full max-w-*`, `min-w-0`, padding not fixed sizes |

Intentional overlaps (avatar stacks, badges on icons, labels inside inputs): `data-review-allow="overlap"`.

## Items wrapping alone — `orphan-wrap`

A flex-wrap row leaves one item alone on a new line. Switch layout at that width (`grid grid-cols-2
sm:grid-cols-3`), or let items grow (`basis-0 grow`) so rows reflow evenly; `auto-fit` grids:
`grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]`.

## Clashing breakpoints — `breakpoint-overlap`, `breakpoint-gap`

`max-width: 768px` and `min-width: 768px` both apply at 768 (a small-range layout); `max-width: 767px` with
`min-width: 769px` leaves 768 with neither. Use one unit and non-overlapping ranges: Tailwind's `max-md:` /
`md:max-lg:`, or `@media (width < 48rem)` / `(width >= 48rem)`.

## Phones: 100vh, safe areas — `vh-height`

`100vh` = the large viewport (address bar hidden), so `h-screen` heroes run under the URL bar and bottom CTAs
fall off. Use `min-h-svh` for heroes; `h-dvh` only for app shells (it changes as the bar moves). Edge-to-edge
pages need `viewport-fit=cover` (Next: `export const viewport = { viewportFit: "cover" }`) and fixed bars padded
with `pb-[max(1rem,env(safe-area-inset-bottom))]`.

## Sticky headers over anchors — `anchor-under-header`

`html { scroll-padding-top: var(--header-h) }` (Tailwind: `scroll-pt-[72px]` on `<html>`), or `scroll-mt-*`
on targets; keep `--header-h` in sync with a ResizeObserver if the header changes height.

## Layout shift — `layout-shift`, `unsized-image`, `cls`

The check names what **moved** and the likely **cause** (inserted above it, an image without a reserved size,
a font swap) by matching each shift to DOM insertions and loads just before it, on a slowed network.

| Cause | Fix |
|---|---|
| Image/video/iframe without size | `width`/`height` attributes (aspect-ratio follows), `aspect-[16/9]` on the wrapper; next/image `width`/`height`, or `fill` in a sized parent with `sizes` |
| Web font swap | `next/font` (self-hosted, preloaded, size-adjusted fallback by default); plain CSS: a fallback `@font-face` with `size-adjust`/`ascent-override`/`descent-override`; `font-display: optional` for zero shift |
| Banner/cookie bar/promo inserted at the top | `fixed` overlay, or reserve its height in the server HTML; never insert above existing content after paint |
| Client-fetched content | same-size skeletons (`min-h-*`), or server-render/stream it (RSC, `<Suspense>` with a same-size fallback); load-more appends below |
| JS media queries (`useMediaQuery`) choosing a layout after hydration | CSS breakpoints for layout |
| Animating `top/height/margin/width` | `transform`/`opacity` only |

Good is CLS ≤ 0.1 (aim ≤ 0.02 on a marketing page).

## Silencing

`data-review-allow="overflow|clip|overlap|cover|protrude|wrap|all"` on the element or an ancestor, with a
comment in the code saying why.

## Fragile layouts — the stress pass

A layout that fits today's copy by a few pixels breaks on the first longer translation, product name or
number. After the normal sweep, the page is loaded again with every word about 30 % longer (its own letters
repeated, so the font and script stay the same; German and French run 30-40 % longer than English) and every
number two digits longer (a badge of 7 becomes 172), and the audit runs again at 320, 375, 390, 768, 1024 and
1440 px. Findings that appear only then are marked `stress` and listed as **Fragile** (warn): not broken yet,
but one copy change away. Code, keyboard hints and anything with `data-review-allow="stress"` are left as
they are. Off with `--no-stress`.

| Fragile because | Fix |
|---|---|
| Fixed widths sized to the label (`w-[120px]` on a button, equal `grid-cols-4` tabs) | size to content (`w-auto px-4`), `min-w-*` instead of `w-*` |
| `whitespace-nowrap` on labels in a row | let the row wrap (`flex-wrap`) or allow two lines |
| A badge or counter in a tight nav | reserve room for 3-4 digits (`min-w-[2ch] tabular-nums`), or cap the shown number (99+) |
