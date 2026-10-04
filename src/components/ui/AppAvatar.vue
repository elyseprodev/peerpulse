<script setup lang="ts">
import { computed } from 'vue'
import { resolveAvatarUrl } from '@/lib/avatar'

const props = withDefaults(
  defineProps<{
    displayName: string
    seed?: string
    photoURL?: string | null
    size?: number
    /** Green pulse ring — used for “online now” states. */
    online?: boolean
    ring?: boolean
  }>(),
  { size: 44, online: false, ring: false },
)

const src = computed(() => resolveAvatarUrl({ photoURL: props.photoURL, avatarSeed: props.seed, displayName: props.displayName }))
</script>

<template>
  <span class="relative inline-flex" :style="{ width: `${size}px`, height: `${size}px` }">
    <img
      :src="src"
      :alt="`${displayName}’s profile image`"
      :width="size"
      :height="size"
      loading="lazy"
      decoding="async"
      class="size-full rounded-2xl object-cover"
      :class="ring ? 'ring-2 ring-brand/40' : 'ring-1 ring-line/70'"
    />
    <span
      v-if="online"
      class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface bg-brand"
      title="Online"
    >
      <span class="sr-only">Online</span>
    </span>
  </span>
</template>
