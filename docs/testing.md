# PeerPulse — Automated Tests, Verification & Manual QA

> **Deliverable 11a of 11.** What is tested, how to run it, what the tests prove, and — separately and
> explicitly — what has **not** been verified.

---

## 1. Commands

```bash
npm ci                      # install (root)
cd functions && npm install # install the functions project, then `cd ..`

npm run typecheck           # vue-tsc, strict, app + shared + tests
npm test                    # vitest, jsdom, tests/unit/**  → 112 tests
npm run build               # production build to dist/
npm run dev                 # local mode at http://localhost:5173 (binds 0.0.0.0)

cd functions && npm test    # Cloud Functions, executed for real → 31 tests
cd functions && npm run typecheck   # tsc over src + tests

npm run sync:shared         # mirror shared/* into functions/src/shared
npm run check:shared        # fail if the copies drift

npm run test:rules          # Firestore emulator rules suite — REQUIRES a JDK
npm run emulators           # emulators + functions + hosting for manual verification
npm run deploy:rules        # firebase deploy --only firestore:rules
npm run deploy:functions    # builds functions/, deploys
npm run deploy:hosting      # builds the app, deploys
```

---

## 2. Unit suites (112 tests, all passing locally)

| Suite | Tests | Proves |
| --- | --- | --- |
| `tests/unit/tokenPolicy.spec.ts` | 22 | 60 min = 1.00 TT; 30 min = 0.50 TT; rounding boundaries (31 min → 0.50 under `nearest`, 38 min → 0.75); `round_up`/`round_down`/`exact` behaviour; explanation strings; duration and window validation (15–180 min, 2 h notice, 60 days); wallet maths (affordability, hold/release, negative-guard); cancellation refund policy including the free window and the teacher-cancels case. |
| `tests/unit/booking.spec.ts` | 18 | Window overlap (touching windows do **not** conflict); conflict detection against a member's calendar including buffers; the status transition table (a settled booking is terminal); `canJoinRoom` (participants only, opens 15 min before, closed after the room closes); lifecycle helpers. |
| `tests/unit/settlement.spec.ts` | 23 | `verifyAttendance` from the **overlap** of both presence segments clamped to the booked window, including one-sided and partial presence; the quorum rule `min(minVerifiedMinutes, max(1, ceil(booked/2)))`; `planSettlement` outcomes — `settle`, `partial` (debit floored to the increment), `refund`, `blocked` with each reason in `SETTLEMENT_BLOCKED_REASONS`; double confirmation overriding a missed quorum while auto-completion alone does not; ledger construction: deterministic ids, balanced debit/credit amounts, `balanceAfter`, `policyCode`. |
| `tests/unit/localBackend.spec.ts` | 25 | The whole reference backend as an integration surface: sign-up provisions profile + wallet + grant + notification; sign-in/sign-out and session persistence; booking request → confirm → room creation; a pending booking moves no tokens; running a session writes attendance and settles exactly once; a replayed settlement is a no-op; signalling is scoped so a non-participant cannot read or post; governance actions (role changes, wallet adjustments with a reason, dispute resolution refunding from the ledger). |
| `tests/unit/components.spec.ts` | 17 | Primitive behaviour that accessibility depends on: button loading/disabled semantics, icon labelling, input label/error wiring, select options, modal focus trap + `Escape` + focus restoration, empty-state actions, badge/stat rendering. |
| `tests/unit/routes.spec.ts` | 7 | The application as a whole: mounts the real router, stores and reference backend, then walks all eleven public routes and seven member routes, asserts the 404 page, asserts that eight protected routes redirect a guest to `/signin` with the intended path remembered, that a member is bounced from `/admin` to the dashboard, that signing out closes the member surface again, and that the steward dashboard renders. A render-time error on any page fails the test, so a broken page cannot pass silently. |

Run them with `npm test` (watch: `npm run test:watch`). The suite is deterministic and offline — it never
touches Firebase or the network.

---

## 3. Cloud Functions suite (31 tests, executed against a real Admin SDK)

`functions/tests/functions.spec.ts` runs the **actual callables** — the real
`firebase-admin` SDK talking to `firebase-mocker`, a Node implementation of the
Firestore gRPC service and the Identity Toolkit REST API. The functions run
unmodified: `getFirestore()`, `Timestamp`s, `array-contains` queries,
subcollections and `runTransaction` all go through the SDK. See
`functions/tests/harness.ts` for the exact boundaries of that claim.

| Block | Proves |
| --- | --- |
| createBooking | unauthenticated and suspended callers are refused; you cannot book your own listing; a 200-minute session, a 10-minute-notice start, a conflicting slot and an unaffordable session are each refused with their own code; **a created request moves no tokens at all** — ledger empty, both wallets unchanged — and notifies the teacher |
| respondToBooking | an outsider and the learner-cannot-confirm are refused; the teacher's confirmation flips the booking to `confirmed`, creates the room document and notifies the learner; a second confirmation is refused |
| rooms | `openRoom({bookingId})` provisions the room and does not let anyone in early; `openRoom({roomId})` inside the window marks the session in progress; an outsider cannot end a session; TURN credentials are STUN-only without configuration and HMAC-derived (`<expiry>:<uid>`) with it |
| settlement | one verified session debits exactly what it credits, with deterministic ids (`tx_{id}_debit`/`_credit`), the acting uid, the policy code and the resulting balance; **a replay moves nothing and does not bump `attempts`**; no attendance blocks instead of settling and writes no ledger row; an outsider cannot settle; a learner who can only cover part settles partially with the ledger still balanced |
| reviews and disputes | a review is refused for a session that never happened and refused to a non-participant; a dispute cannot be resolved without the steward claim |
| administration | every administrative call is refused without the claim; a wallet adjustment without a written reason is refused; with one it changes the balance and writes an `admin_adjustment` row naming the steward; an overdraft is refused; the policy rejects invalid values and stores a readable diff with the changer's uid; a member can be promoted only by a steward; metrics reach a steward |
| healthcheck & exports | the healthcheck reports the seeded policy; every name in the **client's** `CALLABLE` map exists as an exported function (the test reads the map out of the client source, so a rename on either side fails here) |

What this suite does **not** cover: Security Rules (they are enforced by
Firestore, not by the functions), and Firestore's multi-writer transaction
conflict detection — the mock commits atomically but is single-threaded, so it
cannot exercise two concurrent settlements racing. That race is instead made
impossible by construction (deterministic document ids inside one transaction).

## 4. Rules suite (written, **not yet executed**)

`tests/rules/firestore.rules.spec.ts` runs against the Firestore emulator and encodes the product's central
claim. Ten describe blocks, five identities (teacher, learner, outsider, administrator, guest):

| Block | Asserts |
| --- | --- |
| wallets and the ledger | a member reads only their own wallet; an administrator reads any wallet but **cannot write one**; no client can write a ledger row or a settlement record; the token policy is readable (guests included) but never writable |
| bookings | participants and administrators read; clients cannot create or delete; the only client lifecycle write is opening a dispute, one-way; settlement fields cannot be written |
| video rooms | outsiders cannot read the room, presence, signalling or attendance; presence is self-owned; signalling requires `from == self` and a participant recipient; a member reads only what is addressed to them; a closed attendance segment cannot be reopened; rooms cannot be created or closed by a client |
| member profiles | signed-in members read, guests do not; no self-promotion; `stats` untouchable; the listing-reference sync path works |
| listings | public read; owner-only content edits; no counter inflation |
| reviews | no client creation; only the subject may reply; no rating edits |
| notifications | recipient-only read; only the `read` flag may change |
| community posts | author-only creation; reactions limited to the caller's own key; `commentCount` refresh only; comments under the caller's own name |
| reports and disputes | filed as yourself, never pre-resolved; disputes only by booking participants |
| everything else | default deny |

```bash
npm run test:rules
# → firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.ts"
```

> **Status: not run — and the reason is now narrower than before.** A JDK is available (Temurin 25 via the
> `jdk4py` wheel), `java -version` works, and the CLI gets as far as downloading the emulator. The build
> sandbox's network allow-list then blocks the artifact itself: `storage.googleapis.com` (where the CLI fetches
> `cloud-firestore-emulator-v1.19.8.jar`) returns nothing, and every alternative route was checked and refused —
> GitHub release assets resolve to `release-assets.githubusercontent.com`, which is blocked; no npm, PyPI or
> Docker image ships the jar; and no copy exists on the filesystem. On a normal machine with internet access
> `npm run test:rules` will fetch the jar and run these tests unchanged.
>
> So these tests are *written and reviewed line by line against the rules file* but are still not passing
> evidence. Treat the first executed run as a real milestone: fixtures and rules are both plausible places for
> a first red test.

Static verification that was done instead: read `firestore.rules` against `src/lib/backend/firebase/index.ts`
and `local/sessions.ts` to confirm that every write the client actually performs is permitted, and that nothing
permitted is a token movement. That review found and fixed three mismatches (the review reply field, the
settlement read rule, and guest access to the policy) — recorded in the commit that introduced
`docs/security.md`.

---

## 5. Not automated (and why)

| Area | Reason | Manual substitute |
| --- | --- | --- |
| Firestore Security Rules | The emulator jar cannot be downloaded in this sandbox (see §4); rules only exist inside Firestore | `firebase emulators:start` locally, then attempt the forbidden writes from the console |
| Multi-writer transaction conflicts | The mock commits atomically but is single-threaded | Deterministic ids make a duplicate settlement impossible by construction; confirm on staging with two concurrent calls |
| WebRTC media | Requires two real browsers with cameras | The two-tab script in `docs/webrtc-signaling.md` §12 (works in local mode) |
| TURN relay | Requires a coturn host | Verify `getTurnCredentials` returns a credential whose HMAC matches the secret, then force a relay-only call |
| FCM push, App Check | Require a real project, VAPID key and reCAPTCHA site key | Deploy and confirm tokens are attested and notifications arrive |
| Visual regression | No screenshot baseline | Design review against `docs/design-system.md` |
| Load/performance | No staging traffic | — |

---

## 6. Manual QA: the end-to-end walkthrough (local mode)

```bash
npm ci && npm run dev        # http://localhost:5173
```

Sign in with the shared demo password `peerpulse`:

| Account | Email | Use |
| --- | --- | --- |
| Sam (member) | `sam@peerpulse.app` | learner — the default entry point |
| Lena (teacher) | `lena@peerpulse.app` | the other half of a session |
| Admin | `admin@peerpulse.app` | governance surfaces |
| Others | `paulo@` · `mei@` · `amara@` · `tomas@` · `jonas@peerpulse.app` | populated world, extra participants |

Every seeded member shares the password, so two tabs can be two different people — which is the point.

**Checklist — each step states its expected result.**

1. **Landing as a guest** — hero, four steps, featured listings, the token explainer. “Join free” goes to
   `/register`; the marketplace, members and communities are browsable without an account.
2. **Sign up** — a new account lands on the onboarding wizard; the wallet shows the 3-token signup grant and
   the ledger shows one `signup_grant` row. Signing out and back in does **not** grant again.
3. **Onboarding** — six steps save progressively; the review step shows exactly which fields will be public;
   “Skip for now” is possible and the dashboard nudges you later.
4. **Publish a listing** — the form refuses a duration outside 15–180 minutes; the listing appears in
   `/skills` and on your profile, and its price reads `1.00 TT` for 60 minutes.
5. **Request a session** (as Sam against one of Lena's listings) — the modal previews the token amount, warns
   about a deliberate conflict, and submits. The booking is `requested`, the teacher is notified, and **the
   wallet balance and the ledger are unchanged**.
6. **Confirm** (tab B as Lena) — the booking becomes `confirmed`, a room id appears, and the join button is
   disabled with “opens 15 minutes before the session”.
7. **Join** — in local mode the room opens the media session; grant camera/mic. Presence and attendance rows
   appear under the room. A third account cannot open the same room (it errors).
8. **Settle** — “End session for both” closes the room, seals attendance and settles once: the ledger gains
   `tx_…_debit` for the learner and `tx_…_credit` for the teacher with equal amounts, both wallets update live,
   and the settlement record names the verified minutes. Pressing the action twice changes nothing.
9. **Blocked settlement** — end a session within seconds (below the 10-minute quorum) and confirm the amber
   “verification needed” path and its dispute entry instead of a settlement.
10. **Review** — after a completed session, each participant may write exactly one review; the recipient can
    reply once.
11. **Cancel** — a session more than 24 h away cancels free, with the policy code and refund visible; a late
    cancellation shows the reduced refund before you confirm.
12. **Dispute** — opening a dispute freezes the booking (status `disputed`) without moving tokens; as the
    admin, resolving it with a refund writes a ledger row and notifies both members with the reason.
13. **Admin limits** — `/admin` shows metrics, reports, disputes, the ledger and the policy. Try to edit a
    balance: the only path is “adjust with a reason”, and the result appears in the ledger with your uid.
14. **Communities** — create one, post a question, react, comment; confirm you cannot edit someone else's
    reaction in the UI.
15. **Accessibility pass** — tab through the booking modal, the onboarding wizard and the room controls;
    `Escape` closes dialogs and focus returns to the trigger; toggling the light theme keeps contrast.
16. **Responsive pass** — 375 px, 768 px and 1440 px: navigation collapses, cards reflow, no horizontal scroll.
17. **Sign out** — protected routes redirect to `/signin`; the browser back button does not reveal them.

---

## 7. What “done” means for a change

1. `npm run typecheck` passes.
2. `npm test` passes (and new rules have new tests).
3. `npm run check:shared` passes after `shared/` edits.
4. `npm run build` succeeds.
5. New privileged writes have a callable + a rules test.
6. The relevant manual checklist step above still produces its expected result.
7. The affected document is updated.
