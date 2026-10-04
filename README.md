# PeerPulse

**Trade Time. Share Skills. Grow Together.**

A community-driven time bank for skills. One hour of teaching earns **one Time Token**, and one Time Token buys
**one hour of learning** from anyone else in the community. There is no money anywhere in the product — no
prices, no purchases, no payouts — and the code enforces that: a token can only come from a session that
actually happened, and only a Cloud Function can move one.

```
1 hour of teaching  =  1 Time Token  =  1 hour of learning
```

---

## Quick start (60 seconds, no cloud project)

```bash
npm ci
npm run dev            # http://localhost:5173
```

The default backend mode is `local`: the entire product — auth, database, bookings, settlement, communities and
even WebRTC signalling between two tabs — runs in the browser against a seeded demo world. Sign in with any of
these accounts, password `peerpulse`:

| Account | Email | Who |
| --- | --- | --- |
| Sam | `sam@peerpulse.app` | member, learner, the default demo entry |
| Lena | `lena@peerpulse.app` | teacher with published listings |
| Admin | `admin@peerpulse.app` | steward — reports, disputes, policy, ledger |
| Others | `paulo@` · `mei@` · `amara@` · `tomas@` · `jonas@peerpulse.app` | a populated community |

Open a second browser tab, sign in as a different member, and you have both sides of an exchange: request →
confirm → join the room → settle → review. The room works between tabs because the reference backend shares one
database through `localStorage`.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` (local backend) |
| `npm run build` | Typecheck (`vue-tsc`) then build to `dist/` |
| `npm run typecheck` | Strict TypeScript check of app, shared and tests |
| `npm test` | Vitest unit + integration suite (112 tests) |
| `npm run test:rules` | Firestore emulator security-rules suite (**needs a JDK**) |
| `npm run sync:shared` | Mirror `shared/*` into `functions/src/shared/` |
| `npm run check:shared` | Fail if those copies have drifted |
| `npm run emulators` | Auth, Firestore and Functions emulators |
| `npm run deploy:rules` / `:functions` / `:hosting` | Deploy to Firebase |

Environment variables are documented in `.env.example`; the TURN/STUN runtime variables live in the functions
project (`docs/deployment.md` §3).

---

## How it works, in four moves

1. **Offer a skill.** Publish a listing: title, category, level, format, duration, outcomes.
2. **Book a session.** The modal previews the token cost and validates the request against both calendars.
   *A pending request moves nothing* — the balance and the ledger stay untouched until the session happens.
3. **Meet live.** The room opens 15 minutes before the session. Media is peer-to-peer over WebRTC; Firestore
   carries only the signalling. Presence heartbeats record attendance.
4. **Settle.** The server intersects both members' attendance with the booked window, checks the quorum, and
   writes one balanced pair of ledger rows inside a single transaction. Deterministic ids mean a replayed
   settlement is a no-op.

Refunds, partial settlements, blocked settlements, confirmations, disputes and steward decisions are all
first-class outcomes, and every one of them is visible in the member's ledger with a reason and a policy code.

---

## Architecture in one picture

```
Vue 3 SPA (25 pages, 14 primitives, 8 Pinia stores)
   │  renders, never decides
   ▼
shared/*  ← the only place the token economy is defined
   │  used identically by…
   ├──▶ src/lib/backend/local/*      in-browser reference backend (demo + tests)
   └──▶ functions/src/shared/*       mirrored copy → Cloud Functions (production authority)
                                            │
Firestore ◀── rules: no client can move a token ──┘
```

- **Business logic lives outside the UI.** `shared/tokenPolicy.ts`, `shared/booking.ts` and
  `shared/settlement.ts` are dependency-free and are consumed by the browser, the reference backend and the
  Cloud Functions. `npm run check:shared` guarantees the last two cannot drift.
- **Two backends, one interface** (`src/lib/backend/types.ts`): swap `VITE_BACKEND_MODE` and nothing else
  changes.
- **The client write surface is published.** `docs/security.md` lists the fifteen document paths a browser may
  write and states why each is safe; everything privileged is a callable.

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/requirements.md`](docs/requirements.md) | Roles, 34 functional requirements, the business rules and their enforcement, 8 user journeys |
| [`docs/architecture.md`](docs/architecture.md) | Layers and trust boundaries, sequence diagrams for settlement and calls, deployment topology |
| [`docs/firestore-data-model.md`](docs/firestore-data-model.md) | Every collection with a sample record, access matrix, indexes, TTL, invariants |
| [`docs/webrtc-signaling.md`](docs/webrtc-signaling.md) | Firestore signalling, glare handling, ICE/TURN, presence and attendance, failure table, two-tab test script |
| [`docs/security.md`](docs/security.md) | Rules posture, the client write surface, server-side authorization, admin limits, threat model |
| [`docs/roadmap.md`](docs/roadmap.md) | The eight-week plan with measurable acceptance criteria and an honest status column |
| [`docs/design-system.md`](docs/design-system.md) | Tokens, typography, component contracts, accessibility rules, page-by-page wireframes |
| [`docs/project-structure.md`](docs/project-structure.md) | File tree, dependency rules, component contracts, the recipe for adding a feature |
| [`docs/testing.md`](docs/testing.md) | Test suites, how to run them, what is and is not verified, the manual end-to-end checklist |
| [`docs/deployment.md`](docs/deployment.md) | Firebase setup, environment variables, coturn, deploy order, post-deploy verification, known gaps |

---

## What is verified, and what is not

Honesty is a feature of this repository, so it is stated on the front page:

**Verified in this repository**

- 112 unit/integration tests pass (`npm test`): the token maths and its boundaries, booking conflicts and
  lifecycle, attendance verification and every settlement outcome, the whole reference backend, the
  accessibility-relevant behaviour of the UI primitives, and a route smoke test that mounts the real app and
  walks every route in the table (guards included) asserting that each one renders without a render error.
- `npm run typecheck` and `npm run build` pass; the Cloud Functions project compiles clean with `tsc`.
- The product runs end to end in local mode, including a two-tab WebRTC session.

**Not verified here (do not claim otherwise)**

- `tests/rules/firestore.rules.spec.ts` — written and reviewed line by line against `firestore.rules`, but
  **never executed**: the Firestore emulator needs a JDK, which this build environment did not have. Run
  `npm run test:rules` somewhere with Java before trusting it.
- The Cloud Functions have never run against a real Firestore (no emulator, no deploy). They compile, and they
  import the same tested `shared/*` modules, but runtime behaviour — including error-code parity with the
  reference backend — is unproven.
- App Check, FCM push, email flows and the TURN relay path all require a real project; `docs/deployment.md` has
  the steps and the checklist.

---

## Licence and intent

Time Tokens are not money and must never become money. They cannot be bought, sold, transferred for cash or
withdrawn; the acknowledgement of that rule is written into the requirements, the policy document, the rules,
the functions and the UI copy. If the product's requirements ever change on that point, the change belongs in
the open — starting with `docs/requirements.md` and the tests that enforce it.
