<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SessionFormat, SkillLevel } from '@shared/domain'
import { useSkillsStore } from '@/stores/skills'
import { useBookingStore } from '@/stores/bookings'
import { SKILL_CATEGORIES, SESSION_FORMAT_LABELS, SKILL_LEVEL_LABELS, LANGUAGE_OPTIONS } from '@/lib/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import SkillCard from '@/components/skills/SkillCard.vue'

const skills = useSkillsStore()
const bookings = useBookingStore()
const route = useRoute()
const router = useRouter()

const query = ref('')
const showFilters = ref(false)
const debounce = ref<ReturnType<typeof setTimeout> | null>(null)

onMounted(async () => {
  const category = typeof route.query.category === 'string' ? route.query.category : null
  const search = typeof route.query.q === 'string' ? route.query.q : ''
  query.value = search
  await Promise.all([skills.search({ categoryId: category, query: search }), bookings.ensureConfig()])
})

watch(query, (value) => {
  if (debounce.value) clearTimeout(debounce.value)
  debounce.value = setTimeout(() => {
    void applyFilters({ query: value })
  }, 320)
})

async function applyFilters(overrides: Record<string, unknown> = {}): Promise<void> {
  const next = { ...overrides }
  await skills.search(next as never)
  const searchParams: Record<string, string> = {}
  if (skills.filters.query) searchParams.q = String(skills.filters.query)
  if (skills.filters.categoryId) searchParams.category = String(skills.filters.categoryId)
  await router.replace({ query: searchParams })
}

function clearAll(): void {
  query.value = ''
  skills.resetFilters()
  void applyFilters({ query: '', categoryId: null, level: null, format: null, language: null, weekday: null, maxDurationMinutes: null })
}

const activeChips = computed(() => {
  const chips: { label: string; clear: () => void }[] = []
  const f = skills.filters
  if (f.query) chips.push({ label: `“${f.query}”`, clear: () => ((query.value = ''), applyFilters({ query: '' })) })
  if (f.categoryId) {
    chips.push({
      label: SKILL_CATEGORIES.find((c) => c.id === f.categoryId)?.name ?? f.categoryId,
      clear: () => applyFilters({ categoryId: null }),
    })
  }
  if (f.level) chips.push({ label: SKILL_LEVEL_LABELS[f.level] ?? f.level, clear: () => applyFilters({ level: null }) })
  if (f.format) {
    chips.push({ label: SESSION_FORMAT_LABELS[f.format]?.label ?? f.format, clear: () => applyFilters({ format: null }) })
  }
  if (f.language) {
    chips.push({
      label: LANGUAGE_OPTIONS.find((l) => l.code === f.language)?.label ?? f.language,
      clear: () => applyFilters({ language: null }),
    })
  }
  if (f.weekday !== null && f.weekday !== undefined) {
    chips.push({
      label: `Free on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][f.weekday]}`,
      clear: () => applyFilters({ weekday: null }),
    })
  }
  if (f.maxDurationMinutes) chips.push({ label: `Up to ${f.maxDurationMinutes} min`, clear: () => applyFilters({ maxDurationMinutes: null }) })
  return chips
})
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Explore skills</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Every listing is the same price in time: one hour, one Time Token. Filter by what you want to learn, the
          level you are at and when you are free.
        </p>
      </div>
      <AppBadge tone="brand">{{ skills.resultCount }} listings</AppBadge>
    </header>

    <!-- Search + filter bar -->
    <div class="mt-7 grid gap-3 lg:grid-cols-[1fr_auto]">
      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="flex-1">
          <AppInput
            v-model="query"
            icon="search"
            placeholder="Search skills, teachers or keywords — try “Spanish conversation”"
            aria-label="Search skill listings"
          />
        </div>
        <AppButton variant="secondary" icon="filter" @click="showFilters = !showFilters">
          {{ showFilters ? 'Hide filters' : 'Filters' }}
          <span v-if="activeChips.length" class="ml-2 rounded-full bg-brand/15 px-1.5 text-[11px] text-brand-bright">
            {{ activeChips.length }}
          </span>
        </AppButton>
      </div>
      <AppSelect
        :model-value="skills.filters.sort ?? 'relevance'"
        aria-label="Sort results"
        :options="[
          { value: 'relevance', label: 'Sort: best match' },
          { value: 'rating', label: 'Sort: highest rated' },
          { value: 'recent', label: 'Sort: newest' },
          { value: 'duration', label: 'Sort: shortest first' },
        ]"
        @update:model-value="applyFilters({ sort: $event })"
      />
    </div>

    <!-- Category pills -->
    <div class="pp-scroll-x mt-4 flex gap-2 pb-1">
      <button
        type="button"
        class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
        :class="!skills.filters.categoryId ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted hover:border-brand/30 hover:text-ink'"
        @click="applyFilters({ categoryId: null })"
      >
        All categories
      </button>
      <button
        v-for="category in SKILL_CATEGORIES"
        :key="category.id"
        type="button"
        class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
        :class="
          skills.filters.categoryId === category.id
            ? 'border-brand/40 bg-brand/12 text-brand-bright'
            : 'border-line text-muted hover:border-brand/30 hover:text-ink'
        "
        @click="applyFilters({ categoryId: category.id })"
      >
        {{ category.name }}
      </button>
    </div>

    <!-- Filters panel -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-1 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <div v-if="showFilters" class="pp-card mt-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <AppSelect
          :model-value="skills.filters.level ?? ''"
          label="Your level"
          placeholder="Any level"
          :options="Object.entries(SKILL_LEVEL_LABELS).map(([value, label]) => ({ value, label }))"
          @update:model-value="applyFilters({ level: ($event || null) as SkillLevel | null })"
        />
        <AppSelect
          :model-value="skills.filters.format ?? ''"
          label="Session format"
          placeholder="Any format"
          :options="Object.entries(SESSION_FORMAT_LABELS).map(([value, meta]) => ({ value, label: meta.label }))"
          @update:model-value="applyFilters({ format: ($event || null) as SessionFormat | null })"
        />
        <AppSelect
          :model-value="skills.filters.language ?? ''"
          label="Language"
          placeholder="Any language"
          :options="LANGUAGE_OPTIONS.map((l) => ({ value: l.code, label: l.label }))"
          @update:model-value="applyFilters({ language: $event || null })"
        />
        <AppSelect
          :model-value="skills.filters.maxDurationMinutes ?? ''"
          label="Maximum length"
          placeholder="Any length"
          :options="[
            { value: 30, label: 'Up to 30 minutes' },
            { value: 45, label: 'Up to 45 minutes' },
            { value: 60, label: 'Up to 60 minutes' },
            { value: 90, label: 'Up to 90 minutes' },
          ]"
          @update:model-value="applyFilters({ maxDurationMinutes: $event ? Number($event) : null })"
        />
        <div class="sm:col-span-2 lg:col-span-4">
          <p class="text-sm font-medium text-ink">Teacher availability</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="(day, index) in ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']"
              :key="day"
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs transition"
              :class="
                skills.filters.weekday === index
                  ? 'border-brand/40 bg-brand/12 text-brand-bright'
                  : 'border-line text-muted hover:border-brand/30 hover:text-ink'
              "
              @click="applyFilters({ weekday: skills.filters.weekday === index ? null : index })"
            >
              {{ day.slice(0, 3) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Active chips -->
    <div v-if="activeChips.length" class="mt-4 flex flex-wrap items-center gap-2">
      <button
        v-for="chip in activeChips"
        :key="chip.label"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand-bright transition hover:bg-brand/20"
        @click="chip.clear()"
      >
        {{ chip.label }}
        <AppIcon name="close" :size="12" />
      </button>
      <button type="button" class="text-xs text-muted hover:text-ink" @click="clearAll">Clear all</button>
    </div>

    <!-- Results -->
    <div v-if="skills.loading" class="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <AppSkeleton v-for="n in 6" :key="n" card :lines="3" />
    </div>

    <div v-else-if="skills.listings.length" class="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <SkillCard
        v-for="skill in skills.listings"
        :key="skill.id"
        :skill="skill"
        :owner="skills.ownerOf(skill)"
        :config="bookings.config"
      />
    </div>

    <AppEmptyState
      v-else
      class="mt-8"
      icon="search"
      title="No listings match those filters"
      :description="
        activeChips.length
          ? 'Try widening your filters — or offer the skill yourself and let the exchange come to you.'
          : 'Nothing has been published yet. Be the first to list a skill you would happily teach for an hour.'
      "
      action-label="Clear filters"
      @action="clearAll"
    />

    <div class="pp-card mt-10 p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="font-display text-base font-semibold text-ink">Cannot find what you want to learn?</h2>
          <p class="mt-1 text-sm text-muted">
            List it as a learning goal. Members see what the community is asking for and often offer it as a session.
          </p>
        </div>
        <AppButton to="/profile" variant="secondary" icon-right="arrow-right">Update your learning goals</AppButton>
      </div>
    </div>
  </div>
</template>
