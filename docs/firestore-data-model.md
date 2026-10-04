# PeerPulse — Firestore Data Model

> **Deliverable 3 of 11.** Every collection, its fields, who may read and write it, and a realistic sample
> record. Types are declared once in `shared/domain.ts`; this document shows what actually lands in Firestore.

---

## 1. Conventions

| Topic | Decision |
| --- | --- |
| Document ids | Prefixed, human-debuggable, deterministic where idempotency matters: `bk_…` bookings, `room_{bookingId}`, `settlement_{bookingId}`, `tx_{bookingId}_{debit|credit|hold|refund}`, `wallet_{uid}` |
| Timestamps | `Timestamp` in Firestore, ISO-8601 strings in TypeScript. `src/lib/backend/firebase/convert.ts` converts on read/write, so no component ever handles a Firestore object |
| Money-shaped values | Integers or 4-decimal numbers; never floating-point currency formatting. `roundTokens()` is applied at the source |
| Denormalisation | Participants, skill titles and profile snapshots are copied onto bookings/rooms so a session page renders without extra reads and a renamed skill does not rewrite history |
| Server-owned fields | `wallets`, `tokenTransactions`, `settlements`, `config/platform`, all `*Count`/`ratingSum` aggregates, `moderation`, `status` transitions. Rules deny client writes to them |
| Aggregate maintenance | Cloud Functions update counters inside the same transaction that causes them |

### Access matrix

| Collection | Read | Create | Update | Delete |
| --- | --- | --- | --- | --- |
| `users` | public profiles to signed-in members; `private` only to the owner and admins | owner (own doc) via trigger/bootstrap | owner for profile fields only; `role`/`status`/`stats` server-only | never (soft-delete sets `status`) |
| `skills` | published listings to everyone; drafts to the owner | owner | owner for content; `moderation`/counters server-only | owner may archive (`status: removed`) |
| `bookings` | participants and admins | participant via `createBooking` | participants may only set `status: disputed` | never |
| `rooms` + `presence`/`attendance`/`signaling`/`candidates` | participants and admins | server; `presence`/`attendance` by the owner | owner for `presence`/`media`; attendance segments close-only; `attendanceLocked` blocks all | never |
| `wallets` | owner and admins | server only | server only | never |
| `tokenTransactions` | owner and admins | server only | server only | never |
| `settlements` | participants and admins | server only | server only | never |
| `reviews` | everyone (moderated) | one per participant per completed booking | author may edit within the window; reply by the subject | author before moderation |
| `notifications` | owner | server (and the owner's own test fixture) | owner (`read`) | owner |
| `communities` / `members` / `posts` / `comments` | public or member-only per `visibility` | members | owners and moderators for curation | never (soft-remove) |
| `reports` / `disputes` | reporter, subject and admins | any member as themselves | admins only | never |
| `config/platform` | signed-in members (the client caches the policy) | admins via `bootstrapPlatform` | admins via `updatePlatformConfig` | never |

---

## 2. `users/{uid}` — profile, preferences, privacy, stats

```jsonc
{
  "uid": "demo_lena",
  "email": "lena@peerpulse.app",
  "displayName": "Lena Fischer",
  "photoURL": null,                       // null → deterministic SVG avatar
  "avatarSeed": "lena-fischer-42",
  "headline": "Jazz guitarist · 12 years on stage",
  "bio": "I teach chord voicings and improvisation, and I want to get better at spoken Mandarin.",
  "location": "Berlin, Germany",
  "timezone": "Europe/Berlin",
  "role": "member",                       // display mirror of the admin custom claim
  "status": "active",
  "interests": ["music", "languages", "cooking"],
  "languages": ["de", "en"],
  "teachSkillIds": ["sk_guitar_jazz", "sk_theory_basics"],
  "learnSkillIds": ["sk_mandarin"],
  "teachCategories": ["music"],
  "learnCategories": ["languages"],
  "preferredFormats": ["video", "voice"],
  "availability": [
    { "weekday": 2, "start": "18:00", "end": "21:00" },
    { "weekday": 6, "start": "10:00", "end": "13:00" }
  ],
  "privacy": {
    "profileVisibility": "public",
    "showEmail": false,
    "showAvailability": true,
    "allowDirectRequests": true,
    "appearInDiscovery": true
  },
  "stats": {
    "sessionsCompleted": 7,
    "sessionsTaught": 5,
    "teachingHours": 6.5,
    "learningHours": 2,
    "ratingSum": 24,
    "reviewCount": 5,                     // avg 4.8, computed, never stored as a float
    "tokensEarned": 6.5,
    "tokensSpent": 2
  },
  "onboarding": { "completed": true, "step": 5, "completedAt": "2026-01-14T10:02:11.000Z", "savedAt": "2026-01-14T10:02:11.000Z", "skipped": false },
  "createdAt": "2026-01-14T09:58:03.000Z",
  "updatedAt": "2026-02-02T17:41:09.000Z",
  "lastActiveAt": "2026-02-02T17:41:09.000Z"
}
```

Rules: the owner may edit `displayName`, `headline`, `bio`, `location`, `timezone`, `interests`, `languages`,
`teach|learnSkillIds`, `teach|learnCategories`, `preferredFormats`, `availability`, `privacy`, `onboarding`
and `updatedAt`. `role`, `status` and `stats` are server-owned; a self-promotion attempt is denied.

---

## 3. `skills/{skillId}` — a listing

```jsonc
{
  "id": "sk_guitar_jazz",
  "ownerUid": "demo_lena",
  "title": "Jazz guitar: chords, comping and your first solo",
  "slug": "jazz-guitar-chords-comping-first-solo",
  "categoryId": "music",
  "description": "We start from the shapes you already know and turn them into real jazz vocabulary…",
  "outcomes": ["Play 12 essential jazz chord voicings", "Comp over a 12-bar blues", "Improvise a 4-bar solo"],
  "level": "intermediate",
  "languages": ["en", "de"],
  "format": "video",
  "durationMinutes": 60,
  "tags": ["guitar", "jazz", "improvisation"],
  "status": "published",
  "moderation": { "state": "clean", "reason": null, "reviewedByUid": null, "reviewedAt": null },
  "bookingCount": 9,
  "completedCount": 7,
  "ratingSum": 24,
  "reviewCount": 5,
  "createdAt": "2026-01-16T08:12:00.000Z",
  "updatedAt": "2026-02-01T19:30:00.000Z"
}
```

---

## 4. `bookings/{bookingId}` — the contract between two members

```jsonc
{
  "id": "bk_2001",
  "skillId": "sk_guitar_jazz",
  "skillTitle": "Jazz guitar: chords, comping and your first solo",
  "categoryId": "music",
  "teacherUid": "demo_lena",
  "learnerUid": "demo_sam",
  "participants": ["demo_lena", "demo_sam"],          // sorted — rules use array-contains
  "participantsSnapshot": [
    { "uid": "demo_lena", "displayName": "Lena Fischer", "photoURL": null, "avatarSeed": "lena-fischer-42" },
    { "uid": "demo_sam",  "displayName": "Sam Okoye",    "photoURL": null, "avatarSeed": "sam-okoye-7" }
  ],
  "createdByUid": "demo_sam",
  "startAt": "2026-03-04T18:00:00.000Z",
  "endAt": "2026-03-04T19:00:00.000Z",
  "durationMinutes": 60,
  "timezone": "Europe/Berlin",
  "status": "confirmed",                                // requested | confirmed | in_progress | completed | cancelled | declined | no_show | disputed
  "roomId": "room_bk_2001",
  "tokenAmount": 1,                                     // recomputed server-side; never trusted from the client
  "settlement": {
    "state": "unsettled",                               // unsettled | escrowed | settled | refunded | partial | blocked
    "settlementId": null, "settledAt": null,
    "debitTxId": null, "creditTxId": null, "refundTxId": null, "heldTxId": null,
    "note": null
  },
  "cancellation": null,
  "reschedules": [],
  "completion": {
    "teacherConfirmedAt": null, "learnerConfirmedAt": null, "autoCompletedAt": null,
    "verifiedMinutes": null, "closedBy": null
  },
  "learnerNote": "I'd love to work on comping for a blues in F.",
  "teacherNote": "",
  "revision": 3,
  "createdAt": "2026-02-20T11:04:22.000Z",
  "updatedAt": "2026-02-20T11:31:40.000Z"
}
```

A cancelled booking carries the refund evidence:

```jsonc
"status": "cancelled",
"cancellation": {
  "byUid": "demo_sam",
  "reason": "My rehearsal moved to the same evening.",
  "at": "2026-03-02T09:15:00.000Z",
  "refundTokens": 1,
  "policyCode": "free_window_cancellation"              // shown verbatim in the UI and the ledger
}
```

---

## 5. `rooms/{roomId}` and its subcollections

### 5.1 `rooms/{roomId}`

```jsonc
{
  "id": "room_bk_2001",
  "bookingId": "bk_2001",
  "skillTitle": "Jazz guitar: chords, comping and your first solo",
  "teacherUid": "demo_lena",
  "learnerUid": "demo_sam",
  "participants": ["demo_lena", "demo_sam"],
  "status": "open",                                     // scheduled | open | closed | abandoned
  "createdAt": "2026-02-20T11:31:40.000Z",
  "openedAt": "2026-03-04T17:45:12.000Z",
  "closedAt": null,
  "attendanceLocked": false,                            // set true when the session ends
  "session": { "startedAt": "2026-03-04T18:01:05.000Z", "endedAt": null, "durationMinutes": null, "initiatorUid": null }
}
```

### 5.2 `rooms/{roomId}/presence/{uid}`

```jsonc
{
  "uid": "demo_lena", "displayName": "Lena Fischer", "avatarSeed": "lena-fischer-42", "role": "teacher",
  "joinedAt": "2026-03-04T17:58:40.000Z", "lastSeen": "2026-03-04T18:12:10.000Z", "leftAt": null,
  "media": { "camera": true, "microphone": true, "screen": false }
}
```

### 5.3 `rooms/{roomId}/attendance/{segmentId}` — the settlement evidence

```jsonc
{
  "uid": "demo_lena",
  "joinedAt": "2026-03-04T17:58:40.000Z",
  "leftAt": "2026-03-04T19:03:20.000Z"                  // null while the member is still present
}
```

Segments are opened when a member joins and closed when they leave or when `endSession` seals them. Settlement
intersects the teacher's and learner's segments with the booked window; a closed segment can never be
reopened (`tests/rules/firestore.rules.spec.ts` asserts this).

### 5.4 `rooms/{roomId}/signaling/{messageId}`

```jsonc
{
  "id": "msg_4f21a",
  "kind": "offer",                                      // offer | answer | renegotiate | bye
  "from": "demo_sam",                                   // rules: must equal the caller
  "to": "demo_lena",                                    // rules: must be the other participant
  "sdp": "v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\n…",
  "sequence": 3,
  "createdAt": "2026-03-04T17:58:44.120Z",
  "expiresAt": "2026-03-05T17:58:44.120Z"               // TTL policy deletes finished signalling
}
```

### 5.5 `rooms/{roomId}/candidates/{candidateId}`

```jsonc
{
  "id": "cand_9b2",
  "from": "demo_lena", "to": "demo_sam",
  "candidate": { "candidate": "candidate:842163049 1 udp 1677729535 203.0.113.7 55061 typ srflx …", "sdpMid": "0", "sdpMLineIndex": 0, "usernameFragment": "4fZ" },
  "createdAt": "2026-03-04T17:58:45.006Z",
  "expiresAt": "2026-03-05T17:58:45.006Z"
}
```

---

## 6. `wallets/{uid}` — balances (server-only)

```jsonc
{
  "uid": "demo_sam",
  "balance": 2.5,
  "held": 0,                                            // escrow, only when reserveTokensOnConfirm
  "lifetimeEarned": 3,
  "lifetimeSpent": 3.5,
  "lifetimeGranted": 3,
  "policyVersion": "2026.1",
  "updatedAt": "2026-03-04T19:03:21.400Z",
  "updatedBy": "settleSession:bk_2001"
}
```

## 7. `tokenTransactions/{txId}` — the audit trail

Deterministic ids: `tx_{bookingId}_{debit|credit|hold|refund}`, and `tx_signup_{uid}` for grants.

```jsonc
{
  "id": "tx_bk_2001_credit",
  "type": "credit",                                     // signup_grant | credit | debit | escrow_hold | escrow_release | refund | admin_adjustment | penalty
  "amount": 1,                                          // positive magnitude
  "direction": "credit",
  "status": "posted",
  "uid": "demo_lena",                                   // wallet owner of this row
  "counterpartyUid": "demo_sam",
  "bookingId": "bk_2001",
  "roomId": "room_bk_2001",
  "idempotencyKey": "bk_2001:credit",
  "balanceAfter": 6.5,
  "reason": "Taught “Jazz guitar: chords, comping and your first solo” — 60 verified minutes.",
  "policyCode": "standard_settlement",
  "createdBy": "settleSession",
  "createdAt": "2026-03-04T19:03:21.380Z"
}
```

The matching learner row is `tx_bk_2001_debit` (`direction: debit`, `counterpartyUid: demo_lena`). Conservation
rule: for any booking, `amount(debit) == amount(credit)`.

## 8. `settlements/{settlementId}` — the decision record

```jsonc
{
  "id": "settlement_bk_2001",
  "bookingId": "bk_2001",
  "teacherUid": "demo_lena",
  "learnerUid": "demo_sam",
  "tokenAmount": 1,
  "verifiedMinutes": 62,
  "status": "settled",                                  // settled | refunded | blocked
  "debitTxId": "tx_bk_2001_debit",
  "creditTxId": "tx_bk_2001_credit",
  "refundTxId": null,
  "reason": "Both members were present for 62 of 60 booked minutes.",
  "idempotencyKey": "settlement_bk_2001",               // unique per booking
  "attempts": 1,
  "createdAt": "2026-03-04T19:03:21.300Z",
  "updatedAt": "2026-03-04T19:03:21.400Z"
}
```

Blocked example: `status: "blocked"`, `tokenAmount: 0`, `verifiedMinutes: 4`,
`reason: "insufficient_verified_attendance"`, with no `debitTxId`/`creditTxId`.

---

## 9. `reviews/{reviewId}`

```jsonc
{
  "id": "rev_bk_1003_demo_sam",
  "bookingId": "bk_1003",
  "skillId": "sk_guitar_jazz",
  "authorUid": "demo_sam",
  "subjectUid": "demo_lena",
  "authorRole": "learner",
  "rating": 5,
  "comment": "Lena rebuilt my comping from the ground up. Patient, structured, and the hour flew by.",
  "tags": ["patient", "structured", "practical"],
  "moderation": { "state": "clean", "reason": null },
  "responseText": "Thanks Sam — bring the blues next time!",
  "responseAt": "2026-02-19T08:12:00.000Z",
  "createdAt": "2026-02-18T20:41:00.000Z"
}
```

## 10. `notifications/{notificationId}`

```jsonc
{
  "id": "ntf_7c31",
  "uid": "demo_lena",
  "type": "booking_requested",                          // see NotificationType in shared/domain.ts
  "title": "New session request",
  "body": "Sam Okoye asked for “Jazz guitar: chords, comping and your first solo” on 4 March, 18:00–19:00.",
  "link": "/bookings/bk_2001",
  "read": false,
  "priority": "normal",
  "createdAt": "2026-02-20T11:04:23.100Z"
}
```

Allowed `type` values: `booking_requested`, `booking_confirmed`, `booking_declined`, `booking_cancelled`,
`booking_rescheduled`, `booking_reminder`, `session_settled`, `session_refunded`, `session_disputed`,
`review_received`, `community_reply`, `token_grant`, `moderation_action`, `system`.

---

## 11. Communities

### `communities/{communityId}`
```jsonc
{
  "id": "cm_guitar", "name": "Guitar Circle", "slug": "guitar-circle",
  "description": "Chord charts, practice logs and monthly listening sessions.",
  "categoryId": "music", "visibility": "public",
  "ownerUids": ["demo_lena"], "moderatorUids": ["demo_tomas"],
  "memberCount": 34, "postCount": 12,
  "tags": ["guitar", "practice"], "rules": ["Critique the playing, never the player."],
  "createdAt": "2026-01-20T09:00:00.000Z", "updatedAt": "2026-02-22T12:00:00.000Z"
}
```

### `communities/{communityId}/members/{uid}`
```jsonc
{ "uid": "demo_sam", "displayName": "Sam Okoye", "avatarSeed": "sam-okoye-7", "role": "member", "joinedAt": "2026-02-01T10:00:00.000Z" }
```

### `communities/{communityId}/posts/{postId}`
```jsonc
{
  "id": "pst_118", "communityId": "cm_guitar", "authorUid": "demo_tomas", "authorName": "Tomas Novak",
  "authorSeed": "tomas-novak-3", "kind": "question",
  "title": "How do you practise comping without a band?",
  "body": "I record a slow blues loop and trade fours with myself. What works for you?",
  "link": null,
  "reactions": { "demo_sam": "🔥", "demo_lena": "💡" },   // one emoji per uid
  "commentCount": 3, "pinned": false,
  "moderation": { "state": "clean", "reason": null },
  "event": null,
  "createdAt": "2026-02-22T11:40:00.000Z", "updatedAt": "2026-02-22T11:40:00.000Z"
}
```

### `communities/{communityId}/posts/{postId}/comments/{commentId}`
```jsonc
{ "id": "cmt_402", "postId": "pst_118", "communityId": "cm_guitar", "authorUid": "demo_lena",
  "authorName": "Lena Fischer", "authorSeed": "lena-fischer-42",
  "body": "Metronome at 60, two bars comp / two bars silence. The silence teaches you time.",
  "moderation": { "state": "clean", "reason": null }, "createdAt": "2026-02-22T12:02:00.000Z" }
```

---

## 12. Trust and safety

### `reports/{reportId}`
```jsonc
{
  "id": "rpt_1001", "reporterUid": "demo_sam",
  "targetType": "user", "targetId": "demo_jonas",
  "targetPath": "users/demo_jonas", "targetLabel": "Jonas Weber",
  "reason": "no_show",                                   // spam | harassment | inappropriate | no_show | misrepresentation | other
  "details": "We booked 18:00 and nobody joined the room.",
  "status": "reviewing",                                 // open | reviewing | resolved | dismissed
  "priority": "high", "resolution": null,
  "handledByUid": null, "handledAt": null,
  "createdAt": "2026-02-24T18:40:00.000Z", "updatedAt": "2026-02-25T08:00:00.000Z"
}
```

### `disputes/{disputeId}`
```jsonc
{
  "id": "dsp_1001", "bookingId": "bk_1005",
  "openedByUid": "demo_amara", "againstUid": "demo_paulo",
  "claim": "The session ended after 12 minutes because of connection problems on their side.",
  "evidence": "Room attendance shows 12 minutes of overlap; the booking was 60 minutes.",
  "status": "open",                                      // open | resolved_refund | resolved_release | resolved_split | closed
  "outcome": null, "handledByUid": null,
  "createdAt": "2026-02-25T09:10:00.000Z", "updatedAt": "2026-02-25T09:10:00.000Z"
}
```

---

## 13. `config/platform` — the token policy

```jsonc
{
  "version": "2026.1",
  "token": { "tokensPerHour": 1, "partialHourRule": "nearest", "roundingIncrementMinutes": 15,
             "minSessionMinutes": 15, "maxSessionMinutes": 180,
             "signupGrantEnabled": true, "signupGrantAmount": 3 },
  "booking": { "minNoticeHours": 2, "maxAdvanceDays": 60, "autoConfirm": false,
               "reserveTokensOnConfirm": false, "earlyEndToleranceMinutes": 15 },
  "settlement": { "minVerifiedMinutes": 10, "autoSettleAfterHours": 24,
                  "requireBothConfirmations": true, "disputeWindowHours": 72 },
  "cancellation": { "freeCancellationHours": 24, "lateCancellationRefundRatio": 1, "noShowPenaltyTokens": 0 },
  "community": { "allowMemberEvents": true, "autoFlagKeywords": [], "requireModerationForNewMembers": false },
  "updatedAt": "2026-02-01T00:00:00.000Z",
  "updatedByUid": "demo_admin",
  "changeSummary": ["Settlement quorum: 15 → 10 verified minutes"]
}
```

Changing `token.partialHourRule` to `round_up` makes a 50-minute session cost 1 TT instead of 0.75; the
version string is stamped on every subsequent ledger row, so a historical row can always be explained by the
policy that produced it.

---

## 14. Indexes and lifecycle

Composite indexes live in `firestore.indexes.json` (~20). The ones that carry the product:

| Purpose | Fields |
| --- | --- |
| Marketplace browse | `skills: status ASC, categoryId ASC, updatedAt DESC` |
| My listings | `skills: ownerUid ASC, status ASC, updatedAt DESC` |
| My sessions (as learner) | `bookings: learnerUid ASC, startAt DESC` |
| My sessions (as teacher) | `bookings: teacherUid ASC, startAt DESC` |
| Upcoming sessions for a user | `bookings: participants ARRAY, startAt ASC` |
| Settlement sweep | `bookings: status ASC, endAt ASC` |
| Ledger feed | `tokenTransactions: uid ASC, createdAt DESC` |
| Signalling feed | `rooms/{id}/signaling: to ASC, sequence ASC` |
| Dispute queue | `disputes: status ASC, createdAt ASC` |
| Report queue | `reports: status ASC, priority DESC, createdAt ASC` |
| Community feed | `communities/{id}/posts: pinned DESC, createdAt DESC` |

Lifecycle rules:

- **TTL** on `rooms/*/signaling.expiresAt` and `rooms/*/candidates.expiresAt` (24 h) keeps signalling cheap and
  free of stale offers.
- Attendance and presence documents are retained as settlement evidence; the room is sealed with
  `attendanceLocked: true` when the session ends.
- Deleting an account anonymises the profile (`status: deleted`, identifiers stripped) while the ledger rows
  remain, because the audit trail must outlive the member.

---

## 15. Invariants a reviewer can check without reading the app

1. `wallets/{uid}` is never written by a client — only by `functions/src/lib/settlement.ts`, `admin.ts` and
   `triggers.ts`.
2. `tokenTransactions` rows are append-only and always carry `createdBy`, `reason` and `policyCode`.
3. Every booking in `in_progress` has a `roomId`, and every completed booking has a `settlement.state`.
4. `bookings.participants` is sorted, so the rules can use `array-contains` without normalisation at read time.
5. No collection stores a token amount that the client supplied.
