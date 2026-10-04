<script setup lang="ts">
import type { PlatformConfig } from '@shared/domain'
import { computed } from 'vue'
import { explainTokenAmount } from '@shared/tokenPolicy'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{ config: PlatformConfig | null }>()

const examples = computed(() => {
  const config = props.config
  return [60, 90, 45].map((minutes) => ({
    minutes,
    text: config ? explainTokenAmount(minutes, config) : '—',
  }))
})
</script>

<template>
  <div class="pp-card p-5">
    <div class="flex items-center gap-2">
      <span class="grid size-8 place-items-center rounded-xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
        <AppIcon name="info" :size="16" />
      </span>
      <h3 class="font-display text-sm font-semibold text-ink">How Time Tokens work</h3>
    </div>

    <p class="mt-3 text-sm leading-relaxed text-muted">
      Every hour of teaching is worth exactly one Time Token — a guitar lesson, a coding session and a Spanish
      conversation all count the same. No prices, no money, no ranking of skills.
    </p>

    <ul class="mt-4 space-y-2 text-sm text-muted">
      <li class="flex items-start gap-2">
        <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
        <span>Tokens are credit for <span class="text-ink">time</span>, never cash. You cannot buy or withdraw them.</span>
      </li>
      <li class="flex items-start gap-2">
        <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
        <span>Balances only change when a session settles — every movement leaves a permanent ledger entry.</span>
      </li>
      <li class="flex items-start gap-2">
        <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
        <span>
          Sessions are confirmed by both members and verified by attendance before tokens move
          <template v-if="config"> (minimum {{ config.settlement.minVerifiedMinutes }} verified minutes).</template>
        </span>
      </li>
      <li v-if="config?.token.signupGrantEnabled" class="flex items-start gap-2">
        <AppIcon name="gift" :size="15" class="mt-0.5 text-brand-bright" />
        <span>New members start with {{ config.token.signupGrantAmount }} introductory Time Tokens.</span>
      </li>
    </ul>

    <div class="mt-4 rounded-xl border border-line/70 bg-canvas/40 p-3">
      <p class="text-[11px] tracking-wide text-muted uppercase">Current policy</p>
      <ul class="mt-2 space-y-1 text-xs text-muted">
        <li v-for="example in examples" :key="example.minutes">{{ example.minutes }} min → {{ example.text }}</li>
      </ul>
    </div>
  </div>
</template>
