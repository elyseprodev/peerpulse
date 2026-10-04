<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBookingStore } from '@/stores/bookings'
import { useWalletStore } from '@/stores/wallet'
import { useSkillsStore } from '@/stores/skills'
import { useNotificationStore } from '@/stores/notifications'
import { availableBalance } from '@shared/tokenPolicy'
import { canJoinRoom } from '@shared/booking'
import { formatDateTimeRange, formatDuration, formatRelative } from '@/lib/format'
import { categoryName } from '@/lib/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppStat from '@/components/ui/AppStat.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import TokenExplainer from '@/components/wallet/TokenExplainer.vue'
import SkillCard from '@/components/skills/SkillCard.vue'

const auth = useAuthStore()
const bookings = useBookingStore()
const wallet = useWalletStore()
const skills = useSkillsStore()
const notifications = useNotificationStore()

const uid = computed(() => auth.profile?.uid ?? '')
const next = computed(() => bookings.nextSession)
const nextCounterparty = computed(() => {
  if (!next.value) return null
  const otherUid = next.value.teacherUid === uid.value ? next.value.learnerUid : next.value.teacherUid
  return next.value.participantsSnapshot.find((p) => p.uid === otherUid) ?? null
})
const canJoinNow = computed(() => (next.value ? canJoinRoom(next.value) : false))
const myListings = computed(() => skills.listings.filter((s) => s.ownerUid === uid.value))
const suggestions = computed(() =>
  skills.featured.filter((s) => s.ownerUid !== uid.value && !myListings.value.some((m) => m.id === s.id)).slice(0, 3),
)
const teachingHours = computed(() => auth.profile?.stats.teachingHours ?? 0)

onMounted(async () => {
  if (!uid.value) return
  await Promise.all([
    bookings.load(uid.value),
    wallet.load(uid.value),
    skills.loadByOwner(uid.value),
    skills.loadFeatured(6),
  ])
})
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <p class="text-xs tracking-wide text-muted uppercase">{{ new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()) }}</p>
        <h1 class="font-display mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Hello, {{ auth.displayName.split(' ')[0] }}
        </h1>
        <p class="mt-2 max-w-xl text-sm text-muted">
          You have
          <span class="text-ink">{{ availableBalance(wallet.wallet ?? { balance: 0, held: 0 }) }} Time Tokens</span>
          available and
          <span class="text-ink">{{ bookings.pendingActionCount }}</span>
          {{ bookings.pendingActionCount === 1 ? 'request' : 'requests' }} waiting on someone.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton to="/skills" icon="search" variant="secondary">Find a session</AppButton>
        <AppButton to="/profile" icon="plus" icon-right="arrow-right">Offer a skill</AppButton>
      </div>
    </header>

    <!-- Stats -->
    <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Your exchange at a glance">
      <AppStat
        label="Available tokens"
        :value="availableBalance(wallet.wallet ?? { balance: 0, held: 0 })"
        hint="Spendable right now"
        icon="tokens"
        :loading="wallet.loading && !wallet.wallet"
      />
      <AppStat
        label="Teaching hours"
        :value="`${teachingHours}h`"
        hint="Time you have given"
        icon="clock"
        tone="cyan"
        :loading="!auth.profile"
      />
      <AppStat
        label="Sessions completed"
        :value="auth.profile?.stats.sessionsCompleted ?? 0"
        hint="Both directions"
        icon="check"
        tone="brand"
        :loading="!auth.profile"
      />
      <AppStat
        label="Earned / spent"
        :value="`${wallet.earned} / ${wallet.spent}`"
        hint="Lifetime Time Tokens"
        icon="chart"
        tone="warn"
        :loading="wallet.loading && !wallet.wallet"
      />
    </section>

    <div class="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div class="space-y-6">
        <!-- Next session -->
        <section aria-labelledby="next-session">
          <div class="flex items-center justify-between">
            <h2 id="next-session" class="font-display text-lg font-semibold text-ink">Your next session</h2>
            <RouterLink to="/bookings" class="text-xs text-brand-bright hover:underline">All bookings</RouterLink>
          </div>

          <AppSkeleton v-if="bookings.loading && !bookings.bookings.length" class="mt-4" card :lines="3" />

          <div
            v-else-if="next"
            class="pp-card mt-4 overflow-hidden"
          >
            <div class="flex flex-wrap items-start justify-between gap-4 p-5">
              <div class="flex items-center gap-3">
                <AppAvatar
                  :display-name="nextCounterparty?.displayName ?? 'PeerPulse member'"
                  :seed="nextCounterparty?.avatarSeed ?? 'peer'"
                  :photo-url="null"
                  :size="48"
                />
                <div>
                  <h3 class="font-display text-base font-semibold text-ink">{{ next.skillTitle }}</h3>
                  <p class="text-xs text-muted">
                    {{ next.teacherUid === uid ? 'You teach' : 'You learn' }} ·
                    {{ nextCounterparty?.displayName ?? 'PeerPulse member' }}
                  </p>
                  <p class="mt-1 text-xs text-muted">{{ categoryName(next.categoryId) }}</p>
                </div>
              </div>
              <div class="text-right">
                <AppBadge :tone="next.status === 'in_progress' ? 'cyan' : 'brand'">
                  {{ next.status === 'in_progress' ? 'In session' : 'Confirmed' }}
                </AppBadge>
                <p class="font-display mt-2 text-lg font-bold text-brand-bright">
                  {{ next.teacherUid === uid ? '+' : '−' }}{{ next.tokenAmount }} TT
                </p>
              </div>
            </div>

            <div class="grid gap-3 border-t border-line/60 bg-canvas/30 p-5 sm:grid-cols-3">
              <div>
                <p class="text-[11px] tracking-wide text-muted uppercase">When</p>
                <p class="mt-1 text-sm text-ink">{{ formatDateTimeRange(next.startAt, next.endAt) }}</p>
                <p class="text-[11px] text-muted">{{ formatRelative(next.startAt) }}</p>
              </div>
              <div>
                <p class="text-[11px] tracking-wide text-muted uppercase">Length</p>
                <p class="mt-1 text-sm text-ink">{{ formatDuration(next.durationMinutes) }}</p>
                <p class="text-[11px] text-muted">{{ next.timezone }}</p>
              </div>
              <div class="flex items-end justify-end">
                <AppButton v-if="canJoinNow" :to="`/rooms/${next.roomId}`" icon="video" size="sm">
                  Join the room
                </AppButton>
                <AppButton v-else variant="secondary" size="sm" icon="clock" disabled>
                  Opens {{ formatRelative(new Date(Date.parse(next.startAt) - 15 * 60_000).toISOString()) }}
                </AppButton>
              </div>
            </div>
            <p v-if="next.learnerNote && next.teacherUid === uid" class="border-t border-line/60 px-5 py-3 text-xs text-muted">
              <span class="text-ink">Learner note:</span> {{ next.learnerNote }}
            </p>
          </div>

          <AppEmptyState
            v-else
            class="mt-4"
            icon="calendar"
            title="No sessions booked yet"
            description="Pick a skill you have always wanted to learn and book an hour with somebody who knows it."
            action-label="Explore skills"
            action-to="/skills"
          />
        </section>

        <!-- Requests awaiting you -->
        <section v-if="bookings.requests.length" aria-labelledby="requests">
          <h2 id="requests" class="font-display text-lg font-semibold text-ink">Requests waiting on you</h2>
          <ul class="mt-4 space-y-3">
            <li
              v-for="request in bookings.requests.slice(0, 3)"
              :key="request.id"
              class="pp-card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p class="text-sm font-medium text-ink">{{ request.skillTitle }}</p>
                <p class="text-xs text-muted">
                  {{ formatDateTimeRange(request.startAt, request.endAt) }} ·
                  {{ request.teacherUid === uid ? 'you teach' : 'you learn' }}
                </p>
              </div>
              <AppButton to="/bookings" variant="secondary" size="sm" icon-right="arrow-right">Review</AppButton>
            </li>
          </ul>
        </section>

        <!-- Suggestions -->
        <section aria-labelledby="suggestions">
          <div class="flex items-center justify-between">
            <h2 id="suggestions" class="font-display text-lg font-semibold text-ink">Suggested for your learning goals</h2>
            <RouterLink to="/skills" class="text-xs text-brand-bright hover:underline">Browse all</RouterLink>
          </div>
          <div v-if="suggestions.length" class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <SkillCard v-for="skill in suggestions" :key="skill.id" :skill="skill" :owner="skills.ownerOf(skill)" />
          </div>
          <AppEmptyState
            v-else
            class="mt-4"
            compact
            icon="spark"
            title="No listings to suggest yet"
            description="As members publish skills, personalised suggestions appear here."
            action-label="Publish a skill yourself"
            action-to="/profile"
          />
        </section>
      </div>

      <!-- Sidebar -->
      <aside class="space-y-6">
        <TokenExplainer :config="bookings.config" />

        <section class="pp-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="font-display text-sm font-semibold text-ink">Recent activity</h2>
            <RouterLink to="/notifications" class="text-[11px] text-brand-bright hover:underline">
              {{ notifications.unreadCount }} unread
            </RouterLink>
          </div>
          <ul v-if="notifications.items.length" class="mt-3 space-y-3">
            <li v-for="item in notifications.items.slice(0, 4)" :key="item.id" class="flex gap-3">
              <span
                class="mt-1.5 size-1.5 shrink-0 rounded-full"
                :class="item.read ? 'bg-line' : 'bg-brand'"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="text-xs font-medium text-ink">{{ item.title }}</p>
                <p class="line-clamp-2 text-[11px] text-muted">{{ item.body }}</p>
                <p class="mt-0.5 text-[10px] text-muted/80">{{ formatRelative(item.createdAt) }}</p>
              </div>
            </li>
          </ul>
          <p v-else class="mt-3 text-xs text-muted">Nothing yet — your activity will show up here.</p>
        </section>

        <section v-if="wallet.transactions.length" class="pp-card p-5">
          <h2 class="font-display text-sm font-semibold text-ink">Latest token movements</h2>
          <ul class="mt-3 space-y-2.5">
            <li
              v-for="tx in wallet.transactions.slice(0, 4)"
              :key="tx.id"
              class="flex items-center justify-between gap-3 text-xs"
            >
              <span class="min-w-0">
                <span class="block truncate text-ink">{{ tx.reason }}</span>
                <span class="text-[10px] text-muted">{{ formatRelative(tx.createdAt) }}</span>
              </span>
              <span
                class="font-mono whitespace-nowrap"
                :class="tx.direction === 'credit' ? 'text-brand-bright' : 'text-danger'"
              >
                {{ tx.direction === 'credit' ? '+' : '−' }}{{ tx.amount }}
              </span>
            </li>
          </ul>
          <RouterLink to="/wallet" class="mt-4 inline-flex items-center gap-1 text-[11px] text-brand-bright hover:underline">
            Open wallet <AppIcon name="chevron-right" :size="12" />
          </RouterLink>
        </section>

        <section class="pp-card p-5">
          <h2 class="font-display text-sm font-semibold text-ink">Your listings</h2>
          <p class="mt-1 text-xs text-muted">
            {{ myListings.length }} published ·
            {{ myListings.reduce((sum, s) => sum + s.completedCount, 0) }} completed sessions
          </p>
          <ul v-if="myListings.length" class="mt-3 space-y-2">
            <li v-for="listing in myListings.slice(0, 4)" :key="listing.id" class="flex items-center justify-between gap-2">
              <RouterLink :to="`/skills/${listing.id}`" class="truncate text-xs text-ink hover:text-brand-bright">
                {{ listing.title }}
              </RouterLink>
              <span class="text-[10px] whitespace-nowrap text-muted">{{ listing.durationMinutes }} min</span>
            </li>
          </ul>
          <AppButton to="/profile" variant="secondary" size="sm" block class="mt-4" icon="plus">
            Add another skill
          </AppButton>
        </section>
      </aside>
    </div>
  </div>
</template>
