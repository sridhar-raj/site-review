# Performance: measure properly, find the cause, fix it

`perf-check.mjs` measures and diagnoses. This file is the fix playbook and the rules for trusting a number.

## Rules for numbers

- **Production only.** `next dev` is unminified, runs React dev mode and Strict Mode double renders. Measure
  `next build && next start`, a preview or the live URL. The check detects a dev server and says so.
- **Cold runs, fresh contexts, medians.** Default 3 runs; use 5-9 before claiming an improvement. The spread
  is printed; over 20 %, add runs.
- **Same settings before and after** (profile, CPU rate, runs, machine). `compare.mjs` warns when they differ.
- **Throttling:** Lighthouse mobile (150 ms RTT, 1.6 Mbps simulated = 562.5 ms / 1.47 Mbps applied, 4× CPU).
  CPU throttling is relative to this machine: on Apple silicon 4× is still fast; `--cpu 6` is closer to a
  mid-range Android.
- **Noise:** under ~15 % on LCP/TBT, under 0.02 on CLS. Claim an improvement only when the after-median is
  outside the before range, and when the **mechanism** changed (the LCP image now has `fetchpriority=high`;
  the render-blocking list shrank; that origin's main-thread time dropped). A number that moved without its
  mechanism changing is noise.
- Lab proves the mechanism; field data (Vercel Speed Insights, CrUX, PageSpeed Insights) proves user impact.

## Targets

| Metric | Good | Poor |
|---|---|---|
| LCP | ≤ 2.5 s | > 4 s |
| INP (lab: slowest tested interaction) | ≤ 200 ms | > 500 ms |
| CLS | ≤ 0.1 | > 0.25 |
| FCP | ≤ 1.8 s | > 3 s |
| TTFB | ≤ 0.8 s | > 1.8 s |
| TBT (lab) | ≤ 200 ms | > 600 ms |

Budgets for a marketing page (opinion, not a standard): ≤ 1.5 MB on phones, JS ≤ 300 KB compressed, CSS ≤ 50
KB, LCP image ≤ 150 KB, ≤ 2 font files, ≤ 5 third-party origins, DOM ≤ 1,500 elements.

## LCP: fix the biggest of its four parts

Targets (web.dev): TTFB ~40 %, load delay < 10 %, load time ~40 %, render delay < 10 %.

| Finding | Fix |
|---|---|
| `lcp-lazy` | Next 16: `<Image loading="eager" fetchPriority="high" sizes="…">` (`priority` is deprecated in 16; Next 15: `priority`); plain: no `loading="lazy"`, `fetchpriority="high"`, `width`/`height` |
| `lcp-priority` (late start) | `fetchPriority="high"`; `sizes` on `fill` images; use `preload` only for one viewport-independent image found late |
| `lcp-video-poster` | preload the poster with high priority (`<link rel="preload" as="image" fetchpriority="high">`, or `ReactDOM.preload` in the layout), or an `<Image fetchPriority="high">` first frame with the video faded in; `preload="none"` on the video |
| `lcp-background` (CSS background) | make it an `<img>`/`<Image>`, or preload it with `imagesrcset` and `fetchpriority="high"` |
| `lcp-client` | render the hero as a Server Component; push `'use client'` down to the interactive leaf; never fetch hero content in `useEffect` |
| `lcp-render-delay` | an entrance animation from `opacity:0` delays LCP: animate a wrapper from `opacity: 0.01`, or skip the first-paint animation; also fonts or JS holding the paint |
| `lcp-heavy` | AVIF/WebP: `images: { formats: ['image/avif','image/webp'] }`; Next 16 serves quality 75 unless you add others to `images.qualities` |
| `ttfb` | cache the route: Next 15 `revalidate` / `fetch(..., { next: { revalidate } })`; Next 16 with `cacheComponents`: `'use cache'` + `cacheLife`, Partial Prerendering; remove `cookies()`/`headers()` from layouts that don't need them; check `x-vercel-cache: HIT` |

## First paint — `fcp`, `render-blocking`

A first paint far behind TTFB means something blocks rendering. The check lists the blocking files and when
each finished. Usual fixes: smaller critical CSS (a huge global import, a CSS-in-JS runtime), no blocking
scripts in `<head>` (`next/script` with `afterInteractive`/`lazyOnload`), fonts through `next/font` instead of a
Google Fonts `<link>`, and a server-rendered first screen instead of a client-rendered shell.

## JavaScript and the main thread

| Finding | Fix |
|---|---|
| `js-weight`, `tbt`, `unused-js` | Server Components by default; `dynamic(() => import('./Heavy'), { ssr: false, loading: … })` (in the App Router only inside a Client Component); import modals, carousels, charts and editors on interaction; `experimental.optimizePackageImports` for icon/util barrels; replace heavy libraries (moment → Intl/date-fns); `<Suspense>` to stream; React Compiler (`reactCompiler: true`, stable in Next 16) |
| Bundle analysis | Turbopack (Next 16 default): `next analyze --output` (16.1+), `next analyze export` to a JSONL module graph (16.4+); Webpack: `@next/bundle-analyzer` |
| `third-party` | `<Script strategy="lazyOnload">` for chat and widgets, `afterInteractive` only for analytics; facades for YouTube, maps and chat (a still that loads on click); `@next/third-parties`; `strategy="worker"` (Partytown) does **not** work in the App Router; `preconnect` to at most 2-4 early-critical origins |
| `long-frame` | break up the work (`await scheduler.yield()`, `setTimeout`), move it off load, lazy-load the component |
| `layout-thrash` | read layout (`offsetWidth`, `getBoundingClientRect`) before writing styles, batched in rAF |
| `slow-interaction` | by its worst phase: **input delay** → less on the main thread then (hydration, timers, third parties); **processing** → update the UI first, then the heavy work (`startTransition`, `await scheduler.yield()`), memoise, smaller state; **presentation** → smaller DOM and re-render scope, `content-visibility: auto` |
| `dom-size` | virtualise long lists, paginate, don't render hidden mobile and desktop copies; `content-visibility: auto; contain-intrinsic-size: auto 800px` on below-fold sections |

## Images, fonts, video

| Finding | Fix |
|---|---|
| `image-oversized` | `sizes` that match the layout, e.g. `sizes="(min-width: 1024px) 33vw, 100vw"`; srcset in plain HTML |
| `image-format` | AVIF/WebP (next/image does it) |
| `lazy-above-fold` | `loading="eager"` on first-screen images |
| `fonts` | one variable font via `next/font`, `subsets: ['latin']`, `adjustFontFallback` on, unused weights dropped; `display: 'optional'` when the swap's shift matters more than the brand font on first view; static sites: self-hosted WOFF2 with `<link rel=preload as=font crossorigin>` and a size-adjusted fallback (Fontaine/Capsize) |
| `video` | `<video muted playsInline autoPlay loop preload="none" poster="/hero.avif">`, the source swapped in after load or on visibility, ≤ 1-2 MB, a still on phones |
| WebGL/canvas | start after LCP (`requestIdleCallback`), pause off-screen and on `visibilitychange`, DPR ≤ 2, a static poster underneath, a still under reduced motion |

## Field data (`--field`)

Lab runs are a floor; visitors' devices and networks decide. `--field` adds the Chrome UX Report's p75 over
the last 28 days for a **public https URL** (never localhost; the URL is sent to Google): the CrUX API when
`CRUX_API_KEY` is set (fast, this URL), else PageSpeed Insights' field section (slower; key-less calls share one daily quota that runs out, so set
`PSI_API_KEY`, a free Google Cloud key; falls
back to the whole origin when the URL has too little traffic). LCP, INP and CLS that are not "good" become
`field-lcp` / `field-inp` / `field-cls` findings. Thresholds: LCP 2.5 / 4 s, INP 200 / 500 ms, CLS 0.1 / 0.25.
Field numbers trail a fix by about 28 days: prove a speed fix in the lab (same settings, medians), and say
when the field will show it.

## More: INP, bfcache, delivery, third parties, hygiene

Folded in from the quality skills (see sources.md). The Where column names the section above each row extends; finding ids in backticks are not produced by `perf-check.mjs` yet, so judge them from a trace or by hand.

Each row names where it goes: `§Rules`, `§LCP`, `§FCP`, `§JS`, `§Images`, `§Field` are the existing sections; `NEW §…`
is a new section, placed after the one named. Finding ids in backticks are proposals for `perf-check.mjs`; rows
without one are judged by hand. React/Next code fixes cite rules in `~/.claude/skills/vercel-react-best-practices`
(`rules/<id>.md`): link them, don't copy them.

### Rules for numbers (append to §Rules)

| Where | Add |
|---|---|
| §Rules, after "Noise" | **Neutral is a revert.** A fix whose after-median sits inside the before range is undone, not kept "since it can't hurt"; log it (idea · before → after · verdict · why) in the change list so it is not proposed again. |
| §Rules, after "Noise" | **One change per measurement.** Fixes landed together give one number nobody can attribute; measure each alone, then together. |
| §Rules, last line | No runtime evidence (source only) → call it a **hypothesis**, never "LCP is failing"; give the command that would prove it. |
| §Rules, last line | Never send performance through Chrome DevTools MCP `lighthouse_audit` (it skips performance); a trace is `performance_start_trace` → `performance_analyze_insight` on the failing metric's insights only. |

### INP: diagnose one interaction (NEW §INP, after §JS; the `slow-interaction` row stays, this is how to get there)

| Where | Step / finding | Do |
|---|---|---|
| NEW §INP | Pick interactions | the ones a visitor makes on this page: menu toggle, tab, accordion, CTA, form field typing, filter. Click each under 4×/6× CPU after load **and** during hydration (input delay hides there). |
| NEW §INP | Measure | `PerformanceObserver({type:'event', buffered:true, durationThreshold:40})`: per entry `duration`, input delay = `processingStart − startTime`, processing = `processingEnd − processingStart`, presentation = the rest. Session data, not field INP. |
| NEW §INP | Attribute | `long-animation-frame` entries overlapping the event: `scripts[].sourceURL` / `invoker` names the owner (first- or third-party). Field: `web-vitals/attribution` `onINP()` (target, type, LoAF). |
| NEW §INP | `inp-input-delay` | a long task already running: hydration, timers, third-party init → split startup work, defer third parties (below), smaller client islands (`bundle-dynamic-imports`, `bundle-conditional`). |
| NEW §INP | `inp-processing` | paint feedback first, then the work: set the pressed/loading state, `await scheduler.yield()` (fallback `setTimeout(0)`), then compute; analytics in `requestIdleCallback` (`js-request-idle-callback`); `startTransition` / `useDeferredValue` for the heavy re-render (`rerender-transitions`, `rerender-use-deferred-value`); CPU-heavy work to a Worker. |
| NEW §INP | `inp-presentation` | large invalidation after the handler: narrower re-render scope (`rerender-memo` only where the profile shows it), fewer DOM nodes touched, no read-after-write layout. |
| NEW §INP | Watch out | deferring a widget until first click makes that click pay its whole init: show feedback immediately and preload on hover/focus (`bundle-preload`). Chunk sizes come from the trace, not a fixed item count. |

### Back/forward cache (NEW §bfcache, after §INP)

| Where | Finding | Fix |
|---|---|---|
| NEW §bfcache | `bfcache-blocked` (measurable: navigate away and `page.goBack()`, then `performance.getEntriesByType('navigation')[0].notRestoredReasons` in Chrome 123+, or `pageshow` `event.persisted === false`) | report the reasons; a restored back nav is ~instant and costs no LCP |
| NEW §bfcache | `unload` handler (own or a third party's) | `pagehide` (or `visibilitychange`) instead; never `unload`/`beforeunload` added unconditionally (add `beforeunload` only while there are unsaved changes, remove after) |
| NEW §bfcache | `Cache-Control: no-store` on the HTML | only on truly private pages; marketing HTML: `no-cache` / `s-maxage` + revalidation |
| NEW §bfcache | open WebSocket / BroadcastChannel / IndexedDB transaction at navigation | close in `pagehide`, reopen in `pageshow` when `persisted` |
| NEW §bfcache | stale UI after restore | refresh time-sensitive bits (cart, auth) on `pageshow` with `persisted` |

### Navigation and delivery (append to §LCP and §FCP)

| Where | Finding | Fix |
|---|---|---|
| §LCP, after `ttfb` | `compression` (measurable: `content-encoding` on HTML/JS/CSS) | Brotli (or gzip) for text; HTTP/2+; hashed assets `Cache-Control: public, max-age=31536000, immutable` (Next does this for `/_next/static`) |
| §LCP, after `ttfb` | slow HTML generation, stable critical subresources | 103 Early Hints with `Link` preload/preconnect for only the proven-critical few (CDN can synthesize from `Link` headers); measure, wrong hints waste bandwidth |
| §LCP, last row | next-page speed on predictable journeys | Speculation Rules `prerender` with `eagerness: "moderate"`, `href_matches` scoped, logout/checkout excluded; gate analytics on `document.prerendering` / `prerenderingchange`; Chromium only (progressive). Next's `<Link>` prefetch already covers in-app routes |
| §FCP | `@import` in CSS | separate `<link>`s (or bundle); `@import` chains serialise |
| §FCP | `dns-prefetch` alongside `preconnect` | pair them for third-party origins; `preconnect` only for 2-4 used early (existing rule) |

### Third parties (extend the `third-party` row in §JS; NEW §Third parties after §JS)

| Where | Finding | Fix |
|---|---|---|
| NEW §Third parties | First question | remove or replace it if its value doesn't pay its cost (`third-party-summary` per origin: bytes, main-thread ms, blocking) |
| NEW §Third parties | `facade-candidate` (measurable: iframe/script from youtube, vimeo, maps, intercom/drift/crisp/hubspot chat, twitter/instagram embeds) | `lite-youtube-embed` / `lite-vimeo`; Maps Static API image + "open map"; `react-live-chat-loader` (or a styled button that loads the widget on click); a still for social posts. Reserve the box (aspect-ratio) so the swap doesn't shift. iOS/macOS Safari needs a second tap to play a YouTube facade |
| NEW §Third parties | reCAPTCHA/Turnstile on every page | load only on pages with a form, and on first focus of the form; preconnect if it must run on load |
| NEW §Third parties | GTM: tags nobody owns | site owner holds the container; audit and delete unused tags; no GTM on pages that don't need it; don't load it at all when consent is declined; `afterInteractive` at most (`bundle-defer-third-party`) |
| NEW §Third parties | `ab-flicker` (client-side A/B or personalization script, often with an anti-flicker `opacity:0` snippet that holds the paint up to 4 s) | server-side/edge assignment (middleware sets a cookie, the variant renders on the server); else limit the script to the tested pages and audience; the anti-flicker timeout shows up as `lcp-render-delay` |
| NEW §Third parties | critical third-party script on a slow origin | self-host a pinned copy (keep it updated) or cache via service worker; never a third-party polyfill CDN (polyfill.io was compromised in 2024): bundle polyfills at build time |
| NEW §Third parties | `<script>` in `<head>` without `async`/`defer` | `defer` by default; `async` only for independent early scripts; plain React: `rendering-script-defer-async` |

### Best practices (NEW §Hygiene, last section; mostly measurable in the same run)

| Where | Finding | Fix |
|---|---|---|
| NEW §Hygiene | `mixed-content` (http:// subresource on an https page; `requestfailed` / console "Mixed Content") | https URLs; CSP `upgrade-insecure-requests` as a backstop; HSTS only once every subdomain serves https |
| NEW §Hygiene | `console-error` / `page-error` (Playwright `console` type `error`, `pageerror`, failed requests 4xx/5xx) | each listed with its source; React hydration mismatch errors are bugs, not noise (`rendering-hydration-no-flicker`, `rendering-hydration-suppress-warning` only for expected ones) |
| NEW §Hygiene | `deprecated-api` (Chrome `Deprecation`/Issues reports via CDP `Audits.issueAdded`, or console "[Deprecation]") | `document.write` → injected script; sync XHR → `fetch`; `unload` → `pagehide`; AppCache → service worker |
| NEW §Hygiene | `non-passive-listener` (`touchstart`/`wheel` without `{passive:true}`, Lighthouse flags it) | `{ passive: true }`, or explicit `passive:false` when `preventDefault` is needed (`client-passive-event-listeners`) |
| NEW §Hygiene | `security-headers` (measurable from the HTML response) | `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP with `frame-ancestors` (clickjacking); a suggestion unless the person asked for security; never call a Lighthouse score "secure" |
| NEW §Hygiene | `source-maps-public` (`.map` served for prod JS) | `productionBrowserSourceMaps: false` (Next default) or hidden maps uploaded to the error tracker, `sourcesContent` stripped |
| NEW §Hygiene | `document-basics` | `<!doctype html>`, `<meta charset>` first in head, viewport meta, no duplicate `id`s, no `<a><button>` nesting |
| NEW §Hygiene | `image-aspect` (rendered ratio ≠ natural ratio by > 5 %) | correct `width`/`height`, or `object-fit: cover` |
| NEW §Hygiene | `permission-on-load` (geolocation/notifications requested without a gesture) | ask in context, after a click that explains why |
