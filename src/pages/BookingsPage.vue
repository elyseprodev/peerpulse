<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { Booking } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore, type BookingTab } from '@/stores/bookings'
import { useUiStore } from '@/stores/ui'
import { getBackend } from '@/lib/backend'
import { resolveCancellation } from '@shared/tokenPolicy'
import { DEFAULT_PLATFORM_CONFIG } from '@shared/tokenPolicy'
import { formatDateTimeRange } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppRating from '@/components/ui/AppRating.vue'
import BookingCard from '@/components/bookings/BookingCard.vue'

const auth = useAuthStore()
const bookings = useBookingStore()
const ui = useUiStore()

const tab = ref<BookingTab>('upcoming')
const modal = reactive({
  kind: null as null | 'cancel' | 'decline' | 'dispute' | 'reschedule' | 'review',
  booking: null as Booking | null,
})
const form = reactive({
  reason: '',
  claim: '',
  rating: 5,
  comment: '',
  startDate: '',
  startTime: '',
  durationMinutes: 60,
})
const submitting = ref(false)
const actionError = ref<string | null>(null)

const uid = computed(() => auth.profile?.uid ?? '')
const config = computed(() => bookings.config ?? DEFAULT_PLATFORM_CONFIG)

const TABS: { id: BookingTab; label: string; count: () => number }[] = [
  { id: 'upcoming', label: 'Upcoming', count: () => bookings.upcoming.length },
  { id: 'requests', label: 'Requests', count: () => bookings.requests.length },
  { id: 'past', label: 'Past', count: () => bookings.past.length },
  { id: 'cancelled', label: 'Cancelled', count: () => bookings.cancelled.length },
]

const visible = computed(() => {
  switch (tab.value) {
    case 'requests':
      return bookings.requests
    case 'past':
      return bookings.past
    case 'cancelled':
      return bookings.cancelled
    default:
      return bookings.upcoming
  }
})

const cancellationPreview = computed(() => {
  if (!modal.booking) return null
  return resolveCancellation(modal.booking, uid.value, config.value)
})

onMounted(async () => {
  if (!uid.value) return
  await bookings.load(uid.value)
})

function openModal(kind: typeof modal.kind, booking: Booking): void {
  modal.kind = kind
  modal.booking = booking
  actionError.value = null
  form.reason = ''
  form.claim = ''
  form.rating = 5
  form.comment = ''
  if (kind === 'reschedule') {
    const start = new Date(booking.startAt)
    form.startDate = start.toISOString().slice(0, 10)
    form.startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    form.durationMinutes = booking.durationMinutes
  }
}

function closeModal(): void {
  modal.kind = null
  modal.booking = null
}

async function withSubmit(action: () => Promise<void>, successMessage: string): Promise<void> {
  submitting.value = true
  actionError.value = null
  try {
    await action()
    ui.success(successMessage)
    closeModal()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'Something went wrong.'
  } finally {
    submitting.value = false
  }
}

const confirmRequest = (booking: Booking) =>
  withSubmit(async () => {
    await bookings.confirm(booking.id)
  }, 'Session confirmed — the learner has been notified.')

const declineRequest = (booking: Booking) =>
  withSubmit(async () => {
    await bookings.decline(booking.id, form.reason || 'Not available at that time.')
  }, 'Request declined — the learner can book another slot.')

const cancelBooking = () =>
  withSubmit(async () => {
    if (!modal.booking) return
    await bookings.cancel(modal.booking.id, form.reason)
  }, 'Booking cancelled. Any reserved tokens were handled per policy.')

const rescheduleBooking = () =>
  withSubmit(async () => {
    if (!modal.booking) return
    const start = new Date(`${form.startDate}T${form.startTime}:00`)
    const end = new Date(start.getTime() + Number(form.durationMinutes) * 60_000)
    await bookings.reschedule(modal.booking.id, start.toISOString(), end.toISOString(), form.reason)
  }, 'New time proposed — waiting for the other member to confirm.')

const completeSession = (booking: Booking) =>
  withSubmit(async () => {
    const result = await bookings.confirmCompletion(booking.id, uid.value)
    ui.info('Completion recorded', result.notices.join(' '))
  }, 'Thanks — we logged your confirmation.')

const disputeSession = () =>
  withSubmit(async () => {
    if (!modal.booking) return
    await bookings.dispute(modal.booking.id, form.claim)
  }, 'Issue raised. A steward will review the session.')

const submitReview = () =>
  withSubmit(async () => {
    if (!modal.booking) return
    const backend = await getBackend()
    await backend.createReview({
      bookingId: modal.booking.id,
      authorUid: uid.value,
      rating: form.rating,
      comment: form.comment,
      tags: [],
    })
  }, 'Review published — thank you for keeping the exchange honest.')
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Bookings</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Confirm requests, join rooms, settle sessions and leave reviews. Token movements appear in your wallet as soon
          as a session is verified.
        </p>
      </div>
      <AppButton to="/skills" variant="secondary" icon="search">Book another session</AppButton>
    </header>

    <nav class="mt-7 flex gap-2 overflow-x-auto pb-1" aria-label="Booking filters">
      <button
        v-for="item in TABS"
        :key="item.id"
        type="button"
        class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition"
        :class="
          tab === item.id
            ? 'border-brand/40 bg-brand/12 text-brand-bright'
            : 'border-line text-muted hover:border-brand/30 hover:text-ink'
        "
        :aria-current="tab === item.id ? 'page' : undefined"
        @click="tab = item.id"
      >
        {{ item.label }}
        <span
          v-if="item.count()"
          class="rounded-full bg-white/8 px-1.5 text-[11px]"
          :class="tab === item.id ? 'text-brand-bright' : 'text-muted'"
        >
          {{ item.count() }}
        </span>
      </button>
    </nav>

    <AppSkeleton v-if="bookings.loading && !bookings.bookings.length" class="mt-8" card :lines="4" />

    <ul v-else-if="visible.length" class="mt-6 space-y-4">
      <li v-for="booking in visible" :key="booking.id">
        <BookingCard
          :booking="booking"
          :current-uid="uid"
          :config="bookings.config"
          @confirm="confirmRequest"
          @decline="(b) => openModal('decline', b)"
          @cancel="(b) => openModal('cancel', b)"
          @reschedule="(b) => openModal('reschedule', b)"
          @complete="completeSession"
          @dispute="(b) => openModal('dispute', b)"
          @review="(b) => openModal('review', b)"
        />
      </li>
    </ul>

    <AppEmptyState
      v-else
      class="mt-8"
      icon="calendar"
      :title="
        tab === 'past'
          ? 'No completed sessions yet'
          : tab === 'requests'
            ? 'No requests waiting'
            : tab === 'cancelled'
              ? 'Nothing cancelled'
              : 'No upcoming sessions'
      "
      :description="
        tab === 'requests'
          ? 'When a member books one of your listings, the request appears here for you to confirm.'
          : 'Book an hour with someone and it will show up here with a join link and a countdown.'
      "
      action-label="Explore skills"
      action-to="/skills"
    />

    <!-- Cancel / decline -->
    <AppModal
      :open="modal.kind === 'cancel' || modal.kind === 'decline'"
      :title="modal.kind === 'cancel' ? 'Cancel this session?' : 'Decline this request?'"
      :description="modal.booking?.skillTitle"
      size="sm"
      @close="closeModal"
    >
      <div class="space-y-4">
        <div v-if="modal.kind === 'cancel' && cancellationPreview" class="rounded-xl border border-line/70 bg-canvas/40 p-4 text-xs">
          <p class="font-medium text-ink">{{ cancellationPreview.explanation }}</p>
          <p class="mt-2 text-muted">
            Refund value: <span class="font-mono text-ink">{{ cancellationPreview.refundTokens }} TT</span> ·
            policy code <span class="font-mono">{{ cancellationPreview.policyCode }}</span>
          </p>
        </div>
        <p v-else class="text-sm text-muted">
          Declining is recorded on the request so the learner knows to try another time.
        </p>
        <AppInput
          v-model="form.reason"
          :label="modal.kind === 'cancel' ? 'Reason (shown to the other member)' : 'Reason (optional)'"
          textarea
          :rows="3"
          placeholder="Please let them know what changed."
        />
        <p v-if="actionError" class="text-xs text-danger" role="alert">{{ actionError }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="closeModal">Keep it</AppButton>
        <AppButton
          variant="danger"
          :loading="submitting"
          @click="modal.kind === 'cancel' ? cancelBooking() : declineRequest(modal.booking!)"
        >
          {{ modal.kind === 'cancel' ? 'Cancel session' : 'Decline request' }}
        </AppButton>
      </template>
    </AppModal>

    <!-- Reschedule -->
    <AppModal
      :open="modal.kind === 'reschedule'"
      title="Propose a new time"
      :description="modal.booking?.skillTitle"
      @close="closeModal"
    >
      <div class="space-y-4">
        <p class="text-sm text-muted">
          Currently booked for {{ modal.booking ? formatDateTimeRange(modal.booking.startAt, modal.booking.endAt) : '' }}.
          The other member has to confirm the new slot, and conflicts are re-checked on the server.
        </p>
        <div class="grid gap-4 sm:grid-cols-3">
          <AppInput v-model="form.startDate" label="Date" type="date" />
          <AppInput v-model="form.startTime" label="Start time" type="time" />
          <div>
            <label class="block text-sm font-medium text-ink" for="reschedule-duration">Length</label>
            <select
              id="reschedule-duration"
              v-model.number="form.durationMinutes"
              class="mt-1.5 w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-ink"
            >
              <option v-for="option in [30, 45, 60, 90, 120]" :key="option" :value="option">
                {{ option }} minutes
              </option>
            </select>
          </div>
        </div>
        <AppInput v-model="form.reason" label="Message" textarea :rows="2" placeholder="Why the change?" />
        <p v-if="actionError" class="text-xs text-danger" role="alert">{{ actionError }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="closeModal">Cancel</AppButton>
        <AppButton :loading="submitting" @click="rescheduleBooking">Propose new time</AppButton>
      </template>
    </AppModal>

    <!-- Dispute -->
    <AppModal
      :open="modal.kind === 'dispute'"
      title="Raise an issue with this session"
      description="A steward reviews the booking, attendance records, notifications and ledger before deciding."
      @close="closeModal"
    >
      <div class="space-y-4">
        <AppInput
          v-model="form.claim"
          label="What happened?"
          textarea
          :rows="4"
          placeholder="Describe the problem factually: what was agreed, what happened, and what outcome you are looking for."
        />
        <div class="rounded-xl border border-warn/30 bg-warn/10 p-3.5 text-xs text-warn">
          Raising an issue does not move tokens. Stewards may refund, release or split a settlement, and the reason is
          recorded on the booking for both members to see.
        </div>
        <p v-if="actionError" class="text-xs text-danger" role="alert">{{ actionError }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="closeModal">Never mind</AppButton>
        <AppButton variant="danger" :loading="submitting" @click="disputeSession">Submit to a steward</AppButton>
      </template>
    </AppModal>

    <!-- Review -->
    <AppModal :open="modal.kind === 'review'" title="How was the session?" :description="modal.booking?.skillTitle" size="sm" @close="closeModal">
      <div class="space-y-4">
        <div>
          <p class="text-sm font-medium text-ink">Your rating</p>
          <div class="mt-2">
            <AppRating :value="form.rating" interactive :size="26" @update:value="form.rating = $event" />
          </div>
        </div>
        <AppInput
          v-model="form.comment"
          label="What should other members know?"
          textarea
          :rows="4"
          maxlength="1200"
          placeholder="Was the session useful? How did the other member teach or learn?"
        />
        <p class="text-xs text-muted">
          Reviews are public on the member’s profile. Keep them constructive — they are what makes the exchange
          trustworthy.
        </p>
        <p v-if="actionError" class="text-xs text-danger" role="alert">{{ actionError }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="closeModal">Later</AppButton>
        <AppButton :loading="submitting" icon="star" @click="submitReview">Publish review</AppButton>
      </template>
    </AppModal>

    <div class="pp-card mt-10 flex items-start gap-3 p-5">
      <AppIcon name="info" :size="18" class="mt-0.5 text-brand-bright" />
      <p class="text-xs leading-relaxed text-muted">
        Sessions settle automatically once the booked window has passed and the platform has verified joint attendance.
        If attendance verification falls below the quorum, each side is asked to confirm — and either side can open a
        dispute instead.
      </p>
    </div>
  </div>
</template>
