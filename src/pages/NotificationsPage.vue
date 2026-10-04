<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { formatRelative } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'

const auth = useAuthStore()
const notifications = useNotificationStore()
const filter = ref<'all' | 'unread'>('all')

const uid = computed(() => auth.profile?.uid ?? '')
const visible = computed(() =>
  filter.value === 'unread' ? notifications.unread : notifications.items,
)

const ICONS: Record<string, string> = {
  booking_requested: 'bell',
  booking_confirmed: 'check',
  booking_declined: 'close',
  booking_cancelled: 'close',
  booking_rescheduled: 'calendar',
  session_settled: 'tokens',
  session_refunded: 'refresh',
  session_disputed: 'flag',
  review_received: 'star',
  community_reply: 'chat',
  token_grant: 'gift',
  moderation_action: 'shield',
  system: 'info',
}

onMounted(async () => {
  if (uid.value) await notifications.load(uid.value)
})
</script>

<template>
  <div class="pp-container max-w-3xl py-10">
    <header class="flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink">Notifications</h1>
        <p class="mt-2 text-sm text-muted">
          Booking updates, settlement results, review activity and moderation outcomes.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <div class="flex gap-1.5">
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-xs transition"
            :class="filter === 'all' ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted'"
            @click="filter = 'all'"
          >
            All
          </button>
          <button
            type="button"
            class="rounded-full border px-3.5 py-1.5 text-xs transition"
            :class="filter === 'unread' ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted'"
            @click="filter = 'unread'"
          >
            Unread ({{ notifications.unreadCount }})
          </button>
        </div>
        <AppButton
          v-if="notifications.unreadCount"
          variant="secondary"
          size="sm"
          icon="check"
          @click="notifications.markAllRead(uid)"
        >
          Mark all read
        </AppButton>
      </div>
    </header>

    <ul v-if="visible.length" class="mt-8 space-y-2.5">
      <li v-for="item in visible" :key="item.id">
        <RouterLink
          :to="item.link ?? '/notifications'"
          class="pp-card pp-card-hover flex items-start gap-4 p-4"
          :class="item.read ? '' : 'border-brand/30'"
          @click="notifications.markRead(item.id)"
        >
          <span
            class="grid size-10 shrink-0 place-items-center rounded-xl ring-1"
            :class="
              item.read
                ? 'bg-white/5 text-muted ring-line'
                : 'bg-brand/12 text-brand-bright ring-brand/25'
            "
          >
            <AppIcon :name="ICONS[item.type] ?? 'info'" :size="18" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium" :class="item.read ? 'text-muted' : 'text-ink'">{{ item.title }}</p>
              <AppBadge v-if="item.priority === 'high'" tone="warn">Important</AppBadge>
              <span v-if="!item.read" class="size-1.5 rounded-full bg-brand" aria-label="Unread" />
            </div>
            <p class="mt-1 text-xs leading-relaxed text-muted">{{ item.body }}</p>
            <p class="mt-1.5 text-[11px] text-muted/80">{{ formatRelative(item.createdAt) }}</p>
          </div>
        </RouterLink>
      </li>
    </ul>

    <AppEmptyState
      v-else
      class="mt-8"
      icon="bell"
      :title="filter === 'unread' ? 'Nothing unread' : 'No notifications yet'"
      description="Bookings, settlements, reviews and moderation updates all land here."
      action-label="Go to your dashboard"
      action-to="/dashboard"
    />
  </div>
</template>
