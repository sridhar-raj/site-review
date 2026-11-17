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
