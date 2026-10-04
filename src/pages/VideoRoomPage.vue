<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Booking, Room, RoomPresence, UserProfile } from '@shared/domain'
import { canJoinRoom } from '@shared/booking'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore } from '@/stores/bookings'
import { useUiStore } from '@/stores/ui'
import { getBackend } from '@/lib/backend'
import { useWebRTC } from '@/composables/useWebRTC'
import { formatClock, formatDateTimeRange, formatDuration } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppModal from '@/components/ui/AppModal.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const bookings = useBookingStore()
const ui = useUiStore()

const roomId = computed(() => String(route.params.roomId))
const room = ref<Room | null>(null)
const booking = ref<Booking | null>(null)
const peerProfile = ref<UserProfile | null>(null)
const presence = ref<RoomPresence[]>([])
const loading = ref(true)
const joining = ref(false)
const joined = ref(false)
const leaving = ref(false)
const confirmLeave = ref(false)
const elapsedSeconds = ref(0)
const notice = ref<string | null>(null)
const sessionResult = ref<string | null>(null)

const localVideo = ref<HTMLVideoElement | null>(null)
const remoteVideo = ref<HTMLVideoElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let presencePoll: ReturnType<typeof setInterval> | null = null

const uid = computed(() => auth.profile?.uid ?? '')
const isTeacher = computed(() => booking.value?.teacherUid === uid.value)
const peerUid = computed(() => (isTeacher.value ? booking.value?.learnerUid ?? '' : booking.value?.teacherUid ?? ''))
const joinable = computed(() => (booking.value ? canJoinRoom(booking.value) : false))

const webrtc = useWebRTC({
  roomId,
  selfUid: uid,
  peerUid,
  canPublish: computed(() => joinable.value),
})

const peerName = computed(
  () =>
    peerProfile.value?.displayName ??
    booking.value?.participantsSnapshot.find((p) => p.uid === peerUid.value)?.displayName ??
    'the other member',
)

const connectionLabel = computed(() => {
  switch (webrtc.connectionState.value) {
    case 'requesting-media':
      return 'Requesting camera and microphone…'
    case 'waiting-for-peer':
      return `Waiting for ${peerName.value} to join`
    case 'connecting':
      return 'Connecting the call…'
    case 'connected':
      return 'Connected'
    case 'reconnecting':
      return 'Connection interrupted — reconnecting'
    case 'peer-left':
      return `${peerName.value} left the room`
    case 'error':
      return webrtc.error.value ?? 'Connection problem'
    default:
      return joined.value ? 'Ready' : 'Not joined yet'
  }
})

const connectionTone = computed(() => {
  switch (webrtc.connectionState.value) {
    case 'connected':
      return 'brand'
    case 'error':
      return 'danger'
    case 'peer-left':
    case 'reconnecting':
      return 'warn'
    default:
      return 'neutral'
  }
})

/** Presence subscription returned by the backend; released on unmount. */
let stopPresenceWatch: (() => void) | null = null

const peerPresence = computed(() => presence.value.find((p) => p.uid === peerUid.value && !p.leftAt) ?? null)

onMounted(async () => {
  const backend = await getBackend()
  try {
    room.value = await backend.getRoom(roomId.value)
    if (!room.value) {
      loading.value = false
      return
    }
    booking.value = await backend.getBooking(room.value.bookingId)
    if (peerUid.value) peerProfile.value = await backend.getUser(peerUid.value)
    presence.value = await backend.listPresence(roomId.value)
    stopPresenceWatch = backend.watchPresence(roomId.value, (items) => {
      presence.value = items
    })
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not open this room.'
  } finally {
    loading.value = false
  }

  presencePoll = setInterval(async () => {
    const instance = await getBackend()
    presence.value = await instance.listPresence(roomId.value)
  }, 5000)
})

watch(localVideo, (element) => {
  if (element && webrtc.localStream.value) element.srcObject = webrtc.localStream.value
})

watch(
  () => webrtc.localStream.value,
  (stream) => {
    if (localVideo.value) localVideo.value.srcObject = stream
  },
)

watch(
  () => webrtc.remoteStream.value,
  (stream) => {
    if (remoteVideo.value) remoteVideo.value.srcObject = stream
  },
  { immediate: true },
)

/** Session timer counts from the moment the room opens, not from a client claim. */
function startTimer(startIso?: string | null): void {
  const start = startIso ? Date.parse(startIso) : Date.now()
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - start) / 1000))
  }, 1000)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (presencePoll) clearInterval(presencePoll)
  stopPresenceWatch?.()
  void webrtc.stop(true)
})

async function join(): Promise<void> {
  joining.value = true
  notice.value = null
  try {
    if (!booking.value || !room.value) throw new Error('This room is not available.')
    if (!joinable.value) throw new Error('This room opens 15 minutes before the session starts.')
    const backend = await getBackend()
    room.value = await backend.startSession(roomId.value, uid.value)
    await webrtc.start()
    joined.value = true
    startTimer(room.value.session.startedAt)
    presence.value = await backend.listPresence(roomId.value)
  } catch (e) {
    notice.value = e instanceof Error ? e.message : 'Could not join the room.'
  } finally {
    joining.value = false
  }
}

async function leave(andEnd: boolean): Promise<void> {
  leaving.value = true
  try {
    await webrtc.stop(true)
    if (andEnd && booking.value) {
      const result = await bookings.requestSettlement(booking.value.id)
      sessionResult.value = result.notices.join(' ') || 'Session closed.'
      ui.success('Session ended', sessionResult.value)
    }
    confirmLeave.value = false
    joined.value = false
    await router.push('/bookings')
  } catch (e) {
    ui.error('Could not close the session', e instanceof Error ? e.message : undefined)
  } finally {
    leaving.value = false
  }
}

async function endForEveryone(): Promise<void> {
  if (!room.value || !booking.value) return
  leaving.value = true
  try {
    const result = await bookings.requestSettlement(booking.value.id)
    sessionResult.value = result.notices.join(' ')
    ui.success('Session closed and settlement requested', sessionResult.value)
    await webrtc.stop(true)
    await router.push('/bookings')
  } catch (e) {
    ui.error('Could not settle the session', e instanceof Error ? e.message : undefined)
  } finally {
    leaving.value = false
    confirmLeave.value = false
  }
}

function copyRoomLink(): void {
  void navigator.clipboard
    ?.writeText(window.location.href)
    .then(() => ui.success('Room link copied', 'Send it to the other member if they cannot find the room.'))
    .catch(() => ui.warn('Could not copy the link'))
}
</script>

<template>
  <div class="pp-container py-8">
    <!-- Loading -->
    <div v-if="loading" class="pp-card p-10 text-center">
      <p class="text-sm text-muted">Opening the room…</p>
    </div>

    <!-- Room missing -->
    <div v-else-if="!room || !booking" class="pp-card p-10 text-center">
      <span class="mx-auto grid size-12 place-items-center rounded-2xl bg-warn/12 text-warn">
        <AppIcon name="alert" :size="22" />
      </span>
      <h1 class="font-display mt-4 text-lg font-semibold text-ink">This room is not available</h1>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted">
        {{ notice ?? 'The room may have been closed, or the booking was cancelled.' }}
      </p>
      <div class="mt-5">
        <AppButton to="/bookings" icon="arrow-left">Back to bookings</AppButton>
      </div>
    </div>

    <template v-else>
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <AppBadge :tone="connectionTone" :dot="webrtc.connectionState.value === 'connected'">
              {{ connectionLabel }}
            </AppBadge>
            <AppBadge tone="muted">{{ formatDuration(booking.durationMinutes) }} session</AppBadge>
            <AppBadge v-if="room.status === 'open'" tone="cyan">Room open</AppBadge>
            <AppBadge v-else-if="room.status === 'closed'" tone="muted">Room closed</AppBadge>
          </div>
          <h1 class="font-display mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl">{{ booking.skillTitle }}</h1>
          <p class="mt-1 text-sm text-muted">
            {{ isTeacher ? 'You teach' : 'You learn' }} · {{ peerName }} ·
            {{ formatDateTimeRange(booking.startAt, booking.endAt) }}
          </p>
        </div>

        <div class="text-right">
          <p class="font-display text-2xl font-bold text-ink tabular-nums">{{ formatClock(elapsedSeconds) }}</p>
          <p class="text-[11px] text-muted">Session timer</p>
        </div>
      </header>

      <div
        v-if="webrtc.error.value"
        class="mt-5 flex items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/10 p-3.5 text-sm text-warn"
        role="alert"
      >
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <div>
          <p class="font-medium">{{ webrtc.error.value }}</p>
          <p class="mt-1 text-xs">
            You can rejoin the room at any time — attendance segments are recorded automatically, and a failed
            connection never costs anyone tokens.
          </p>
        </div>
      </div>

      <!-- Media problems do not stop the call, so they get their own notice
           rather than the connection error above. -->
      <div
        v-else-if="webrtc.mediaWarning.value"
        class="mt-5 flex items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/10 p-3.5 text-sm text-warn"
        role="status"
      >
        <AppIcon name="mic-off" :size="17" class="mt-0.5" />
        <div>
          <p class="font-medium">{{ webrtc.mediaWarning.value }}</p>
          <p class="mt-1 text-xs">
            The session still counts for the time you are both present — attendance is measured from presence,
            not from whether a camera was on.
          </p>
        </div>
      </div>

      <div class="mt-6 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <!-- Stage -->
        <section class="space-y-4">
          <div class="relative aspect-video overflow-hidden rounded-3xl border border-line/70 bg-[#04101a]">
            <video
              ref="remoteVideo"
              class="size-full object-cover"
              autoplay
              playsinline
              :muted="false"
              :aria-label="`${peerName}'s video`"
            />

            <!-- Waiting overlay -->
            <div
              v-if="!peerPresence"
              class="absolute inset-0 grid place-items-center bg-[#04101a]/85 p-6 text-center backdrop-blur-sm"
            >
              <div>
                <span class="mx-auto grid size-14 animate-[pulse-ring_2.4s_infinite] place-items-center rounded-2xl bg-brand/12 ring-1 ring-brand/30">
                  <AppIcon name="video" :size="24" class="text-brand-bright" />
                </span>
                <h2 class="font-display mt-4 text-base font-semibold text-ink">
                  {{ joined ? `Waiting for ${peerName}` : 'Ready when you are' }}
                </h2>
                <p class="mx-auto mt-2 max-w-sm text-sm text-muted">
                  {{
                    joined
                      ? 'They will appear here as soon as they join. Your presence is already counted.'
                      : 'Joining starts the session timer and records your attendance for settlement.'
                  }}
                </p>
                <div class="mt-5 flex flex-wrap justify-center gap-3">
                  <AppButton v-if="!joined" :loading="joining" :disabled="!joinable" icon="video" @click="join">
                    Join the session
                  </AppButton>
                  <AppButton variant="secondary" size="sm" icon="link" @click="copyRoomLink">Copy room link</AppButton>
                </div>
                <p v-if="!joinable && !joined" class="mt-3 text-xs text-warn">
                  The room opens 15 minutes before the scheduled start.
                </p>
              </div>
            </div>

            <!-- Local picture-in-picture -->
            <div class="absolute right-4 bottom-4 w-32 overflow-hidden rounded-2xl border border-line/70 bg-surface/90 shadow-card sm:w-44">
              <video ref="localVideo" class="aspect-video size-full object-cover" autoplay muted playsinline aria-label="Your camera" />
              <div class="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted">
                <span>You</span>
                <span class="flex items-center gap-1">
                  <AppIcon :name="webrtc.media.value.microphone ? 'mic' : 'mic-off'" :size="11" />
                  <AppIcon :name="webrtc.media.value.camera ? 'video' : 'video-off'" :size="11" />
                </span>
              </div>
            </div>
          </div>

          <!-- Controls -->
          <div class="pp-card flex flex-wrap items-center justify-center gap-2.5 p-4">
            <button
              type="button"
              class="inline-flex size-12 items-center justify-center rounded-2xl border transition"
              :class="webrtc.media.value.microphone ? 'border-line bg-surface-2 text-ink' : 'border-danger/40 bg-danger/15 text-danger'"
              :aria-pressed="webrtc.media.value.microphone"
              :aria-label="webrtc.media.value.microphone ? 'Mute microphone' : 'Unmute microphone'"
              @click="webrtc.toggleMicrophone()"
            >
              <AppIcon :name="webrtc.media.value.microphone ? 'mic' : 'mic-off'" :size="20" />
            </button>
            <button
              type="button"
              class="inline-flex size-12 items-center justify-center rounded-2xl border transition"
              :class="webrtc.media.value.camera ? 'border-line bg-surface-2 text-ink' : 'border-danger/40 bg-danger/15 text-danger'"
              :aria-pressed="webrtc.media.value.camera"
              :aria-label="webrtc.media.value.camera ? 'Turn camera off' : 'Turn camera on'"
              @click="webrtc.toggleCamera()"
            >
              <AppIcon :name="webrtc.media.value.camera ? 'video' : 'video-off'" :size="20" />
            </button>
            <button
              type="button"
              class="inline-flex size-12 items-center justify-center rounded-2xl border transition"
              :class="webrtc.media.value.screen ? 'border-cyan/45 bg-cyan/15 text-cyan' : 'border-line bg-surface-2 text-ink'"
              :aria-pressed="webrtc.media.value.screen"
              aria-label="Share your screen"
              @click="webrtc.toggleScreenShare()"
            >
              <AppIcon name="screen" :size="20" />
            </button>
            <button
              type="button"
              class="inline-flex h-12 items-center gap-2 rounded-2xl border border-danger/40 bg-danger/15 px-5 text-sm font-medium text-danger transition hover:bg-danger/25"
              @click="confirmLeave = true"
            >
              <AppIcon name="phone-off" :size="18" />
              Leave
            </button>
          </div>

          <p class="text-center text-xs text-muted">
            Attendance is recorded as time-stamped segments for both members. Tokens settle automatically once the
            session window has passed and both attendances are verified.
          </p>
        </section>

        <!-- Side panel -->
        <aside class="space-y-4">
          <div class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">In this room</h2>
            <ul class="mt-3 space-y-3">
              <li
                v-for="person in presence"
                :key="person.uid"
                class="flex items-center gap-3"
              >
                <AppAvatar :display-name="person.displayName" :seed="person.avatarSeed" :size="34" :online="!person.leftAt" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm text-ink">
                    {{ person.displayName }}<span v-if="person.uid === uid" class="text-muted"> (you)</span>
                  </p>
                  <p class="text-[11px] text-muted">
                    {{ person.role }} · joined {{ new Date(person.joinedAt).toLocaleTimeString() }}
                  </p>
                </div>
                <span class="flex items-center gap-1 text-muted">
                  <AppIcon :name="person.media.microphone ? 'mic' : 'mic-off'" :size="13" />
                  <AppIcon :name="person.media.camera ? 'video' : 'video-off'" :size="13" />
                  <AppIcon v-if="person.media.screen" name="screen" :size="13" class="text-cyan" />
                </span>
              </li>
            </ul>
            <p v-if="presence.length <= 1" class="mt-3 text-xs text-muted">
              Nobody else has joined yet. The other member is notified automatically.
            </p>
          </div>

          <div class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">Session details</h2>
            <dl class="mt-3 space-y-2.5 text-xs">
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Booking</dt>
                <dd class="font-mono text-ink">{{ booking.id }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Room</dt>
                <dd class="font-mono text-ink">{{ room.id }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Scheduled</dt>
                <dd class="text-right text-ink">{{ formatDateTimeRange(booking.startAt, booking.endAt) }}</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Token value</dt>
                <dd class="font-mono text-brand-bright">{{ booking.tokenAmount }} TT</dd>
              </div>
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Your role</dt>
                <dd class="text-ink">{{ isTeacher ? 'Teacher (earns)' : 'Learner (spends)' }}</dd>
              </div>
              <div v-if="booking.completion.verifiedMinutes" class="flex items-center justify-between gap-3">
                <dt class="text-muted">Verified attendance</dt>
                <dd class="text-ink">{{ booking.completion.verifiedMinutes }} min</dd>
              </div>
            </dl>
          </div>

          <div v-if="sessionResult" class="pp-card border-brand/30 p-5">
            <p class="text-xs font-medium text-brand-bright">Settlement</p>
            <p class="mt-1.5 text-xs leading-relaxed text-muted">{{ sessionResult }}</p>
          </div>

          <div class="pp-card p-5">
            <p class="flex items-center gap-2 text-xs font-medium text-ink">
              <AppIcon name="shield" :size="15" class="text-brand-bright" /> Peer-to-peer and private
            </p>
            <p class="mt-2 text-xs leading-relaxed text-muted">
              Your audio and video travel directly between the two of you. PeerPulse only relays the small negotiation
              messages, and those records are readable by nobody else.
            </p>
            <AppButton variant="ghost" size="sm" class="mt-3" icon="link" @click="copyRoomLink">
              Copy room link
            </AppButton>
          </div>
        </aside>
      </div>
    </template>

    <!-- Leave confirmation -->
    <AppModal
      :open="confirmLeave"
      title="Leave this session?"
      description="Your attendance up to this point is already recorded."
      size="sm"
      @close="confirmLeave = false"
    >
      <div class="space-y-3 text-sm text-muted">
        <p>
          Leaving only closes your own connection. The session keeps its attendance record, and settlement happens when
          the booked window ends — or immediately if you end it for both of you.
        </p>
        <p class="rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          Ending the session for both members stops the room and asks the server to settle the tokens now, using the
          attendance both sides recorded.
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="confirmLeave = false">Stay</AppButton>
        <AppButton variant="secondary" :loading="leaving" icon="logout" @click="leave(false)">Leave quietly</AppButton>
        <AppButton :loading="leaving" icon="check" @click="endForEveryone">End session for both</AppButton>
      </template>
    </AppModal>
  </div>
</template>
