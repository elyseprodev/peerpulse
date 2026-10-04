<script setup lang="ts">
import SectionHeading from '@/components/ui/SectionHeading.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const RULES = [
  {
    icon: 'users',
    title: 'Teach at the level you claim',
    body: 'List the level you can genuinely support. Beginner-friendly listings that over-promise waste somebody’s only free evening.',
  },
  {
    icon: 'clock',
    title: 'Time is the only currency',
    body: 'Never ask for payment, tips or paid upsells inside PeerPulse. Tokens cannot be bought, sold or transferred for money.',
  },
  {
    icon: 'shield',
    title: 'Turn up or cancel early',
    body: 'Cancel as far ahead as you can. Attendance is recorded, and repeated no-shows are visible to stewards.',
  },
  {
    icon: 'heart',
    title: 'Be patient with beginners',
    body: 'Everyone starts somewhere. Explain without condescension, and let learners ask the “obvious” question.',
  },
  {
    icon: 'flag',
    title: 'Report, do not retaliate',
    body: 'If something feels wrong, report it. Stewards review the record and act. Retaliatory reviews or posts are removed.',
  },
  {
    icon: 'lock',
    title: 'Respect privacy',
    body: 'Do not record sessions, share contact details or republish another member’s material without explicit permission.',
  },
]

const ENFORCEMENT = [
  { step: '1', title: 'Report received', body: 'A steward reviews the report with the surrounding context: posts, messages, attendance and ledger records.' },
  { step: '2', title: 'Assessment', body: 'Content may be hidden while under review. Both sides can add information.' },
  { step: '3', title: 'Action', body: 'Outcomes range from a note, to content removal, to suspension. Every action carries a written reason the reporter sees.' },
  { step: '4', title: 'Appeal', body: 'Members can appeal within 14 days by replying to the outcome notification; a second steward reviews it.' },
]
</script>

<template>
  <div class="pp-container py-14">
    <SectionHeading
      as="h1"
      eyebrow="Community guidelines"
      title="How we treat each other here"
      description="PeerPulse runs on trust between strangers. These are the rules that keep an exchange without money safe to use."
    />

    <div class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <article v-for="rule in RULES" :key="rule.title" class="pp-card p-6">
        <span class="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
          <AppIcon :name="rule.icon" :size="18" />
        </span>
        <h2 class="font-display mt-4 text-base font-semibold text-ink">{{ rule.title }}</h2>
        <p class="mt-2 text-sm leading-relaxed text-muted">{{ rule.body }}</p>
      </article>
    </div>

    <section class="mt-14">
      <SectionHeading eyebrow="Moderation" title="What happens when a rule is broken" />
      <ol class="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <li v-for="item in ENFORCEMENT" :key="item.step" class="pp-card p-5">
          <span aria-hidden="true" class="font-display text-2xl font-bold text-line">{{ item.step }}</span>
          <h3 class="font-display mt-2 text-sm font-semibold text-ink">{{ item.title }}</h3>
          <p class="mt-1.5 text-xs leading-relaxed text-muted">{{ item.body }}</p>
        </li>
      </ol>
    </section>

    <section class="pp-card mt-12 p-7">
      <h2 class="font-display text-lg font-semibold text-ink">Time Token rules in one place</h2>
      <ul class="mt-4 space-y-3 text-sm text-muted">
        <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> One hour of teaching earns one Time Token. One hour of learning costs one Time Token.</li>
        <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> All skills are equal. There is no price list and no premium rate.</li>
        <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> Tokens are never cash: no buying, selling, gifting for money or withdrawal.</li>
        <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> Settlements require verified attendance or explicit confirmation from both members.</li>
        <li class="flex gap-2.5"><AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" /> Every movement is recorded permanently and visible to the members involved.</li>
      </ul>
    </section>
  </div>
</template>
