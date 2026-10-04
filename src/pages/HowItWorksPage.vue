<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBookingStore } from '@/stores/bookings'
import { useAuthStore } from '@/stores/auth'
import { computeTokenAmount, DEFAULT_PLATFORM_CONFIG } from '@shared/tokenPolicy'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import SectionHeading from '@/components/ui/SectionHeading.vue'

const bookings = useBookingStore()
const auth = useAuthStore()
const openFaq = ref<number | null>(0)

onMounted(() => {
  bookings.ensureConfig().catch(() => undefined)
})

const config = computed(() => bookings.config ?? DEFAULT_PLATFORM_CONFIG)

const examples = computed(() =>
  [60, 45, 30].map((minutes) => ({ minutes, tokens: computeTokenAmount(minutes, config.value) })),
)

const FLOW = [
  {
    title: '1 · Booking confirmed',
    body: 'Both members agree a slot. A unique room id is generated and the booking becomes joinable 15 minutes before it starts.',
    icon: 'calendar',
  },
  {
    title: '2 · Session happens',
    body: 'Each participant joins the video room. Attendance is recorded as time-stamped segments by the app — not by a client timer.',
    icon: 'video',
  },
  {
    title: '3 · Completion verified',
    body: 'The server measures the overlap of both members’ attendance, clamped to the booked window, and compares it with the platform quorum.',
    icon: 'target',
  },
  {
    title: '4 · Tokens settle atomically',
    body: 'Inside one database transaction: learner debited, teacher credited, both ledger rows written, settlement record stamped with an idempotency key.',
    icon: 'tokens',
  },
  {
    title: '5 · Both sides notified',
    body: 'You get a notification with the verified minutes and the new balance. Reviews unlock, and a dispute can be raised afterwards if needed.',
    icon: 'bell',
  },
]

const FAQ = [
  {
    q: 'What exactly is a Time Token?',
    a: 'A Time Token (TT) is a unit of credit for one hour of a member’s time. It is not money, has no cash value, cannot be bought, sold or withdrawn, and exists only to keep the exchange balanced between members.',
  },
  {
    q: 'What if a session is shorter than an hour?',
    a: 'The platform applies a published rounding policy to partial hours. The policy is visible in your wallet and on every booking before you confirm — there are no hidden fees.',
  },
  {
    q: 'What stops someone from claiming a session that never happened?',
    a: 'Tokens never move on a single client’s word. Settlement requires verified joint attendance, or explicit confirmation from both members, and is applied by the server inside a transaction with a deterministic idempotency key so it cannot run twice.',
  },
  {
    q: 'What happens if I cancel?',
    a: 'Cancellations inside the free window cost nothing. Late cancellations follow the published refund rules, teachers who cancel never cost the learner tokens, and every cancellation is recorded on the booking with its reason.',
  },
  {
    q: 'Can my balance go negative?',
    a: 'No. Balances cannot go below zero, and bookings are checked against your available balance. If a session would exceed what a learner can cover, the platform settles what it can and flags the remainder for a steward rather than inventing debt.',
  },
  {
    q: 'Who can see my data?',
    a: 'You control profile visibility, availability sharing, discovery listing and direct requests in Settings. Moderators can only see the records they need to resolve a specific report or dispute.',
  },
]
</script>

<template>
  <div class="pp-container py-14">
    <SectionHeading
      eyebrow="How it works"
      title="The mechanics behind a fair time exchange"
      description="PeerPulse is deliberately boring about the money part — because there is no money. Here is exactly how a session turns into Time Tokens, and what protects both sides."
    />

    <div class="mt-10 grid gap-5 md:grid-cols-3">
      <div class="pp-card p-6">
        <AppBadge tone="brand">Exchange rate</AppBadge>
        <p class="font-display mt-4 text-3xl font-bold text-ink">1 hour = 1 TT</p>
        <p class="mt-2 text-sm text-muted">
          Every skill, every member, every category. Tokens per hour:
          <span class="text-ink">{{ config.token.tokensPerHour }}</span>
        </p>
      </div>
      <div class="pp-card p-6">
        <AppBadge tone="cyan">Partial hours</AppBadge>
        <p class="font-display mt-4 text-3xl font-bold text-ink">
          {{ config.token.partialHourRule.replace('_', ' ') }}
        </p>
        <p class="mt-2 text-sm text-muted">
          Rounded in {{ config.token.roundingIncrementMinutes }}-minute steps, between
          {{ config.token.minSessionMinutes }} and {{ config.token.maxSessionMinutes }} minutes.
        </p>
      </div>
      <div class="pp-card p-6">
        <AppBadge tone="brand">New members</AppBadge>
        <p class="font-display mt-4 text-3xl font-bold text-ink">{{ config.token.signupGrantAmount }} TT</p>
        <p class="mt-2 text-sm text-muted">
          Introductory grant, so you can book learning before you have taught anything.
          <template v-if="!config.token.signupGrantEnabled">Disabled by platform policy.</template>
        </p>
      </div>
    </div>

    <!-- Token maths -->
    <section class="mt-14 grid gap-8 lg:grid-cols-[1fr_1fr]">
      <div>
        <h2 class="font-display text-xl font-bold text-ink">Session lengths and token values</h2>
        <p class="mt-2 text-sm text-muted">
          These numbers come from the live platform policy, not from documentation that can drift out of date.
        </p>
        <ul class="mt-5 space-y-3">
          <li
            v-for="example in examples"
            :key="example.minutes"
            class="pp-card flex items-center justify-between px-5 py-4"
          >
            <span class="text-sm text-ink">{{ example.minutes }} minute session</span>
            <span class="font-mono text-sm font-semibold text-brand-bright">{{ example.tokens }} TT</span>
          </li>
        </ul>
      </div>

      <div>
        <h2 class="font-display text-xl font-bold text-ink">Cancellation & refund rules</h2>
        <p class="mt-2 text-sm text-muted">Transparent, symmetrical, and enforced by the server.</p>
        <ul class="mt-5 space-y-4">
          <li class="pp-card p-5">
            <p class="text-sm font-semibold text-ink">Free window: {{ config.cancellation.freeCancellationHours }}h before start</p>
            <p class="mt-1 text-sm text-muted">
              Cancel with more than {{ config.cancellation.freeCancellationHours }} hours’ notice and nothing is
              charged. Reserved tokens (if the platform uses escrow) are released in full.
            </p>
          </li>
          <li class="pp-card p-5">
            <p class="text-sm font-semibold text-ink">
              Late cancellation: {{ Math.round(config.cancellation.lateCancellationRefundRatio * 100) }}% refunded
            </p>
            <p class="mt-1 text-sm text-muted">
              Cancelling inside the free window returns
              {{ Math.round(config.cancellation.lateCancellationRefundRatio * 100) }}% of any reserved tokens and is
              recorded on your reliability history.
            </p>
          </li>
          <li class="pp-card p-5">
            <p class="text-sm font-semibold text-ink">Teacher cancellation</p>
            <p class="mt-1 text-sm text-muted">
              The learner always keeps their tokens in full and receives a priority rebooking notice.
            </p>
          </li>
          <li class="pp-card p-5">
            <p class="text-sm font-semibold text-ink">
              No-show policy: {{ config.cancellation.noShowPenaltyTokens }} TT penalty
            </p>
            <p class="mt-1 text-sm text-muted">
              No-shows are recorded against the absent member and reviewed by a steward. Tokens are never taken from a
              member’s balance as punishment unless an administrator adjusts it explicitly, with a reason.
            </p>
          </li>
        </ul>
      </div>
    </section>

    <!-- Settlement flow -->
    <section class="mt-16">
      <SectionHeading
        eyebrow="Automatic settlement"
        title="How a completed session becomes a token movement"
        description="Everything below happens server-side. The browser cannot write to a wallet, and no client timer is ever trusted."
      />
      <ol class="mt-8 grid gap-4 lg:grid-cols-5">
        <li v-for="(step, index) in FLOW" :key="step.title" class="pp-card pp-card-hover relative p-5">
          <span class="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
            <AppIcon :name="step.icon" :size="18" />
          </span>
          <p class="font-display mt-3 text-sm font-semibold text-ink">{{ step.title }}</p>
          <p class="mt-1.5 text-xs leading-relaxed text-muted">{{ step.body }}</p>
          <span class="sr-only">Step {{ index + 1 }} of {{ FLOW.length }}</span>
        </li>
      </ol>

      <div class="pp-card mt-6 grid gap-4 p-6 sm:grid-cols-3">
        <div>
          <p class="text-xs tracking-wide text-muted uppercase">Verified attendance quorum</p>
          <p class="font-display mt-1 text-lg font-bold text-ink">{{ config.settlement.minVerifiedMinutes }} min</p>
          <p class="mt-1 text-xs text-muted">Below this, one confirmation is required from each side to settle.</p>
        </div>
        <div>
          <p class="text-xs tracking-wide text-muted uppercase">Auto-settle window</p>
          <p class="font-display mt-1 text-lg font-bold text-ink">{{ config.settlement.autoSettleAfterHours }} h</p>
          <p class="mt-1 text-xs text-muted">After a session ends, the server settles once the window closes.</p>
        </div>
        <div>
          <p class="text-xs tracking-wide text-muted uppercase">Dispute window</p>
          <p class="font-display mt-1 text-lg font-bold text-ink">{{ config.settlement.disputeWindowHours }} h</p>
          <p class="mt-1 text-xs text-muted">Time to raise an issue after a settlement, reviewed by a steward.</p>
        </div>
      </div>
    </section>

    <!-- Security -->
    <section class="mt-16 grid gap-5 lg:grid-cols-2">
      <div class="pp-card p-6">
        <span class="grid size-10 place-items-center rounded-xl bg-cyan/10 text-cyan ring-1 ring-cyan/25">
          <AppIcon name="lock" :size="18" />
        </span>
        <h3 class="font-display mt-4 text-lg font-semibold text-ink">What the platform guarantees</h3>
        <ul class="mt-4 space-y-3 text-sm text-muted">
          <li class="flex gap-2.5">
            <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
            Balances and ledger rows can only be written by trusted server code, never from a browser session.
          </li>
          <li class="flex gap-2.5">
            <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
            Only the two participants of a session can read its video-room signalling or attendance data.
          </li>
          <li class="flex gap-2.5">
            <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
            A settlement is idempotent: retries and duplicate events can never post a second credit.
          </li>
          <li class="flex gap-2.5">
            <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
            Double bookings are rejected by a transactional reservation check, not by the calendar’s good manners.
          </li>
        </ul>
      </div>

      <div id="disputes" class="pp-card scroll-mt-24 p-6">
        <span class="grid size-10 place-items-center rounded-xl bg-warn/10 text-warn ring-1 ring-warn/25">
          <AppIcon name="flag" :size="18" />
        </span>
        <h3 class="font-display mt-4 text-lg font-semibold text-ink">When things go wrong</h3>
        <ol class="mt-4 space-y-3 text-sm text-muted">
          <li><span class="text-ink">1.</span> Raise an issue on the booking within the dispute window.</li>
          <li><span class="text-ink">2.</span> The other member is notified and can add their side.</li>
          <li><span class="text-ink">3.</span> A steward reviews attendance records, notifications and the ledger.</li>
          <li><span class="text-ink">4.</span> The outcome is recorded on the booking; either side can see the reason.</li>
        </ol>
        <p class="mt-4 text-xs text-muted">
          Stewards can adjust a balance for a proven problem, always with a written reason that appears in both members’
          transaction history.
        </p>
      </div>
    </section>

    <!-- FAQ -->
    <section class="mt-16">
      <SectionHeading eyebrow="Questions" title="Frequently asked" />
      <div class="mt-8 space-y-3">
        <details
          v-for="(item, index) in FAQ"
          :key="item.q"
          class="pp-card group px-5 py-4"
          :open="openFaq === index"
          @toggle="(event) => (openFaq = (event.target as HTMLDetailsElement).open ? index : null)"
        >
          <summary class="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-ink">
            {{ item.q }}
            <AppIcon name="chevron-down" :size="17" class="text-muted transition group-open:rotate-180" />
          </summary>
          <p class="mt-3 text-sm leading-relaxed text-muted">{{ item.a }}</p>
        </details>
      </div>
    </section>

    <div class="pp-card mt-14 flex flex-wrap items-center justify-between gap-5 p-7">
      <div>
        <h2 class="font-display text-xl font-bold text-ink">Ready to trade an hour?</h2>
        <p class="mt-1.5 text-sm text-muted">
          Create a profile, list one skill you enjoy teaching, and book your first session this week.
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <AppButton v-if="!auth.isAuthenticated" to="/register" icon-right="arrow-right">Create your account</AppButton>
        <AppButton v-else to="/dashboard" icon-right="arrow-right">Back to dashboard</AppButton>
        <AppButton to="/skills" variant="secondary">Explore skills</AppButton>
      </div>
    </div>
  </div>
</template>
