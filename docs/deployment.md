# PeerPulse — Deployment Guide

> **Deliverable 11b of 11.** Everything needed to take this repository from a clone to a working deployment:
> the cloud setup, the environment variables, the deploy order, the post-deploy verification, and the mistakes
> that are easy to make.
>
> **Nothing here has been executed by the author of this repository** — no Firebase project was available in the
> environment where it was built. Read it as a precise plan, and expect the first deploy to surface small
> mismatches (that is what the verification checklist is for).

---

## 1. Prerequisites

| Requirement | Why |
| --- | --- |
| Node.js 20 LTS | Both projects target `node 20` (functions `engines.node`, functions runtime `nodejs20`) |
| `firebase-tools` ≥ 13 | `npx firebase --version`; the CLI is also a dev dependency, so `npx firebase` works after `npm ci` |
| A Firebase project on the **Blaze** plan | Cloud Functions require billing; the free tier still covers a pilot community |
| A JDK (for local emulators only) | `firebase emulators:start` and the rules suite need Java 11+ |
| A domain (optional) | Hosting provides `*.web.app`; a custom domain can be connected later |
| A TURN host (recommended) | coturn, or a managed TURN service that supports the REST credential scheme |

Project structure reminders: the app lives at the repository root, the functions are a separate npm project in
`functions/`, and `shared/*` is mirrored into `functions/src/shared/` by `npm run sync:shared`.

---

## 2. Create the Firebase project

1. **Project** — create it in the Firebase console, then:

   ```bash
   firebase login
   firebase use --add            # pick the project, alias it `default`
   ```

2. **Authentication** — enable the **Email/Password** provider (Users → Sign-in method). No other provider is
   used.

3. **Firestore** — create the database in **production mode**, choosing a region near the members
   (e.g. `europe-west1`, matching the functions region). Keep the default rules for now; they are replaced in
   step 6.

4. **Storage** — enable it in the same region. `storage.rules` restricts uploads to avatars and listing media
   under the caller's uid.

5. **App Check** — register the web app with **reCAPTCHA v3**, then take the *site key* into
   `VITE_FIREBASE_APPCHECK_SITE_KEY`. Keep enforcement **off** until the app has been deployed once (enforcing
   before the site key is live locks out every client).

6. **Cloud Messaging** — under Project settings → Cloud Messaging, generate a **Web Push certificate** and copy
   the VAPID public key into `VITE_FCM_VAPID_KEY`. Without it the app hides the push opt-in instead of showing a
   broken button.

7. **Web app registration** — add a web app and copy the SDK config: `apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, `appId`.

---

## 3. Environment variables

### 3.1 The browser (`.env.local` at the repository root)

Copy `.env.example` → `.env.local`. These values **ship to the browser** — never put a secret in this file.

```ini
VITE_BACKEND_MODE=firebase
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=…
VITE_FIREBASE_APP_ID=…
VITE_FIREBASE_APPCHECK_SITE_KEY=…
VITE_FIREBASE_APPCHECK_DEBUG=false
VITE_FUNCTIONS_REGION=europe-west1        # must match setGlobalOptions in functions/src/index.ts
VITE_FCM_VAPID_KEY=…
VITE_WEBRTC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
VITE_TURN_CREDENTIALS_ENDPOINT=callable   # mint TURN credentials via the function
# Leave the static TURN variables empty in production — the function mints them.
```

> Leaving `VITE_BACKEND_MODE` unset defaults to `local`, which runs the whole product in the browser. That is
> correct for demos and wrong for anything real.

### 3.2 The functions (`functions/.env`, git-ignored)

```ini
STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
TURN_STATIC_AUTH_SECRET=<the coturn static-auth-secret>
TURN_TTL_SECONDS=3600
```

Notes and caveats, stated plainly:

- These values are read with `process.env` in `functions/src/rooms.ts`.
- `functions/.env` is **not a secret store**: anyone with project access can read the deployed environment.
  `TURN_STATIC_AUTH_SECRET` is the one real secret here — the delivered code does **not** yet use
  `defineSecret`. Moving it to Secret Manager (`firebase functions:secrets:set TURN_STATIC_AUTH_SECRET` +
  `defineSecret('TURN_STATIC_AUTH_SECRET')`) is a recommended follow-up before opening the platform widely; see
  §9.
- Without `TURN_URLS`/`TURN_STATIC_AUTH_SECRET` the function returns STUN only and reports
  `turnConfigured: false`. Calls still work for many peer pairs; members behind symmetric NAT will not connect.

### 3.3 coturn (the TURN server)

```conf
# /etc/turnserver.conf
use-auth-secret
static-auth-secret=<same value as TURN_STATIC_AUTH_SECRET>
realm=turn.example.com
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535
no-multicast-peers
no-cli
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

This is the **REST API** scheme: the function mints `username = "<expiry unix>:<uid>"` and
`credential = base64(HMAC-SHA1(static-auth-secret, username))`. The secret is never sent to a browser, and
credentials expire within `TURN_TTL_SECONDS`.

---

## 4. Deploy

```bash
# 0. from a clean clone
npm ci
cd functions && npm install && cd ..

# 1. the shared business core must match the functions' copy
npm run check:shared          # fails if they drifted → run `npm run sync:shared`

# 2. prove it builds and the suite is green before touching the cloud
npm run typecheck
npm test

# 3. rules, indexes and storage rules
npm run deploy:rules          # firestore:rules, firestore:indexes

# 4. functions — the firebase.json predeploy runs `npm --prefix "$RESOURCE_DIR" run build`
npm run deploy:functions

# 5. the SPA (builds with typecheck first)
npm run deploy:hosting
```

One-shot alternative: `npx firebase deploy` (hosting + functions + rules + indexes, in that order, using the
`predeploy` build hook).

**Expected first-deploy output.** The functions deploy prints 18 endpoints: 15 callables, the
`onUserCreated` auth trigger, the `hourlySettlementSweep` scheduled function and `healthcheck`.

---

## 5. First-run provisioning (in this order)

1. **Seed the policy and backfill wallets.** Sign in to the deployed app with the account that should be the
   first steward, then grant it the admin claim out-of-band (the callable requires the claim it is meant to
   grant — the bootstrap problem):

   ```bash
   cd functions
   gcloud auth application-default login          # or set GOOGLE_APPLICATION_CREDENTIALS
   node -e "
   const admin = require('firebase-admin');
   admin.initializeApp({ credential: admin.applicationDefault(), projectId: 'your-project' });
   admin.auth().setCustomUserClaims('THE_UID', { admin: true })
     .then(() => console.log('claim set — sign out and back in'))
     .catch((e) => { console.error(e); process.exit(1); });
   "
   ```

   Sign out and back in (the claim only reaches the client on a fresh token), then call `bootstrapPlatform`
   from the admin dashboard → Overview → “Prepare the platform”. It seeds `config/platform` from
   `DEFAULT_PLATFORM_CONFIG` and creates a wallet (with the signup grant) for every existing profile.

2. **Health check.** From the browser console while signed in:

   ```js
   const f = getFunctions(); // or use the admin Overview panel
   await httpsCallable(f, 'healthcheck')()
   // → { ok: true, policyVersion: '2026.1', signupGrant: 3, ledgerReachable: true, … }
   ```

   `ok: false` means the policy document is missing — run step 1.

3. **Firestore TTL.** Composite indexes deploy with the rules, but **TTL policies do not**. Create them once:

   ```bash
   gcloud firestore fields ttls update expiresAt \
     --collection-group=signaling --enable-ttl --project=your-project
   gcloud firestore fields ttls update expiresAt \
     --collection-group=candidates --enable-ttl --project=your-project
   ```

   Without this, finished signalling documents accumulate.

4. **App Check enforcement.** Only after a successful deploy and a smoke test: Firebase console → App Check →
   Firestore/Functions → Enforce. Tokens are already being sent.

5. **Hosting domain.** Optionally connect a custom domain, then re-deploy hosting.

---

## 6. Post-deploy verification checklist

| # | Check | Expected |
| --- | --- | --- |
| 1 | `https://<project>.web.app` loads | Landing page renders; the SPA rewrites every route to `index.html` |
| 2 | Response headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` allowing camera/mic/display-capture for self, `Cache-Control: immutable` on `/assets/**` |
| 3 | Sign-up | Profile document, wallet with the 3-token grant, one `signup_grant` ledger row, one welcome notification — all present within a few seconds |
| 4 | Sign out, sign in again | The grant is not repeated (one transaction, deterministic `tx_signup_{uid}`) |
| 5 | Publish a listing | Appears in `/skills`; the token price matches `computeTokenAmount` for its duration |
| 6 | Request a booking | Status `requested`; the teacher has a notification; **no ledger row and no balance change** |
| 7 | Confirm (second account) | Status `confirmed`; a `rooms/room_{bookingId}` document exists |
| 8 | Forbidden write test | In the browser console, `updateDoc(doc(db,'wallets','<uid>'),{balance:999})` → `permission-denied` |
| 9 | Cross-member read test | As account B, reading account A's wallet → `permission-denied` |
| 10 | Live session | Two browsers connect, media is peer-to-peer; `signaling` documents appear during setup and stop after `bye` |
| 11 | Settlement | Exactly one `settlement_{bookingId}` and two balanced ledger rows; a second call changes nothing |
| 12 | Dispute | Client can set `status: 'disputed'` only, and cannot resolve it |
| 13 | TURN | `getTurnCredentials` returns a credential and `turnConfigured: true`; a forced relay-only call connects |
| 14 | App Check | With enforcement on, requests from the deployed origin succeed and a scripted request without a token fails |
| 15 | Push | A member who opts in receives an FCM notification; the browser permission prompt appears only after consent |
| 16 | Cleanup | A room's `signaling` documents disappear the day after the session (TTL) |

---

## 7. Local verification without a cloud project

```bash
npm ci
npm run dev        # http://localhost:5173 — local backend, seeded demo world
```

`VITE_BACKEND_MODE=local` (the default) runs everything in the browser: auth, a seeded database, bookings,
settlement, communities and even the WebRTC signalling (two tabs share one `localStorage` database). This is
how the product can be demonstrated and how the unit suite exercises whole flows.

With a JDK installed, the emulator route is closer to production:

```bash
npm run emulators        # auth 9099, firestore 8080, functions 5001, UI 4000
npm run serve:dev        # in another shell: the app pointed at the emulators (set the VITE_FIREBASE_* vars)
npm run test:rules       # the security-rules suite
```

---

## 8. Operations

| Task | Command |
| --- | --- |
| Function logs | `npx firebase functions:log --only settleSession` |
| Roll back hosting | Console → Hosting → Release history → Rollback |
| Roll back functions | Redeploy the previous commit (`git checkout <sha> -- functions && npm run deploy:functions`) |
| Rotate TURN credentials | Change `static-auth-secret` on coturn **and** in `functions/.env`, then redeploy functions |
| Pause automatic settlement | Raise `settlement.autoSettleAfterHours` on the policy form (only explicit settlements then run), or disable `hourlySettlementSweep` in the console |
| Inspect an economy issue | Admin → Ledger (all rows, with `createdBy`, `reason`, `policyCode`, `balanceAfter`) and Admin → Settlements (verified minutes, ids) |

Cost notes: the functions are capped (`maxInstances`), the sweep queries only `in_progress` bookings past the
cutoff, signalling documents are TTL-deleted, and the ledger is append-only with small documents. The dominant
costs at pilot scale are Firestore reads on list pages and the TURN server's bandwidth if many calls must relay.

---

## 9. Known gaps to close before a wide rollout

1. **Move the TURN secret to Secret Manager** (`defineSecret`) instead of a plain environment variable.
2. **Run the rules suite** in CI on a machine with a JDK, and require it to pass before deploying rules
   (`npm run test:rules`; it needs to download the emulator jar, so it cannot run in a locked-down sandbox).
3. **Run the functions suite in CI** (`cd functions && npm test`, 31 tests, no JDK or network needed) and
   extend it as features land. It covers the token paths but not Security Rules, and its mock commits
   transactions single-threaded — add a staging test with two concurrent settlements before trusting the
   concurrency story.
4. **Alerting**: an error-rate alert on the functions and a daily reconciliation job that asserts
   `sum(credits) == sum(debits)` per booking, so a settlement bug is loud rather than silent.
5. **Backups**: schedule Firestore exports (the ledger is the platform's book of record).
6. **Account deletion**: currently a steward-run process; automate the anonymisation while retaining the ledger.
7. **App Check enforcement** on Storage as well as Firestore/Functions.
