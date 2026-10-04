<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean; size?: number }>(), { size: 34 })
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <span
      class="relative grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-bright/25 to-cyan/15 ring-1 ring-brand/35"
      :style="{ width: `${size}px`, height: `${size}px` }"
    >
      <svg viewBox="0 0 24 24" :width="size * 0.62" :height="size * 0.62" aria-hidden="true" fill="none">
        <path d="M3 14c0-3.3 2.2-5.5 5-5.5s5 2.2 5 5.5" stroke="#34D399" stroke-width="2.1" stroke-linecap="round" />
        <path d="M14 11.5c0-2.4 1.4-4 3.4-4" stroke="#10B981" stroke-width="2.1" stroke-linecap="round" />
        <circle cx="12" cy="5.6" r="2.1" fill="#34D399" />
        <circle cx="20" cy="4" r="1.5" fill="#22D3EE" />
      </svg>
    </span>
    <span v-if="!compact" class="leading-none">
      <span class="font-display block text-[17px] font-bold tracking-tight text-ink">PeerPulse</span>
      <span class="mt-0.5 block text-[10px] font-medium tracking-[0.14em] text-muted uppercase">Time bank</span>
    </span>
  </span>
</template>
