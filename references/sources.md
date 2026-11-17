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

## Contrast

- WCAG 2.2 Understanding 1.4.3 Contrast (Minimum): 4.5:1 for text, 3:1 for large text (24 px, or 18.66 px bold).
  https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- The background is read from the hit-test stack (`document.elementsFromPoint`) at the middle of each text's
  first line, compositing semi-transparent layers down to the first opaque one, so a positioned pill or card
  behind the text counts. https://developer.mozilla.org/en-US/docs/Web/API/Document/elementsFromPoint

## Fragile layouts, keyboard widgets, field data

- Pseudo-localisation: lengthening strings ~30-40 % to find layouts that break when translated. W3C
  Internationalization, text size in translation https://www.w3.org/International/articles/article-text-size
- WAI-ARIA APG Tabs pattern (arrow keys, roving tabindex) https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ ·
  Slider pattern https://www.w3.org/WAI/ARIA/apg/patterns/slider/
- WCAG 2.2 Understanding 2.1.1 Keyboard https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- Chrome UX Report API https://developer.chrome.com/docs/crux/api · PageSpeed Insights API
  https://developers.google.com/speed/docs/insights/v5/get-started
- Visual regression by screenshot diffing, with self-changing regions masked: the approach of Playwright's
  `toHaveScreenshot` https://playwright.dev/docs/test-snapshots
- Design Skills Library, accessibility-skill before/after study: the screen-reader list from Chrome's
  accessibility tree, focus visibility checked by screenshot, the 320px reflow test, forced-colours screenshots,
  findings tagged with WCAG criterion and who they affect, REVIEW items for a person. Its own figures (a 56-check
  benchmark, "68% of screen-reader users start by headings") are its claims, not re-checked here.
  https://design-skills-library.vercel.app/a11y/
- WCAG 2.2 Understanding 2.5.3 Label in Name https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html ·
  1.4.11 Non-text Contrast https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html · 1.4.10 Reflow
  https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- MDN forced-colors https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors · Chrome DevTools
  Protocol Accessibility.getFullAXTree https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/

## Folded-in skills

Condensed and rewritten from three agent skills (read in full before use):

- *better-accessibility* (jakubkrehel/skills): WCAG 2.2 criteria per finding, severity rules, focus and keyboard
  patterns, the before-you-finish grep → `accessibility.md`. https://github.com/jakubkrehel/skills
- *web-quality-audit* and *accessibility* (addyosmani/web-quality-skills, MIT): evidence-led audits, the
  Lighthouse pass via Chrome DevTools MCP, "a score of 100 is not conformance" → `accessibility.md`, step 2.
  https://github.com/addyosmani/web-quality-skills
- *break-ui* (emilkowalski/skills): plausible worst-case data, the failure-signature table, truncate / wrap /
  clamp → `worst-case.md`. https://github.com/emilkowalski/skills
