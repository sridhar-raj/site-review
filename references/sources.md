# Sources

The research behind the checks. Where a detail could not be re-verified against its source at the time of
writing, it is marked (unverified).

## Responsive layout failures

- Walsh, Kapfhammer, McMinn. *Automated layout failure detection for responsive web pages without an explicit
  oracle.* ISSTA 2017 (ReDeCheck): five failure kinds (element collision, element protrusion, viewport
  protrusion, wrapping, small-range layouts) found by comparing layout graphs across widths; 33 failures on 16
  of 26 production pages. The exact sampling step and small-range threshold are (unverified).
  https://eprints.whiterose.ac.uk/id/eprint/116989/
- Walsh et al. *VISER*, ICST 2019: confirms each reported failure by hiding the elements and comparing
  screenshots; removes invisible false positives. https://eprints.whiterose.ac.uk/id/eprint/230100
- *VERVE*, STVR 2021: visual verification for all five kinds. https://eprints.whiterose.ac.uk/165542
- Althomali, Kapfhammer, McMinn. *LayoutDR*, ICST 2022: repairs a failing width range by transplanting the
  layout from a nearby working width. https://eprints.whiterose.ac.uk/id/eprint/230094
- Mahajan, Alameer, McMinn, Halfond. *XFix* (ICSE 2017) and *IFix* (ICST 2018): search-based CSS repair;
  IFix clusters elements by shared style so one repair fixes all similar elements. https://github.com/USC-SQL/ifix

## Layout shift, viewport, overflow

- web.dev: CLS https://web.dev/articles/cls · Debug layout shifts https://web.dev/articles/debug-layout-shifts ·
  Optimize CLS https://web.dev/articles/optimize-cls · size-adjust https://web.dev/articles/css-size-adjust ·
  viewport units https://web.dev/blog/viewport-units
- Layout Instability spec https://github.com/WICG/layout-instability · MDN LayoutShiftAttribution
  https://developer.mozilla.org/en-US/docs/Web/API/LayoutShiftAttribution
- MDN overflow (clip vs hidden), overflow-wrap, env(): https://developer.mozilla.org/en-US/docs/Web/CSS/overflow
- CSS-Tricks: flexbox truncation (min-width: 0), preventing a grid blowout.

## Interaction and accessibility

- WCAG 2.2 Understanding: 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured, 2.4.13 Focus Appearance, 2.5.8 Target
  Size (Minimum), 1.4.13 Content on Hover or Focus, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order, 2.4.1 Bypass
  Blocks, 2.3.3 Animation from Interactions, 2.2.2 Pause, Stop, Hide. https://www.w3.org/WAI/WCAG22/Understanding/
- WAI-ARIA APG: dialog (modal), menu button. https://www.w3.org/WAI/ARIA/apg/patterns/
- Vercel Web Interface Guidelines https://vercel.com/design/guidelines
- Chrome DevTools Protocol `CSS.forcePseudoState`
  https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-forcePseudoState
- Tailwind CSS v4 upgrade guide (button cursor, ring width, outline-hidden) and hover media query
  https://tailwindcss.com/docs/upgrade-guide · https://tailwindcss.com/docs/hover-focus-and-other-states
- axe-core rule descriptions https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md
- NN/g, animation duration https://www.nngroup.com/articles/animation-duration/

## Performance

- web.dev: Optimize LCP (the four parts) https://web.dev/articles/optimize-lcp · INP https://web.dev/articles/inp ·
  Optimize INP https://web.dev/articles/optimize-inp
- Chrome: Long Animation Frames https://developer.chrome.com/docs/web-platform/long-animation-frames ·
  Lighthouse 13 insights https://developer.chrome.com/blog/moving-lighthouse-to-insights
- Lighthouse throttling https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md
- Next.js: Image (`priority` deprecated in 16, `preload`, `qualities`), Script (`worker` not in the App Router),
  Font, Package bundling (`next analyze`) https://nextjs.org/docs/app/api-reference/components/image
- DebugBear, network throttling methods https://debugbear.com/blog/network-throttling-methods
- web-vitals attribution build https://github.com/GoogleChrome/web-vitals
