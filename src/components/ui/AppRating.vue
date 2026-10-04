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
    <!--
      Read-only ratings render as spans, not as disabled buttons. A disabled
      button is still a control: it lands in the accessibility tree as an unnamed
      button (five of them per card, hundreds per page), and screen-reader users
      get "button, dimmed" repeated instead of the rating. The wrapper already
      carries the value as an image, so the stars are decoration.
    -->
    <div class="flex" :role="interactive ? 'radiogroup' : 'img'" :aria-label="`${average.toFixed(1)} out of 5`">
      <template v-if="interactive">
        <button
          v-for="star in stars"
          :key="star"
          type="button"
          role="radio"
          :aria-checked="value === star"
          :aria-label="`${star} star${star === 1 ? '' : 's'}`"
          class="rounded-md p-0.5 transition hover:scale-110"
          @click="emit('update:value', star)"
        >
          <AppIcon
            name="star"
            :size="size"
            :stroke-width="1.4"
            :class="star <= Math.round(average) ? 'text-warn' : 'text-line'"
          />
        </button>
      </template>
      <template v-else>
        <span v-for="star in stars" :key="star" aria-hidden="true" class="p-0.5">
          <AppIcon
            name="star"
            :size="size"
            :stroke-width="1.4"
            :class="star <= Math.round(average) ? 'text-warn' : 'text-line'"
          />
        </span>
      </template>
    </div>
    <span class="text-xs text-muted">
      {{ count ? `${average.toFixed(1)} (${count})` : average ? average.toFixed(1) : 'No reviews yet' }}
    </span>
  </div>
</template>
