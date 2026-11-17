# Interaction: hover, focus, overlays, touch, motion

`interaction-check.mjs` finds these. Hover is forced through the DevTools protocol (`CSS.forcePseudoState`),
so it is deterministic and has no pointer side effects; elements with JS hover handlers (`onMouseEnter`,
`aria-haspopup`) also get a real hover to see what opens. Every phase runs on a freshly loaded page, with any
popup open on arrival closed first, the way a visitor would.

## Hover

| Finding | Cause | Fix (Tailwind v4) |
|---|---|---|
| `no-hover` | no style change on the element or its children | a hover state with more contrast than rest: `hover:bg-*`, `hover:text-*`, an underline, a shadow (Vercel guidelines) |
| `hover-shift` | hover adds a border, padding or bolder weight | `border border-transparent hover:border-zinc-700`; `ring`/`outline`/`shadow` (no layout cost); bold on hover: reserve the width with a hidden bold copy (`after:content-[attr(data-text)] after:font-semibold after:invisible after:block after:h-0`) |
| `transition-all` | `transition: all` animates everything, layout included | `transition-[color,background-color,transform]` / `transition-colors` |
| `layout-transition` | width/height/top/left/margin/padding animated | `transform`/`opacity` only |
| `hover-duration` | under 50 ms snaps, over 400 ms lags | 100-250 ms for hover (`duration-150 ease-out`); menus 150-250, modals 200-300; exits ~75 % of entries |
| `cursor` | a clickable `div`/`button` shows the arrow | `cursor-pointer`; Tailwind v4 changed buttons to `cursor: default`: `@layer base { button:not(:disabled), [role="button"] { cursor: pointer } }` |
| `popup-offscreen` | a menu/tooltip opens past the edge | collision handling: Floating UI `flip()`/`shift()`, Radix `avoidCollisions`, CSS anchor positioning |
| `popup-covered` | it opens behind content: an ancestor's `transform`/`filter` traps its z-index, or a card's `overflow-hidden` | a portal (Radix `Portal`, `createPortal` to body) or the `popover` attribute |
| `state-unannounced` | one control in a row (tabs, segmented buttons, nav) looks selected but carries no state: screen readers can't tell which one is on | tabs: `role="tab" aria-selected`; nav: `aria-current="page"`; toggles: `aria-pressed`. A control with any of these (or Radix `data-state="active"`) is not flagged for `no-hover`: the current item often has no hover on purpose |
| Flicker | the hover state moves the element out from under the pointer (`hover:-translate-y-2` on a chip) | keep the hit box still: `group` on the wrapper, `group-hover:-translate-y-1` on the inner child |

In v4 `hover:` is already inside `@media (hover: hover)`, so content revealed on hover must start visible on
touch (see `hover-only` below). Tooltips must be dismissible (Esc), hoverable and persistent (WCAG 1.4.13);
delay the first one ~300-500 ms, the rest instant.

## Focus (keyboard)

| Finding | Fix |
|---|---|
| `no-focus-ring` (WCAG 2.4.7) | `@layer base { :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px } }`; replace `outline-none` with `outline-hidden` (v4 keeps it in forced-colors mode) plus a visible ring. A v4 `ring` is 1 px currentColor by default (v3 was 3 px blue): set its width and colour. Use `focus-visible:`, not `focus:` |
| Appearance bar (2.4.13 AAA, a good target) | the indicator covers at least a 2 px perimeter and changes ≥ 3:1 against the unfocused pixels |
| `focus-ring-clipped` | an `overflow-hidden` parent: `focus-visible:outline-offset-[-2px]` (inset) or `p-1 -m-1` on the parent |
| `focus-obscured` (2.4.11) | a sticky header or cookie bar covers it: `html { scroll-padding-top/bottom }` equal to the bar |
| `invisible-focus-stop` | a closed menu still tabbable (moved off with a transform): `inert` on closed panels (React 19: boolean; 18: `inert=""`), or `invisible` with the transform |
| `positive-tabindex` (2.4.3) | `tabindex` 0 or none; order the DOM. CSS `order`, `flex-row-reverse` and grid placement also scramble the reading order |
| `focus-trap` (2.1.2) | trap only inside an open modal and release it on close |
| `no-skip-link` (2.4.1) | first in `<body>`: `<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">Skip to content</a>` and `<main id="main" tabIndex={-1}>` |

## Custom widgets with the keyboard

| Finding | Fix |
|---|---|
| `not-focusable` (WCAG 2.1.1) | something has a click handler (or a widget role) but Tab never reaches it: use `<button>` (or `<a href>` to navigate); a div needs `tabIndex={0}`, a role and key handlers |
| `no-key-activation` | a focusable fake button that ignores Enter and Space: use `<button>`; otherwise `onKeyDown` calls the click handler for Enter and Space |
| `tablist-arrows` | `role="tablist"` promises the ARIA tabs pattern: arrows move between tabs, Tab leaves the list. Radix Tabs / Headless UI do it; by hand, a roving `tabIndex` (0 on the selected tab, -1 on the rest) and ArrowLeft/Right/Home/End. A row of page links is navigation, not tabs: drop `role="tab"` and use `aria-current="page"` instead |
| `slider-keys` | `role="slider"` must step with the arrow keys and update `aria-valuenow`; or use `<input type="range">` / Radix Slider |

## Screen readers, voice control and contrast themes (always run)

| Finding | Fix |
|---|---|
| `image-name` (1.1.1) | `alt` that says what it shows; `alt=""` for decoration; a logo's alt is the company name. "image", "photo" or a file name is not a name |
| `label-in-name` (2.5.3) | the button shows "Try it free" but is announced "Get started for free": voice-control users say what they see and nothing happens. Start the `aria-label` with the visible words, or drop it |
| `no-h1`, `no-main-landmark` | most screen-reader users start a page by its headings or jump to main: one `h1` (visually hidden in an app shell if needed) and `<main id="main">` |
| `captions-review` (1.2.2) | needs a person: a video with speech needs `<track kind="captions">`; a muted decorative loop needs none |
| `forced-colors-edge` | Windows contrast themes remove author backgrounds: a filled button with no border becomes floating text. `border border-transparent` (the transparent border is drawn in the theme), or a `forced-colors:` variant |
| `forced-colors-icon` | icons with a fixed `fill`/`stroke` keep that colour on the theme's ground (dark grey on black vanishes): `fill="currentColor"` |

`reader.txt` lists the page as Chrome's accessibility tree has it (the data screen readers read), in order:
landmarks, headings with levels, links, buttons, fields, images; ✗ marks anything without a name. Read it top
to bottom: does it make sense without the screen? `forced-colors.jpg` is the page in a contrast theme.
Focus visibility is judged by screenshot (the stop's box focused and not), so a ring the colour of the
background counts as missing and a ring drawn by a parent counts as present.

## Without axe: the built-in basics

When `@axe-core/playwright` isn't installed, the check runs the failures axe reports most, so a review never
ships with no accessibility check at all, and says so in its summary:

| Finding | Fix |
|---|---|
| `no-accessible-name` | icon-only buttons and links: `aria-label`, or visually hidden text (`<span class="sr-only">`) |
| `no-label` / `placeholder-label` | a visible `<label htmlFor>`, or `aria-label`; a placeholder disappears once you type |
| `no-lang` | `<html lang="en">` (Next: in `app/layout.tsx`) |
| `heading-skip` (info) | keep levels in order; style with classes, not by picking a smaller tag |

Install axe for the rest (colour contrast in context, ARIA validity, landmarks, duplicate IDs, list structure).

## Menus, dialogs, drawers

Each trigger (`aria-haspopup`, `aria-expanded`, `aria-controls`) is opened and tested (WAI-ARIA APG dialog and
menu-button patterns):

| Finding | Fix |
|---|---|
| `esc-no-close` | close on Escape; native `<dialog>.showModal()`, the `popover` attribute, Radix and Headless UI do it |
| `focus-not-returned` | return focus to the trigger on close |
| `dialog-focus` | move focus into the dialog when it opens |
| `scroll-not-locked` | lock body scroll while open, `overscroll-contain` inside |
| `scrollbar-jump` | the scrollbar disappears and centred content jumps (~15 px on Windows; the check forces a classic scrollbar so it shows on a Mac): `html { scrollbar-gutter: stable }`, or the library's `padding-right` compensation, also on fixed bars (`var(--removed-body-scroll-bar-size)`) |
| `menu-stays-open` (phone) | the App Router keeps the layout across navigation, so menu state survives: `const pathname = usePathname(); useEffect(() => setOpen(false), [pathname])`, and close in the link's `onClick` for hash links |

## Touch and phones

| Finding | Fix |
|---|---|
| `tap-target` (WCAG 2.5.8: 24 px, or 24 px of spacing) | `min-h-11 min-w-11` (44 px, Apple HIG and WCAG 2.5.5), or an invisible hit area: `relative after:absolute after:-inset-2 after:content-['']`; `gap-2` between icon buttons. Inline links in text are exempt |
| `small-tap` | 24-43 px buttons: fine for WCAG AA, small for thumbs |
| `ios-zoom` | Safari zooms on focus when an input is under 16 px: `text-base md:text-sm`. Never fix it with `maximum-scale=1` |
| `zoom-disabled` | remove `user-scalable=no` / `maximum-scale`; Next: `export const viewport = { width: "device-width", initialScale: 1 }` without `maximumScale`/`userScalable` |
| `hover-only` | revealed only on `:hover`, so invisible on touch: `opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100` (or `[@media(hover:hover)]:opacity-0`) |
| `sticky-cover` (> 25 % of the screen) | a compact sticky header (`h-14`) that hides on scroll down; bottom bars: `pb-[calc(var(--bar-h)+env(safe-area-inset-bottom))]` on `main` |
| Hover-only menus (open on `mouseenter` only) | also open on click/tap and keyboard; gate hover opening with `matchMedia('(hover: hover) and (pointer: fine)')` |

Also worth setting: `touch-action: manipulation` on controls (`touch-manipulation`), and
`-webkit-tap-highlight-color: transparent` only when a custom `active:` state exists.

## Motion

| Finding | Fix |
|---|---|
| `reduced-motion` | `motion-safe:animate-*` / `motion-reduce:animate-none`; global: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important } }`; Framer Motion `<MotionConfig reducedMotion="user">`; canvas/WebGL: render one still frame. Reduce motion, keep meaning: crossfades are fine. Loops over 5 s need pause/stop (WCAG 2.2.2) |
| Scroll jank | `scroll` listeners writing styles, non-passive `wheel`/`touchmove`, `background-attachment: fixed`, JS-animated `top`: CSS scroll-driven animations (`animation-timeline: scroll()/view()`), IntersectionObserver for reveals, `{ passive: true }`, reads then writes in rAF, `transform` instead of `top` |

## axe-core

With `@axe-core/playwright` installed, axe runs at desktop and phone (WCAG 2.0-2.2 A/AA); serious and critical
violations become findings with their help link. axe does not cover focus visibility, hover, motion, order or
traps: the checks above do.
