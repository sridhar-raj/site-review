# Worst case: what breaks and why

The layout check's stress pass makes every text 30% longer and every number bigger. This file is for reading
what it finds, and for testing a component with realistic worst-case data by hand.

Two rules. **Plausible, never random:** every value is something a real user could produce, or the real limit
from the schema or API (`aaaa…` proves nothing). **Change the data, not the component:** feed the worst case
through the same props, fixture or mock the demo data uses; never edit markup to make it break.

## What you see → the cause → the fix

| On the screenshot | Cause | Fix |
| --- | --- | --- |
| Avatar or icon squashed into an oval | Flex child shrinking | `shrink-0` on every fixed-size box |
| Text runs out of its box | Flex/grid child keeps `min-width: auto` | `min-w-0` on the text column, `minmax(0,1fr)` in grids |
| Email or URL runs past the edge | No break opportunity | `overflow-wrap: anywhere` (`[overflow-wrap:anywhere]`) on that element |
| Trailing button or menu pushed off or clipped | Middle content took the space | `min-w-0` on the middle, `shrink-0` on the action |
| Badge wraps to two lines | Badge allowed to shrink | `whitespace-nowrap shrink-0` on the badge; decide what yields |
| Icon adrift beside a three-line name | `items-center` on rows of varying height | `items-start` once text can wrap |
| Last row cut mid-glyph | Fixed height + `overflow: hidden` | `min-height`, or a visible scroll/fade |
| Heading breaks mid-word | `break-all` | `overflow-wrap: anywhere` |
| A form or row wider than a 320px phone | Fixed `min-width`/`width`, or `flex` with no wrap | `flex-wrap`, `w-full`, `min-w-0`; let the input shrink |
| "1 members", "0 member" | Hard-coded plural | `Intl.PluralRules` or a string per count |
| Numbers jitter as they change, columns misalign | Proportional figures | `tabular-nums` |
| `1284`, `NaN`, `undefined` on screen | Raw value | `Intl.NumberFormat`; guard nulls |
| Translated or longer button label overflows | Fixed-width button | Width from content, `min-width` only |
| Diacritics clipped top or bottom | Tight `line-height` + `overflow: hidden` | Looser line-height, no clipping on text |
| Broken-image icon | No fallback | `onError` fallback (initials), `object-cover` |
| Ellipsis with no way to read the rest | `truncate` alone | `title`, or the full value elsewhere |

## Truncate, wrap or clamp (decide per field)

- **Wrap** what identifies a thing (names, titles in detail views).
- **Truncate at the end** secondary metadata, with a way to see it all.
- **Truncate in the middle** values that differ at the end: file names, long shared-domain emails, hashes.
- **Clamp** multi-line previews in cards (`line-clamp-2`) when equal card heights matter.
- **Never truncate** numbers, money, dates or anything compared.

These are design decisions: in a no-UI-change review, list them as suggestions rather than fixing them.

## Realistic worst-case values

- **Names:** `Aleksandra Wiśniewska-Kowalczyk` (long, hyphen, diacritics) · `Jo` (very short) · `Đặng Thị
  Ngọc Hân` (stacked diacritics) · `王秀英` (CJK, no spaces) · `نور الهدى` (RTL) · `🦊 Fox` (emoji first breaks
  `.charAt(0)` initials) · missing name (email only).
- **Unbreakable strings:** `bartholomew.fitzgerald@northwind-industries-holdings.example.com` · a long URL with a
  query string · a UUID · `Q3 Board Deck — FINAL (revised) v12.pdf` · German compounds like
  `Benachrichtigungseinstellungen`.
- **Copy:** a long job title or status badge, twelve tags on one item, French or German UI copy (~30% longer),
  `<b>`/`&amp;`/`**x**` (must render literally), a newline in a one-line field, an empty title.
- **Numbers:** `0`, `1`, `1,284`, `1,000,000`, a negative, over-100% progress, `null`, a value that ticks live.
- **Collections:** 0 items (is there an empty state?), 1 item, exactly a page and a page + 1, 1,000+ unpaginated,
  one item 10× the size of the others.
- **Time:** now ("just now", not "0 seconds ago"), 12 days ago (switch to a date), a future date, a timezone edge.
- **Media:** an image that 404s, none at all, a 4000×200 panorama, a dark logo on dark mode, a slow image.
- **States:** loading, an API error, partial data, every status at once, no permission.
- **Environment:** a 320px container, a narrow sidebar, 2560px wide, 200% zoom, dark mode, `dir="rtl"`, touch.

Report each break as **Broken** (unreadable, unreachable, wrong data), **Ugly** (readable but visibly wrong) or
**Fragile** (fine now, one realistic step from breaking), with the value that caused it.
