/**
 * Firestore Security Rules tests.
 *
 * These run against the Firestore emulator (`npm run test:rules`) and assert the
 * claim the whole token economy rests on: **no client can move a Time Token, and
 * no client can read a room it is not in.**
 *
 * They cannot run in a plain sandbox — the emulator is a JVM application, so a
 * JDK must be installed. If `java -version` fails, these tests are skipped by
 * the wrapper script and this suite is simply not evidence of anything; do not
 * report it as passing unless it actually ran.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, deleteDoc, serverTimestamp } from 'firebase/firestore'

const PROJECT_ID = 'peerpulse-rules-test'

let environment: RulesTestEnvironment

/** Two members, one outsider, one administrator. */
const TEACHER = 'uid_teacher'
const LEARNER = 'uid_learner'
const OUTSIDER = 'uid_outsider'
const ADMIN = 'uid_admin'
const BOOKING_ID = 'bk_rules_1'
const ROOM_ID = `room_${BOOKING_ID}`

const asTeacher = () => environment.authenticatedContext(TEACHER).firestore()
const asLearner = () => environment.authenticatedContext(LEARNER).firestore()
const asOutsider = () => environment.authenticatedContext(OUTSIDER).firestore()
const asAdmin = () => environment.authenticatedContext(ADMIN, { admin: true }).firestore()
const asGuest = () => environment.unauthenticatedContext().firestore()

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await import('node:fs').then((fs) => fs.readFileSync('firestore.rules', 'utf8')),
    },
  })
})

afterAll(async () => {
  await environment?.cleanup()
})

beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'config/platform'), {
      version: '2026.1',
      token: { tokensPerHour: 1 },
    })
    await setDoc(doc(db, 'users', TEACHER), { uid: TEACHER, email: 'teacher@peerpulse.app', role: 'member', status: 'active' })
    await setDoc(doc(db, 'users', LEARNER), { uid: LEARNER, email: 'learner@peerpulse.app', role: 'member', status: 'active' })
    await setDoc(doc(db, 'wallets', LEARNER), { uid: LEARNER, balance: 3, held: 0 })
    await setDoc(doc(db, 'wallets', TEACHER), { uid: TEACHER, balance: 0, held: 0 })
    await setDoc(doc(db, 'bookings', BOOKING_ID), {
      id: BOOKING_ID,
      teacherUid: TEACHER,
      learnerUid: LEARNER,
      participants: [LEARNER, TEACHER],
      status: 'confirmed',
      roomId: ROOM_ID,
    })
    await setDoc(doc(db, 'rooms', ROOM_ID), {
      bookingId: BOOKING_ID,
      participants: [LEARNER, TEACHER],
      status: 'open',
      attendanceLocked: false,
    })
  })
})

/* ─────────────────────────── the token economy ─────────────────────────── */

describe('wallets and the ledger', () => {
  it('lets a member read their own wallet and nobody else’s', async () => {
    await assertSucceeds(getDoc(doc(asLearner(), 'wallets', LEARNER)))
    await assertFails(getDoc(doc(asLearner(), 'wallets', TEACHER)))
    await assertFails(getDoc(doc(asOutsider(), 'wallets', LEARNER)))
  })

  it('lets an administrator read any wallet', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'wallets', LEARNER)))
  })

  it('refuses every client write to a wallet — including an administrator’s', async () => {
    await assertFails(updateDoc(doc(asLearner(), 'wallets', LEARNER), { balance: 999 }))
    await assertFails(updateDoc(doc(asAdmin(), 'wallets', LEARNER), { balance: 999 }))
    await assertFails(setDoc(doc(asLearner(), 'wallets', OUTSIDER), { uid: OUTSIDER, balance: 500 }))
  })

  it('refuses client writes to the ledger and to settlement records', async () => {
    await assertFails(
      addDoc(collection(asLearner(), 'tokenTransactions'), {
        uid: LEARNER,
        amount: 50,
        direction: 'credit',
        reason: 'found money',
      }),
    )
    await assertFails(setDoc(doc(asAdmin(), 'settlements', `settlement_${BOOKING_ID}`), { status: 'settled' }))
  })

  it('keeps the policy readable but never writable from a client', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'config', 'platform')))
    await assertFails(updateDoc(doc(asAdmin(), 'config', 'platform'), { version: 'hacked' }))
  })
})

/* ──────────────────────────────── bookings ────────────────────────────── */

describe('bookings', () => {
  it('are readable by participants and administrators only', async () => {
    await assertSucceeds(getDoc(doc(asTeacher(), 'bookings', BOOKING_ID)))
    await assertSucceeds(getDoc(doc(asAdmin(), 'bookings', BOOKING_ID)))
    await assertFails(getDoc(doc(asOutsider(), 'bookings', BOOKING_ID)))
  })

  it('cannot be created or deleted by a client', async () => {
    await assertFails(
      addDoc(collection(asLearner(), 'bookings'), {
        participants: [LEARNER, TEACHER],
        status: 'confirmed',
        tokenAmount: 0,
      }),
    )
    await assertFails(deleteDoc(doc(asLearner(), 'bookings', BOOKING_ID)))
  })

  it('let a participant open a dispute, and nothing else', async () => {
    await assertSucceeds(updateDoc(doc(asLearner(), 'bookings', BOOKING_ID), { status: 'disputed', updatedAt: serverTimestamp() }))
    // Freezing is one-way: a client cannot un-freeze it or settle it.
    await assertFails(updateDoc(doc(asLearner(), 'bookings', BOOKING_ID), { status: 'completed', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(asLearner(), 'bookings', BOOKING_ID), { tokenAmount: 0, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(asOutsider(), 'bookings', BOOKING_ID), { status: 'disputed', updatedAt: serverTimestamp() }))
  })

  it('cannot be settled by writing settlement fields', async () => {
    await assertFails(
      updateDoc(doc(asTeacher(), 'bookings', BOOKING_ID), {
        'settlement.state': 'settled',
        'settlement.settledAt': serverTimestamp(),
      }),
    )
  })
})

/* ─────────────────────────────── the room ─────────────────────────────── */

describe('video rooms', () => {
  it('are readable by the two participants and nobody else', async () => {
    await assertSucceeds(getDoc(doc(asTeacher(), 'rooms', ROOM_ID)))
    await assertFails(getDoc(doc(asOutsider(), 'rooms', ROOM_ID)))
    await assertFails(getDoc(doc(asGuest(), 'rooms', ROOM_ID)))
  })

  it('accept self-owned presence, and reject presence written as somebody else', async () => {
    await assertSucceeds(
      setDoc(doc(asTeacher(), 'rooms', ROOM_ID, 'presence', TEACHER), {
        uid: TEACHER,
        lastSeen: serverTimestamp(),
        leftAt: null,
        media: { camera: true, microphone: true, screen: false },
      }),
    )
    await assertFails(
      setDoc(doc(asTeacher(), 'rooms', ROOM_ID, 'presence', LEARNER), {
        uid: LEARNER,
        lastSeen: serverTimestamp(),
        leftAt: null,
        media: { camera: false, microphone: false, screen: false },
      }),
    )
  })

  it('accept signalling only from a participant, addressed to a participant, as themselves', async () => {
    await assertSucceeds(
      addDoc(collection(asLearner(), 'rooms', ROOM_ID, 'signaling'), {
        from: LEARNER,
        to: TEACHER,
        kind: 'offer',
        sdp: 'v=0',
        sequence: 1,
        createdAt: serverTimestamp(),
        expiresAt: serverTimestamp(),
      }),
    )

    await assertFails(
      addDoc(collection(asLearner(), 'rooms', ROOM_ID, 'signaling'), {
        from: TEACHER, // impersonation
        to: LEARNER,
        kind: 'offer',
        sdp: 'v=0',
        sequence: 1,
        createdAt: serverTimestamp(),
      }),
    )

    await assertFails(
      addDoc(collection(asOutsider(), 'rooms', ROOM_ID, 'signaling'), {
        from: OUTSIDER,
        to: TEACHER,
        kind: 'offer',
        sdp: 'v=0',
        sequence: 1,
        createdAt: serverTimestamp(),
      }),
    )

    await assertFails(
      addDoc(collection(asLearner(), 'rooms', ROOM_ID, 'signaling'), {
        from: LEARNER,
        to: OUTSIDER, // not a participant
        kind: 'offer',
        sdp: 'v=0',
        sequence: 1,
        createdAt: serverTimestamp(),
      }),
    )
  })

  it('let a member read only the signalling addressed to them', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'rooms', ROOM_ID, 'signaling', 'msg_for_teacher'), {
        from: LEARNER,
        to: TEACHER,
        kind: 'offer',
        sdp: 'v=0',
        sequence: 1,
      })
    })
    await assertSucceeds(getDoc(doc(asTeacher(), 'rooms', ROOM_ID, 'signaling', 'msg_for_teacher')))
    await assertFails(getDoc(doc(asLearner(), 'rooms', ROOM_ID, 'signaling', 'msg_for_teacher')))
  })

  it('accept an attendance segment opened by its owner and closed once', async () => {
    const segment = await assertSucceeds(
      addDoc(collection(asTeacher(), 'rooms', ROOM_ID, 'attendance'), {
        uid: TEACHER,
        joinedAt: serverTimestamp(),
        leftAt: null,
      }),
    )
    expect(segment.id).toBeTruthy()

    await assertSucceeds(
      updateDoc(doc(asTeacher(), 'rooms', ROOM_ID, 'attendance', segment.id), { leftAt: serverTimestamp(), closedByClient: true }),
    )
    // Once closed, it cannot be extended — that would inflate verified minutes.
    await assertFails(updateDoc(doc(asTeacher(), 'rooms', ROOM_ID, 'attendance', segment.id), { leftAt: null }))
  })

  it('cannot have rooms created or session state written by a client', async () => {
    await assertFails(setDoc(doc(asLearner(), 'rooms', 'room_fake'), { participants: [LEARNER], status: 'open' }))
    await assertFails(updateDoc(doc(asLearner(), 'rooms', ROOM_ID), { status: 'closed', attendanceLocked: true }))
  })
})

/* ────────────────────────────── profiles ──────────────────────────────── */

describe('member profiles', () => {
  it('are readable by signed-in members but not by guests', async () => {
    await assertSucceeds(getDoc(doc(asOutsider(), 'users', TEACHER)))
    await assertFails(getDoc(doc(asGuest(), 'users', TEACHER)))
  })

  it('cannot self-promote or change their own account status', async () => {
    await assertSucceeds(updateDoc(doc(asLearner(), 'users', LEARNER), { headline: 'Learning in public' }))
    await assertFails(updateDoc(doc(asLearner(), 'users', LEARNER), { role: 'admin' }))
    await assertFails(updateDoc(doc(asLearner(), 'users', LEARNER), { status: 'active', role: 'admin' }))
    await assertFails(updateDoc(doc(asLearner(), 'users', TEACHER), { headline: 'not mine' }))
  })

  it('may sync their own listing references but not the counters', async () => {
    await assertSucceeds(updateDoc(doc(asLearner(), 'users', LEARNER), { teachSkillIds: ['skill_1'], updatedAt: serverTimestamp() }))
    await assertFails(
      updateDoc(doc(asLearner(), 'users', LEARNER), { teachSkillIds: ['skill_1'], stats: { ratingSum: 500 } }),
    )
  })
})

/* ───────────────────────── listings and reviews ───────────────────────── */

describe('listings', () => {
  it('are public to read, and only the owner may write', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'skills', 'skill_1'), { ownerUid: TEACHER, status: 'published', moderation: { state: 'clean' } })
    })

    await assertSucceeds(getDoc(doc(asGuest(), 'skills', 'skill_1')))
    await assertSucceeds(updateDoc(doc(asTeacher(), 'skills', 'skill_1'), { description: 'Updated copy' }))
    await assertFails(updateDoc(doc(asLearner(), 'skills', 'skill_1'), { description: 'not mine' }))
  })

  it('cannot have their rating counters inflated by the owner', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'skills', 'skill_1'), {
        ownerUid: TEACHER,
        status: 'published',
        ratingSum: 0,
        reviewCount: 0,
        moderation: { state: 'clean' },
      })
    })
    await assertFails(updateDoc(doc(asTeacher(), 'skills', 'skill_1'), { ratingSum: 999, reviewCount: 100 }))
  })
})

describe('reviews', () => {
  it('cannot be created by a client, and only the recipient may reply', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'reviews', 'rv_1'), { authorUid: LEARNER, subjectUid: TEACHER, rating: 5 })
    })

    await assertFails(
      addDoc(collection(asLearner(), 'reviews'), { bookingId: BOOKING_ID, authorUid: LEARNER, rating: 5 }),
    )
    await assertSucceeds(updateDoc(doc(asTeacher(), 'reviews', 'rv_1'), { responseText: 'Thank you!', responseAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(asLearner(), 'reviews', 'rv_1'), { responseText: 'answering for them' }))
    await assertFails(updateDoc(doc(asTeacher(), 'reviews', 'rv_1'), { rating: 1 }))
  })
})

/* ────────────────────────── notifications & social ────────────────────── */

describe('notifications', () => {
  it('are private to the recipient, and only `read` may change', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'notifications', 'nt_1'), { uid: LEARNER, read: false, title: 'Settled' })
    })

    await assertSucceeds(getDoc(doc(asLearner(), 'notifications', 'nt_1')))
    await assertFails(getDoc(doc(asOutsider(), 'notifications', 'nt_1')))
    await assertSucceeds(updateDoc(doc(asLearner(), 'notifications', 'nt_1'), { read: true }))
    await assertFails(updateDoc(doc(asLearner(), 'notifications', 'nt_1'), { title: 'rewritten' }))
    await assertFails(setDoc(doc(asLearner(), 'notifications', 'nt_forged'), { uid: LEARNER, read: false }))
  })
})

describe('community posts', () => {
  async function seedPost() {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'post_1'), {
        communityId: 'cm_1',
        authorUid: TEACHER,
        kind: 'post',
        title: 'Chord challenge',
        body: 'Join me',
        reactions: { [TEACHER]: '👏' },
        commentCount: 0,
        pinned: false,
        moderation: { state: 'clean', reason: null },
      })
    })
  }

  it('let only the author create a post under their own name', async () => {
    await seedPost()
    await assertFails(
      addDoc(collection(asOutsider(), 'posts'), {
        communityId: 'cm_1',
        authorUid: TEACHER,
        kind: 'post',
        title: 'impersonation',
        body: 'x',
        reactions: {},
        commentCount: 0,
        moderation: { state: 'clean', reason: null },
      }),
    )
  })

  it('let a member change only their own reaction key', async () => {
    await seedPost()

    await assertSucceeds(
      updateDoc(doc(asLearner(), 'posts', 'post_1'), { reactions: { [TEACHER]: '👏', [LEARNER]: '💡' }, updatedAt: serverTimestamp() }),
    )
    // Cannot rewrite somebody else's reaction…
    await assertFails(
      updateDoc(doc(asLearner(), 'posts', 'post_1'), { reactions: { [TEACHER]: '❤️' }, updatedAt: serverTimestamp() }),
    )
    // …nor pin the post, nor change its author.
    await assertFails(updateDoc(doc(asLearner(), 'posts', 'post_1'), { pinned: true }))
    await assertFails(updateDoc(doc(asLearner(), 'posts', 'post_1'), { authorUid: LEARNER }))
  })

  it('allow the comment counter to be refreshed but not arbitrary fields', async () => {
    await seedPost()
    await assertSucceeds(updateDoc(doc(asLearner(), 'posts', 'post_1'), { commentCount: 1, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(asLearner(), 'posts', 'post_1'), { title: 'hijacked' }))
  })

  it('accept comments only under the author’s own name', async () => {
    await seedPost()
    await assertSucceeds(
      addDoc(collection(asLearner(), 'posts', 'post_1', 'comments'), {
        postId: 'post_1',
        communityId: 'cm_1',
        authorUid: LEARNER,
        body: 'Count me in',
        moderation: { state: 'clean', reason: null },
        createdAt: serverTimestamp(),
      }),
    )
    await assertFails(
      addDoc(collection(asLearner(), 'posts', 'post_1', 'comments'), {
        postId: 'post_1',
        communityId: 'cm_1',
        authorUid: TEACHER,
        body: 'not me',
        moderation: { state: 'clean', reason: null },
        createdAt: serverTimestamp(),
      }),
    )
  })
})

/* ───────────────────────── reports and disputes ───────────────────────── */

describe('reports and disputes', () => {
  it('accept a report only from its own reporter, and never a resolution', async () => {
    await assertSucceeds(
      addDoc(collection(asLearner(), 'reports'), {
        reporterUid: LEARNER,
        targetType: 'skill',
        targetId: 'skill_1',
        targetPath: 'skills/skill_1',
        targetLabel: 'A listing',
        reason: 'spam',
        details: 'Looks like advertising',
        status: 'open',
        handledByUid: null,
        createdAt: serverTimestamp(),
      }),
    )
    await assertFails(
      addDoc(collection(asLearner(), 'reports'), {
        reporterUid: TEACHER,
        targetType: 'skill',
        targetId: 'skill_1',
        targetPath: 'skills/skill_1',
        targetLabel: 'A listing',
        reason: 'spam',
        details: 'impersonation',
        status: 'open',
        handledByUid: null,
        createdAt: serverTimestamp(),
      }),
    )
    await assertFails(
      addDoc(collection(asLearner(), 'reports'), {
        reporterUid: LEARNER,
        targetType: 'skill',
        targetId: 'skill_1',
        targetPath: 'skills/skill_1',
        targetLabel: 'A listing',
        reason: 'spam',
        details: 'pre-resolved',
        status: 'resolved',
        handledByUid: LEARNER,
        createdAt: serverTimestamp(),
      }),
    )
  })

  it('accept a dispute only from a participant of the booking in question', async () => {
    await assertSucceeds(
      addDoc(collection(asLearner(), 'disputes'), {
        bookingId: BOOKING_ID,
        openedByUid: LEARNER,
        againstUid: TEACHER,
        claim: 'They never joined',
        evidence: '',
        status: 'open',
        outcome: null,
        handledByUid: null,
        createdAt: serverTimestamp(),
      }),
    )
    await assertFails(
      addDoc(collection(asOutsider(), 'disputes'), {
        bookingId: BOOKING_ID,
        openedByUid: OUTSIDER,
        againstUid: TEACHER,
        claim: 'none of my business',
        evidence: '',
        status: 'open',
        outcome: null,
        handledByUid: null,
        createdAt: serverTimestamp(),
      }),
    )
  })
})

/* ──────────────────────────── default deny ────────────────────────────── */

describe('everything else', () => {
  it('is denied by default', async () => {
    await assertFails(getDoc(doc(asAdmin(), 'secrets', 'anything')))
    await assertFails(setDoc(doc(asLearner(), 'secrets', 'anything'), { value: 1 }))
  })
})
