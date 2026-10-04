<script setup lang="ts">
import { computed } from 'vue'
import type { AvailabilityBlock } from '@shared/domain'
import AppIcon from '../ui/AppIcon.vue'
import AppButton from '../ui/AppButton.vue'

const props = defineProps<{
  modelValue: AvailabilityBlock[]
  /** Read-only mode is used on public profiles. */
  readonly?: boolean
  timezone?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: AvailabilityBlock[]] }>()

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, '0')
  const minutes = i % 2 === 0 ? '00' : '30'
  return `${hours}:${minutes}`
})

function update(next: AvailabilityBlock[]): void {
  if (props.readonly) return
  emit('update:modelValue', next)
}

function addBlock(weekday: number): void {
  const existing = props.modelValue.filter((b) => b.weekday === weekday)
  const last = existing[existing.length - 1]
  const start = last ? last.end : '18:00'
  const [h, m] = start.split(':').map(Number)
  const endHour = Math.min(23, h + 2)
  update([
    ...props.modelValue,
    { weekday, start, end: `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}` },
  ])
}

function removeBlock(index: number): void {
  update(props.modelValue.filter((_, i) => i !== index))
}

function patchBlock(index: number, patch: Partial<AvailabilityBlock>): void {
  update(props.modelValue.map((block, i) => (i === index ? { ...block, ...patch } : block)))
}

function isInvalid(block: AvailabilityBlock): boolean {
  return !block.start || !block.end || block.start >= block.end
}

const totalWeeklyHours = computed(() =>
  Math.round(
    props.modelValue.reduce((sum, block) => {
      if (isInvalid(block)) return sum
      const [sh, sm] = block.start.split(':').map(Number)
      const [eh, em] = block.end.split(':').map(Number)
      return sum + (eh * 60 + em - (sh * 60 + sm)) / 60
    }, 0) * 10,
  ) / 10,
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-muted">
        Times are in your local timezone<span v-if="timezone"> ({{ timezone }})</span>. Members in other zones see
        converted slots when booking.
      </p>
      <p class="rounded-full border border-brand/25 bg-brand/10 px-3 py-1 text-[11px] font-medium text-brand-bright">
        {{ totalWeeklyHours }} hours offered per week
      </p>
    </div>

    <ul class="space-y-2">
      <li v-for="day in 7" :key="day" class="rounded-xl border border-line/70 bg-canvas/30 p-3">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-ink">{{ DAYS[day % 7 === 0 ? 6 : day - 1] }}</p>
          <button
            v-if="!readonly"
            type="button"
            class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-brand-bright transition hover:bg-brand/10"
            @click="addBlock(day % 7 === 0 ? 6 : day - 1)"
          >
            <AppIcon name="plus" :size="13" /> Add slot
          </button>
        </div>

        <div
          v-if="!modelValue.filter((b) => b.weekday === (day % 7 === 0 ? 6 : day - 1)).length"
          class="mt-2 text-[11px] text-muted"
        >
          Not available
        </div>

        <ul class="mt-2 space-y-2">
          <li
            v-for="(block, index) in modelValue"
            v-show="block.weekday === (day % 7 === 0 ? 6 : day - 1)"
            :key="index"
            class="flex flex-wrap items-center gap-2"
          >
            <select
              :value="block.start"
              :disabled="readonly"
              class="rounded-lg border bg-canvas/60 px-2 py-1.5 text-xs text-ink"
              :class="isInvalid(block) ? 'border-danger/60' : 'border-line'"
              :aria-label="`Start time for ${DAYS[block.weekday]}`"
              @change="patchBlock(index, { start: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="time in TIME_OPTIONS" :key="`s-${time}`" :value="time">{{ time }}</option>
            </select>
            <span class="text-xs text-muted">to</span>
            <select
              :value="block.end"
              :disabled="readonly"
              class="rounded-lg border bg-canvas/60 px-2 py-1.5 text-xs text-ink"
              :class="isInvalid(block) ? 'border-danger/60' : 'border-line'"
              :aria-label="`End time for ${DAYS[block.weekday]}`"
              @change="patchBlock(index, { end: ($event.target as HTMLSelectElement).value })"
            >
              <option v-for="time in TIME_OPTIONS" :key="`e-${time}`" :value="time">{{ time }}</option>
            </select>
            <button
              v-if="!readonly"
              type="button"
              class="rounded-lg p-1.5 text-muted transition hover:bg-danger/10 hover:text-danger"
              :aria-label="`Remove ${DAYS[block.weekday]} slot`"
              @click="removeBlock(index)"
            >
              <AppIcon name="close" :size="14" />
            </button>
            <span v-if="isInvalid(block)" class="text-[11px] text-danger">End must be after start</span>
          </li>
        </ul>
      </li>
    </ul>

    <AppButton
      v-if="!readonly && !modelValue.length"
      variant="secondary"
      size="sm"
      icon="plus"
      @click="update([{ weekday: 1, start: '18:00', end: '20:00' }, { weekday: 6, start: '10:00', end: '13:00' }])"
    >
      Use a suggested weekly pattern
    </AppButton>
  </div>
</template>
