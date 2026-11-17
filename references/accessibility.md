# Accessibility: criteria, walks and fixes

How to judge and fix what the interaction check finds. Every issue cites a WCAG 2.2 A or AA criterion, or a
task an assistive-technology user cannot complete. Everything else (AAA, APG conventions, one `<h1>`, the 44px
target) is a suggestion, never a must-fix.

## The two walks (step 2, every page)

1. **Keyboard only.** Tab through every flow without a mouse. Each stop shows a visible ring (2.4.7), is never
   fully hidden under sticky chrome (2.4.11), and the order follows reading order (2.4.3). Every pointer action
   has a keyboard path (2.1.1); nothing traps focus (2.1.2).
2. **Screen reader.** Read `reader.txt` (or the accessibility tree via Chrome DevTools `take_snapshot`): every
   control announces a name, a role and its state (4.1.2); the visible label is inside the name (2.5.3).

Then a **Lighthouse** pass for accessibility, SEO and best practices: Chrome DevTools MCP `lighthouse_audit`
(snapshot mode keeps the page's state; it never covers performance), or the Lighthouse CLI. Use its failing
nodes to find the component; a score of 100 is not conformance.

## Thresholds

| Criterion | Applies to | Minimum |
| --- | --- | --- |
| 1.4.3 | Text | 4.5:1 |
| 1.4.3 | Large text (24px, or 18.67px bold) | 3:1 |
| 1.4.11 | Component boundaries, focus rings, states, meaningful graphics | 3:1 |
| 2.5.8 | Target size | 24×24 CSS px, or the spacing exception |

Disabled controls, decorative graphics and logos are exempt from contrast. Text over a photo is judged on the
screenshot, not by the script.

## Severity

- **Must fix:** a task cannot be done, content is hidden from assistive tech, or a systemic failure. On sight:
  a missing accessible name, no visible focus, a pointer path with no keyboard path, motion that ignores reduced
  motion, loss at 320px or 200% zoom, meaning carried by colour alone.
- **Should fix:** the interaction is meaningfully harder.
- **Polish:** isolated.

## Rules that decide the fix

- **Native first.** `<button>` acts, `<a href>` navigates; never `<div onClick>`. Remove ARIA rather than add it.
- **Focus rings.** Style `:focus-visible`. Prefer the browser ring (only add `outline-offset`); a custom ring
  needs a colour that reaches 3:1 against everything it crosses. `outline: none` only with a verified
  replacement. A ring inside an `overflow: hidden` or scrolling parent is clipped: draw it inset, or give the
  parent padding.
- **Composite widgets** (tabs, radio groups, menus, toolbars) are one Tab stop: roving tabindex (active `0`,
  others `-1`), arrows move, Home/End jump. `role="tab"` items sit directly in `role="tablist"` (wrapper `<li>`
  gets `role="presentation"`, or drop the list).
- **Never nest** interactive elements (a link inside a `role="option"`, a button inside a link).
- **Lists and definitions:** `<li>` only in `<ul>`/`<ol>`; `<dt>`/`<dd>` only in `<dl>` (directly or in a `div`).
- **Scrollable regions** with no focusable child get `tabindex="0"` and a name, so keyboard users can scroll them.
- **Hidden things are not focusable.** Content that is visually hidden (opacity 0, off-screen, a closed menu) is
  also `inert` or out of the tab order; content revealed on hover must also reveal on `:focus-visible`.
- **Hover-only content** (tooltips, hints) also opens on focus and on tap, and Esc dismisses it (1.4.13).
- **Labels:** every input has a `<label>`; a placeholder is never a label; valid `autocomplete`; never block paste.
- **Errors:** validate on submit, `aria-invalid` + `aria-describedby` on the field, focus the first error.
- **Announcements:** `role="status"` for result counts and toasts, rendered empty first; `role="alert"` only for
  urgent errors.
- **Dialogs:** `<dialog>` + `showModal()`, or `role="dialog"` + `aria-modal` + `inert` behind; focus in on open,
  back to the trigger on close; Esc closes.
- **Route changes:** update `document.title`; move focus to the new view's `<h1>` or `<main>`.
- **Alt text by purpose:** decorative `alt=""`, informative describes the meaning, functional names the action.
- **Motion:** honour `prefers-reduced-motion` (fade instead of slide/scale); anything moving longer than 5s gets
  a pause (2.2.2).
- **Windows contrast themes:** a filled button or chip with no border becomes floating text: give it a
  transparent border, or a `@media (forced-colors: active)` border, so the shape survives.
- **Zoom and reflow:** works at 320px with no sideways scroll (1.4.10) and 200% text (1.4.4); text boxes use
  `min-height`, never `height`. Never `maximum-scale=1` or `user-scalable=no`.

## Before you finish (grep the diff)

| Pattern | Fix |
| --- | --- |
| `outline-none` with no `focus-visible` style beside it | Restore the ring |
| `onClick` on a `div` or `span` | `<button>` or `<a href>` |
| `role="tab"`/`role="button"` with no `onKeyDown` | Native element, or the APG key map |
| positive `tabIndex` | Fix the DOM order, use `0` |
| `disabled={!isValid}` on submit | Keep enabled, validate on submit |
| `aria-label` that leaves out the visible text | Start the name with the visible text |
| `aria-hidden` on something focusable, or an ancestor of it | Remove it, or make it `inert` |
| `<img>` with no `alt` | `alt=""` or a purpose description |

## Focus lessons from the Arcline review

- **Global focus rules go in `@layer base`.** An unlayered `:focus-visible { outline … }` beats every Tailwind
  `outline-none`, so a field that shows focus on its wrapper also gets a square box of its own.
- **Never change shape on focus.** A global `border-radius` in the focus rule turned round pills square when
  focused; the outline follows the element's own radius.
- **Clipped rings.** Inside `overflow: hidden` or a scroller an outside ring is cut: draw it inset there
  (`:where(.overflow-hidden, .overflow-x-auto, …) :focus-visible { outline-offset: -2px }`), and keep an outside
  ring where the clip is far away (footer links).
- **Fields set into a pill** (email + button): the pill shows the ring, not the input
  (`:has(> input.outline-none:focus-visible)`).
- **Under the sticky header (2.4.11):** give every focusable a scroll margin larger than the header; judge it after
  the scroll settles, not mid smooth-scroll.
- **Label in name (2.5.3):** drop an `aria-label` that reworded the visible text ("Wednesday 18 November, 3 times
  free" for "Wed 18 3 free"); the visible text is the name.
