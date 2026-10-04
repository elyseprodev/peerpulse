<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { Review } from '@shared/domain'
import { computeTokenAmount, explainTokenAmount } from '@shared/tokenPolicy'
import { DEFAULT_PLATFORM_CONFIG } from '@shared/tokenPolicy'
import { useAuthStore } from '@/stores/auth'
import { useSkillsStore } from '@/stores/skills'
import { useBookingStore } from '@/stores/bookings'
import { useUiStore } from '@/stores/ui'
import { getBackend } from '@/lib/backend'
import { categoryAccent, categoryName, SKILL_LEVEL_LABELS, SESSION_FORMAT_LABELS } from '@/lib/catalog'
import { formatDuration, formatHours, formatRelative } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppRating from '@/components/ui/AppRating.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SkillCard from '@/components/skills/SkillCard.vue'
import BookingRequestModal from '@/components/bookings/BookingRequestModal.vue'

const route = useRoute()
const auth = useAuthStore()
const skills = useSkillsStore()
const bookings = useBookingStore()
const ui = useUiStore()

const reviews = ref<Review[]>([])
const reviewers = ref<Record<string, string>>({})
const bookingOpen = ref(false)
const reportOpen = ref(false)
const reportReason = ref<'spam' | 'harassment' | 'inappropriate' | 'misrepresentation' | 'other'>('spam')
const reportDetails = ref('')
const submitting = ref(false)
const bookingError = ref<string | null>(null)
const alsoLike = ref<Awaited<ReturnType<typeof skills.loadByOwner>>>([])

const skillId = computed(() => String(route.params.id))
const skill = computed(() => skills.current)
const owner = computed(() => (skill.value ? skills.ownerOf(skill.value) : null))
const config = computed(() => bookings.config ?? DEFAULT_PLATFORM_CONFIG)
const tokenCost = computed(() => (skill.value ? computeTokenAmount(skill.value.durationMinutes, config.value) : 0))
const isOwner = computed(() => owner.value?.uid === auth.profile?.uid)
const myBooking = computed(() =>
  bookings.bookings.find(
    (b) => b.skillId === skill.value?.id && ['requested', 'confirmed', 'in_progress'].includes(b.status),
  ),
)

onMounted(async () => {
  const backend = await getBackend()
  await Promise.all([skills.loadOne(skillId.value), bookings.ensureConfig()])
  if (auth.profile) await bookings.load(auth.profile.uid)
  reviews.value = await backend.listReviewsForSkill(skillId.value)
  const authors = await backend.getUsers([...new Set(reviews.value.map((r) => r.authorUid))])
  authors.forEach((profile) => {
    reviewers.value[profile.uid] = profile.displayName
  })
  if (skill.value) alsoLike.value = (await skills.loadByOwner(skill.value.ownerUid)).filter((s) => s.id !== skill.value!.id)
})

async function submitBooking(payload: { startAt: string; endAt: string; timezone: string; note: string }): Promise<void> {
  if (!skill.value) return
  submitting.value = true
  bookingError.value = null
  try {
    const booking = await bookings.create({
      skillId: skill.value.id,
      startAt: payload.startAt,
      endAt: payload.endAt,
      timezone: payload.timezone,
      learnerNote: payload.note,
    })
    bookingOpen.value = false
    ui.success(
      booking.status === 'confirmed' ? 'Session confirmed' : 'Request sent',
      booking.status === 'confirmed'
        ? 'The room opens 15 minutes before your session.'
        : `${owner.value?.displayName ?? 'The teacher'} will confirm shortly — you will get a notification.`,
    )
  } catch (e) {
    bookingError.value = e instanceof Error ? e.message : 'Could not create the booking.'
  } finally {
    submitting.value = false
  }
}

async function submitReport(): Promise<void> {
  if (!skill.value) return
  submitting.value = true
  try {
    const backend = await getBackend()
    await backend.createReport({
      reporterUid: auth.profile!.uid,
      targetType: 'skill',
      targetId: skill.value.id,
      targetPath: `skills/${skill.value.id}`,
      targetLabel: skill.value.title,
      reason: reportReason.value,
      details: reportDetails.value,
    })
    reportOpen.value = false
    reportDetails.value = ''
    ui.success('Report sent', 'A steward will review this listing. Thank you for keeping the exchange safe.')
  } catch (e) {
    ui.error('Could not send the report', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pp-container py-10">
    <AppSkeleton v-if="skills.loading && !skill" card :lines="6" />

    <AppEmptyState
      v-else-if="!skill"
      icon="search"
      title="That listing could not be found"
      description="It may have been removed by its owner or by a moderator."
      action-label="Back to explore"
      action-to="/skills"
    />

    <template v-else>
      <nav class="flex items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
        <RouterLink to="/skills" class="hover:text-brand-bright">Skills</RouterLink>
        <AppIcon name="chevron-right" :size="12" />
        <RouterLink :to="`/skills?category=${skill.categoryId}`" class="hover:text-brand-bright">
          {{ categoryName(skill.categoryId) }}
        </RouterLink>
        <AppIcon name="chevron-right" :size="12" />
        <span class="truncate text-ink">{{ skill.title }}</span>
      </nav>

      <div class="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div class="space-y-6">
          <!-- Header card -->
          <article class="pp-card overflow-hidden">
            <div class="h-1.5 w-full" :style="{ background: `linear-gradient(90deg, ${categoryAccent(skill.categoryId)}, transparent)` }" />
            <div class="p-6 sm:p-7">
              <div class="flex flex-wrap items-center gap-2">
                <AppBadge tone="brand">{{ categoryName(skill.categoryId) }}</AppBadge>
                <AppBadge tone="muted">{{ SKILL_LEVEL_LABELS[skill.level] }}</AppBadge>
                <AppBadge tone="cyan">{{ SESSION_FORMAT_LABELS[skill.format]?.label ?? skill.format }}</AppBadge>
                <AppBadge v-if="skill.status !== 'published'" tone="warn">{{ skill.status }}</AppBadge>
              </div>

              <h1 class="font-display mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{{ skill.title }}</h1>

              <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                <span class="inline-flex items-center gap-1.5">
                  <AppIcon name="clock" :size="14" /> {{ formatDuration(skill.durationMinutes) }} per session
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <AppIcon name="globe" :size="14" /> {{ skill.languages.join(', ').toUpperCase() }}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <AppIcon name="check" :size="14" /> {{ skill.completedCount }} completed sessions
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <AppIcon name="edit" :size="14" /> updated {{ formatRelative(skill.updatedAt) }}
                </span>
              </div>

              <p class="mt-5 text-sm leading-relaxed whitespace-pre-line text-muted">{{ skill.description }}</p>

              <div v-if="skill.outcomes.length" class="mt-6">
                <h2 class="font-display text-sm font-semibold text-ink">What you will walk away with</h2>
                <ul class="mt-3 grid gap-2 sm:grid-cols-2">
                  <li v-for="outcome in skill.outcomes" :key="outcome" class="flex items-start gap-2 text-sm text-muted">
                    <AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" />
                    {{ outcome }}
                  </li>
                </ul>
              </div>

              <div v-if="skill.tags.length" class="mt-6 flex flex-wrap gap-2">
                <AppBadge v-for="tag in skill.tags" :key="tag" tone="muted">#{{ tag }}</AppBadge>
              </div>
            </div>
          </article>

          <!-- Reviews -->
          <section class="pp-card p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display text-lg font-semibold text-ink">Reviews</h2>
              <AppRating :value="skill.ratingSum" :count="skill.reviewCount" />
            </div>

            <ul v-if="reviews.length" class="mt-5 space-y-4">
              <li v-for="review in reviews" :key="review.id" class="rounded-2xl border border-line/70 bg-canvas/30 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <AppAvatar :display-name="reviewers[review.authorUid] ?? 'PeerPulse member'" :seed="review.authorUid" :size="34" />
                    <div>
                      <p class="text-sm font-medium text-ink">{{ reviewers[review.authorUid] ?? 'PeerPulse member' }}</p>
                      <p class="text-[11px] text-muted">{{ formatRelative(review.createdAt) }}</p>
                    </div>
                  </div>
                  <AppRating :value="review.rating" :size="13" />
                </div>
                <p class="mt-3 text-sm leading-relaxed text-muted">{{ review.comment }}</p>
                <div v-if="review.responseText" class="mt-3 rounded-xl border border-brand/25 bg-brand/8 p-3">
                  <p class="text-[11px] font-medium text-brand-bright">Response from the teacher</p>
                  <p class="mt-1 text-xs text-muted">{{ review.responseText }}</p>
                </div>
              </li>
            </ul>
            <p v-else class="mt-4 text-sm text-muted">
              No reviews yet. Session reviews are only possible after a completed, settled booking — which is what keeps
              them trustworthy.
            </p>
          </section>

          <!-- Owner's other listings -->
          <section v-if="alsoLike.length">
            <h2 class="font-display text-lg font-semibold text-ink">More from {{ owner?.displayName }}</h2>
            <div class="mt-4 grid gap-5 sm:grid-cols-2">
              <SkillCard v-for="item in alsoLike" :key="item.id" :skill="item" :owner="owner" :config="config" />
            </div>
          </section>
        </div>

        <!-- Booking sidebar -->
        <aside class="space-y-5">
          <div class="pp-card sticky top-20 p-6">
            <div class="flex items-baseline justify-between">
              <div>
                <p class="text-xs tracking-wide text-muted uppercase">Session cost</p>
                <p class="font-display mt-1 text-3xl font-bold text-brand-bright">{{ tokenCost }} TT</p>
              </div>
              <p class="text-xs text-muted">{{ formatDuration(skill.durationMinutes) }}</p>
            </div>
            <p class="mt-2 text-[11px] text-muted">
              {{ explainTokenAmount(skill.durationMinutes, config) }}
            </p>

            <div class="mt-5 space-y-2.5">
              <AppButton
                v-if="!isOwner"
                block
                size="lg"
                icon="calendar"
                :disabled="!auth.isAuthenticated"
                @click="bookingOpen = true"
              >
                {{ myBooking ? 'You already have a session booked' : 'Request a session' }}
              </AppButton>
              <AppButton v-else block size="lg" variant="secondary" to="/profile" icon="edit">
                Edit your listing
              </AppButton>
              <AppButton
                v-if="!auth.isAuthenticated"
                block
                variant="secondary"
                to="/signin"
                icon-right="arrow-right"
              >
                Sign in to book
              </AppButton>
              <p v-if="myBooking" class="rounded-xl border border-brand/25 bg-brand/8 p-3 text-xs text-muted">
                You have a {{ myBooking.status }} booking on
                {{ new Date(myBooking.startAt).toLocaleString() }}.
                <RouterLink to="/bookings" class="text-brand-bright hover:underline">View it</RouterLink>.
              </p>
            </div>

            <div class="pp-hairline mt-6 space-y-3 pt-5">
              <p class="text-xs tracking-wide text-muted uppercase">Your teacher</p>
              <RouterLink :to="`/members/${skill.ownerUid}`" class="flex items-center gap-3">
                <AppAvatar
                  :display-name="owner?.displayName ?? 'PeerPulse member'"
                  :seed="owner?.avatarSeed ?? skill.ownerUid"
                  :photo-url="owner?.photoURL"
                  :size="46"
                  ring
                />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-ink">{{ owner?.displayName ?? 'PeerPulse member' }}</span>
                  <span class="block truncate text-xs text-muted">{{ owner?.headline || 'PeerPulse member' }}</span>
                </span>
              </RouterLink>
              <p v-if="owner?.location" class="flex items-center gap-1.5 text-xs text-muted">
                <AppIcon name="map-pin" :size="13" /> {{ owner.location }}
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <AppBadge tone="brand">{{ owner?.stats.sessionsTaught ?? 0 }} taught</AppBadge>
                <AppBadge tone="muted">{{ formatHours((owner?.stats.learningHours ?? 0) * 60) }} learned</AppBadge>
                <AppBadge v-if="owner?.languages.length" tone="cyan">{{ owner.languages.join(' · ').toUpperCase() }}</AppBadge>
              </div>
            </div>

            <div v-if="owner?.availability.length" class="pp-hairline mt-5 pt-5">
              <p class="text-xs tracking-wide text-muted uppercase">Typical availability</p>
              <ul class="mt-2 space-y-1 text-xs text-muted">
                <li v-for="block in owner.availability.slice(0, 4)" :key="`${block.weekday}-${block.start}`">
                  {{ ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][block.weekday] }} · {{ block.start }}–{{ block.end }}
                </li>
              </ul>
            </div>

            <div class="pp-hairline mt-5 pt-5">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-[11px] text-muted transition hover:text-danger"
                @click="reportOpen = true"
              >
                <AppIcon name="flag" :size="13" /> Report this listing
              </button>
            </div>
          </div>
        </aside>
      </div>
    </template>

    <BookingRequestModal
      :open="bookingOpen"
      :skill="skill"
      :teacher="owner"
      :config="config"
      :my-bookings="bookings.bookings"
      :submitting="submitting"
      :error="bookingError"
      @close="bookingOpen = false"
      @submit="submitBooking"
    />

    <AppModal :open="reportOpen" title="Report this listing" size="sm" @close="reportOpen = false">
      <div class="space-y-4">
        <div>
          <label for="report-reason" class="block text-sm font-medium text-ink">Reason</label>
          <select
            id="report-reason"
            v-model="reportReason"
            class="mt-1.5 w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-ink"
          >
            <option value="spam">Spam or advertising</option>
            <option value="harassment">Harassment</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="misrepresentation">Misrepresentation</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <AppInput v-model="reportDetails" label="What should we look at?" textarea :rows="3" maxlength="800" />
        <p class="text-xs text-muted">
          Reports are confidential. A steward reviews the listing and can hide it while investigating.
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="reportOpen = false">Cancel</AppButton>
        <AppButton variant="danger" :loading="submitting" @click="submitReport">Send report</AppButton>
      </template>
    </AppModal>
  </div>
</template>
