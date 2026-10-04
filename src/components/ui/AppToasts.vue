<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import AppIcon from './AppIcon.vue'

const ui = useUiStore()

const ICONS: Record<string, string> = {
  success: 'check',
  error: 'alert',
  warn: 'alert',
  info: 'info',
}

const TONES: Record<string, string> = {
  success: 'border-brand/40 text-brand-bright',
  error: 'border-danger/40 text-danger',
  warn: 'border-warn/40 text-warn',
  info: 'border-cyan/40 text-cyan',
}
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-200 flex flex-col items-center gap-2 p-4 sm:right-4 sm:left-auto sm:items-end">
    <TransitionGroup
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-3 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="translate-x-4 opacity-0"
      move-class="transition duration-200"
    >
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pp-glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl p-4 shadow-card"
        role="status"
        aria-live="polite"
      >
        <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-white/5" :class="TONES[toast.tone]">
          <AppIcon :name="ICONS[toast.tone]" :size="16" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-ink">{{ toast.title }}</p>
          <p v-if="toast.description" class="mt-0.5 text-xs leading-relaxed text-muted">{{ toast.description }}</p>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-muted transition hover:text-ink"
          aria-label="Dismiss notification"
          @click="ui.dismiss(toast.id)"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </div>
    </TransitionGroup>
    <span class="sr-only" aria-live="polite">{{ ui.toasts.length ? ui.toasts[ui.toasts.length - 1].title : '' }}</span>
  </div>
</template>
