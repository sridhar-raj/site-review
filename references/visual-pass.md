# The pixel pass: what only looking finds

The Arcline review (14 pages) passed every script, Lighthouse scored 100, and the person still found about
thirty defects one screenshot at a time. Each was small and each was visible. This file is what that taught:
how to look so you find them first, what they were, and the measurement traps that made the scripts wrong.

## The method

1. `scripts/chunks.mjs <every url>`: every page, including every sub-page of a family (each legal document,
   each article type, the 404), at **320, 390, 768 and 1440**. It scrolls slowly first so entrance animations
   have run, then captures screen-sized chunks as a person sees them.
2. Open **every** chunk. Read each one for the list below, a width at a time. 768 is not optional: tablet is
   where grid flow breaks, and it was the width nobody had looked at.
3. `scripts/rhythm.mjs <urls>`: the gaps between sections, measured; flag any that differ from the page's usual gap.
4. Watch the dev server's issue badge and the console (`chunks.mjs` notes console errors per width): a
   duplicate React key showed only on one legal page.
5. Split big sites by page across helpers that each own their components; shared files (nav, footer, global
   CSS, shared sections) go to one owner, reported, not edited in parallel.

## What to look for (each one was a real defect)

| You see | Cause | Fix |
| --- | --- | --- |
| An empty column beside a card or a stack at tablet | A child spans both columns (`md:col-span-2`) between two single-column children, so the next one drops a row | Reorder at that breakpoint (`md:order-last` on the spanning child), or let a lone last item span (`last:odd:col-span-2`) |
| A stranded small card with blank space beside it (tablet) | Desktop side-by-side collapsed to a stack while the card kept its desktop max-width | Put it beside its heading at `md`, or let it take the full width |
| A page 15-70px wider than the phone | A grid with **no base column** (`grid lg:grid-cols-…`): its one implicit column sizes to the widest `nowrap` content | `grid-cols-[minmax(0,1fr)]` at the base; the `lg:` columns still take over |
| A stray arc or half a pill after a label | A tag inside a `truncate` element: the ellipsis clips the tag, leaving its rounded edge | Truncate only the text span; the tag gets `shrink-0`. On phones let the text wrap instead |
| A label on two lines inside a fixed-height button or pill ("Company-wide", "Talk to sales"), text over the border | Fixed height plus a label allowed to wrap | `whitespace-nowrap`; give the column room, or smaller padding/text under 360px |
| A label wrapping one word per line in a narrow column ("No / issues", stat labels) | Three or four columns kept on phones | Rows on phones (number, then label), columns from `sm:` |
| A placeholder or label cut at 320 ("you@company.c") | The input's share of a flex row is a few px short | Less padding under 360px, or drop a decorative part of the button (an arrow tile); never text under 16px in inputs (iOS zoom) |
| An icon tile and its text not lined up | `items-start` with single-line text beside a taller tile | `items-center` (two-line text still reads well centred against a tile) |
| A number prefix low against its heading ("02 Acceptable use") | Small mono text on the heading's baseline | Heading as `flex items-center`, number `shrink-0` |
| A logo a few px high in a bar | An `inline-flex` logo inside an inline link: the line box adds descender space | The link `flex` (or `block`) |
| Invisible labels | Colour left over from a dark version of the section (`text-white/75` on a white card) | Grep `text-white/` and check each sits on a dark fill |
| Square focus box inside a rounded field | An unlayered global `:focus-visible` beating the field's `outline-none` | Global focus rules in `@layer base`; a pill field shows its ring on the pill (`:has(> input:focus-visible)`) |
| `truncate` / `whitespace-nowrap` ignored, labels wrapping anyway | An unlayered global `text-wrap: pretty` on `p, li, dd` (the shorthand resets wrapping) | `text-wrap-style: pretty` (or `balance`) inside `@layer base` |
| A scaled product screenshot that falls apart on phones | An embedded app whose responsive rules follow the **window** (`@media`), not its own width | Container queries on the embed (`container-type: inline-size`), so a 1440px-wide scaled app keeps its layout |
| A filter that greys items out instead of hiding them | "Fade the non-matching" read as broken | Filter for real; the list closes up with a layout animation |
| An element half-hidden under the sticky header after Tab | No scroll margin on focusables | `:where(a[href], button, input, select, textarea, summary, [tabindex]) { scroll-margin-block: <header + 30px> 24px }` |
| Gaps between sections from 80 to 224px | Mixed `py-*` and `pb-*` sections; bands with backgrounds | One `--section-gap` token as each section's bottom padding; bands pad both sides inside; the section after a band pads its top |

## Measurement traps (each produced a false finding here)

- **Animations not run.** Sections reveal on scroll (`whileInView`). A full-page shot or a measurement without
  a slow scroll shows blank sections, cards 12-16px low ("spill"), wrong gaps. Scroll slowly first; measure in
  place, not after scrolling back to the top (some reveals reverse when they leave the screen).
- **Mid-scroll.** With `scroll-behavior: smooth`, a Tab stop measured at once is mid-animation and reads as
  hidden under the header. Wait for `scrollY` to hold still for a few frames (the interaction check now does).
- **Text over pictures.** White text on a photo reads 1:1 against the box behind it: judge it on the screenshot.
- **Mid-fade.** A badge measured during its fade-in fails contrast; re-measure it settled.
- **Disabled controls** (taken slots) are exempt from contrast (1.4.3).
- **Clipped decoration.** Content inside a panel that crops it (a product screenshot) and corner marks on a
  border are not the section's edge; measure the panel or the border.
- **Dev overlay.** `nextjs-portal` is the framework's dev tool, not the page: never a finding.

## Gaps the checks still have (check these by hand)

- **States.** The pixel pass captures the default state. Click every tab, filter, toggle, slider end, rule and
  accordion yourself at 390 and 1440: a tooltip forced onto one line and a tab rail that hid the selected tab
  were only visible after a click.
- **Short laptop screens.** A sticky element taller than the screen hides its bottom on 1280×720 and 1024×768.
  Check any sticky column at those sizes; pin it only from a min-height (`[@media(min-height:880px)]:sticky`).
- **Rings on a parent.** The focus check looks 8px around the element; a ring drawn on a pill around a field
  reads as missing. Confirm on the picture.
- **Rings drawn inside the edge** are reported as clipped; they aren't.
- **Inert or scaled embeds** (a product screenshot built from live components, marked `inert` and
  `data-qa-allow`): covered-text and focus findings inside them are not defects.
- **Marquees.** A horizontally scrolling row of logos is clipped on purpose.
- **Shared components** report once per page (a footer pill on every page): fix once, in the component.
- **Content, not layout.** Every article showing the same body passed every check. Read a few pages of a
  repeated template to see that each has its own content.
