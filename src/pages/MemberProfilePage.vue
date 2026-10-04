<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { Review, SkillListing, UserProfile } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore } from '@/stores/bookings'
import { useSkillsStore } from '@/stores/skills'
import { getBackend } from '@/lib/backend'
import { categoryName, LANGUAGE_OPTIONS } from '@/lib/catalog'
import { formatDuration, formatHours, formatRelative } from '@/lib/format'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppRating from '@/components/ui/AppRating.vue'
import AppStat from '@/components/ui/AppStat.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import SkillCard from '@/components/skills/SkillCard.vue'

const route = useRoute()
const auth = useAuthStore()
const skills = useSkillsStore()
const bookings = useBookingStore()

const member = ref<UserProfile | null>(null)
const listings = ref<SkillListing[]>([])
const reviews = ref<Review[]>([])
const reviewers = ref<Record<string, string>>({})
const loading = ref(true)

const uid = computed(() => String(route.params.uid))
const isSelf = computed(() => auth.profile?.uid === uid.value)
const isPrivate = computed(
  () =>
    Boolean(member.value) &&
    !isSelf.value &&
    (member.value!.privacy.profileVisibility === 'private' ||
      (member.value!.privacy.profileVisibility === 'members' && !auth.isAuthenticated)),
)
const ratingValue = computed(() => member.value?.stats.ratingSum ?? 0)
const ratingCount = computed(() => member.value?.stats.reviewCount ?? 0)

onMounted(async () => {
  const backend = await getBackend()
  try {
    const [profile, allSkills, allReviews, platformConfig] = await Promise.all([
      backend.getUser(uid.value),
      skills.loadByOwner(uid.value),
      backend.listReviewsForUser(uid.value),
      backend.getPlatformConfig(),
    ])
    member.value = profile
    listings.value = allSkills.filter((s) => s.status === 'published')
    reviews.value = allReviews
    bookings.config = platformConfig
    const authors = await backend.getUsers([...new Set(allReviews.map((r) => r.authorUid))])
    authors.forEach((p) => {
      reviewers.value[p.uid] = p.displayName
    })
  } finally {
    loading.value = false
  }
})

const languageLabels = computed(() =>
  (member.value?.languages ?? []).map((code) => LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ?? code.toUpperCase()).join(', '),
)

const learnGoals = computed(() => member.value?.learnCategories.map(categoryName) ?? [])
const teachGoals = computed(() => member.value?.teachCategories.map(categoryName) ?? [])

const availabilitySummary = computed(() => {
  const blocks = (member.value?.availability ?? []).slice().sort((a, b) => a.weekday - b.weekday)
  return blocks.map((b) => ({
    label: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][b.weekday],
    value: `${b.start} – ${b.end}`,
  }))
})
</script>

<template>
  <div class="pp-container py-10">
    <AppSkeleton v-if="loading" card :lines="6" />

    <AppEmptyState
      v-else-if="!member"
      icon="users"
      title="Member not found"
      description="The profile may have been deleted or the link may be incorrect."
      action-label="Browse members"
      action-to="/members"
    />

    <AppEmptyState
      v-else-if="isPrivate"
      icon="lock"
      title="This profile is private"
      :description="`${member.displayName} has chosen to keep their profile out of public view.`"
      action-label="Browse other members"
      action-to="/members"
    />

    <template v-else>
      <!-- Profile header -->
      <header class="pp-card overflow-hidden">
        <div class="h-24 bg-gradient-to-r from-brand/25 via-cyan/15 to-transparent" aria-hidden="true" />
        <div class="flex flex-wrap items-end gap-5 px-6 pb-6">
          <div class="-mt-10">
            <AppAvatar
              :display-name="member.displayName"
              :seed="member.avatarSeed"
              :photo-url="member.photoURL"
              :size="96"
              ring
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="font-display text-2xl font-bold tracking-tight text-ink">{{ member.displayName }}</h1>
              <AppBadge v-if="member.role === 'admin'" tone="cyan">Steward</AppBadge>
              <AppBadge v-if="member.status !== 'active'" tone="danger">{{ member.status }}</AppBadge>
            </div>
            <p class="mt-1 text-sm text-muted">{{ member.headline || 'PeerPulse member' }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
              <span v-if="member.location" class="inline-flex items-center gap-1.5">
                <AppIcon name="map-pin" :size="13" /> {{ member.location }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <AppIcon name="globe" :size="13" /> {{ languageLabels }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <AppIcon name="clock" :size="13" /> Joined {{ formatRelative(member.createdAt) }}
              </span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <AppButton v-if="isSelf" to="/profile" variant="secondary" icon="edit">Edit profile</AppButton>
            <template v-else-if="member.privacy.allowDirectRequests">
              <AppButton to="/skills" icon="calendar">Book a session</AppButton>
            </template>
          </div>
        </div>
      </header>

      <!-- Stats -->
      <section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Member activity">
        <AppStat label="Sessions completed" :value="member.stats.sessionsCompleted" hint="Teaching and learning" icon="check" />
        <AppStat label="Teaching hours" :value="`${member.stats.teachingHours}h`" hint="Time given to others" icon="clock" tone="cyan" />
        <AppStat label="Tokens earned" :value="member.stats.tokensEarned" hint="Lifetime" icon="tokens" tone="brand" />
        <AppStat label="Learning hours" :value="formatHours(member.stats.learningHours * 60)" hint="Time received" icon="book" tone="warn" />
      </section>

      <div class="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div class="space-y-6">
          <!-- Bio -->
          <section class="pp-card p-6">
            <h2 class="font-display text-lg font-semibold text-ink">About</h2>
            <p class="mt-3 text-sm leading-relaxed whitespace-pre-line text-muted">
              {{ member.bio || 'This member has not written a bio yet.' }}
            </p>

            <div v-if="member.interests.length" class="mt-5">
              <p class="text-xs tracking-wide text-muted uppercase">Interests</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <AppBadge v-for="interest in member.interests" :key="interest" tone="muted">{{ interest }}</AppBadge>
              </div>
            </div>
          </section>

          <!-- Listings -->
          <section>
            <div class="flex items-center justify-between">
              <h2 class="font-display text-lg font-semibold text-ink">Skills offered</h2>
              <AppBadge tone="brand">{{ listings.length }}</AppBadge>
            </div>
            <div v-if="listings.length" class="mt-4 grid gap-5 sm:grid-cols-2">
              <SkillCard
                v-for="listing in listings"
                :key="listing.id"
                :skill="listing"
                :owner="member"
                :config="bookings.config"
              />
            </div>
            <p v-else class="mt-4 text-sm text-muted">
              {{ isSelf ? 'You have not published a listing yet.' : `${member.displayName} has not published a listing yet.` }}
            </p>
          </section>

          <!-- Reviews -->
          <section class="pp-card p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display text-lg font-semibold text-ink">Reviews</h2>
              <AppRating :value="ratingValue" :count="ratingCount" />
            </div>
            <ul v-if="reviews.length" class="mt-5 space-y-4">
              <li v-for="review in reviews" :key="review.id" class="rounded-2xl border border-line/70 bg-canvas/30 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-3">
                    <AppAvatar :display-name="reviewers[review.authorUid] ?? 'PeerPulse member'" :seed="review.authorUid" :size="34" />
                    <div>
                      <p class="text-sm font-medium text-ink">{{ reviewers[review.authorUid] ?? 'PeerPulse member' }}</p>
                      <p class="text-[11px] text-muted">
                        {{ review.authorRole === 'teacher' ? 'As teacher' : 'As learner' }} · {{ formatRelative(review.createdAt) }}
                      </p>
                    </div>
                  </div>
                  <AppRating :value="review.rating" :size="13" />
                </div>
                <p class="mt-3 text-sm leading-relaxed text-muted">{{ review.comment }}</p>
              </li>
            </ul>
            <p v-else class="mt-4 text-sm text-muted">No reviews yet.</p>
          </section>
        </div>

        <aside class="space-y-5">
          <section class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">Teaches</h2>
            <div class="mt-3 flex flex-wrap gap-2">
              <AppBadge v-for="goal in teachGoals" :key="goal" tone="brand">{{ goal }}</AppBadge>
              <span v-if="!teachGoals.length" class="text-xs text-muted">No categories selected yet.</span>
            </div>
            <h2 class="font-display mt-5 text-sm font-semibold text-ink">Wants to learn</h2>
            <div class="mt-3 flex flex-wrap gap-2">
              <AppBadge v-for="goal in learnGoals" :key="goal" tone="cyan">{{ goal }}</AppBadge>
              <span v-if="!learnGoals.length" class="text-xs text-muted">No learning goals shared.</span>
            </div>
          </section>

          <section v-if="member.privacy.showAvailability && availabilitySummary.length" class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">Availability</h2>
            <dl class="mt-3 space-y-2 text-xs">
              <div v-for="slot in availabilitySummary" :key="slot.label + slot.value" class="flex items-center justify-between gap-3">
                <dt class="text-muted">{{ slot.label }}</dt>
                <dd class="text-ink">{{ slot.value }}</dd>
              </div>
            </dl>
            <p class="mt-3 text-[11px] text-muted">
              Shown in {{ member.timezone }}. Slots convert automatically when you book.
            </p>
          </section>

          <section class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">Session history</h2>
            <ul class="mt-3 space-y-2 text-xs text-muted">
              <li class="flex items-center justify-between">
                <span>Completed sessions</span><span class="text-ink">{{ member.stats.sessionsCompleted }}</span>
              </li>
              <li class="flex items-center justify-between">
                <span>As teacher</span><span class="text-ink">{{ member.stats.sessionsTaught }}</span>
              </li>
              <li class="flex items-center justify-between">
                <span>Average rating</span>
                <span class="text-ink">{{ ratingCount ? (ratingValue / ratingCount).toFixed(1) : '—' }}</span>
              </li>
              <li class="flex items-center justify-between">
                <span>Avg. session length</span>
                <span class="text-ink">
                  {{ formatDuration(listings.length ? Math.round(listings.reduce((s, l) => s + l.durationMinutes, 0) / listings.length) : 60) }}
                </span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
