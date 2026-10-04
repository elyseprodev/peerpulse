<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import AppButton from './AppButton.vue'

withDefaults(
  defineProps<{
    icon?: string
    title: string
    description?: string
    actionLabel?: string
    actionTo?: string
    compact?: boolean
  }>(),
  { icon: 'spark' },
)

defineEmits<{ action: [] }>()
</script>

<template>
  <div
    class="pp-card flex flex-col items-center justify-center gap-3 text-center"
    :class="compact ? 'px-6 py-8' : 'px-6 py-14'"
  >
    <span class="grid size-12 place-items-center rounded-2xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
      <AppIcon :name="icon" :size="22" />
    </span>
    <h3 class="font-display text-base font-semibold text-ink">{{ title }}</h3>
    <p v-if="description" class="max-w-md text-sm text-muted">{{ description }}</p>
    <div v-if="actionLabel" class="pt-1">
      <AppButton v-if="actionTo" :to="actionTo" variant="primary" size="sm" icon-right="arrow-right">
        {{ actionLabel }}
      </AppButton>
      <AppButton v-else variant="primary" size="sm" icon-right="arrow-right" @click="$emit('action')">
        {{ actionLabel }}
      </AppButton>
    </div>
    <slot />
  </div>
</template>
