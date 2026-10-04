<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{ open: boolean; title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>(),
  { size: 'md' },
)

const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  // Simple focus trap: keep Tab inside the dialog.
  if (event.key === 'Tab' && panel.value) {
    const focusable = panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      await new Promise((resolve) => setTimeout(resolve, 30))
      panel.value?.querySelector<HTMLElement>('button, input, textarea, select, a[href]')?.focus()
    } else {
      document.body.style.overflow = ''
    }
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-100 flex items-end justify-center overflow-y-auto bg-[#04101a]/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        @click.self="emit('close')"
      >
        <div
          ref="panel"
          class="pp-card animate-[fade-up_0.28s_cubic-bezier(0.22,1,0.36,1)_both] w-full rounded-t-3xl border-line p-6 sm:rounded-3xl"
          :class="SIZES[size]"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="font-display text-lg font-semibold text-ink">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
            </div>
            <button
              type="button"
              class="rounded-xl p-2 text-muted transition hover:bg-white/6 hover:text-ink"
              aria-label="Close dialog"
              @click="emit('close')"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </div>
          <div class="mt-5">
            <slot />
          </div>
          <div v-if="$slots.footer" class="mt-6 flex flex-wrap justify-end gap-3">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
