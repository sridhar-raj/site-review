# Conversion: does the page get people to act, and what stops them

For a website (not `--kind app`). Read the page as a first-time visitor from its likely source (ad, search, social,
email) before measuring. Layout, focus, contrast, speed stay in their files; this is the path to the action (feeds
Clarity, Hierarchy, Trust in `rubric.md`).

## How findings are labelled

Each finding is **measured** (a script or reproducible step proves it) or **judged** (copy, taste), and an
**issue** or a **suggestion** (SKILL.md §3). In CRO most things are suggestions: only data says which change wins.
Issues (broken, reproduced): no CTA on the phone first screen or one covered by a banner; a form that can't
submit, loses input or double-submits; a popup with no close/Esc; a dead CTA link; no success state; a dark pattern
(pre-checked consent, last-step cost, fake countdown); a submit that fires no conversion event. Suggestions: generic
CTA copy, too many fields, an early popup, a slogan headline, no proof near the CTA, inconsistent event names.
Never claim a lift: say "likely" and why, or route it to a test (§10).

## 1. Value proposition and first screen (judged; CTA position measured)

- 5-second test from the first screen alone: what it is, for whom, what to do. Fail = Clarity ≤ 2.
- Headline names the thing or outcome in the customer's words, key noun early; specific (number, timeframe,
  named result) beats clever. It repeats the promise of the ad / query / link that brought them (message match).
- One primary action on the first screen at 390 and 1440 px; a decorative visual that pushes it below the fold costs.
- Objections answered on the page: price, "will it work for me", effort to start, "what if it doesn't" (FAQ, guarantee).

## 2. CTA

| Check | Kind |
|---|---|
| One primary style per screen; secondary visibly quieter (not two equal filled buttons) | measured (computed style) |
| Above the fold at both widths; repeated after the main argument and at the end | measured |
| Verb + what they get ("Start free trial"), not "Submit"/"Learn more"; next step and its cost beside it ("No card required") | judged |
| Every CTA href resolves (no 404, `#`, `javascript:`) | measured |

## 3. Forms (lead, contact, demo, newsletter)

Labels, error announcement, focus to first error and paste are in `accessibility.md`; test as SKILL.md §2 says
(empty and wrong value, never a real submission on a live site).

| Check | How / fix |
|---|---|
| Field count | visible required inputs; > 3 on a lead form: ask which the follow-up uses, defer the rest (enrichment, onboarding). Suggestion |
| Optional marked "optional"; label above, placeholder only an example; one column at 390 | DOM, screenshot |
| Right keyboard: `type=email/tel/url`, `inputmode="numeric"` for codes | DOM |
| `autocomplete`: `email`, `name`, `tel`, `organization`, `postal-code`, `one-time-code`, `new-password` | DOM; missing on signup/checkout = issue (WCAG 1.3.5) |
| Validation on blur, not per keystroke; message gives the fix; input kept | submit a wrong value |
| Pending: button disabled + spinner; success state with next step; double-click sends once | reproduce with the request blocked |
| No "confirm email"; typo help (gmial.com); phone/company optional or says why | judged |
| Privacy line and response time by the button ("No spam", "We reply within a day") | judged |
| Multi-step (> 5-6 fields): "Step 2 of 3", back works, survives refresh, easy questions first | reproduce |
| CAPTCHA shown before interaction → invisible / Turnstile on focus | measured |

## 4. Signup flow

- Email (or SSO) + password only; name if used at once; company, role, size deferred to onboarding.
- SSO prominent and audience-fit (B2C Google/Apple, B2B Google/Microsoft), separate from the email form.
- Password: show toggle, rules up front and ticked live, paste allowed. "Already registered" offers sign in/reset.
- After submit: confirmation; verification explained with resend, change-email, check-spam; let them in first if possible.
- Card for a trial, terms checkbox, verification gate: each is a test, not a recommendation.
- Leaving is as easy as joining: cancel and delete-data findable.

## 5. Popups, banners, slide-ins

`site-review.mjs` already closes popups open on arrival and reports them; judge them here.

| Check | Kind |
|---|---|
| Appears on arrival or < 30 s → suggest scroll 25-50 %, exit intent (desktop), or click-triggered | measured (time) |
| Covers > 30 % of the 390 px viewport before content is read = issue (Google intrusive interstitials) | measured |
| Visible close ≥ 44 px, Esc, outside click, "No thanks"; focus trapped, then returned | measured |
| Decline copy neutral; confirmshaming = issue | judged |
| Dismissal remembered across reload; not on checkout/signup; never two stacked | measured |
| Cookie banner: reject as easy as accept on the first layer, nothing pre-checked, CTA not covered | measured |

## 6. Trust

- Proof by the CTA and after each claim: named testimonials (photo, role), known logos, review score with count,
  a case-study number. Unattributed quotes are filler (rubric Trust 3).
- Price shown or "talk to sales"; total before the last step; guarantee/refund terms; real compliance badges only
  where data is sensitive; company identity and contact in the footer.
- Dark patterns are issues: false urgency (a countdown that resets on reload), sneak into basket, hidden costs,
  pre-checked opt-ins, roach motel. Mirror test: would it survive a journalist describing it?

## 7. Analytics present (measured, observe only)

Record `dataLayer` pushes, `gtag`/`posthog`/`analytics` calls and beacons (GA4 `collect`, PostHog `/e/`, Segment
`/v1/t`) while clicking the CTA and submitting a blocked form. Check: which tool, loaded after consent where a banner
exists; CTA click and submit each emit one event with sensible properties (`cta_clicked`+`location`,
`form_submitted`+`form_name`; GA4 recommended `sign_up`, `generate_lead`); no duplicates; no PII (email, name) in
params or URLs. No conversion event = issue for the owner; naming = suggestion.

## 8. Usability heuristics (Nielsen, live-page form)

Severity 0-4 (not a problem · cosmetic · minor · major · blocks the task) from frequency × impact × persistence;
3-4 go under Must fix only when reproduced.
1. **Status:** every click answers within ~100 ms (pressed, spinner, "Sent"); no silent failure. 2. **Real-world words:** "Sign in" not "Authenticate"; icons labelled.
3. **Control:** back works (no history hijack); every modal/flow has an exit; undo over "Are you sure?". 4. **Consistency:** logo top-left to home; one term per concept; same style = same importance.
5. **Error prevention:** radios for < 5 options, pickers, defaults, unsaved-changes warning. 6. **Recognition:** current nav item marked (`aria-current`), breadcrumbs, options shown.
7. **Efficiency:** search visible on deep sites; returning visitors not re-asked. 8. **Minimalist:** cut half the words, no happy talk, one primary action a screen.
9. **Recovery:** what happened, why, how to fix, input kept. 10. **Help:** FAQ near the decision, contact route, inline hints.
Trunk test on any inner page: site, page, sections, options, where am I, search — each answerable in 5 s.

## 9. Design-engineer checks (rams-style; source unreachable, written from the brief)

- Every element earns its place (remove a section: does the argument lose anything?); claims, numbers and
  screenshots are real; each control does what its label says.
- Every control on the path has hover, pressed, focus, loading, error, success; motion is feedback, ≤ 300 ms, off
  under reduced motion; nothing moves while the visitor reads.
- Details finished (one spacing scale, consistent radii, aligned baselines); survives longer copy (the stress pass).

## 10. When the answer is an A/B test, not a recommendation

Recommend directly when broken, a clear heuristic violation, or a dark pattern. Test when two options are both
reasonable (headline angle, CTA copy, field count, card required, popup trigger), the change is costly, or the owner
disagrees. Write: *Because [evidence], we believe [change] will raise [metric] for [audience]; primary [metric],
guardrail [metric that must not drop].* Minimum n per variant (α 0.05 two-sided, 80 % power, relative lift):

| Baseline | +10 % | +20 % | +50 % |
|---|---|---|---|
| 1 % | 160k | 43k | 7.7k |
| 3 % | 53k | 14k | 2.5k |
| 5 % | 31k | 8.2k | 1.5k |
| 10 % | 15k | 3.8k | 690 |

n ≈ 16·p(1−p)/(p·lift)². Days = n × variants ÷ daily eligible visitors; ≥ 1 full week (2 cycles for B2B), ≤ 4-8
weeks. Over ~60 days: don't test; ship the heuristic fix, test a bolder change or upstream. Fix n first, no peeking,
one change, server-side assignment (no flicker), triggered analysis when few visitors see the change; report the
effect with its interval, not just "significant".

Report it as a **Conversion** block: Must fix, Should fix, Test ideas (hypothesis, metric, does traffic allow it), Copy alternatives (2-3 headline/CTA options with the reason).

## Sources

- https://github.com/coreyhaines31/marketingskills (cro + references/form.md, signup, popups, ab-testing + sample-size-guide.md, analytics) · https://github.com/wondelai/skills (ux-heuristics)
- https://www.nngroup.com/articles/ten-usability-heuristics/ · https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials · https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose
- https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill · https://www.evanmiller.org/ab-testing/sample-size.html · https://www.amstat.org/asa/files/pdfs/p-valuestatement.pdf
- brianlovin/agent-config (rams): repo not found on 2026-11-17; §9 is not from it

## Script proposal (`cro-check.mjs`, measured parts only)

Built (2026-11-18): items 1-4, 6 (time to appear, area at 390, Esc/close, back after reload) and 9, as `cro-*`
types. Not built, still judged by hand: 5 (empty/bad submits, double submit), 7 (consent), 8 (fake urgency), popups
that appear later than ~4 s after load or on scroll/exit, and analytics on a blocked form submit.

`node <skill>/scripts/cro-check.mjs <url> --out .review/before` — 390 and 1440 px, ~20 s, writes `cro.json`.
1. First screen: elements styled primary (filled accent) → count, text, in viewport (`cro-no-cta`, `cro-competing-cta`).
2. CTA text against a generic list (submit, learn more, click here) → `cro-generic-cta` (suggestion).
3. HEAD each CTA href → `cro-dead-cta` (4xx, `#`, `javascript:`).
4. Per form: visible required fields, placeholder-only labels, `type`/`inputmode`/`autocomplete` vs the field's name/label (`form-fields`, `form-keyboard`, `form-autocomplete`).
5. Abort every non-GET request, submit empty and bad values: error shown, input kept, pending state, requests per double-click (`form-error`, `form-double-submit`).
6. Popups: time to appear, overlay area % at 390, close size, Esc/outside close, back after reload (`popup-early`, `popup-intrusive`, `popup-no-close`, `popup-no-memory`).
7. Cookie banner: reject on the first layer, pre-checked boxes (`consent-asymmetric`).
8. Countdowns and "only N left": value before vs after reload (`fake-urgency`).
9. Analytics: tools, load order vs consent, events on CTA click and blocked submit, duplicates, PII regex (`analytics-missing-conversion`, `analytics-duplicate`, `analytics-pii`).
10. Shared finding shape (kind measured, severity issue|suggestion), outlined screenshots; judged items left to the Look step.
