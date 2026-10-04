<script setup lang="ts">
import SectionHeading from '@/components/ui/SectionHeading.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const COLLECTED = [
  { what: 'Account details', why: 'Name, email and password hash so you can sign in and be identified to other members.', retention: 'Until you delete your account.' },
  { what: 'Profile content', why: 'Your bio, skills, languages, availability and interests — everything you choose to publish.', retention: 'Until you remove it or delete your account.' },
  { what: 'Bookings and attendance', why: 'Session times and the presence segments used to verify that a session happened before tokens move.', retention: 'Kept as long as the booking exists; attendance summaries are kept for dispute resolution.' },
  { what: 'Token ledger', why: 'An immutable record of every credit and debit, so balances can always be reconciled.', retention: 'Retained in anonymised form after account deletion, because the exchange must still balance.' },
  { what: 'Signalling messages', why: 'The short-lived WebRTC offer, answer and ICE records used to connect your video call.', retention: 'Deleted when the room closes; never used for analytics.' },
  { what: 'Notifications', why: 'Booking confirmations, settlement results and moderation outcomes.', retention: 'Until you delete them or your account.' },
]

const CONTROLS = [
  'Set your profile to public, members-only or private at any time.',
  'Hide your availability, or pause new booking requests without removing your listings.',
  'Opt out of member discovery and keep your listings reachable only by direct link.',
  'Export your profile, bookings, reviews, notifications and full token ledger as JSON.',
  'Request deletion; open bookings are cancelled under standard rules first.',
]
</script>

<template>
  <div class="pp-container py-14">
    <SectionHeading
      as="h1"
      eyebrow="Privacy"
      title="What PeerPulse stores, and why"
      description="A time-bank needs a reliable memory — bookings, attendance and the ledger — but nothing more than that. Here is exactly what we keep."
    />

    <section class="mt-10">
      <div class="pp-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-180 text-left text-sm">
            <caption class="sr-only">Data we store, why, and for how long</caption>
            <thead class="border-b border-line/60 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th class="px-5 py-3 font-medium">Data</th>
                <th class="px-5 py-3 font-medium">Why we need it</th>
                <th class="px-5 py-3 font-medium">Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in COLLECTED" :key="row.what" class="border-b border-line/40 last:border-0">
                <td class="px-5 py-4 font-medium text-ink">{{ row.what }}</td>
                <td class="px-5 py-4 text-muted">{{ row.why }}</td>
                <td class="px-5 py-4 text-xs text-muted">{{ row.retention }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="mt-12 grid gap-5 lg:grid-cols-2">
      <div class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Your controls</h2>
        <ul class="mt-4 space-y-3 text-sm text-muted">
          <li v-for="control in CONTROLS" :key="control" class="flex gap-2.5">
            <AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" />
            {{ control }}
          </li>
        </ul>
      </div>

      <div class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Who can see what</h2>
        <ul class="mt-4 space-y-3 text-sm text-muted">
          <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> <span><span class="text-ink">Other members</span> see your public profile, published listings and reviews.</span></li>
          <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> <span><span class="text-ink">Your session partner</span> sees the booking details, the signalling records for your shared room, and your attendance.</span></li>
          <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> <span><span class="text-ink">Stewards</span> see moderation reports and disputes they are assigned, plus aggregated platform metrics. They cannot read your video or audio — the call is peer-to-peer.</span></li>
          <li class="flex gap-2.5"><AppIcon name="lock" :size="16" class="mt-0.5 text-brand-bright" /> <span>Nobody can read your wallet by guessing: balances are readable only by you and by server code.</span></li>
        </ul>
      </div>
    </section>

    <section class="pp-card mt-12 p-7">
      <h2 class="font-display text-lg font-semibold text-ink">Cookies, analytics and third parties</h2>
      <p class="mt-3 text-sm leading-relaxed text-muted">
        PeerPulse sets no advertising cookies and runs no third-party trackers. Browser storage holds your session, your
        theme preference and — when the app runs on the in-browser reference backend — the local demo dataset. In
        production, Firebase Authentication, Cloud Firestore, Cloud Functions and Cloud Messaging process the data
        described above on our behalf; TURN credentials for video relay are minted per session and expire within hours.
      </p>
      <p class="mt-3 text-sm leading-relaxed text-muted">
        Questions about any of this can go to <span class="text-ink">privacy@peerpulse.app</span>. If you believe your
        data has been handled incorrectly, a steward can review the access records for your account.
      </p>
    </section>
  </div>
</template>
