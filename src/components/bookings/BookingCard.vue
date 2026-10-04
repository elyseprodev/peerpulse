<script setup lang="ts">
import { computed } from 'vue'
import type { Booking, PlatformConfig, UserProfile } from '@shared/domain'
import { bookingLifecycle, canJoinRoom } from '@shared/booking'
import { categoryName } from '@/lib/catalog'
import { formatDateTimeRange, formatDuration, formatRelative } from '@/lib/format'
import AppAvatar from '../ui/AppAvatar.vue'
import AppBadge from '../ui/AppBadge.vue'
import AppButton from '../ui/AppButton.vue'

const props = defineProps<{
  booking: Booking
  currentUid: string
  config?: PlatformConfig | null
  /** Members keyed by uid for avatar/name lookup. */
  people?: Record<string, UserProfile>
}>()

const emit = defineEmits<{
  confirm: [booking: Booking]
  decline: [booking: Booking]
  cancel: [booking: Booking]
  reschedule: [booking: Booking]
  complete: [booking: Booking]
  dispute: [booking: Booking]
  review: [booking: Booking]
}>()

const isTeacher = computed(() => props.booking.teacherUid === props.currentUid)
const counterpartyUid = computed(() => (isTeacher.value ? props.booking.learnerUid : props.booking.teacherUid))
const counterparty = computed(() => props.people?.[counterpartyUid.value] ?? null)
const counterpartyName = computed(
  () =>
    counterparty.value?.displayName ??
    props.booking.participantsSnapshot.find((p) => p.uid === counterpartyUid.value)?.displayName ??
    'PeerPulse member',
)
const lifecycle = computed(() => bookingLifecycle(props.booking.status))
const canJoin = computed(() => canJoinRoom(props.booking))
const joinOpensIn = computed(() => {
  const ms = Date.parse(props.booking.startAt) - 15 * 60_000 - Date.now()
  return ms > 0 ? formatRelative(new Date(Date.now() + ms).toISOString()) : 'now'
})
const awaitingMyConfirmation = computed(
  () => props.booking.status === 'requested' && isTeacher.value,
)
const canComplete = computed(
  () =>
    props.booking.status === 'in_progress' &&
    !((isTeacher.value && props.booking.completion.teacherConfirmedAt) ||
      (!isTeacher.value && props.booking.completion.learnerConfirmedAt)),
)
const canReview = computed(() => props.booking.status === 'completed')

const STATUS_TONES: Record<string, 'brand' | 'neutral' | 'cyan' | 'warn' | 'danger' | 'muted'> = {
  requested: 'warn',
  confirmed: 'brand',
  in_progress: 'cyan',
  completed: 'brand',
  cancelled: 'muted',
  declined: 'muted',
  no_show: 'danger',
  disputed: 'danger',
}
</script>

<template>
  <article class="pp-card overflow-hidden p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <AppBadge :tone="STATUS_TONES[booking.status] ?? 'neutral'" :dot="booking.status === 'in_progress'">
            {{ lifecycle.label }}
          </AppBadge>
          <AppBadge tone="muted">{{ categoryName(booking.categoryId) }}</AppBadge>
          <AppBadge v-if="booking.settlement.state === 'settled'" tone="brand">Settled</AppBadge>
          <AppBadge v-else-if="booking.settlement.state === 'escrowed'" tone="cyan">Tokens reserved</AppBadge>
          <AppBadge v-else-if="booking.settlement.state === 'partial'" tone="warn">Partially settled</AppBadge>
          <AppBadge v-else-if="booking.settlement.state === 'blocked'" tone="danger">Needs review</AppBadge>
        </div>
        <h3 class="font-display mt-2.5 text-base font-semibold text-ink">{{ booking.skillTitle }}</h3>
        <p class="mt-1 text-xs text-muted">
          {{ isTeacher ? 'You teach' : 'You learn' }} ·
          {{ isTeacher ? counterpartyName : counterpartyName }}
        </p>
      </div>

      <div class="text-right">
        <p class="font-display text-lg font-bold text-brand-bright">
          {{ isTeacher ? '+' : '−' }}{{ booking.tokenAmount }} TT
        </p>
        <p class="text-[11px] text-muted">{{ booking.durationMinutes }} min session</p>
      </div>
    </div>

    <dl class="mt-4 grid gap-3 sm:grid-cols-2">
      <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
        <dt class="text-[11px] tracking-wide text-muted uppercase">Schedule</dt>
        <dd class="mt-1 text-sm text-ink">{{ formatDateTimeRange(booking.startAt, booking.endAt) }}</dd>
        <dd class="text-[11px] text-muted">
          {{ formatDuration(booking.durationMinutes) }} · {{ booking.timezone }}
        </dd>
      </div>
      <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
        <dt class="text-[11px] tracking-wide text-muted uppercase">
          {{ isTeacher ? 'Learner' : 'Teacher' }}
        </dt>
        <dd class="mt-1 flex items-center gap-2">
          <AppAvatar :display-name="counterpartyName" :seed="counterparty?.avatarSeed ?? counterpartyUid" :photo-url="counterparty?.photoURL" :size="26" />
          <RouterLink :to="`/members/${counterpartyUid}`" class="text-sm text-ink hover:text-brand-bright">
            {{ counterpartyName }}
          </RouterLink>
        </dd>
        <dd v-if="booking.settlement.note && booking.settlement.state === 'blocked'" class="mt-1 text-[11px] text-warn">
          {{ booking.settlement.note }}
        </dd>
      </div>
    </dl>

    <p v-if="booking.learnerNote && isTeacher" class="mt-3 rounded-xl border border-line/60 bg-surface-2/50 p-3 text-xs text-muted">
      <span class="font-medium text-ink">Learner note:</span> {{ booking.learnerNote }}
    </p>
    <p v-if="booking.cancellation" class="mt-3 text-xs text-muted">
      Cancelled {{ formatRelative(booking.cancellation.at) }} · {{ booking.cancellation.reason }}
    </p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <AppButton v-if="canJoin" :to="`/rooms/${booking.roomId}`" size="sm" icon="video">
        Join video room
      </AppButton>
      <AppButton v-else-if="booking.status === 'confirmed'" variant="secondary" size="sm" icon="clock" disabled>
        Room opens {{ joinOpensIn }}
      </AppButton>

      <template v-if="awaitingMyConfirmation">
        <AppButton size="sm" icon="check" @click="emit('confirm', booking)">Confirm</AppButton>
        <AppButton variant="secondary" size="sm" icon="close" @click="emit('decline', booking)">Decline</AppButton>
      </template>

      <AppButton
        v-if="['requested', 'confirmed'].includes(booking.status)"
        variant="ghost"
        size="sm"
        icon="calendar"
        @click="emit('reschedule', booking)"
      >
        Reschedule
      </AppButton>

      <AppButton v-if="canComplete" size="sm" variant="soft" icon="check" @click="emit('complete', booking)">
        Mark complete
      </AppButton>

      <AppButton v-if="canReview" variant="secondary" size="sm" icon="star" @click="emit('review', booking)">
        Leave a review
      </AppButton>

      <AppButton
        v-if="['requested', 'confirmed', 'in_progress'].includes(booking.status)"
        variant="danger"
        size="sm"
        icon="close"
        @click="emit('cancel', booking)"
      >
        Cancel
      </AppButton>

      <AppButton
        v-if="['completed', 'disputed'].includes(booking.status) && booking.settlement.state !== 'refunded'"
        variant="ghost"
        size="sm"
        icon="flag"
        @click="emit('dispute', booking)"
      >
        Raise an issue
      </AppButton>
    </div>
  </article>
</template>
