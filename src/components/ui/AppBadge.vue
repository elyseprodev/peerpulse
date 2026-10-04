<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'brand' | 'neutral' | 'cyan' | 'warn' | 'danger' | 'muted'
    size?: 'sm' | 'md'
    dot?: boolean
  }>(),
  { tone: 'brand', size: 'sm' },
)

const TONES: Record<string, string> = {
  brand: 'bg-brand/12 text-brand-bright border-brand/25',
  cyan: 'bg-cyan/12 text-cyan border-cyan/25',
  neutral: 'bg-white/6 text-ink border-line',
  muted: 'bg-white/4 text-muted border-line',
  warn: 'bg-warn/12 text-warn border-warn/30',
  danger: 'bg-danger/12 text-danger border-danger/30',
}

const classes = computed(() => [
  'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight',
  props.size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
  TONES[props.tone],
])
</script>

<template>
  <span :class="classes">
    <span v-if="dot" class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    <slot />
  </span>
</template>
