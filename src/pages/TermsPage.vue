<script setup lang="ts">
import SectionHeading from '@/components/ui/SectionHeading.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const SECTIONS = [
  {
    title: '1 · The exchange',
    points: [
      'PeerPulse is a time bank: members exchange skills in units of time, recorded as Time Tokens.',
      'One hour of teaching earns one Time Token; one hour of learning costs one Time Token, regardless of the skill exchanged.',
      'Partial hours follow the published rounding policy shown on every listing and in your wallet.',
    ],
  },
  {
    title: '2 · Time Tokens are not money',
    points: [
      'Time Tokens have no monetary value, earn no interest, and are not redeemable for cash or goods.',
      'Tokens cannot be purchased, sold, traded outside PeerPulse, or transferred except as part of a settled session.',
      'On account deletion any remaining balance is returned to the community pool — it cannot be cashed out.',
    ],
  },
  {
    title: '3 · Membership conduct',
    points: [
      'You must provide accurate profile information and only list skills you can genuinely teach at the stated level.',
      'Soliciting payment, tips or paid courses through the platform is prohibited and results in removal.',
      'Harassment, discrimination and misrepresentation are grounds for immediate suspension.',
    ],
  },
  {
    title: '4 · Sessions and settlement',
    points: [
      'Bookings are confirmed by the teacher unless auto-confirmation is enabled for that member.',
      'A session settles when verified joint attendance meets the platform quorum, or when both members confirm completion.',
      'If a participant cannot cover the token amount at settlement, the platform settles what it can and flags the remainder for steward review rather than creating debt.',
      'Settlements are idempotent: repeating a settlement calculation can never move tokens twice.',
    ],
  },
  {
    title: '5 · Cancellations and no-shows',
    points: [
      'Cancellations made before the free window cost nothing.',
      'Late cancellations follow the published refund ratio and are recorded on your reliability history.',
      'When a teacher cancels, the learner keeps their tokens in full and receives priority rebooking.',
      'Repeated no-shows may lead to restrictions on booking privileges.',
    ],
  },
  {
    title: '6 · Disputes',
    points: [
      'Either member may raise an issue within the dispute window after a settlement.',
      'Stewards decide using attendance records, the booking history and the ledger, and record their reasoning on the booking.',
      'Steward decisions may credit, refund or split tokens. Admin adjustments always carry a written reason.',
    ],
  },
  {
    title: '7 · Limits of the service',
    points: [
      'PeerPulse provides a platform, not tuition, and does not guarantee any learning outcome.',
      'Video sessions are peer-to-peer. Connection quality depends on the members’ networks and devices.',
      'The platform is provided as-is; no currency-like protections, insurance or deposit guarantees apply.',
    ],
  },
]
</script>

<template>
  <div class="pp-container py-14">
    <SectionHeading
      eyebrow="Terms of exchange"
      title="The rules that make a moneyless exchange work"
      description="Short version: trade time fairly, be honest about what you teach, and never treat Time Tokens as money. The detail follows."
    />

    <div class="mt-10 space-y-5">
      <section v-for="section in SECTIONS" :key="section.title" class="pp-card p-6">
        <h2 class="font-display text-base font-semibold text-ink">{{ section.title }}</h2>
        <ul class="mt-3 space-y-2.5">
          <li v-for="point in section.points" :key="point" class="flex gap-2.5 text-sm leading-relaxed text-muted">
            <AppIcon name="check" :size="15" class="mt-0.5 shrink-0 text-brand-bright" />
            {{ point }}
          </li>
        </ul>
      </section>
    </div>

    <section class="pp-card mt-10 p-6">
      <h2 class="font-display text-base font-semibold text-ink">Questions about these terms</h2>
      <p class="mt-2 text-sm text-muted">
        Contact the stewards at <span class="text-ink">stewards@peerpulse.app</span>. Policy changes that affect token
        values or refund rules are announced in the platform before they take effect, and existing bookings always keep
        the terms they were made under.
      </p>
    </section>
  </div>
</template>
