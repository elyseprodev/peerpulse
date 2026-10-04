# PeerPulse — Security Rules & Server-Side Authorization

> **Deliverable 5 of 11.** The rules file, the claim it makes, the client write surface stated exhaustively,
> and how each Cloud Function re-derives authority instead of trusting the browser.
>
> Files: `firestore.rules` (401 lines), `storage.rules`, `functions/src/lib/refs.ts`, `functions/src/*.ts`,
> tests in `tests/rules/firestore.rules.spec.ts` (see §9 for how to run them).

---

## 1. The one claim this document defends

> **No client can move a Time Token, and no client can read a room it is not in.**

Everything below exists to make that sentence checkable rather than aspirational:

- `wallets`, `tokenTransactions` and `settlements` have **no client write path at all** — not even for
  administrators. There is no rule branch that mentions them under `allow write`.
- Balances change only inside a Cloud Function transaction that also writes the ledger row, the settlement
  record, the booking state and the notifications.
- Room subtrees are gated on `request.auth.uid in room.participants`, evaluated from the room document itself.

---

## 2. Trust model

```
client ──(1) reads ───────────────▶ Firestore      ← Security Rules decide
       ──(2) small writes ────────▶ Firestore      ← Security Rules decide (list in §3)
       ──(3) callables ────────────▶ Cloud Functions ← request.auth.uid decides; Admin SDK bypasses rules
```

1. **Reads** are direct and rule-governed: profiles, listings, communities, a member's own wallet and ledger,
   their notifications, their bookings, and the rooms they belong to.
2. **Client writes** are an explicit allow-list of fifteen document paths (§3). If a rule change would add a
   sixteenth, that is a design decision, not a patch.
3. **Callables** run with the Admin SDK, so rules are not their security boundary — `functions/src/lib/refs.ts`
   is: `requireUid(request)` and `requireAdmin(request)`, plus `requireParticipant(booking, uid)`. Every payload is re-derived server-side (§5).

Why split it this way: the write surface is small enough to enumerate and test, and the reads stay cheap
(direct from Firestore) instead of being funnelled through functions.

---

## 3. The client write surface, exhaustively

| Path | Allowed client write | Guard |
| --- | --- | --- |
| `users/{uid}` | own profile fields, plus `teachSkillIds`/`teachCategories`/`learnSkillIds` sync | `isSelf(uid)` and `!touchesServerFields()`; `role`, `status`, `stats`, `uid`, `email` are refused |
| `skills/{id}` | create/update own listing content | `ownerUid == request.auth.uid`; `ratingSum`, `reviewCount`, `completedCount`, `bookingCount`, `moderation` and `createdAt` untouched |
| `bookings/{id}` | **only** `{status: 'disputed', updatedAt}` | must be a participant, must come from `confirmed`/`in_progress`/`completed` |
| `rooms/{roomId}/presence/{uid}` | own presence document | `isRoomParticipant(roomId) && isSelf(uid)` |
| `rooms/{roomId}/attendance/{segmentId}` | open own segment (`leftAt == null`), then close it once | `changedKeys().hasOnly(['leftAt','closedByClient'])` and `resource.data.leftAt == null` |
| `rooms/{roomId}/signaling/{id}` | create an envelope as yourself | `from == request.auth.uid`, `to in room.participants`, `sequence is int`, `kind in [offer, answer, renegotiate, bye]` |
| `rooms/{roomId}/candidates/{id}` | create a candidate as yourself | same identity checks |
| `notifications/{id}` | `{read: true}` | recipient only |
| `reviews/{id}` | `{responseText, responseAt}` | subject of the review only |
| `communities/{id}` | create as founder; owners/moderators update | `ownerUids == [uid]` on create; counters and `ownerUids` frozen afterwards |
| `communities/{id}/members/{uid}` | join/leave as yourself | `isSelf(uid)` |
| `posts/{id}` | create as author; own reaction key; `commentCount` refresh | `reactions` diff limited to the caller's own key |
| `posts/{postId}/comments/{id}` | create/edit own comment body | author only |
| `reports/{id}` | create as yourself, status `open` | `reporterUid == request.auth.uid`, `handledByUid == null` |
| `disputes/{id}` | create as yourself about your own booking | caller must be in the booking's `participants` |

Everything else — `wallets`, `tokenTransactions`, `settlements`, `rooms/{roomId}` itself, all counters and
moderation fields, all `status` transitions other than "open a dispute" — is denied, including to
administrators.

---

## 4. Reading the rules file

```
isAdmin()        request.auth.token.admin == true        ← minted only by setUserRole
isRoomParticipant(roomId)   uid in get(rooms/{roomId}).participants
touchesServerFields()       changedKeys().hasAny(['uid','email','role','status','stats', …])
changedKeys()    request.resource.data.diff(resource.data).affectedKeys()
```

Three habits make the file reviewable:

- **Field-level diffs, not whole-document checks.** `changedKeys().hasOnly([...])` is what stops a member from
  smuggling `role: 'admin'` alongside a `headline` edit.
- **Rules read the source of truth, not a copy.** Room membership is resolved with `get()` on the room
  document, so a stale client cannot claim membership.
- **Default deny is last and unconditional.** Anything not matched by the file (new collections included) is
  denied until someone writes a rule for it on purpose.

Anonymous access is deliberately narrow: the marketplace (`skills`) and community posts are public reads,
`config/platform` is public because the token policy is product information, and **profiles, bookings, rooms,
wallets, notifications, reports and disputes require authentication**.

---

## 5. Server-side authorization in the Cloud Functions

The Admin SDK bypasses rules, so each callable performs its own checks in this order:

1. **Authentication** — `requireUid(request)` throws `HttpsError('unauthenticated')`.
2. **Role** — `requireAdmin(request)` reads the `admin` custom claim from the *token*, never from Firestore.
3. **Ownership / participation** — re-read the documents that matter and compare against `request.auth.uid`:
   - `createBooking` re-reads the listing (must be `published`), the config, both profiles and the conflicting
     bookings.
   - `respondToBooking` verifies the caller is a participant in the booking it is about, and that the action
     is legal for the current status.
   - `openRoom` / `endSession` verify participation and the join window through the shared `canJoinRoom`.
   - `createReview` verifies a completed booking with the caller as a participant.
   - `resolveDispute` verifies the caller is an administrator and that the debit row actually exists before
     writing a refund.
4. **Value re-derivation** — `tokenAmount` is recomputed via `computeTokenAmount(duration, config)`; durations,
   windows, conflicts, refunds and attendance quorums are computed by the shared modules, never accepted from
   the payload.
5. **Consistency** — the write happens in one Firestore transaction; deterministic ids
   (`tx_{bookingId}_debit`, `settlement_{bookingId}`, …) make replays idempotent.

Error codes are the local adapter's own strings, so the UI renders the same message regardless of backend:

```ts
fail('wallet/insufficient', 'You need 1 Time Token for this session and your balance is 0.5.')
throw new HttpsError('failed-precondition', message, { code })
```

---

## 6. Storage rules

`storage.rules` allows only two things, both under the caller's uid:

```
avatars/{uid}/…     image/* ≤ 2 MB, write by the owner, read by any signed-in member
listings/{uid}/…    image/* ≤ 5 MB, write by the owner, read publicly
```

Everything else is denied. No session media is ever uploaded — calls are peer-to-peer and are not recorded.

---

## 7. Administrative powers and their limits

| Power | Function | Limit |
| --- | --- | --- |
| Grant/revoke the admin claim | `setUserRole` | refuses to demote the **last** administrator; writes the claim with `setCustomUserClaims` |
| Suspend an account | `setUserStatus` | sets `status` and revokes refresh tokens; the account's ledger rows remain |
| Change a balance | `adjustWallet` | a written reason is mandatory and becomes the ledger row's `reason`; the row names the acting steward |
| Change the token policy | `updatePlatformConfig` | validates the values, stores `changeSummary` (human-readable diff) and bumps the audit timestamp |
| Resolve a report | `resolveReport` | can hide the reported content; the resolution text is stored and the reporter is notified |
| Resolve a dispute | `resolveDispute` | the refund amount is read from the **ledger**, not from the payload; a split refunds half |
| Read everything | rules | administrators may read any wallet, booking, room, report or dispute — but they still cannot write one |

**Administrators are not super-users of the database.** They can act *through functions*, where each action
leaves an audit trail, and never by editing documents directly.

---

## 8. Threat model (and what is not defended)

| Threat | Defence |
| --- | --- |
| Self-promotion to admin | Claim is only set by `setUserRole`; `role`/`status` are server-owned fields |
| Client sets its own balance | No rule path writes wallets/ledger; settlement is a function |
| Double settlement / replay | Deterministic ids + one transaction + `settlement.state` guard |
| Reopening attendance to inflate minutes | `resource.data.leftAt == null` on update; `attendanceLocked` when a room closes |
| Reading another member's room / wallet / notifications | Per-document ownership and participation checks |
| Forging signalling as the peer | `from == request.auth.uid`; `to` must be a participant |
| Inflating review scores | Counters are server-owned; a listing update may not touch `ratingSum`/`reviewCount` |
| Spam bookings | Server-side conflict, window and affordability validation; every booking notifies a human |
| TURN credential theft | Minted per caller, HMAC-derived, short-lived; the static secret never leaves the runtime |
| Deleted account to escape history | Ledger rows are retained; deletion anonymises the profile |

**Explicitly out of scope:** a compromised *client device* (a member can always see what their own browser
sees) and denial of service. App Check raises the cost of scripted abuse but is not treated as an
authorization mechanism.

---

## 9. How these claims are tested

`tests/rules/firestore.rules.spec.ts` drives the Firestore emulator as five identities — teacher, learner,
outsider, administrator and guest — and asserts, among others:

- a member reads only their own wallet; an administrator reads any wallet but **cannot write one**;
- a client cannot write a ledger row or a settlement record;
- a booking cannot be created, deleted, or settled from the client, and the only client lifecycle write is
  opening a dispute, one-way;
- an outsider cannot read a room, its presence, signalling or attendance;
- signalling requires `from == self` and `to` a participant; a member reads only what is addressed to them;
- a closed attendance segment cannot be reopened;
- profiles cannot self-promote or change `stats`; listings cannot inflate counters; reviews cannot be created
  and only the subject may reply;
- notifications expose only the `read` flag to the recipient;
- reports and disputes can only be filed as yourself and never pre-resolved;
- unmatched paths are denied by default.

Run them with:

```bash
npm ci
npm run test:rules        # wraps vitest in `firebase emulators:exec --only firestore`
```

> **Status:** this suite was written against the committed rules and reviewed line by line, but it **has not
> been executed** in the environment where the project was built — the emulator needs a JDK, and none was
> available. Do not treat it as passing evidence until it has actually run; the first run may reveal rules and
> fixtures that disagree.

Manual verification that needs no JVM: `firebase emulators:start` locally, then attempt the forbidden writes
from the browser console (`updateDoc(doc(db,'wallets',uid),{balance:999})`) and confirm `permission-denied`.
