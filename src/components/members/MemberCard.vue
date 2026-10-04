<script setup lang="ts">
import { computed } from 'vue'
import type { UserProfile } from '@shared/domain'
import { categoryName } from '@/lib/catalog'
import { formatHours } from '@/lib/format'
import AppAvatar from '../ui/AppAvatar.vue'
import AppBadge from '../ui/AppBadge.vue'
import AppRating from '../ui/AppRating.vue'
import AppIcon from '../ui/AppIcon.vue'

const props = defineProps<{ member: UserProfile }>()

const ratingValue = computed(() => props.member.stats.ratingSum)
const ratingCount = computed(() => props.member.stats.reviewCount)
</script>

<template>
  <RouterLink
    :to="`/members/${member.uid}`"
    class="pp-card pp-card-hover group flex h-full flex-col gap-3 p-5 focus-visible:outline-none"
  >
    <div class="flex items-center gap-3">
      <AppAvatar :display-name="member.displayName" :seed="member.avatarSeed" :photo-url="member.photoURL" :size="52" />
      <div class="min-w-0">
        <h2 class="font-display group-hover:text-brand-bright truncate text-sm font-semibold text-ink transition-colors">
          {{ member.displayName }}
        </h2>
        <p class="truncate text-xs text-muted">{{ member.headline || 'PeerPulse member' }}</p>
        <div class="mt-1.5">
          <AppRating :value="ratingValue" :count="ratingCount" :size="12" />
        </div>
      </div>
    </div>

    <p class="line-clamp-2 text-xs leading-relaxed text-muted">{{ member.bio }}</p>

    <div class="flex flex-wrap gap-1.5">
      <AppBadge v-for="category in member.teachCategories.slice(0, 3)" :key="category" tone="brand">
        {{ categoryName(category) }}
      </AppBadge>
      <AppBadge v-if="!member.teachCategories.length" tone="muted">No listings yet</AppBadge>
    </div>

    <div class="pp-hairline mt-auto flex items-center justify-between pt-3 text-[11px] text-muted">
      <span class="inline-flex items-center gap-1.5">
        <AppIcon name="target" :size="13" /> {{ member.stats.sessionsCompleted }} sessions
      </span>
      <span class="inline-flex items-center gap-1.5">
        <AppIcon name="clock" :size="13" /> {{ formatHours(member.stats.teachingHours * 60) }} taught
      </span>
    </div>
  </RouterLink>
</template>
