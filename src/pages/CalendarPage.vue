<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import type { Booking } from '@shared/domain'
import { canJoinRoom } from '@shared/booking'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore } from '@/stores/bookings'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_AVAILABILITY } from '@/lib/catalog'
import { formatDuration, formatTime } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AvailabilityEditor from '@/components/schedule/AvailabilityEditor.vue'

const auth = useAuthStore()
const bookings = useBookingStore()
const ui = useUiStore()

const selectedDate = ref<Date>(new Date())
const availability = ref([...DEFAULT_AVAILABILITY])
const saving = ref(false)
const showEditor = ref(false)

const uid = computed(() => auth.profile?.uid ?? '')

onMounted(async () => {
  if (!uid.value) return
  await bookings.load(uid.value)
  availability.value = auth.profile?.availability.length ? [...auth.profile.availability] : [...DEFAULT_AVAILABILITY]
})

/** Bookings grouped by local calendar day for the month grid markers. */
const bookingsByDay = computed(() => {
  const map = new Map<string, Booking[]>()
  for (const booking of bookings.bookings) {
    if (!['requested', 'confirmed', 'in_progress', 'completed'].includes(booking.status)) continue
    const key = new Date(booking.startAt).toDateString()
    map.set(key, [...(map.get(key) ?? []), booking])
  }
  return map
})

const selectedDayKey = computed(() => selectedDate.value.toDateString())
const dayBookings = computed(() =>
  (bookingsByDay.value.get(selectedDayKey.value) ?? []).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
)

const weekdayAvailability = computed(() =>
  availability.value.filter((block) => block.weekday === selectedDate.value.getDay()),
)

/** Open teaching slots on the selected day, minus anything already booked. */
const freeSlots = computed(() => {
  const slots: { label: string; start: Date; booked: boolean }[] = []
  for (const block of weekdayAvailability.value) {
    const [sh, sm] = block.start.split(':').map(Number)
    const [eh, em] = block.end.split(':').map(Number)
    const cursor = new Date(selectedDate.value)
    cursor.setHours(sh, sm, 0, 0)
    const end = new Date(selectedDate.value)
    end.setHours(eh, em, 0, 0)
    while (cursor < end) {
      const slotStart = new Date(cursor)
      const slotEnd = new Date(cursor.getTime() + 60 * 60_000)
      const booked = dayBookings.value.some(
        (booking) =>
          Date.parse(booking.startAt) < slotEnd.getTime() && slotStart.getTime() < Date.parse(booking.endAt),
      )
      slots.push({
        label: `${String(slotStart.getHours()).padStart(2, '0')}:${String(slotStart.getMinutes()).padStart(2, '0')}`,
        start: slotStart,
        booked,
      })
      cursor.setMinutes(cursor.getMinutes() + 60)
    }
  }
  return slots
})

const upcomingCount = computed(() => bookings.upcoming.length)
const weekLoad = computed(() => {
  const weekStart = new Date(selectedDate.value)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
  const minutes = bookings.bookings
    .filter((b) => Date.parse(b.startAt) >= weekStart.getTime() && Date.parse(b.startAt) < weekEnd.getTime())
    .filter((b) => ['confirmed', 'in_progress', 'completed'].includes(b.status))
    .reduce((sum, b) => sum + b.durationMinutes, 0)
  return minutes
})

async function saveAvailability(): Promise<void> {
  saving.value = true
  try {
    await auth.saveProfile({ availability: availability.value })
    ui.success('Availability saved', 'Members will only see these windows when booking you.')
  } catch (e) {
    ui.error('Could not save availability', auth.errorMessage(e))
  } finally {
    saving.value = false
  }
}

function resetAvailability(): void {
  availability.value = [...DEFAULT_AVAILABILITY]
}

watch(selectedDate, () => {
  showEditor.value = false
})
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Booking calendar</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Manage your weekly availability, see every confirmed session and spot the gaps. Conflicts are blocked
          server-side when a booking is created, so the grid is never the final authority.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton variant="secondary" icon="edit" @click="showEditor = !showEditor">
          {{ showEditor ? 'Hide availability editor' : 'Edit weekly availability' }}
        </AppButton>
        <AppButton to="/skills" icon="search">Book a session</AppButton>
      </div>
    </header>

    <div class="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <!-- Calendar -->
      <section class="space-y-5">
        <div class="pp-card p-3">
          <VueDatePicker
            v-model="selectedDate"
            inline
            auto-apply
            dark
            :enable-time-picker="false"
            :day-names="['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']"
          >
            <template #day="{ day, date }">
              <span class="relative inline-flex h-full w-full items-center justify-center">
                {{ day }}
                <span
                  v-if="bookingsByDay.get(new Date(date).toDateString())?.length"
                  class="absolute bottom-1 size-1.5 rounded-full bg-brand"
                  aria-hidden="true"
                />
              </span>
            </template>
          </VueDatePicker>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="pp-card p-4">
            <p class="text-[11px] tracking-wide text-muted uppercase">Upcoming sessions</p>
            <p class="font-display mt-1 text-2xl font-bold text-ink">{{ upcomingCount }}</p>
          </div>
          <div class="pp-card p-4">
            <p class="text-[11px] tracking-wide text-muted uppercase">This week</p>
            <p class="font-display mt-1 text-2xl font-bold text-ink">{{ formatDuration(weekLoad) }}</p>
          </div>
          <div class="pp-card p-4">
            <p class="text-[11px] tracking-wide text-muted uppercase">Weekly availability</p>
            <p class="font-display mt-1 text-2xl font-bold text-ink">{{ availability.length }} slots</p>
          </div>
        </div>

        <div v-if="showEditor" class="pp-card p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-display text-base font-semibold text-ink">Weekly availability</h2>
            <div class="flex gap-2">
              <AppButton variant="ghost" size="sm" @click="resetAvailability">Reset to default</AppButton>
              <AppButton size="sm" :loading="saving" icon="check" @click="saveAvailability">Save</AppButton>
            </div>
          </div>
          <div class="mt-4">
            <AvailabilityEditor v-model="availability" :timezone="auth.profile?.timezone" />
          </div>
        </div>
      </section>

      <!-- Day detail -->
      <aside class="space-y-5">
        <section class="pp-card p-5">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-display text-base font-semibold text-ink">
                {{ selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) }}
              </h2>
              <p class="text-xs text-muted">{{ dayBookings.length }} session(s) scheduled</p>
            </div>
            <AppBadge tone="neutral">{{ weekdayAvailability.length }} open windows</AppBadge>
          </div>

          <ul v-if="dayBookings.length" class="mt-4 space-y-3">
            <li v-for="booking in dayBookings" :key="booking.id" class="rounded-xl border border-line/70 bg-canvas/40 p-3.5">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-ink">{{ booking.skillTitle }}</p>
                  <p class="text-xs text-muted">
                    {{ formatTime(booking.startAt) }} – {{ formatTime(booking.endAt) }} ·
                    {{ booking.teacherUid === uid ? 'you teach' : 'you learn' }}
                  </p>
                </div>
                <AppBadge :tone="booking.status === 'completed' ? 'muted' : booking.status === 'confirmed' ? 'brand' : 'warn'">
                  {{ booking.status.replace('_', ' ') }}
                </AppBadge>
              </div>
              <div v-if="canJoinRoom(booking)" class="mt-3">
                <AppButton :to="`/rooms/${booking.roomId}`" size="sm" icon="video">Join room</AppButton>
              </div>
            </li>
          </ul>
          <p v-else class="mt-4 rounded-xl border border-line/70 bg-canvas/40 p-3 text-xs text-muted">
            Nothing scheduled. Your free windows below are open for booking requests.
          </p>
        </section>

        <section class="pp-card p-5">
          <h2 class="font-display text-base font-semibold text-ink">Your windows that day</h2>
          <ul v-if="freeSlots.length" class="mt-3 grid grid-cols-3 gap-2">
            <li
              v-for="slot in freeSlots"
              :key="slot.label"
              class="rounded-xl border px-2 py-2 text-center text-xs"
              :class="slot.booked ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted'"
            >
              {{ slot.label }}
              <span class="mt-0.5 block text-[10px] text-muted">{{ slot.booked ? 'booked' : 'open' }}</span>
            </li>
          </ul>
          <p v-else class="mt-3 text-xs text-muted">
            No availability published for this weekday.
            <button type="button" class="text-brand-bright hover:underline" @click="showEditor = true">
              Add a window
            </button>
            to let members request sessions.
          </p>
        </section>

        <AppEmptyState
          v-if="!bookings.upcoming.length"
          compact
          icon="calendar"
          title="Your calendar is open"
          description="Publish availability and the exchange will start filling these slots."
          action-label="Book your first session"
          action-to="/skills"
        />

        <div class="pp-card p-5 text-xs leading-relaxed text-muted">
          <p class="flex items-center gap-2 text-ink">
            <AppIcon name="shield" :size="15" class="text-brand-bright" /> How conflicts are prevented
          </p>
          <p class="mt-2">
            When a booking is sent, the server checks both members’ schedules inside a database transaction before
            writing anything. Two people cannot hold the same hour, even if they click at the same moment.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>
