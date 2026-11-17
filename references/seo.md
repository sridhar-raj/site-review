# SEO: what to check, how it's measured, how to fix it

Marketing pages only (`--kind site`); an app screen behind a login skips all of this. Judge three layers and
say which one a finding comes from: the **raw HTML** (`fetch` with no JS, what most crawlers and agents see),
the **rendered DOM** (Playwright), and **HTTP** (status, headers, redirects). Never promise rankings, indexing or
AI citations: report "search-engine validation pending". A Lighthouse SEO 100 is a subset, not a pass.

**Issue** = blocks crawling, indexing or correct display, measured (noindex on a public page, canonical to
another page, 200 on a missing URL, invalid JSON-LD, og:image 404). **Suggestion** = works, could be better
(title 70 chars, generic anchor text, no breadcrumbs, no llms.txt). Length limits are lint proxies (Google cuts
by pixel width and rewrites freely), so a length finding is always a suggestion.

Already checked by `site-review.mjs` (don't repeat): `<title>` present and > 65 chars, meta description and
og:image present, visible h1 count, `<html lang>`. `accessibility.md` owns alt text by purpose and link purpose
(2.4.4); this file adds only the search angle.

## Page checks

| Check | Measure | Issue | Suggestion |
|---|---|---|---|
| Title | `document.title`; across a crawl, group equal titles | duplicate on 2+ pages; "Home", "Untitled", template leftovers | outside ~30-60 chars; brand first on an unknown brand; no shared topic with the h1 |
| Description | `meta[name=description]` length; duplicates across crawl | duplicate across pages; text unrelated to the page | outside ~70-160 chars |
| Canonical | `link[rel=canonical]`: count, absolute, resolves | > 1 tag; relative; points to another page, `http:`, other host or a non-200; every page canonical to `/` (inherited root canonical) | missing on a unique page (self-canonical expected) |
| Robots meta / header | `meta[name=robots]`, `meta[name=googlebot]`, response `X-Robots-Tag` | `noindex` on a page meant to be public (also in raw HTML only, or rendered only: they disagree) | `nofollow` site-wide; `nosnippet` without a reason |
| Status | response status of the page itself | 4xx/5xx; soft 404 (200 with "not found" text or an empty shell) | — |
| Head in raw HTML | title, description, canonical, robots in the no-JS response, not only after hydration | canonical/robots/title only in the rendered DOM | metadata streamed into `<body>` for bots (check `htmlLimitedBots`) |
| Content in raw HTML | the h1 text and one phrase per main section found in the no-JS body | h1 or the main answer missing (client-only fetch, skeleton in HTML) | secondary sections only after JS |
| Headings | outline of h1-h6 from the DOM | no h1; h1 is a logo or an image with no text | skipped levels (h2 → h4); headings used for styling; generic ("Overview", "More") |
| Links | every `a[href]`: internal/external, anchor text, status (HEAD) | internal link to 404/5xx; `href="#"` or JS-only navigation for real pages (`onClick` on a div) | anchors "click here", "read more", "learn more" (> 3 on a page); internal links through a redirect |
| Images | `img` src filename, `alt`, `width`/`height` | an image that carries the page's only copy of key text (price, plan, headline) | camera names (`IMG_1234.jpg`, `hash.png`) on content images; huge originals |
| Share card | `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `twitter:card`; fetch the image | og:image 404, not absolute, or `localhost`/preview host; `og:url` ≠ canonical | image not ~1200×630 (ratio 1.91:1); > 5 MB; no `twitter:card` (`summary_large_image`); long titles cut in the card |
| hreflang | `link[rel=alternate][hreflang]` | target 404/redirect/noindex; no self entry; not reciprocal (fetch each target and check it points back); invalid code (`en-UK`); canonical not in the set; cross-locale canonical | no `x-default` when a fallback exists |
| Structured data | parse every `script[type="application/ld+json"]` in rendered DOM and raw HTML | JSON parse error; type missing its required fields (table below); facts not visible on the page (price, rating, author); two conflicting blocks (manual + plugin) | relative URLs; only injected by JS; markup for a retired Google feature sold as a rich result |
| Viewport, HTTPS | `meta[name=viewport]`; mixed `http:` subresources | no viewport; mixed content; page on `http:` without redirect | no HSTS |
| URL | path of the page | — | uppercase, underscores, IDs or query params for content, > 75 chars, dates in blog slugs |

## Site checks

| Check | Measure | Issue | Suggestion |
|---|---|---|---|
| robots.txt | GET `/robots.txt`: status, groups, `Sitemap:` | 5xx; `Disallow: /` for `*` on production; blocks CSS/JS needed to render; blocks a page that carries `noindex` (crawler never sees it) | no `Sitemap:` line; named AI groups that silently drop the wildcard's disallows (named groups don't inherit) |
| sitemap.xml | GET sitemap (from robots or `/sitemap.xml`), parse, HEAD a sample of `<loc>` (≤ 50) | missing or not XML; `<loc>` relative or wrong host; listed URLs that redirect, 404 or are noindex/non-canonical | every `lastmod` = build time; > 50k URLs or 50 MB without an index; nav pages missing from it |
| Missing URLs | GET `/<random>-review-404` | returns 200 (SPA catch-all: dead URLs look live) | 404 page with no way back (no nav, no search) |
| Host variants | GET `http://`, `www.`/apex, trailing slash, uppercase path | any variant serves 200 content instead of redirecting | 302 where 301/308 belongs |
| Redirect chains | follow redirects for crawled links and variants | loop; > 2 hops; ends in 4xx | internal links pointing at a redirect |
| Click depth | BFS from home over nav/footer/body links (`--crawl N`) | important page (pricing, product, docs) unreachable by links (orphan, only in sitemap) | > 3 clicks from home; key page linked once |
| Duplicates | titles, descriptions, h1s, canonical targets across crawled pages | 2 pages with the same h1 + title and different canonicals | thin pages (tag/category with no content) |
| Preview hosts | preview/staging URL: robots, `X-Robots-Tag` | preview indexable (no noindex, no protection) | — |

## Structured data by page type

Use the type the visible page is. Required fields (Google, Schema.org); a missing required field is an issue,
a missing recommended one a suggestion. FAQPage (May 2026), HowTo (2023) and sitelinks `SearchAction` (2024) no
longer earn Google rich results: fine as semantics, never sold as one.

| Page | Type | Required | Recommended |
|---|---|---|---|
| Home | `Organization` + `WebSite` (`@graph`) | name, url | logo, sameAs, contactPoint; WebSite gives the site name |
| Blog post | `Article`/`BlogPosting` | headline, image, datePublished, author (Person/Org with name) | dateModified (real edits only), publisher, description |
| Product | `Product` | name, image, offers (price, priceCurrency, availability) | brand, sku, aggregateRating (only real reviews) |
| SaaS / app | `SoftwareApplication` | name, offers | applicationCategory, operatingSystem, aggregateRating |
| Any deep page | `BreadcrumbList` | itemListElement (position, name, item absolute) | mirrors the visible breadcrumb and URL path |
| Local business | `LocalBusiness` | name, address | geo, openingHours, telephone (same NAP as the page) |
| Event | `Event` | name, startDate, location | offers, organizer |

Values: dates ISO 8601, URLs absolute, enums exact (`https://schema.org/InStock`). Validate the served output in
Rich Results Test (Google features) and validator.schema.org (vocabulary); they answer different questions.

## AI-search readiness

Same base as SEO: indexable, snippet-eligible, crawlable text. Google says AI Overviews need no special file or
schema. Measure and report; most of this is suggestion unless it blocks reading.
- **Text in the first response (issue when missing):** h1, the main answer, pricing and key facts in raw HTML.
  Proof as text: prices, testimonials, customer names selectable, not baked into images or injected by a widget.
- **Bots by purpose (issue only when it contradicts the owner's stated goal):** search `OAI-SearchBot`,
  `Claude-SearchBot`, `PerplexityBot`; user fetch `ChatGPT-User`, `Claude-User`, `Perplexity-User`; training
  `GPTBot`, `ClaudeBot`, `Google-Extended` (not a Search switch). Report the policy; never flip it unasked.
  Also check a firewall/bot challenge isn't serving 403/challenge pages (fetch with a crawler UA as a hint only;
  UAs are spoofable).
- **Answer-first (suggestion):** the first paragraph under the h1 and under each h2 says the answer in plain words
  (~40-60 words); headings phrased like questions where the page answers questions; tables for comparisons,
  numbered lists for steps; specific numbers with sources; visible "Updated" date that tracks real edits; named
  author on articles. No separate "for AI" copy, no chunked fragments, no keyword stuffing.
- **llms.txt is optional:** absent is never an issue; suggest it only when the owner wants agent/docs discovery.
  Present: `/llms.txt` returns 200 `text/plain`/markdown, starts with `# Name`, links resolve, linked from the site.
- **Semantic structure (shared with accessibility):** landmarks, labelled controls, one clear h1.

## Fixes: Next.js App Router

| Finding | Fix |
|---|---|
| Missing/duplicate title, description | `export const metadata` in `layout.tsx` with `title: { default, template: "%s · Brand" }`; per route `generateMetadata` returning `title`, `description` from the page's data |
| Relative / localhost canonical or og URLs | `metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL)` in the root layout; check emitted absolute URLs in production |
| Every page canonical to `/` | root sets `alternates.canonical: "/"`, children inherit: set `alternates: { canonical: "/path" }` per route (or in `generateMetadata`) |
| Lost og fields on a child | metadata merges shallowly: a child `openGraph` replaces the parent's; spread a shared `baseOpenGraph` |
| noindex on public pages / preview indexable | `robots: { index: false }` only where meant; gate on `VERCEL_ENV !== "production"`, not `NODE_ENV` |
| No / wrong sitemap | `app/sitemap.ts` returning `MetadataRoute.Sitemap` of absolute canonical URLs, `lastModified` from content data; no `priority`/`changeFrequency` tuning; DB-backed: revalidate on publish (cached by default) |
| No / wrong robots.txt | `app/robots.ts` returning `MetadataRoute.Robots`: `{ rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }], sitemap }`; repeat disallows in any named group |
| Share card | `app/opengraph-image.tsx` (`ImageResponse`, flexbox only, ≤ 500 KB bundle, ttf/otf/woff fonts) or a static `opengraph-image.png` 1200×630; `twitter: { card: "summary_large_image" }` |
| hreflang | `alternates: { canonical, languages: { en: "/en/x", de: "/de/x", "x-default": "/en/x" } }` including the page itself; in `sitemap.ts` `alternates.languages` add the self locale explicitly |
| JSON-LD | in the page (Server Component): `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />`; data from the same source the page renders; no `next/script` |
| Content missing from raw HTML | fetch data in a Server Component; no `Date.now()`/`Math.random()` in render (stops the prerender at the Suspense fallback); short `cacheLife` keeps content out of the prerender |
| 200 on unknown URLs | call `notFound()` for missing slugs; add `app/not-found.tsx`; `dynamicParams = false` for a fixed set |
| Host / slash variants | `trailingSlash` in `next.config`; `redirects()` with `permanent: true` for old URLs; host redirect at the platform |
| Generic anchors, orphans | link text names the destination ("Pricing for teams"); add breadcrumbs + related links with `next/link` |
| Camera filenames, image-only text | rename assets descriptively; move text out of images into HTML |
| `viewport`/`themeColor` in metadata | move to `export const viewport` (in metadata it emits nothing) |
| `keywords` meta | ignore (Google doesn't use it); don't add |

Static `public/robots.txt` / `public/sitemap.xml` are fine for a fixed site; don't keep both a file and the
route. `public/llms.txt` for a fixed llms.txt.

## Sources

- coreyhaines31/marketingskills `seo-audit` (github.com/coreyhaines31/marketingskills/tree/main/skills/seo-audit):
  audit priority order, canonical/host consistency, hreflang rules (self, reciprocal, codes, canonical in set),
  title patterns and rewrite triggers, "curl can't see JS-injected schema: render it".
- same repo, `schema`: types and required fields, retired FAQ/HowTo/SearchAction, validation errors.
- same repo, `site-architecture`: 3-click depth, orphans, anchor text, URL rules, breadcrumb/URL alignment.
- same repo, `ai-seo` (+ `references/agent-readiness.md`): bots by purpose, answer-first blocks, content in initial
  HTML, real 404s, pricing and proof as text, llms.txt as optional.
- addyosmani/web-quality-skills `seo` (github.com/addyosmani/web-quality-skills/tree/main/skills/seo): lengths as
  lint proxies, don't fail multiple h1 alone, sitemap limits, image filenames, crawler table, llms.txt optional.
- laguagu/claude-code-nextjs-skills `nextjs-seo` (github.com/laguagu/claude-code-nextjs-skills/tree/main/skills/nextjs-seo):
  metadataBase, inherited canonical, shallow merge, htmlLimitedBots, sitemap/robots caching, named robots groups,
  JSON-LD escaping, raw-HTML content check and prerender causes, OG image limits, preview env policy.
- sanity-io/agent-toolkit `seo-aeo-best-practices` (github.com/sanity-io/agent-toolkit/tree/main/skills/seo-aeo-best-practices):
  OG tag set and 1200×630, generateMetadata/sitemap.ts examples, hreflang via `alternates.languages`, AEO
  direct-answer and question-heading patterns, dateModified, author signals.

## The script: `seo-check.mjs` (built from this proposal)

`seo-check.mjs <url> [--crawl N]` (or an `seo` pass in `review.mjs`), site kind only, ~30-60 s a page:
1. `fetch(url, { redirect: "manual" })`: status, `X-Robots-Tag`, redirect hops; parse raw HTML (title,
   description, canonical, robots, h1 text, hreflang, og/twitter, JSON-LD) with a small regex/DOM parser.
2. Playwright: same fields from the rendered DOM; heading outline; every `a[href]` (text, internal?); `img`
   src/alt; JSON-LD blocks. Diff raw vs rendered: anything only rendered → `seo-raw-missing`.
3. Per page: canonical (count, absolute, same host, HEAD = 200, self vs other), robots noindex, title/description
   lengths (suggestion), headings skip, generic anchors (regex `^(click here|read more|learn more|here|more)$`),
   camera filenames (`/^(img|dsc|screenshot|image)[-_ ]?\d+/i`, hex hashes).
4. JSON-LD: `JSON.parse` each, walk `@graph`, required fields per `@type` from the table, absolute URLs,
   ISO dates; flag facts not found in `innerText` (price, ratingValue, author name).
5. Share card: HEAD/GET og:image (status, `content-type`, size), decode dimensions; og:url = canonical.
6. Site once: `/robots.txt` (status, groups, `Sitemap:`, `Disallow: /`, named groups vs `*`), sitemap parse +
   HEAD ≤ 50 `<loc>` (status, redirect, noindex), GET a random path (expect 404), http/www/slash variants.
7. hreflang: fetch each alternate, check status, self entry, return link, code against ISO lists.
8. `--crawl`: BFS from home (same origin, ≤ N pages), click depth per URL, internal 4xx/redirect links,
   duplicate titles/descriptions/h1s, sitemap URLs never linked (orphans).
9. `/llms.txt`: INFO only (present/absent, status, first line).
Write findings with `O.add({ type: "seo-…", severity, el, detail, fix })` like the others; every finding names
raw/rendered/HTTP as its evidence. Lighthouse SEO stays the manual cross-check (§2).
