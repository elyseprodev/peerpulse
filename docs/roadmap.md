# PeerPulse — Eight-Week Roadmap

> **Deliverable 6 of 11.** The plan with measurable acceptance criteria, a status column reflecting what this
> repository actually contains, and the honest list of things that still need a real cloud project.
>
> **How to read the status column:** ✅ built and exercised locally · 🟡 built but never run against Firebase ·
> ⬜ not started.

---

## 1. Assumptions behind the schedule

- One full-stack developer, ~1 week per milestone, 1:1 sessions only, no payments anywhere.
- A Firebase project exists from **Week 3** onward; TURN is provisioned in **Week 5**.
- The token economy's rules are frozen at v`2026.1` (1 token/hour, nearest-15-minute rounding, 24 h auto-settle,
  72 h dispute window). Changing them is a policy change, not a code change.
- "Done" means the acceptance criteria are demonstrated in a browser against a deployed environment — not that
  the code exists.

---

## 2. The plan

### Week 1 — Foundation: requirements, architecture, data model, threat model

| | |
| --- | --- |
| **Objective** | Agree what is being built and what is deliberately excluded before writing product code. |
| **Deliverables** | `docs/requirements.md`, `docs/architecture.md`, `docs/firestore-data-model.md`, `docs/security.md`; repository scaffold (Vite + Vue 3 + TypeScript strict + Tailwind 4 + router + Pinia). |
| **Acceptance criteria** | Every one of the 12 vision sections maps to a numbered requirement; the collections list is frozen; the trust boundary ("no client writes a balance") is written down and the client write surface is stated exhaustively; `npm run typecheck` and `npm run build` pass on an empty app. |
| **Status** | ✅ all four documents exist; scaffold committed (`728ab84`). |

### Week 2 — Domain layer and the mobile-first shell

| | |
| --- | --- |
| **Objective** | Put the token economy's arithmetic and lifecycle rules in one dependency-free module, and build the design system it will be presented through. |
| **Deliverables** | `shared/{domain,tokenPolicy,booking,settlement}.ts`; `src/components/ui/*` primitives; `AppShell`; design tokens; dark + light themes. |
| **Acceptance criteria** | Unit tests prove: 60 min = 1.00 TT; 30 min = 0.50 TT under `nearest`; 31 min = 0.50 TT and 38 min = 0.75 TT (rounding boundaries); 15–180 min window enforced; conflicts detected across touching and overlapping windows; refund rounding floors to the increment; a blocked settlement moves nothing. Keyboard-only pass over every primitive. |
| **Status** | ✅ `tests/unit/tokenPolicy|booking|settlement.spec.ts` cover these cases (112 assertions across the suite); primitives and a11y behaviours covered by `components.spec.ts`, and every route is mounted by `routes.spec.ts`. |

### Week 3 — Authentication, profiles, privacy

| | |
| --- | --- |
| **Objective** | A member can create an account, be provisioned correctly, and control what is public. |
| **Deliverables** | Firebase Auth wiring; `onUserCreated` trigger; profile + settings + onboarding pages; privacy settings; App Check gated on a site key. |
| **Acceptance criteria** | Signing up produces a profile, a wallet with the 3-token grant, a `signup_grant` ledger row and a welcome notification **in one transaction**; signing in twice does not double-grant; a member can sign in again after a reload; a member cannot promote themselves (`role: 'admin'` is refused by rules); `profileVisibility: private` hides the profile page from others. |
| **Status** | 🟡 implemented (`functions/src/triggers.ts`, `src/stores/auth.ts`, `OnboardingPage`, `SettingsPage`, `ProfileEditPage`); verified against the reference backend. Idempotency and the "no double grant" path need the emulator or a real project. |

### Week 4 — Skill exchange and bookings

| | |
| --- | --- |
| **Objective** | Members can publish skills, find each other and agree a session — without any tokens moving yet. |
| **Deliverables** | Listings CRUD + explore/detail pages; booking request modal; confirm/decline/cancel/reschedule functions; bookings list; availability editor. |
| **Acceptance criteria** | A request schedules nothing and moves nothing (wallet unchanged, ledger empty); a teacher can confirm and the room document appears; a request outside 15–180 min, under 2 h notice, over 60 days ahead, conflicting with either member's calendar, or unaffordable is refused with a specific code; cancelling ≥ 24 h ahead refunds 100 % and the ledger row explains why. |
| **Status** | 🟡 implemented end to end against the reference backend (`src/lib/backend/local/sessions.ts`, `functions/src/bookings.ts`, `BookingsPage`, `BookingRequestModal`, `AvailabilityEditor`), and the Cloud Functions paths now have runtime coverage (`functions/tests`, 31 tests). The booking tests are what found the read-after-write bug in `respondToBooking` — every confirmation would have failed on real Firestore. |

### Week 5 — Live sessions (WebRTC)

| | |
| --- | --- |
| **Objective** | Two members can hold a real audio/video session with verified attendance. |
| **Deliverables** | `useWebRTC` composable; video room page; Firestore signalling rules; `getTurnCredentials` function and coturn config; `docs/webrtc-signaling.md`. |
| **Acceptance criteria** | Two browsers connect and reconnect after a reload; media never transits Firestore; a third account cannot read the room, its presence or its signalling (rules test); camera-denied still yields a usable room; presence heartbeat writes attendance segments; join is disabled > 15 min before the start; TURN credentials for two different callers differ and expire. |
| **Status** | 🟡 implemented (`useWebRTC.ts`, `VideoRoomPage.vue`, `functions/src/rooms.ts`, rules spec). Two-tab verification on the local backend is the manual test in `docs/webrtc-signaling.md` §12; the join-window and TURN-credential logic of `openRoom`/`getTurnCredentials` is asserted in `functions/tests`. Real media still needs two browsers. |

### Week 6 — Settlement engine

| | |
| --- | --- |
| **Objective** | Tokens move exactly once, transparently, and only when a session demonstrably happened. |
| **Deliverables** | Settlement planner + ledger builders (already in `shared/settlement.ts`); `endSession`, `confirmCompletion`, `settleSession`, `hourlySettlementSweep`; wallet and ledger UI; blocked/partial/refund surfacing. |
| **Acceptance criteria** | Debit equals credit for every settlement; a second call is a no-op with a notice; attendance below the quorum blocks with `insufficient_verified_attendance`; a learner who can only cover part settles partially, floored to the increment, and the remainder is waived; a missing wallet does not crash the sweep; the sweep touches only `in_progress` bookings older than 24 h; the ledger row shows reason, policy code and resulting balance. |
| **Status** | 🟡 implemented, unit-tested at the planner level (`tests/unit/settlement.spec.ts`) and integration-tested through the real transaction (`functions/tests`): one balanced pair of rows, deterministic ids, replay is a no-op, missing attendance blocks, partial settlement floors correctly. Still unrun against **real** Firestore (the mock is single-threaded). |

### Week 7 — Community, moderation and dispute paths

| | |
| --- | --- |
| **Objective** | The human systems around exchange: communities, reviews, reports, disputes and administrator tooling. |
| **Deliverables** | Communities/posts/comments; reviews with replies; report flow; `resolveReport`; `resolveDispute`; the seven-tab admin dashboard; notifications. |
| **Acceptance criteria** | Reactions can only edit the caller's own key (rules test); a review is impossible without a completed booking and one per member per session; a steward can hide upheld content; a dispute can refund the learner, refund half, release the settlement or close with no movement, and every outcome notifies both members with the steward's reason; an administrator **cannot** write a wallet directly. |
| **Status** | 🟡 implemented (pages, stores, `functions/src/social.ts`, `functions/src/admin.ts`); community and moderation flows exercised on the reference backend, and the steward-only paths (adjust with a reason, policy validation and diff, role changes, metrics) are integration-tested. `resolveDispute` had the same read-after-write bug as `respondToBooking` and is fixed. |

### Week 8 — Hardening, deployment, documentation

| | |
| --- | --- |
| **Objective** | Ship it, and make the shipped thing explainable. |
| **Deliverables** | Rules + emulator test suite; unit suite; `docs/testing.md`, `docs/deployment.md`, `docs/project-structure.md`, `docs/design-system.md`, README; indexes and TTL; hosting headers; observability. |
| **Acceptance criteria** | `npm run typecheck`, `npm test` and `npm run build` pass on a clean clone; the rules suite passes against the emulator; a deploy to a staging project serves the SPA over the production indexes; a two-tab session settles once and the ledger shows two balanced rows; a smoke checklist covers sign-up → book → run → settle → review → dispute. |
| **Status** | 🟡 typecheck, unit tests and docs are in place; the rules suite exists but **has not run** (no JDK in the build environment), and nothing has been deployed to a live project from here. |

---

## 3. What is genuinely finished in this repository

1. **The token economy's arithmetic and identity rules** — implemented once in `shared/*`, consumed by the app,
   the reference backend and the Cloud Functions, and unit-tested at the boundaries (rounding, conflicts,
   quorum, idempotent ids, partial settlement, refunds).
2. **The security posture** — `firestore.rules` + `storage.rules` + `functions/src/*`, with the client write
   surface stated exhaustively and an emulator suite that encodes the central claim.
3. **Both backends behind one interface** — a complete in-browser product (13 listings, 8 members, 12 bookings,
   communities, a report and a dispute) and a Firebase adapter for production.
4. **The whole UI** — 25 routes, 14 primitives, 8 stores, dark/light, responsive, keyboard-accessible.
5. **Documentation** — the eleven briefed deliverables, including WAL-level detail of the data model and the
   signalling protocol.

## 4. What still requires a real environment (do not claim otherwise)

| Item | Why it cannot be verified here |
| --- | --- |
| Firestore emulator rules suite | Java is now available, but the sandbox's network allow-list blocks the emulator jar (storage.googleapis.com and GitHub release assets). Run `npm run test:rules` on any machine with internet access. |
| Cloud Functions against real Firestore | Exercised against the `firebase-mocker` implementation of the Firestore gRPC API (31 tests), not against Google's emulator: transaction conflict detection and rules enforcement are outside that harness. |
| App Check, FCM push | Require a real Firebase project and site key / VAPID key. |
| TURN relay path | Requires a coturn host and the two functions secrets. |
| Email delivery, password reset | Requires Firebase Auth's hosted flow. |
| Load behaviour | No staging environment or traffic generator has been run. |

## 5. Risk register

| Risk | Likelihood | Mitigation (already in the design) |
| --- | --- | --- |
| Firestore signalling latency makes call setup feel slow | Medium | In-region functions and database; only three round trips; UI shows a determinate "connecting" state |
| Symmetric-NAT users cannot connect without TURN | High if TURN is skipped | `getTurnCredentials` exists and degrades honestly; provision coturn before inviting members outside your network |
| Time-token gaming (fake attendance) | Medium | Server-measured overlap of both presence segments, a quorum, a 24 h confirmation path, a dispute window and an auditable ledger |
| Policy change breaks historical clarity | Low | Every ledger row stamps the policy version; changes store a readable diff |
| Function cost from the sweep | Low | The sweep queries only `in_progress` bookings past the cutoff; capped instances |
| Rules drift from the app as features are added | Medium | Rules tests + an explicit "fifteen client write paths" list in `docs/security.md` |

---

## 6. Post-launch candidates (not in the eight weeks)

Group sessions via an SFU, calendar invitations (`.ics`), reminders by email and push, a richer matching
engine, community-level exchanges, an accessibility audit with real assistive-technology users, and an
audited external review of the settlement code before scaling beyond a pilot community.
