<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import type { Booking, PlatformConfig, SkillListing, UserProfile } from '@shared/domain'
import { DEFAULT_PLATFORM_CONFIG, computeTokenAmount, explainTokenAmount, validateBookingWindow, validateSessionDuration } from '@shared/tokenPolicy'
import { windowsOverlap } from '@shared/booking'
import { formatDuration } from '@/lib/format'
import AppModal from '../ui/AppModal.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'
import AppBadge from '../ui/AppBadge.vue'
import AppInput from '../ui/AppInput.vue'

const props = defineProps<{
  open: boolean
  skill: SkillListing | null
  teacher?: UserProfile | null | undefined
  config?: PlatformConfig | null
  /** The current member's existing bookings, used for a client-side conflict preview. */
  myBookings?: Booking[]
  submitting?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  /** Chronological ISO strings; the server re-validates everything. */
  submit: [payload: { startAt: string; endAt: string; timezone: string; note: string }]
}>()

const selectedDate = ref<Date | null>(null)
const selectedSlot = ref<string | null>(null)
const durationMinutes = ref(60)
const note = ref('')

const config = computed(() => props.config ?? DEFAULT_PLATFORM_CONFIG)

const DURATION_OPTIONS = [30, 45, 60, 90, 120]

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    selectedDate.value = null
    selectedSlot.value = null
    note.value = ''
    durationMinutes.value = props.skill?.durationMinutes ?? 60
  },
)

watch(
  () => props.skill?.durationMinutes,
  (minutes) => {
    if (minutes) durationMinutes.value = minutes
  },
)

/** Slots generated from the teacher's weekly availability for the chosen date. */
const slots = computed(() => {
  if (!selectedDate.value || !props.teacher) return []
  const weekday = selectedDate.value.getDay()
  const blocks = props.teacher.availability.filter((b) => b.weekday === weekday)
  const out: { time: string; start: Date; conflict: boolean }[] = []
  for (const block of blocks) {
    const [sh, sm] = block.start.split(':').map(Number)
    const [eh, em] = block.end.split(':').map(Number)
    const cursor = new Date(selectedDate.value)
    cursor.setHours(sh, sm, 0, 0)
    const end = new Date(selectedDate.value)
    end.setHours(eh, em, 0, 0)
    while (cursor.getTime() + durationMinutes.value * 60_000 <= end.getTime()) {
      const slotStart = new Date(cursor)
      const slotEnd = new Date(cursor.getTime() + durationMinutes.value * 60_000)
      const conflict = (props.myBookings ?? []).some(
        (booking) =>
          ['requested', 'confirmed', 'in_progress'].includes(booking.status) &&
          windowsOverlap({ start: slotStart.toISOString(), end: slotEnd.toISOString() }, { start: booking.startAt, end: booking.endAt }),
      )
      out.push({
        time: `${String(slotStart.getHours()).padStart(2, '0')}:${String(slotStart.getMinutes()).padStart(2, '0')}`,
        start: slotStart,
        conflict,
      })
      cursor.setMinutes(cursor.getMinutes() + 30)
    }
  }
  return out
})

const selectedWindow = computed(() => {
  if (!selectedDate.value || !selectedSlot.value) return null
  const [h, m] = selectedSlot.value.split(':').map(Number)
  const start = new Date(selectedDate.value)
  start.setHours(h, m, 0, 0)
  const end = new Date(start.getTime() + durationMinutes.value * 60_000)
  return { start, end }
})

const tokenAmount = computed(() => computeTokenAmount(durationMinutes.value, config.value))
const tokenExplanation = computed(() => explainTokenAmount(durationMinutes.value, config.value))

const validationError = computed(() => {
  if (!selectedWindow.value) return null
  const duration = validateSessionDuration(durationMinutes.value, config.value)
  if (duration) return duration
  return validateBookingWindow(selectedWindow.value.start, selectedWindow.value.end, config.value)
})

const minDate = computed(() => new Date())

function submit(): void {
  if (!selectedWindow.value || validationError.value) return
  emit('submit', {
    startAt: selectedWindow.value.start.toISOString(),
    endAt: selectedWindow.value.end.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    note: note.value,
  })
}
</script>

<template>
  <AppModal
    :open="open"
    title="Request a session"
    :description="skill ? skill.title : undefined"
    size="lg"
    @close="emit('close')"
  >
    <div class="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div>
        <p class="text-sm font-medium text-ink">1 · Pick a day</p>
        <p v-if="teacher" class="mt-1 text-xs text-muted">
          {{ teacher.displayName }} is generally available
          <span class="text-ink">{{ teacher.availability.length }}</span> slots a week
          <template v-if="teacher.timezone"> (their timezone: {{ teacher.timezone }})</template>.
        </p>
        <div class="pp-card mt-3 p-2">
          <VueDatePicker
            v-model="selectedDate"
            inline
            auto-apply
            dark
            :min-date="minDate"
            :enable-time-picker="false"
            :time-config="{ enableTimePicker: false }"
            prevent-min-max-navigation
            :day-names="['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']"
          />
        </div>
      </div>

      <div class="space-y-5">
        <div>
          <p class="text-sm font-medium text-ink">2 · Choose a slot</p>
          <p v-if="!selectedDate" class="mt-1 text-xs text-muted">Select a date to see available start times.</p>
          <div v-else-if="slots.length" class="mt-3 grid grid-cols-3 gap-2">
            <button
              v-for="slot in slots"
              :key="slot.time"
              type="button"
              class="rounded-xl border px-2 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                selectedSlot === slot.time
                  ? 'border-brand/50 bg-brand/15 text-brand-bright'
                  : slot.conflict
                    ? 'border-line/60 text-muted line-through'
                    : 'border-line text-ink hover:border-brand/40'
              "
              :disabled="slot.conflict"
              :title="slot.conflict ? 'You already have a session then' : `Book at ${slot.time}`"
              @click="selectedSlot = slot.time"
            >
              {{ slot.time }}
            </button>
          </div>
          <p v-else class="mt-3 rounded-xl border border-line/70 bg-canvas/40 p-3 text-xs text-muted">
            No published availability on that day. You can still send a request — the teacher decides, and you can agree a
            time in the chat.
          </p>
          <div v-if="selectedDate && !slots.length" class="mt-3">
            <AppInput v-model="selectedSlot" label="Proposed start time" type="time" hint="In your local timezone" />
          </div>
        </div>

        <div>
          <p class="text-sm font-medium text-ink">3 · Session length</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="option in DURATION_OPTIONS"
              :key="option"
              type="button"
              class="rounded-xl border px-3 py-2 text-xs transition"
              :class="
                durationMinutes === option
                  ? 'border-brand/50 bg-brand/15 text-brand-bright'
                  : 'border-line text-muted hover:border-brand/40 hover:text-ink'
              "
              @click="durationMinutes = option"
            >
              {{ formatDuration(option) }}
            </button>
          </div>
          <p class="mt-2 text-xs text-muted">{{ tokenExplanation }}</p>
        </div>

        <div class="rounded-2xl border border-brand/25 bg-brand/8 p-4">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted">This session costs</span>
            <span class="font-display text-xl font-bold text-brand-bright">{{ tokenAmount }} TT</span>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed text-muted">
            Deducted from your balance only when the session settles. Your available balance is checked again by the
            server before the booking is accepted.
          </p>
        </div>

        <AppInput v-model="note" label="Message to the teacher (optional)" textarea :rows="2" maxlength="400" />
      </div>
    </div>

    <div v-if="validationError" class="mt-5 flex items-start gap-2 rounded-xl border border-warn/35 bg-warn/10 p-3 text-xs text-warn">
      <AppIcon name="alert" :size="15" class="mt-0.5" />
      <span>{{ validationError }}</span>
    </div>
    <div v-if="error" class="mt-3 flex items-start gap-2 rounded-xl border border-danger/35 bg-danger/10 p-3 text-xs text-danger" role="alert">
      <AppIcon name="alert" :size="15" class="mt-0.5" />
      <span>{{ error }}</span>
    </div>

    <template #footer>
      <AppBadge v-if="selectedWindow" tone="muted">
        {{ selectedWindow.start.toLocaleString() }} → {{ selectedWindow.end.toLocaleTimeString() }}
      </AppBadge>
      <AppButton variant="ghost" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="submitting" :disabled="!selectedWindow || Boolean(validationError)" icon="send" @click="submit">
        Send request
      </AppButton>
    </template>
  </AppModal>
</template>
