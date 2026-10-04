<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    icon?: string
    tone?: 'brand' | 'cyan' | 'warn' | 'neutral'
    loading?: boolean
  }>(),
  { tone: 'brand' },
)

const TONES = {
  brand: 'text-brand-bright bg-brand/12 ring-brand/20',
  cyan: 'text-cyan bg-cyan/12 ring-cyan/20',
  warn: 'text-warn bg-warn/12 ring-warn/20',
  neutral: 'text-muted bg-white/5 ring-line',
} as const
</script>

<template>
  <div class="pp-card pp-card-hover p-5">
    <div class="flex items-start justify-between gap-3">
      <p class="text-xs font-medium tracking-wide text-muted uppercase">{{ label }}</p>
      <span v-if="icon" class="grid size-8 place-items-center rounded-xl ring-1" :class="TONES[tone]">
        <AppIcon :name="icon" :size="16" />
      </span>
    </div>
    <p v-if="loading" class="pp-skeleton mt-3 h-8 w-24" />
    <p v-else class="font-display mt-2 text-3xl font-bold tracking-tight text-ink">{{ value }}</p>
    <p v-if="hint" class="mt-1 text-xs text-muted">{{ hint }}</p>
  </div>
</template>
