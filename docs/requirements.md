# PeerPulse — Requirements & User Journeys

> **Deliverable 1 of 11.** Scope, roles, business rules and the journeys each role can take through the
> product. Everything below is implemented unless a section says otherwise.

---

## 1. Product statement

PeerPulse is a **community-driven time bank for skills**. A member teaches an hour of something they know
and banks an hour of something they want to learn. The unit of exchange is the **Time Token (TT)**:

- **1 hour of teaching = 1 Time Token = 1 hour of learning.**
- Tokens are **not money**. They cannot be bought, sold, withdrawn or converted to cash.
- Partial hours follow a configurable rounding rule (default: nearest 15 minutes).
- Tokens only move when a session has demonstrably happened — never when a booking is merely requested.

Tagline: **“Trade Time. Share Skills. Grow Together.”**

---

## 2. Roles

| Role | How it is granted | Can do |
| --- | --- | --- |
| **Guest** | not signed in | Browse the landing page, How it works, the public marketplace, member profiles, guidelines, privacy and terms. Cannot see a wallet, a room or a community feed. |
| **Member** | signs up (email + password) | Everything a guest can, plus: publish listings, request bookings, join rooms, settle sessions, hold a wallet and ledger, review, join communities, post, comment, react, report, open disputes, manage privacy. |
| **Administrator (steward)** | promoted by another steward (`setUserRole`), carries the `admin` custom claim | Everything a member can, plus: resolve reports and disputes, adjust wallets with a written reason, edit the platform policy, change roles and account status, and read platform metrics. |

**Server-enforced RBAC.** The administrator flag is a Firebase Auth **custom claim**, and the claim is only
ever written by the `setUserRole` Cloud Function. Firestore Security Rules read the claim
(`request.auth.token.admin == true`); a client can neither grant itself the claim nor write `role` on its own
profile document. `setUserRole` also refuses to demote the final administrator.

---

## 3. Functional requirements

### 3.1 Accounts and profiles
- **FR-1** Email/password sign-up, sign-in, password reset and password change.
- **FR-2** Creating an account provisions: a profile document, a wallet carrying the configured signup grant,
  the matching ledger row, and a welcome notification — all server-side (`onUserCreated`).
- **FR-3** Members maintain headline, bio, location, timezone, languages, interests, preferred formats,
  weekly availability, teach/learn categories and privacy settings.
- **FR-4** Privacy controls: profile visibility (public / members / private), whether email and availability
  are shown, whether direct requests are allowed, and whether the member appears in discovery.
- **FR-5** A member can export their data as JSON; account deletion is a steward-run process (the ledger is
  retained for audit and the profile is anonymised).

### 3.2 Skill exchange marketplace
- **FR-6** Members publish listings (title, category, description, outcomes, level, languages, format,
  duration, tags) and edit or archive them.
- **FR-7** Discovery: text search, category filters, level, format, language, maximum duration, sorting by
  relevance/rating/recency/duration, and filter state mirrored into the URL.
- **FR-8** A listing detail page shows the teacher, availability, ratings and reviews, and the token cost.

### 3.3 Booking calendar
- **FR-9** A weekly availability editor (weekday + start/end blocks) drives bookable slots.
- **FR-10** A booking request validates: session duration inside `15–180` minutes, at least `2 h` notice, at
  most `60 days` ahead, no overlap with either member’s existing sessions, and affordability for the learner.
- **FR-11** The teacher confirms or declines; either participant can cancel or propose a reschedule.
- **FR-12** A month/week calendar shows a member’s sessions, plus free windows derived from their availability.
- **FR-13** A room is created when a booking is confirmed and opens **15 minutes before** the start.

### 3.4 Live video learning (WebRTC)
- **FR-14** Peer-to-peer audio/video with microphone, camera and screen-share toggles.
- **FR-15** Signalling travels through Firestore (`rooms/{roomId}/signaling` and `.../candidates`), scoped to
  the two participants by Security Rules.
- **FR-16** ICE servers come from the `getTurnCredentials` function, which mints short-lived HMAC TURN
  credentials; STUN-only fallback is used when TURN is not configured.
- **FR-17** Presence heartbeat (10 s) is also the attendance feed; each join/leave writes an attendance
  segment used later by settlement.
- **FR-18** “Leave quietly” drops your own connection; “End session for both” closes the room and settles.

### 3.5 Token wallet and ledger
- **FR-19** A wallet shows settled balance, held (escrowed) tokens, lifetime earned/spent/granted, and the
  expected movements implied by upcoming bookings.
- **FR-20** The ledger lists every movement with reason, policy code, actor, timestamp and resulting balance.
- **FR-21** No client can write a balance: wallets and the ledger are read-only outside Cloud Functions.

### 3.6 Automatic token settlement
- **FR-22** Settlement runs when a session ends, or automatically after `autoSettleAfterHours` (24 h).
- **FR-23** Verified attendance = the **overlap** of both members’ presence, clamped to the booked window; the
  quorum is `min(minVerifiedMinutes, max(1, ceil(bookedMinutes / 2)))`.
- **FR-24** Outcomes: `settle`, `partial` (learner can only cover part — the remainder is waived), `refund`,
  `blocked` (with a machine-readable reason).
- **FR-25** Both members confirming overrides a missed attendance quorum; nobody can force a settlement
  without either evidence or a double confirmation.
- **FR-26** Settlement is idempotent: deterministic ids (`tx_{bookingId}_{debit|credit|hold|refund}`,
  `settlement_{bookingId}`) and a single Firestore transaction guarantee **never twice**.

### 3.7 Communities and collaboration
- **FR-27** Create and join communities; post kinds `post`, `question`, `resource`, `event` (with time,
  duration, location and optional capacity); comment; react with a fixed emoji set.
- **FR-28** Owners and moderators curate; the UI shows a “You moderate this” affordance.

### 3.8 Trust, moderation and dispute paths
- **FR-29** Any member can report a listing, post, comment, member or review with a reason and details.
- **FR-30** Stewards triage reports (`open → reviewing → resolved | dismissed`) and can hide content.
- **FR-31** Either participant can open a dispute on a session; stewards resolve it as `resolved_refund`,
  `resolved_release`, `resolved_split` or `closed`. A refund writes a ledger row; a split refunds half.
- **FR-32** Reviews require a completed session and one review per member per session; the recipient may reply.

### 3.9 Notifications
- **FR-33** Members receive notifications for requests, confirmations, declines, cancellations,
  reschedules, settlements, refunds, disputes, reviews, community replies and token grants.
- **FR-34** Browser push (FCM) is opt-in and only offered when a VAPID key is configured.

---

## 4. Business rules (non-negotiable)

| Rule | Enforced by |
| --- | --- |
| 1 hour of teaching = 1 Time Token; partial hours follow the configured rounding rule | `shared/tokenPolicy.ts`, used identically by the client, the reference backend and the Cloud Functions |
| No token movement while a booking is `requested` | `planSettlement` blocks unconfirmed bookings; the UI shows “0 tokens move yet” |
| Transparent refunds: the policy code and amount are shown on the booking and in the ledger | `resolveCancellation` → `CancellationRecord.policyCode`, rendered verbatim |
| Never settle twice | deterministic ledger ids + one transaction + `settlement.state` guard |
| Room signalling is limited to participants | Firestore rules (`rooms/{roomId}` participant check) and the reference backend’s `requireRoomAccess` |
| Users cannot write balances from the frontend | rules deny all wallet/ledger writes; only functions write them |
| Every movement is auditable | `createdBy`, `reason`, `policyCode`, `idempotencyKey`, `balanceAfter` on every ledger row |
| Tokens are never cash | no purchase, withdrawal or conversion path exists anywhere in the codebase |
| Dispute paths are defined | `DisputeCase` status machine; refunds only via `resolveDispute` |

---

## 5. User journeys

### J1 — Guest discovers the platform
1. Lands on `/` (hero, four-step explainer, featured listings, token explainer).
2. Reads `/how-it-works`, `/guidelines`, `/privacy`, `/terms`.
3. Browses `/skills` and `/members`; opens a listing and a public profile.
4. Clicks “Join free” → `/register`.

**Success:** can explain what a Time Token is and what it is not, without an account.

### J2 — New member onboards
1. Signs up with name, email and password.
2. Provisioning lands a profile, a wallet with the signup grant, and a welcome notification.
3. Six-step onboarding wizard: identity → teach → learn → availability → privacy → review.
4. Publishes a first listing or browses the marketplace.

**Success:** wallet shows the grant, profile shows the chosen fields, availability is saved.

### J3 — Member books a session
1. Opens a listing, picks a slot derived from the teacher’s availability.
2. The modal previews the token amount (“1 h = 1 TT”), warns about conflicts, and submits.
3. Status `requested`; nothing moves. The teacher is notified.
4. Teacher confirms → status `confirmed`, a room is created, the learner is notified.
5. The join button unlocks 15 minutes before the start.

**Success:** both members see the same booking state; the wallet still shows no movement.

### J4 — Members run the session
1. Both join the room; camera/mic consent is requested; presence + attendance are recorded.
2. Signalling flows through Firestore; media is peer-to-peer; TURN is used only when a direct path fails.
3. Either hides their camera or shares their screen mid-session.
4. One member ends the session for both.

**Success:** the session closes, attendance is sealed, and settlement runs once.

### J5 — Settlement
1. Server computes verified attendance from the overlap of both presence segments.
2. If the quorum is met → learner debited 1 TT, teacher credited 1 TT, settlement record written.
3. If it is not → the booking is flagged for confirmation; either member confirms, or both confirmations
   settle it anyway. Two hours later, the automatic sweep retries.
4. Both wallets update live; both ledgers show the row with reason and policy code.

**Success:** tokens conserved (debit = credit), and a replayed settlement changes nothing.

### J6 — Cancellation
1. Either member cancels with a reason.
2. Policy decides the refund: ≥ 24 h ahead is always free; later cancellations follow
   `lateCancellationRefundRatio` and record a strike; a teacher cancelling always refunds the learner.
3. The counterparty is notified with the policy code and the refund amount.

**Success:** the ledger reflects exactly what the policy promised — nothing more.

### J7 — Something went wrong (dispute)
1. A participant opens a dispute with a written claim.
2. The booking is frozen as `disputed` (a one-way client write; no tokens move).
3. A steward reviews the room attendance and the ledger, then resolves:
   `resolved_refund` (learner made whole), `resolved_split` (half back), `resolved_release` (settlement
   stands) or `closed` (no action).
4. Both members are notified with the written outcome; any refund appears in the ledger.

**Success:** the decision is visible in the ledger with the steward’s uid and reason.

### J8 — Steward governance
1. Steward opens `/admin`: overview metrics, reports, disputes, members, ledger, policy.
2. Triages a report → hides the content if upheld → reporter is notified.
3. Adjusts a wallet → **a written reason is mandatory** → a ledger row records it.
4. Changes the policy (e.g. rounding increment) → validation blocks unsafe values → the stored diff is
   attached to the policy document.

**Success:** every administrative action has an identifying actor, a reason and a visible effect.

---

## 6. Non-functional requirements

- **Responsive and accessible**: keyboard-reachable controls, visible focus rings, `aria-*` on dialogs,
  labels bound to inputs, no colour-only meaning; a light theme toggle on top of the dark default.
- **Brand palette** used exactly: `#071521` canvas, `#0B1F2D` surface, `#10B981` primary, `#34D399` accent,
  `#A7BBC8` secondary text, `#1D4553` borders, `#22D3EE` cyan accent, white.
- **TypeScript strict** across the app, the shared domain code and the functions.
- **No secrets in the browser**: TURN credentials are minted per session; App Check keys are public by design;
  service-account material never leaves the server.
- **Offline-friendly development**: the reference backend runs the whole product in the browser without a
  cloud project, so the flows can be exercised and unit-tested.
- **Cost-aware**: capped Cloud Functions instances, bounded queries, TTL on signalling documents.

---

## 7. Out of scope (deliberately)

- Payments, purchases or cash conversion of Time Tokens — excluded by the product’s definition.
- Session recording or storage of call media.
- Group video rooms (rooms are strictly two-participant).
- Mobile native apps; the web app is responsive instead.
- Federated identity providers (email/password only in this milestone).
