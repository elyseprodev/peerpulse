<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{ value: number; count?: number; size?: number; interactive?: boolean }>(),
  { size: 15, interactive: false },
)

const emit = defineEmits<{ 'update:value': [value: number] }>()

const stars = computed(() => Array.from({ length: 5 }, (_, i) => i + 1))
const average = computed(() => (props.count ? props.value / props.count : props.value))
</script>

<template>
  <div class="flex items-center gap-1.5">
    <div class="flex" :role="interactive ? 'radiogroup' : 'img'" :aria-label="`${average.toFixed(1)} out of 5`">
      <button
        v-for="star in stars"
        :key="star"
        :type="interactive ? 'button' : undefined"
        :disabled="!interactive"
        :role="interactive ? 'radio' : undefined"
        :aria-checked="interactive ? value === star : undefined"
        :aria-label="interactive ? `${star} star${star === 1 ? '' : 's'}` : undefined"
        class="rounded-md p-0.5 transition disabled:cursor-default"
        :class="interactive ? 'hover:scale-110' : ''"
        @click="interactive && emit('update:value', star)"
      >
        <AppIcon
          name="star"
          :size="size"
          :stroke-width="1.4"
          :class="star <= Math.round(average) ? 'text-warn' : 'text-line'"
        />
      </button>
    </div>
    <span class="text-xs text-muted">
      {{ count ? `${average.toFixed(1)} (${count})` : average ? average.toFixed(1) : 'No reviews yet' }}
    </span>
  </div>
</template>
