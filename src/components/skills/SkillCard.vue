<script setup lang="ts">
import { computed } from 'vue'
import type { SkillListing, UserProfile } from '@shared/domain'
import { categoryAccent, categoryName, SKILL_LEVEL_LABELS } from '@/lib/catalog'
import { computeTokenAmount, DEFAULT_PLATFORM_CONFIG } from '@shared/tokenPolicy'
import type { PlatformConfig } from '@shared/domain'
import { formatDuration } from '@/lib/format'
import AppBadge from '../ui/AppBadge.vue'
import AppAvatar from '../ui/AppAvatar.vue'
import AppIcon from '../ui/AppIcon.vue'
import AppRating from '../ui/AppRating.vue'

const props = defineProps<{ skill: SkillListing; owner?: UserProfile | null | undefined; config?: PlatformConfig | null }>()

const accent = computed(() => categoryAccent(props.skill.categoryId))
const tokenCost = computed(() => computeTokenAmount(props.skill.durationMinutes, props.config ?? DEFAULT_PLATFORM_CONFIG))
const ownerName = computed(() => props.owner?.displayName ?? 'PeerPulse member')
</script>

<template>
  <article class="pp-card pp-card-hover group flex h-full flex-col overflow-hidden">
    <RouterLink :to="`/skills/${skill.id}`" class="flex h-full flex-col focus-visible:outline-none">
      <div class="h-1.5 w-full" :style="{ background: `linear-gradient(90deg, ${accent}, transparent)` }" />
      <div class="flex flex-1 flex-col gap-3 p-5">
        <div class="flex items-center justify-between gap-2">
          <AppBadge :tone="'brand'" size="sm">{{ categoryName(skill.categoryId) }}</AppBadge>
          <span class="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
            <AppIcon name="clock" :size="13" /> {{ formatDuration(skill.durationMinutes) }}
          </span>
        </div>

        <h3 class="font-display group-hover:text-brand-bright text-base leading-snug font-semibold text-ink transition-colors">
          {{ skill.title }}
        </h3>
        <p class="line-clamp-3 text-sm leading-relaxed text-muted">{{ skill.description }}</p>

        <div class="mt-auto space-y-3 pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <AppBadge tone="muted">{{ SKILL_LEVEL_LABELS[skill.level] }}</AppBadge>
            <AppBadge v-if="skill.format !== 'video'" tone="cyan">{{ skill.format }}</AppBadge>
            <span class="text-[11px] text-muted">{{ skill.languages.join(' · ').toUpperCase() }}</span>
          </div>

          <div class="pp-hairline flex items-center justify-between gap-3 pt-3">
            <div class="flex min-w-0 items-center gap-2">
              <AppAvatar
                :display-name="ownerName"
                :seed="owner?.avatarSeed ?? skill.ownerUid"
                :photo-url="owner?.photoURL"
                :size="30"
              />
              <div class="min-w-0">
                <p class="truncate text-xs font-medium text-ink">{{ ownerName }}</p>
                <p class="truncate text-[11px] text-muted">{{ owner?.location || 'Remote-friendly' }}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="font-display text-sm font-bold text-brand-bright">{{ tokenCost }} TT</p>
              <AppRating :value="skill.ratingSum" :count="skill.reviewCount" :size="11" />
            </div>
          </div>
        </div>
      </div>
    </RouterLink>
  </article>
</template>
