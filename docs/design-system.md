# PeerPulse — Design System & Wireframes

> **Deliverable 7 of 11.** The visual language, the reusable component contract, the accessibility rules, and a
> page-by-page wireframe of the 25 routes that exist.
>
> Tokens live in `src/assets/styles/main.css` (`@theme`), primitives in `src/components/ui/`.

---

## 1. Brand

**“Trade Time. Share Skills. Grow Together.”** — the tagline appears in `index.html`, `APP_TAGLINE`, the hero
and the auth screens.

The product is a time bank, so the visual language is **generous, calm and precise**: a deep canvas that makes
green feel like currency without looking like a casino, cards that lift on hover, and numbers set in a tabular
face so balances never jitter.

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#071521` | page background |
| `--color-surface` | `#0B1F2D` | cards, panels, sheets |
| `--color-surface-2` | `#0F2837` | raised rows, inputs, hover surfaces |
| `--color-brand` | `#10B981` | primary actions, balances, positive deltas |
| `--color-brand-bright` | `#34D399` | accents, focus detail, gradient partner |
| `--color-brand-deep` | `#059669` | pressed states, light-theme primary |
| `--color-on-brand` | `#04231A` | text on a solid brand fill (`#FFFFFF` in the light theme) |
| `--color-cyan` | `#22D3EE` | optional soft accent — secondary charts, links in dark |
| `--color-muted` | `#A7BBC8` | secondary text, meta, timestamps |
| `--color-line` | `#1D4553` | borders, dividers, skeletons |
| `--color-ink` | `#FFFFFF` | primary text |
| `--color-danger` | `#F87171` | destructive actions, blocked settlements |
| `--color-warn` | `#FBBF24` | partial settlements, pending states |

A light theme re-maps the same names and is toggled from the shell (remembered per browser). The surface and
text names swap to light values (`--color-canvas: #F3F8F7`, `--color-surface: #FFFFFF`, `--color-ink: #06121B`),
and the **accent hues are darkened rather than re-used**: `--color-brand: #047857`, `--color-brand-bright:
#065F46`, `--color-cyan: #0E7490`, `--color-danger: #B91C1C`, `--color-warn: #92400E`. The dark theme's greens
measure 2.5–3.8 : 1 on white — they are fills, not text — which is exactly the defect `tests/unit/contrast.spec.ts`
found. The brand palette the brief specified is the dark theme, and it is unchanged.

**Semantic colour rules.** Green means *value earned or available*, never “success” in the abstract. Amber
means *partial or pending*, red means *blocked or destructive*, cyan marks *secondary information* only. Colour
is never the sole carrier of meaning: every tone is paired with an icon or a word (`AppBadge` renders a dot
*and* a label).

---

## 2. Typography, spacing, elevation

| Role | Family | Size / weight |
| --- | --- | --- |
| Display | `--font-display` (Sora) | 2.25–3.5 rem, 600–700, tight leading |
| Body | `--font-sans` (Inter) | 0.875–1rem, 400–500, `leading-relaxed` on prose |
| Numeric | `--font-mono` or `tabular-nums` | balances, durations, ids |
| Meta | Inter | 0.6875–0.75 rem, `--color-muted` |

- Radii: `--radius-card: 1.25rem`, `--radius-pill: 9999px`, inputs `0.75rem`.
- Elevation: `--shadow-card` for resting surfaces, `--shadow-glow` on hover/focus of interactive cards.
- Spacing follows Tailwind's 4 px scale; container is `pp-container` (max 80 rem, 1 rem / 2 rem gutters).
- Motion: `fade-up` for staggered entrances (`pp-stagger`), 0.28 s cubic-bezier lifts, and a
  `prefers-reduced-motion` block that disables transforms and shortens durations.

---

## 3. Layout shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ▲ PeerPulse   Explore  Sessions  Calendar  Community     🔔 3   ◍ Sam ▾      │  ← sticky, glass
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   page content (max-w-7xl, px-4 md:px-8, py-8)                               │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Trade Time · Share Skills · Grow Together        Guidelines · Privacy · ··· │
└──────────────────────────────────────────────────────────────────────────────┘
```

`AppShell` decides between a signed-out marketing chrome (transparent header, “Sign in / Join free”) and the
signed-in chrome (nav, notification bell with unread count, avatar menu, wallet balance chip). The mobile
navigation collapses into a sheet that traps focus while open and restores it on close.

---

## 4. Component inventory

### 4.1 Primitives — `src/components/ui/`

| Component | Props (abridged) | Notes |
| --- | --- | --- |
| `AppButton` | `variant: primary \| secondary \| ghost \| danger \| subtle`, `size: sm \| md \| lg`, `to`, `href`, `loading`, `block`, `icon`, `iconRight` | Renders `<RouterLink>`, `<a>` or `<button>`; `loading` sets `aria-busy` and blocks double submits |
| `AppInput` | `modelValue`, `label`, `type`, `hint`, `error`, `required`, `min/max/step`, `icon` | Label is bound with `for`/`id`; `error` sets `aria-invalid` + `aria-describedby`; numbers accept string bounds from templates |
| `AppSelect` | `modelValue`, `options`, `label`, `hint`, `error` | Native select styled to match, so mobile pickers work |
| `AppModal` | `open`, `title`, `description`, `size` | Teleports to `<body>`, traps focus, closes on `Escape` / backdrop, restores focus to the opener, `role="dialog"` + `aria-modal` |
| `AppBadge` | `tone`, `size`, `dot` | Status vocabulary: tone **and** text |
| `AppAvatar` | `displayName`, `seed`, `photoURL`, `size`, `online`, `ring` | Falls back to a deterministic SVG from the uid seed — no broken images, no identicon service |
| `AppRating` | `value`, `count`, `size`, `interactive` | Interactive mode exposes radio semantics and announces the selected value |
| `AppStat` | `label`, `value`, `delta`, `icon`, `tone` | Dashboard/wallet metric block |
| `AppEmptyState` | `icon`, `title`, `description`, `actionLabel`, `actionTo` | Every list has one; states *why* it is empty and what to do |
| `AppSkeleton` | `lines`, `variant` | Shimmer placeholder, `aria-hidden`, paired with a live region for loading |
| `AppToasts` | — (reads `useUiStore`) | `aria-live="polite"` region; errors stay until dismissed |
| `AppIcon` | `name`, `size`, `strokeWidth`, `label` | Hand-rolled 24 px stroke set; decorative by default, `label` promotes to `role="img"` |
| `AppLogo` | `compact`, `size` | The pulse mark; `compact` drops the wordmark |
| `SectionHeading` | `eyebrow`, `title`, `description`, `align` | Consistent section rhythm |

### 4.2 Feature components

| Component | Responsibility |
| --- | --- |
| `SkillCard` | Listing summary: teacher, level, format, duration, token cost, rating |
| `BookingCard` | One booking with its status, countdown, participants and actions; renders the settlement outcome when present |
| `BookingRequestModal` | Slot choice, token preview (“1 h = 1 TT”), conflict and affordability warnings, note field |
| `ReportDialog` | One moderation dialog for every reportable thing — listing, member, post, comment or review. Presentational: the parent owns the backend call. Requires a sentence, not just a reason, and states that reports are confidential |
| `AvailabilityEditor` | Weekly blocks with validation (end after start, no overlaps) written to `profile.availability` |
| `MemberCard` | Directory entry with teach/learn categories |
| `TokenExplainer` | The canonical “what a Time Token is / is not” panel, reused on the landing page, wallet and how-it-works |

---

## 5. Accessibility contract

Non-negotiable rules, all exercised in `tests/unit/components.spec.ts`:

1. **Every control is reachable and operable by keyboard.** Focus rings use `--color-brand-bright` at 2 px and
   are never removed without a replacement.
2. **Dialogs:** `AppModal` traps focus, closes on `Escape`, restores focus, and marks background content inert.
3. **Forms:** labels are programmatically bound, errors are announced through `aria-describedby`, and required
   fields are marked with text, not only an asterisk colour.
4. **Live regions:** toasts are `aria-live="polite"`; blocking errors use `role="alert"`.
5. **Icons:** decorative icons are `aria-hidden`; meaningful ones take `label`.
6. **Reduced motion:** transforms and long transitions are disabled under `prefers-reduced-motion: reduce`.
7. **Contrast:** every token used as text reaches ≥ 4.5 : 1 on every page background in both themes, measured —
   not asserted — by `tests/unit/contrast.spec.ts` (§5.2). Non-text use (rings, borders) clears 3 : 1.
8. **Media in calls:** camera/mic controls are buttons with `aria-pressed`, and the connection state is
   announced in a polite live region so a screen-reader user knows when the peer connects.

### 5.1 Rules the audit added

`tests/unit/a11y.spec.ts` walks every route in the real app and checks the rendered DOM against the
machine-checkable parts of WCAG 2.1 AA (one `h1`, no skipped heading levels, every control named, every input
labelled, no duplicate ids, no positive `tabindex`, no `aria-live="false"`, no bare `<a>`). Four rules came out
of writing it, and each one is a mistake that is invisible in a screenshot:

1. **A component that renders `<component :is>` must not pass attributes bound to `undefined`.** `AppButton`
   passed `:href="href"` alongside `:to="to"`; `RouterLink` renders its own `href` and spreads the remaining
   attributes over it, so the `undefined` *removed* the href it had just computed. Every `<AppButton to="...">`
   in the app — 39 of them, including "Sign in", "Join course" and "Book a session" — rendered an anchor that a
   keyboard could not reach and a screen reader did not call a link. Mouse clicks still worked, which is why it
   survived every manual walkthrough. Buttons now bind only the attributes their chosen element understands.
2. **Caller attributes belong on the control, not on the wrapper.** `AppInput` and `AppSelect` render a wrapper
   `<div>`; with `inheritAttrs` on by default, `aria-label="Search members"` landed on that div and the input
   itself had no accessible name. Both set `inheritAttrs: false` and bind `$attrs` to the `<input>`, `<textarea>`
   or `<select>` — and a caller-supplied `id` now wins, with the `<label for>` following it.
3. **Headings are structure, not size.** The five hero headings on `/`, `/how-it-works`, `/privacy`, `/terms`
   and `/community-guidelines` were `h2`s, so those documents had no `h1` at all. `SectionHeading` takes
   `as="h1" | "h2" | "h3"` (default `h2`), and card titles are `h2`s — a listing is a peer of the page, not a
   subsection of one.
4. **Decorative controls are not controls.** A read-only star rating rendered five disabled `<button>`s per
   card: 275 unnamed buttons on the marketplace alone, announced as "button, dimmed" five times per listing.
   Read-only ratings render as `aria-hidden` spans inside a labelled `role="img"`, and only the interactive
   variant uses real radio buttons.

### 5.2 Contrast, measured

`tests/unit/contrast.spec.ts` parses the palette out of `src/assets/styles/main.css`, derives which tokens the
application actually uses as *text* (by scanning `src/` for `text-<token>` classes), and applies WCAG 2.1's
contrast formula to each one against every page background, in both themes. Measured values:

| Pair | Dark theme | Light theme |
| --- | --- | --- |
| `ink` on `canvas` | 18.45 : 1 | 17.64 : 1 |
| `ink` on `surface` | 16.83 : 1 | 18.92 : 1 |
| `muted` on `canvas` | 9.30 : 1 | 5.34 : 1 |
| `muted` on `surface` | 8.48 : 1 | 5.73 : 1 |
| `muted` on `surface-2` | 7.68 : 1 | 5.18 : 1 |
| `brand` on `canvas` | 7.27 : 1 | 5.11 : 1 |
| `brand` on `surface` | 6.63 : 1 | 5.48 : 1 |
| `brand-bright` on `canvas` | 9.60 : 1 | 7.16 : 1 |
| `brand-bright` on `surface` | 8.75 : 1 | 7.68 : 1 |
| `cyan` on `canvas` | 10.21 : 1 | 5.00 : 1 |
| `danger` on `canvas` | 6.67 : 1 | 6.03 : 1 |
| `danger` on `surface` | 6.08 : 1 | 6.47 : 1 |
| `warn` on `canvas` | 11.05 : 1 | 6.61 : 1 |
| `warn` on `surface` | 10.08 : 1 | 7.09 : 1 |
| `on-brand` on `brand` (button labels) | 6.57 : 1 | 5.48 : 1 |

**What it found.** The light theme originally re-used the dark theme's accent hexes. On white that measured
`brand-bright` 2.54 : 1, `cyan` 1.81 : 1, `warn` 1.67 : 1, `danger` 2.77 : 1 — a light theme in which links,
warnings and errors were unreadable, and the primary button's label (a hardcoded `#04231A`) sat at 4.42 : 1.
The accent hues are now darkened for light surfaces, and the button label is the `--color-on-brand` token so it
can differ per theme.

**The one deliberate exception.** `--color-line` is never used for text that carries meaning. It draws borders
and dividers *and* two decorative elements — the unfilled stars in a rating and the step numerals on
`/community-guidelines` — both of which are `aria-hidden` and repeat information that is present in words
immediately beside them. The test lists this exemption explicitly rather than tolerating a low ratio silently.

**What it cannot see.** The rendered background behind a given element (a card can sit on a gradient or a
translucent overlay), font size — so nothing gets the 3 : 1 large-text allowance — and opacity modifiers such as
`text-muted/70`, whose effective colour depends on what is behind them.

---

## 6. Page-by-page wireframes

Legend: `▣` card/panel · `▸` primary action · `◌` avatar · `⌘` form control · `≈` list · `▲` logo · `⠿` chart.

### 6.1 Public

**`/` Landing (`LandingPage.vue`)**
```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▲ PeerPulse                     How it works  Explore  Members   Sign in ▸ │
├────────────────────────────────────────────────────────────────────────────┤
│   Trade Time. Share Skills. Grow Together.                     Join free ▸  │
│   1 hour of teaching = 1 Time Token = 1 hour of learning.                   │
│   Hero mock: a session card (“settled · 58 min verified”) and the balance   │
│   card (3 Time Tokens, “3 hours of learning available to you today”)        │
│                                                                            │
│   Four steps (numbered cards): create your account → list what you teach    │
│   and want to learn → discover people and book a session → trade Time       │
│   Tokens when it is done                                                    │
│   Benefits: learning without a paywall · fair by design · reciprocity       │
│   ▣ Featured listings (SkillCard grid, honest empty state when none exist)  │
│   ▣ TokenExplainer: “One hour = one Time Token”, the rounding policy and    │
│     the four things a token is not                                          │
│   Closing CTA into /register (the 3-token signup grant is stated)           │
└────────────────────────────────────────────────────────────────────────────┘
```

**`/how-it-works` (`HowItWorksPage.vue`)** — the four steps as alternating rows with illustrations, the token
maths table (30 / 45 / 60 / 90 minutes → tokens under each rounding rule), and the cancellation policy.

**`/skills` (`SkillsExplorePage.vue`)**
```
┌ search ⌘ ──────────────────────────────────────────────────────────────────┐
│ ▣ Category ▾  ▣ Level ▾  ▣ Format ▾  ▣ Language ▾  ▣ Max duration ⌘  reset   │
├────────────────────────────────────────────────────────────────────────────┤
│ ▣ ▣ ▣   (grid: 1 col → 2 → 3, each card = SkillCard)                       │
│ ▣ ▣ ▣                                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ ← 1 2 3 →                          filters mirrored into the URL            │
└────────────────────────────────────────────────────────────────────────────┘
```

**`/skills/:id` (`SkillDetailPage.vue`)** — title, teacher card with rating and response time, outcomes list,
format/duration/language facts, token cost block, weekly availability, reviews with replies, and a sticky
“Request a session ▸” bar on mobile.

**`/members` (`MembersPage.vue`)** — search + teach/learn category filters over `MemberCard` grid; members who
set `privacy.appearInDiscovery: false` are excluded here and their profile shows only what they published.

**`/members/:uid` (`MemberProfilePage.vue`)** — header (◌, name, headline, location, timezone, rating),
bio, teach listings, learn goals, availability *if* `privacy.showAvailability`, reviews, report link.

**`/signin`, `/register`, `/forgot-password`** — 2-column: form on the left (email, password, show/hide,
remember, inline validation), value panel on the right (token explainer + three trust points). Sign-up adds
display name, timezone (auto-detected), and the consent checkboxes.

**`/community-guidelines`, `/privacy`, `/terms`, 404** — long-form prose styled by a shared reading column; the 404
offers “Explore skills” and “Go home”.

### 6.2 Onboarding and profile  (all routes below require authentication)

**`/onboarding` (`OnboardingPage.vue`)** — six steps with a persistent progress rail:
```
① You    ② Teach    ③ Learn    ④ Availability    ⑤ Privacy    ⑥ Review
┌────────────────────────────────────────────────────────────────────────────┐
│ ▣ Step content: name/headline/location/timezone/languages → teach categories │
│   → learn categories → AvailabilityEditor (weekday blocks) → privacy toggles │
│   → summary card showing exactly what will be public                        │
├────────────────────────────────────────────────────────────────────────────┤
│ ← Back                                     Save & continue ▸   Skip for now │
└────────────────────────────────────────────────────────────────────────────┘
```

**`/profile` (`ProfileEditPage.vue`)** — every profile field grouped in cards (identity, teaching,
learning, availability, preferences) with dirty-state save bar.
**`/settings` (`SettingsPage.vue`)** — account (email, password change, sessions), notifications (per-type,
browser push opt-in when a VAPID key is configured), appearance (theme), privacy, data export (JSON download),
and the account-deletion request path with its consequences spelled out.

### 6.3 Learning and teaching

**`/dashboard` (`DashboardPage.vue`)**
```
┌ Welcome back, Sam ▸ next session in 3 h — join opens 15 min before ─────────┐
│ ▣ Wallet 2.5 TT   ▣ 4 sessions   ▣ ★ 4.9    ▣ 12 h taught                  │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Upcoming sessions ≈ BookingCard│ Needs your attention: 2 requests to answer │
│                               │ Settlement awaiting your confirmation      │
│ Recommended for you (learn)   │ Community replies                          │
└───────────────────────────────┴────────────────────────────────────────────┘
```

**My listings** — reachable from the dashboard; edit/archive actions per listing, and the listing form
enforces outcomes as bullets, a category, and a duration inside the policy window.

**`/bookings` (`BookingsPage.vue`)** — tabs `Upcoming · Requests · Past · Cancelled`; each row is a
`BookingCard` with status, countdown, token amount, **“0 tokens move while pending”** on requests,
cancellation policy preview before cancelling, and dispute entry on completed sessions within the window.

**Booking detail** — expanded in place from the bookings list (no separate route): participants, window,
notes, history (reschedules, cancellation), the settlement block (state, verified minutes, both ledger rows),
and the review form when the session completed.

**`/calendar` (`CalendarPage.vue`)** — `@vuepic/vue-datepicker` in month/week mode with three layers: my
sessions (brand), others' confirmed sessions (muted), free windows derived from my availability (outline).
Clicking a free window pre-fills a booking request.

**`/rooms/:roomId` (`VideoRoomPage.vue`)**
```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◌ Lena · “Jazz guitar” · 18:00–19:00 · ⏱ 42:10        ● connected          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                    remote video (object-cover, rounded)                    │
│                                    ┌──────────────┐                        │
│                                    │ self preview │                        │
│                                    └──────────────┘                        │
├────────────────────────────────────────────────────────────────────────────┤
│  🎙 mic   📷 camera   🖥 share   💬 notes        Leave quietly  End session ▸│
└────────────────────────────────────────────────────────────────────────────┘
```
Pre-join state shows a device check (camera preview, mic level, “allow permissions” guidance), the booked
window, and the join button that is **disabled until 15 minutes before the start** with the reason stated.
Closed rooms render a read-only summary with the settlement outcome.

**`/wallet` (`WalletPage.vue`)**
```
┌ Balance 2.50 TT    Held 0.00    Earned 6.50    Spent 3.00    Granted 3.00 ──┐
│ ▣ “1 hour = 1 Time Token” · partial hours round to the nearest 15 minutes   │
├────────────────────────────────────────────────────────────────────────────┤
│ Ledger ≈ (date · reason · booking link · policy code · amount · balance)    │
│  ↑ filter: all / earned / spent / grants / refunds / adjustments            │
└────────────────────────────────────────────────────────────────────────────┘
```
Every row shows `reason` and `policyCode`; a blocked settlement shows its reason with a link to the session.

### 6.4 Community and trust

**`/communities` (`CommunitiesPage.vue`)** — cards with member/post counts and a *Your communities* strip.
**`/communities/:slug` (`CommunityDetailPage.vue`)** — header, join/leave, curated rules, pinned posts, feed
with kind chips (`post · question · resource · event`), composer, reactions, comment thread, and the
owner/moderator affordances.
**`/notifications` (`NotificationsPage.vue`)** — grouped by day, unread markers, per-type iconography, “mark
all read”, and an empty state that explains what will arrive here.
**Report flow (modal from context)** — reason select, details, “what happens next” text, and the promise that
the reported member is not told who reported them. Entry points sit on listings, profiles, posts and reviews.

### 6.5 Administration — `/admin` (`AdminPage.vue`)

Seven tabs, each a table or card list: **Overview** (metrics, recent settlements, policy version), **Members**
(roles, suspension, wallet adjustment with a mandatory reason), **Reports** (triage → uphold/dismiss → hide
content), **Disputes** (evidence view → refund / split / release / close), **Ledger** (all transactions,
read-only), **Settlements** (decision records with verified minutes), **Policy** (token, booking, settlement,
cancellation, community sections with a diff preview before saving).

The dashboard states its own limits: *“Administrators cannot write balances directly — every adjustment
creates an auditable ledger row.”*

---

## 7. Empty, loading and error states

| Situation | Treatment |
| --- | --- |
| First visit, no listings | `AppEmptyState` “Nothing here yet — be the first to offer a skill” + CTA |
| Loading a list | `AppSkeleton` cards, never a spinner over blank space |
| Loading a page | Route-level skeleton with the section headings already in place |
| Empty ledger | Explains that the signup grant will appear here and links to the policy |
| No sessions | Distinguishes “you have not booked anything” from “nothing matched your filters” (with a reset) |
| Blocked settlement | Amber card naming the reason in plain language, the confirm action, and a dispute link |
| Network/permission error | Inline error with the backend's message verbatim and a retry action |
| Room not open yet | Countdown to the join window and a calendar link |

---

## 8. Content voice

- Second person, present tense, no exclamation marks in system messages.
- Never call tokens money. Say “Time Tokens”, “credit”, “balance” — never “pay”, “purchase”, “cash out”.
- Numbers are always formatted (`formatTokens`, `formatDuration`, `formatRelative`) so the same value looks the
  same everywhere.
- Errors state what happened, why, and the next action — e.g. “You need 1 Time Token for this session and your
  balance is 0.50 TT. Teach a session first, or ask the teacher for a shorter format.”
