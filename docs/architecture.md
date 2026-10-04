# PeerPulse — System Architecture

> **Deliverable 2 of 11.** How the pieces fit together, where the trust boundaries are, and what happens on
> the wire for the two flows that matter most: a settlement and a call.

---

## 1. Context

```mermaid
graph TB
  subgraph Browser["Browser (Vue 3 SPA)"]
    UI["Pages + components<br/>(25 pages, 14 UI primitives)"]
    Stores["Pinia stores<br/>auth · wallet · bookings · skills<br/>notifications · community · admin · ui"]
    Domain["shared/* business logic<br/>token policy · booking rules · settlement maths"]
    WebRTC["useWebRTC()<br/>RTCPeerConnection"]
    Adapter{{"Backend adapter<br/>PeerPulseBackend"}}
    Local["LocalBackend<br/>(localStorage reference impl.)"]
    Fire["FirebaseBackend<br/>(Auth · Firestore · Functions)"]
    UI --> Stores --> Domain
    Stores --> Adapter
    Adapter -->|VITE_BACKEND_MODE=local| Local
    Adapter -->|VITE_BACKEND_MODE=firebase| Fire
    UI --> WebRTC
  end

  subgraph GCP["Google Cloud / Firebase"]
    Auth["Firebase Auth<br/>email/password + custom claims"]
    FS["Cloud Firestore<br/>documents + Security Rules"]
    FN["Cloud Functions v2<br/>15 callables · 1 trigger · 1 sweep"]
    ST["Cloud Storage<br/>avatars + listing media"]
    FCM["Cloud Messaging"]
    FCMv1["Firebase App Check<br/>reCAPTCHA v3"]
  end

  TURN["TURN server (coturn)<br/>HMAC time-limited credentials"]

  Fire --> Auth
  Fire --> FS
  Fire --> ST
  Fire --> FCM
  Fire --> FN
  FN --> FS
  FN --> Auth
  FN -.->|mints credentials| TURN
  WebRTC -.->|STUN / TURN relay| TURN
  WebRTC <-->|media, peer-to-peer| WebRTC
```

---

## 2. Layers and their responsibilities

| Layer | Location | Responsibility | Must never |
| --- | --- | --- | --- |
| Presentation | `src/pages`, `src/components` | Render state, capture intent, show honest empty/error states | Contain business rules or write to the database directly |
| State | `src/stores` | Cache, subscriptions, action orchestration, optimistic-free UI state | Re-implement policy; it calls the adapter |
| Business rules | `shared/*` | Token policy, conflict detection, attendance verification, settlement planning, ledger ids, **marketplace discovery (filter, search, order)** | Depend on Vue, the DOM, Firebase or the browser |
| Backend contract | `src/lib/backend/types.ts` | One interface, two implementations | Leak Firebase types into the app |
| Reference backend | `src/lib/backend/local/*` | Run the product offline, cross-tab, deterministically | Be presented as production storage |
| Production backend | `src/lib/backend/firebase/*` | Rule-governed reads, callable writes, Timestamp ⇄ ISO at the boundary | Move tokens from the client |
| Server authority | `functions/*` | Bookings lifecycle, settlement, moderation, policy, roles, TURN minting | Duplicate the domain maths (it imports `shared/`) |
| Media | `src/composables/useWebRTC.ts` | One peer connection, glare-free negotiation, presence/attendance heartbeat | Store media anywhere |

`shared/discovery.ts` was added after the marketplace rules were found duplicated in both backends and drifted:
production search did not look at a teacher's name, applied its `limit(60)` before filtering, and scored
relevance differently from local mode. The two adapters now call the same pipeline — Firestore pushes down only
the constraints it can enforce in full, and never truncates when client-side filtering is needed.

The single most important structural decision: **`shared/*` is the only source of business logic.** The
browser uses it to preview costs and refuse obviously invalid input; the Cloud Functions use it to decide what
actually happens. The client is a convenience, never the authority. `scripts/sync-shared.mjs` mirrors the
modules into `functions/src/shared/` (the functions package must be self-contained for `firebase deploy`) and
`npm run check:shared` fails on drift.

---

## 3. Trust boundaries

```
┌──────────────────────────── untrusted ─────────────────────────────┐
│ browser: every value it sends, including uids, amounts and claims  │
└───────────────┬────────────────────────────────────────────────────┘
                │  (1) reads  → Security Rules decide
                │  (2) writes → Security Rules decide (small allow-list)
                │  (3) callables → functions re-derive everything
┌───────────────▼────────────────────────────────────────────────────┐
│ trusted: Firestore rules + Cloud Functions (Admin SDK)             │
│  • the only code that can write wallets, ledger, settlements       │
│  • the only code that can grant the admin claim                    │
│  • the only code that can close a room or settle a session         │
└────────────────────────────────────────────────────────────────────┘
```

- **Claim-based administration.** `request.auth.token.admin` is written exclusively by `setUserRole`
  (`getAuth().setCustomUserClaims`). Rules and functions read the claim; profiles store `role` only for
  display.
- **Server-derived identity.** Callables never trust a uid in the payload; they use `request.auth.uid`. The
  client adapter passes `{ bookingId, action }`, never “who I am”.
- **Server-derived money.** `tokenAmount` is always recomputed from the duration via `computeTokenAmount`,
  never accepted from the client.
- **App Check** is initialised when a reCAPTCHA site key is configured (debug tokens supported), so Firestore
  and Functions requests carry an attestation.

---

## 4. Flow: requesting, running and settling a session

```mermaid
sequenceDiagram
  participant L as Learner (browser)
  participant T as Teacher (browser)
  participant FS as Firestore (rules)
  participant FN as Cloud Function
  participant LN as Ledger + Wallets

  L->>FN: createBooking { skillId, startAt, endAt, timezone, learnerNote }
  FN->>FS: read listing, config, both profiles, conflicting bookings
  FN->>FN: validateSessionDuration + validateBookingWindow + findConflict + canAfford
  FN->>FS: write booking(status=requested) + notify teacher   (transaction)
  FN-->>L: booking
  Note over LN: nothing moves — a request costs nothing

  T->>FN: respondToBooking { bookingId, action: "confirm" }
  FN->>FS: write booking(status=confirmed, roomId=room_{id}) + rooms/{id} + notify learner
  FN-->>T: booking

  L->>FS: rooms/{room}/presence/{uid} (direct write, self-owned)
  T->>FS: rooms/{room}/presence/{uid}
  L->>FS: rooms/{room}/signaling (offer/answer, as self, to participant)
  FS-->>T: snapshot listener
  L-->>T: WebRTC media (peer-to-peer)
  Note over FS: attendance segments written on join/leave

  L->>FN: endSession { roomId }
  FN->>FS: seal open attendance segments
  FN->>FN: verifyAttendance → planSettlement
  FN->>LN: tx_{id}_debit, tx_{id}_credit, wallets, settlement_{id}   (one transaction)
  FN->>FS: booking(status=completed, completion.verifiedMinutes)
  FN->>FS: notify both members
  FN-->>L: SettlementOutcomeResult { booking, settlement, notices }
```

Failure paths are explicit: insufficient attendance blocks with
`insufficient_verified_attendance` and prompts a confirmation; an unaffordable learner settles `partial`
(floored to the rounding increment) or blocks with `insufficient_balance`; an already-settled booking returns
its existing record with a notice and moves nothing.

---

## 5. Flow: a WebRTC session

```mermaid
sequenceDiagram
  participant A as Member A (lower uid — offerer)
  participant FS as Firestore
  participant B as Member B (answerer)

  A->>FS: presence(A) — heartbeat every 10 s
  B->>FS: presence(B)
  A->>A: getUserMedia, addTrack, createOffer, setLocalDescription
  A->>FS: signaling { kind: offer, sequence: n, sdp, to: B }
  FS-->>B: snapshot
  B->>B: setRemoteDescription, createAnswer, setLocalDescription
  B->>FS: signaling { kind: answer, sequence: n, sdp, to: A }
  FS-->>A: snapshot
  par ICE
    A->>FS: candidates { to: B } (queued until remote description exists)
    FS-->>B: snapshot
    B->>FS: candidates { to: A }
    FS-->>A: snapshot
  end
  Note over A,B: media flows peer-to-peer; TURN relays only when a direct path fails
  A->>FS: signaling { kind: bye } and presence.leftAt
  B->>FS: presence.leftAt
```

Details — glare handling, sequence numbers, renegotiation, screen share and the fallback when a camera is
refused — are in **[webrtc-signaling.md](./webrtc-signaling.md)**.

---

## 6. Deployment topology

```mermaid
graph LR
  Hosting["Firebase Hosting<br/>dist/ SPA + rewrites + security headers"]
  subgraph Region["europe-west1"]
    FN["Cloud Functions (maxInstances 20)"]
  end
  FS["Firestore<br/>+ indexes + TTL on signaling.expiresAt"]
  ST["Cloud Storage<br/>avatars/ · listings/"]
  TURN["coturn<br/>(optional but recommended)"]

  Hosting --> FS
  Hosting --> FN
  FN --> FS
  FN --> ST
  FN -.-> TURN
  Hosting -.->|WebRTC media| TURN
```

- One region (`europe-west1`) for functions, matching `VITE_FUNCTIONS_REGION` and `setGlobalOptions`.
- Firestore composite indexes live in `firestore.indexes.json`; a TTL policy expires signalling documents.
- Hosting serves the SPA with a rewrite to `index.html`, immutable hashed assets and security headers
  including a `Permissions-Policy` that allows camera/microphone/display-capture only to the app's own origin.
- TURN is optional at deploy time: without `TURN_URLS`/`TURN_STATIC_AUTH_SECRET` the call still runs on STUN,
  and the app says so rather than pretending.

---

## 7. Flow: notifications

Notifications are the part of the product where *who* matters as much as *what*:
a member reads "Sam cancelled your session" in a bell menu with no context around
it, so a message addressed to the wrong person is not a display bug, it is the
platform telling somebody the wrong thing about their own session.

```mermaid
graph TD
  A["An event happens<br/>(the eleven FR-33 events)"] --> B["shared/notify.ts<br/>one composer per event<br/>→ {uid, type, title, body, link, priority}"]
  B --> C["functions/src/lib/notify.ts<br/>wraps each draft in a Firestore payload"]
  B --> D["src/lib/backend/local/notify.ts<br/>pushDraft writes the same shape"]
  C --> E[("notifications/{id}<br/>firestore.rules: no client writes")]
  D --> F[("localStorage db.notifications")]
  E --> G["src/stores/notifications.ts<br/>watch → bell menu + /notifications"]
  F --> G
  H["onCommentCreated<br/>communities/{c}/posts/{p}/comments/{id}"] --> C
  I["sessionReminders<br/>every 10 min"] --> C
```

Decisions this shape encodes:

- **Composition happens once, in `shared/`.** The Cloud Functions and the local
  backend both call the same builders, and a static test in
  `functions/tests/notifications.spec.ts` fails if either side starts writing a
  notification object by hand. This is not tidiness: the two implementations had
  already diverged in ways only a member would notice — production told the
  member who cancelled, typed steward messages as `community_reply`, and never
  sent the `booking_reminder` the domain union declared.
- **The recipient is derived from the participants, never from state.** A
  cancellation is addressed to the member who did not cancel; a refund is
  addressed to the member who paid; a review to the member it is about.
- **The type describes what happened to the reader.** `session_refunded` only
  when a refund row was written, which is the only version of "your tokens came
  back" that is true — the default policy holds nothing on confirm, so cancelling
  such a session says "nothing was charged" instead. An icon, a filter or a
  grouping that trusts the type therefore cannot lie either.
- **Two triggers, both server-side.** The comment trigger exists because posts
  and comments are written straight from the client (the rules police them), and
  the reminder sweep exists because a session that nobody remembers is the most
  likely way for this product to fail its own premise. The reminder's document id
  is its idempotency key, so a retry or a redeploy cannot send twice.
- **Nothing new is exposed to the browser.** Both triggers read and write with
  admin credentials; `notifications` remains a collection no client may write.

---

## 8. Data-flow invariants (checked in review and tests)

1. **Token conservation** — for any settlement, `sum(debits) == sum(credits)`; the platform never mints.
2. **Idempotency** — ledger ids are derived from the booking id, so a retried settlement overwrites nothing.
3. **Monotonic evidence** — attendance segments can only be closed, never extended
   (`tests/rules/firestore.rules.spec.ts` asserts it).
4. **Participant-only rooms** — every room read, presence write and signalling write is gated on
   `participants` containing the caller.
5. **No client-authored money** — no rule path writes `wallets`, `tokenTransactions` or `settlements`.
6. **Auditability** — every ledger row names its actor (`createdBy`), its reason and its policy code.
7. **Counters follow evidence** — the denormalised numbers the UI reads move only for work that verifiably
   happened: a session counts on a listing and in both members' profiles when it settles (fully or partially),
   never when an attempt is blocked or refunded. A steward's refund after a settlement deliberately does not
   un-count the hour: the work happened, the tokens were returned. Both engines use the same pure helpers in
   `shared/settlement.ts`, so the numbers cannot differ between local mode and production.

---

## 9. Why this shape

- **The adapter pattern** lets the product be demonstrated and unit-tested without a cloud project while the
  production path stays Firebase-native. Both implementations satisfy the same TypeScript interface, so a
  store cannot accidentally depend on one of them.
- **Business logic outside Vue** means the same functions that price a session in the browser decide its
  outcome on the server — the two can be compared in tests instead of argued about in review.
- **Firestore-native signalling** avoids running and paying for a signalling server, at the cost of latency
  (sub-second in-region) and the need for TTL cleanup — an acceptable trade for two-participant sessions.
- **Callables over client writes** keep the write surface small enough to state exhaustively in the rules
  file, which is what makes the “no client moves a token” claim checkable.
