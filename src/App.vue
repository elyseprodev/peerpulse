<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()

/** Landing and trust pages hide the app chrome when visited by a guest. */
const isBareLayout = computed(() => route.meta.bare === true)
const ready = computed(() => auth.ready)
</script>

<template>
  <AppShell v-if="!isBareLayout">
    <RouterView v-slot="{ Component }">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </AppShell>
  <RouterView v-else />

  <!-- First-paint splash while the session resolves -->
  <div
    v-if="!ready"
    class="fixed inset-0 z-200 grid place-items-center bg-canvas/90 backdrop-blur"
    role="status"
    aria-live="polite"
  >
    <div class="flex flex-col items-center gap-4">
      <span class="relative grid size-14 place-items-center rounded-2xl bg-brand/12 ring-1 ring-brand/30">
        <span class="absolute inset-0 animate-[pulse-ring_2.4s_infinite] rounded-2xl" />
        <span class="font-display text-lg font-bold text-brand-bright">PP</span>
      </span>
      <p class="text-sm text-muted">Connecting you to the exchange…</p>
    </div>
  </div>
</template>
