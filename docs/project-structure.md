# PeerPulse — Project Structure & Reusable Components

> **Deliverable 8 of 11.** Where every file lives, what each layer may depend on, the contract of each reusable
> component, and the recipe for adding a feature without breaking the architecture.

---

## 1. The tree, annotated

```
peerpulse/
├── index.html                     Vite entry: fonts, theme bootstrap, meta, favicon
├── vite.config.ts                 aliases (@ → src, @shared → shared), dev server, vitest config
├── tsconfig.json / .app / .node   project references; strict, noUnused*, verbatimModuleSyntax
├── .env.example                   every VITE_* variable, documented; copy to .env.local
│
├── shared/                        ── the business core: no Vue, no DOM, no Firebase ──
│   ├── domain.ts                  every persisted type + the settlement result envelope
│   ├── tokenPolicy.ts             DEFAULT_PLATFORM_CONFIG, computeTokenAmount, validation, policy codes
│   ├── booking.ts                 lifecycle, conflict detection, canJoinRoom, cancellation + refund policy
│   ├── settlement.ts              attendance verification, planSettlement, deterministic ledger ids
│   └── index.ts                   barrel
│
├── src/
│   ├── main.ts                    createApp + Pinia + router + global styles
│   ├── App.vue                    shell switch (marketing vs app) + toasts + route transitions
│   ├── lib/
│   │   ├── env.ts                 typed import.meta.env reader; backend-mode decision
│   │   ├── format.ts              formatTokens/Duration/Date/Relative — one place for every number
│   │   ├── avatar.ts              deterministic SVG avatar generator (seeded by uid)
│   │   ├── catalog.ts             categories, formats, levels, languages, reaction set
│   │   └── backend/
│   │       ├── types.ts           PeerPulseBackend interface + DTOs + BackendRequestError
│   │       ├── index.ts           getBackend(): local | firebase
│   │       ├── local/             in-browser reference backend (db, seed, sessions, social, notify)
│   │       └── firebase/          production adapter (app, convert, index)
│   ├── stores/                    auth, skills, bookings, wallet, notifications, community, admin, ui
│   ├── components/
│   │   ├── ui/                    14 primitives (§3)
│   │   ├── layout/AppShell.vue    header, nav, mobile sheet, footer
│   │   ├── skills/                SkillCard
│   │   ├── bookings/              BookingCard, BookingRequestModal
│   │   ├── schedule/              AvailabilityEditor
│   │   ├── members/               MemberCard
│   │   └── wallet/                TokenExplainer
│   ├── composables/useWebRTC.ts   the media session controller
│   ├── pages/                     25 routes (§4)
│   ├── router/index.ts            route table + UX guards
│   └── assets/styles/main.css     @theme tokens, component layer, keyframes, davue datepicker theming
│
├── functions/                     ── its own npm project, deployed by the Firebase CLI ──
│   ├── package.json               firebase-admin, firebase-functions; build → lib/
│   ├── tsconfig.json              CommonJS/ES2022, strict, noUnused*
│   └── src/
│       ├── index.ts               setGlobalOptions + exactly the exported endpoints
│       ├── bookings.ts            8 booking callables
│       ├── rooms.ts               openRoom, endSession, getTurnCredentials
│       ├── social.ts              createReview, resolveReport, resolveDispute
│       ├── admin.ts               roles, status, wallet adjustment, policy, metrics
│       ├── triggers.ts            onUserCreated provisioning
│       ├── lib/                   errors, refs (db + admin checks), notify, format, convert, settlement
│       └── shared/                GENERATED copies of shared/* — never edit (see scripts/sync-shared.mjs)
│
├── scripts/sync-shared.mjs        mirror shared/* into functions; --check fails on drift
├── firestore.rules                the client write surface, exhaustively
├── firestore.indexes.json         ~20 composite indexes
├── storage.rules                  avatars + listing media only
├── firebase.json                  hosting rewrites/headers, functions predeploy, emulator ports
│
├── tests/
│   ├── unit/                      112 tests: policy, booking, settlement, reference backend, components, routes
│   └── rules/                     Firestore emulator suite (needs a JDK + the emulator jar)

functions/tests/                   31 tests: the callables executed against a real Admin SDK
functions/vitest.config.ts         single fork — every file shares one in-memory Firestore
functions/tsconfig.test.json       type-checks src + tests without emitting
│
└── docs/                          the eleven briefed deliverables
```

---

## 2. Dependency rules

```
pages ──▶ stores ──▶ backend adapter ──▶ (local | firebase)
  │           │                              │
  └──▶ components/ui            shared/* ◀────┘  (also imported by functions/src/shared)
```

| Layer | May import | Must not import |
| --- | --- | --- |
| `shared/*` | nothing but itself | Vue, Firebase, `src/*`, `functions/*` |
| `src/lib/backend/*` | `shared/*`, `src/lib/env` | stores, components, pages |
| `src/stores/*` | backend, `shared/*`, `src/lib` | components, pages |
| `src/pages`, `src/components` | stores, `shared/*` (read-only helpers), `src/lib`, `src/components/ui` | backend implementations directly — always `useXStore()` |
| `functions/src/*` | `functions/src/shared/*`, `functions/src/lib/*`, firebase-admin | `src/*` |

The rule that keeps the token economy honest: **a page may render a rule (`computeTokenAmount`) but never
decide one.** If a rule is needed to decide an outcome, it belongs in `shared/` and is called from a store or a
function.

---

## 3. UI primitives — contract

| Component | Props | Emits | Slots | Accessibility contract |
| --- | --- | --- | --- | --- |
| `AppButton` | `variant`, `size`, `type`, `to`, `href`, `disabled`, `loading`, `block`, `icon`, `iconRight` | — | default | `aria-busy` while loading; `disabled` blocks activation; renders `<a>`/`RouterLink`/`<button>` appropriately |
| `AppInput` | `modelValue`, `label`, `type`, `placeholder`, `hint`, `error`, `required`, `disabled`, `autocomplete`, `icon`, `min`, `max`, `step` | `update:modelValue` | — | `label[for]` ↔ `input[id]`; `aria-invalid` + `aria-describedby` on error; number bounds accepted as strings (template attributes) |
| `AppSelect` | `modelValue`, `options`, `label`, `hint`, `error` | `update:modelValue` | — | same labelling contract; native element for platform pickers |
| `AppModal` | `open`, `title`, `description`, `size` | `close` | default, `footer` | teleports to body; focus trap; `Escape` closes; focus restored; `role="dialog"` + `aria-modal="true"`; background scroll locked |
| `AppBadge` | `tone`, `size`, `dot` | — | default | tone is decorative, the text carries the meaning |
| `AppAvatar` | `displayName`, `seed`, `photoURL`, `size`, `online`, `ring` | — | — | image has `alt` = display name; the generated SVG is `aria-hidden` with a text label beside it |
| `AppRating` | `value`, `count`, `size`, `interactive` | `update:value` | — | non-interactive renders `aria-label="4.8 out of 5 from 12 reviews"`; interactive uses radio semantics |
| `AppStat` | `label`, `value`, `delta`, `icon`, `tone` | — | — | value is text, not an image of text |
| `AppEmptyState` | `icon`, `title`, `description`, `actionLabel`, `actionTo` | `action` | default | heading level configurable by the page; the action is a real button/link |
| `AppSkeleton` | `lines`, `variant` | — | — | `aria-hidden`; the containing view owns the polite loading announcement |
| `AppToasts` | — | — | — | `aria-live="polite"`; errors persist until dismissed |
| `AppIcon` | `name`, `size`, `strokeWidth`, `label` | — | — | `aria-hidden` unless `label` is given, then `role="img"` |
| `AppLogo` | `compact`, `size` | — | — | decorative mark + wordmark text |
| `SectionHeading` | `eyebrow`, `title`, `description`, `align` | — | default | renders a real `<h2>` so heading order stays valid |

Feature components:

| Component | Contract |
| --- | --- |
| `SkillCard` | Props: listing + teacher snapshot. Renders cost via `formatTokens(listing.durationMinutes …)`; emits `select`. Used on the landing page, explore grid and profile pages. |
| `BookingCard` | Props: booking, viewer role, now. Renders the status vocabulary, the countdown to the join window, the token amount, the cancellation policy preview and role-appropriate actions; emits `cancel`, `confirm`, `reschedule`, `join`, `review`, `dispute`. |
| `BookingRequestModal` | Props: listing, teacher availability; two-way `open`; emits `submitted`. Validates client-side with the shared validators, warns on conflicts, previews tokens, and explains that no tokens move while pending. |
| `AvailabilityEditor` | `modelValue: AvailabilityBlock[]`; emits `update:modelValue`. Rejects end ≤ start and overlaps; works in the member's own timezone. |
| `MemberCard` | Props: profile; renders teaching/learning categories and rating; used by the directory. |
| `TokenExplainer` | No props. The single source of the "what a token is / is not" copy, reused in three places so the promise cannot drift. |

---

## 4. Routes and their guards

| Route | Page | Access |
| --- | --- | --- |
| `/` | Landing | public |
| `/how-it-works` | How it works | public |
| `/skills`, `/skills/:id` | Explore, listing | public |
| `/members`, `/members/:uid` | Directory, profile | public (profiles honour privacy settings) |
| `/communities`, `/communities/:id` | Communities | public read, member write |
| `/signin`, `/register`, `/forgot-password` | Auth | guests only (signed-in members are redirected) |
| `/onboarding` | Onboarding wizard | member |
| `/dashboard` | Dashboard | member |
| `/bookings` | Bookings | member |
| `/calendar` | Booking calendar | member |
| `/wallet` | Wallet + ledger | member |
| `/rooms/:roomId` | Live session | member, participant |
| `/notifications` | Notifications | member |
| `/profile` | Edit profile | member |
| `/settings` | Settings & privacy | member |
| `/admin` | Administration | member + `admin` claim (UX only — the rules and functions are the boundary) |
| `/community-guidelines`, `/privacy`, `/terms` | Policy pages | public |
| `/:pathMatch(.*)*` | Not found | public |

---

## 5. Adding a feature: the recipe

1. **Model it.** If it persists, add the type to `shared/domain.ts`. If it decides anything about tokens,
   bookings or attendance, add the decision to `shared/{tokenPolicy,booking,settlement}.ts` with a unit test in
   `tests/unit/`.
2. **Sync.** `npm run sync:shared` — the functions package now sees the change (and `npm run check:shared`
   fails CI if you forget).
3. **Expose it.** Add the method to `PeerPulseBackend` (`src/lib/backend/types.ts`) and implement it in **both**
   adapters: the local reference backend (so it can be demonstrated and unit-tested offline) and the Firebase
   adapter (calling a Cloud Function for anything privileged).
4. **Guard it.** If the operation writes privileged data, add the callable in `functions/src/*` and export it
   from `functions/src/index.ts`; if it is a client write, add the narrowest possible rule branch and a case in
   `tests/rules/firestore.rules.spec.ts`.
5. **Surface it.** Add store state/action, then the page or component. Every list needs an empty state and
   every action needs a failure path that shows the backend's message.
6. **Prove it.** Unit test the rule; add a manual step to `docs/testing.md` if it is a cross-cutting flow.
7. **Document it.** Update the relevant doc — the data model for a new field, the security doc for a new write
   path, the design doc for a new primitive.

---

## 6. Conventions

| Topic | Convention |
| --- | --- |
| Component names | `AppX` for primitives, `XCard`/`XEditor`/`XModal` for feature components; PascalCase files |
| Store ids | `useXStore` in `src/stores/x.ts`; state as `ref`/`computed`, actions as `async` functions returning typed data |
| Types | `interface` for persisted shapes, `type` for unions; ISO strings for time; no `any` (the codebase has zero) |
| Errors | `BackendRequestError` with a `code` such as `wallet/insufficient`; pages show `error.message` verbatim |
| Time | Always UTC ISO internally; convert for display in the member's `timezone` via `format.ts` |
| Tokens | Never format manually: `formatTokens(value)` → `1.00 TT` |
| Comments | Explain *why* (a policy decision, a WebRTC quirk), never *what* |
| Commits | One logical unit each, imperative subject, body explaining the decision |

---

## 7. Build and tooling configuration

| File | What it does |
| --- | --- |
| `vite.config.ts` | Aliases, `server.host: '0.0.0.0'` + `allowedHosts: true` for the preview proxy, manual vendor chunk, vitest (`jsdom`, `tests/unit/setup.ts`) |
| `tsconfig.app.json` | Strict app build; `vue-tsc --noEmit` is `npm run typecheck` |
| `tsconfig.node.json` | Vite config typing |
| `vitest.rules.config.ts` | Node environment, `tests/rules/**`, `fileParallelism: false` (the emulator is shared state) |
| `firebase.json` | Hosting (`dist`, SPA rewrite, immutable asset caching, security headers incl. `Permissions-Policy` for camera/mic/display-capture), functions predeploy build, emulator ports |
| `scripts/sync-shared.mjs` | Copies `shared/*.ts` → `functions/src/shared/`, strips nothing, rewrites nothing; `--check` for CI |

Hosting security headers, verbatim from `firebase.json`:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY            (the app is an app, not an embed)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()
```
plus `Cache-Control: public, max-age=31536000, immutable` on `/assets/**` and
`no-cache, no-store, must-revalidate` on `/index.html`.

`Permissions-Policy` is what allows `getUserMedia` and `getDisplayMedia` on the deployed origin while denying
geolocation outright — a deliberate default for a product that needs exactly two device permissions.
