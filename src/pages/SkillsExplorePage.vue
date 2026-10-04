<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SessionFormat, SkillFilter, SkillLevel } from '@shared/domain'
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

/**
 * Filter state lives in the URL.
 *
 * FR-7 asks for the filter state to be mirrored into the query string, and the
 * first implementation mirrored two of the eight things that can be filtered —
 * so a shared link to "advanced, Spanish, under an hour, on Saturday" silently
 * dropped everything but the text search. Everything is now read on mount (and
 * on a back/forward navigation), written on every change, and *validated* on the
 * way in: a hand-edited `?level=banana` must not reach the store.
 */
const LEVELS = Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]
const FORMATS = Object.keys(SESSION_FORMAT_LABELS) as SessionFormat[]
const SORTS = ['relevance', 'rating', 'recent', 'duration'] as const
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function stringParam(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberParam(value: unknown, allowed?: number[]): number | null {
  const raw = stringParam(value)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return allowed && !allowed.includes(parsed) ? null : parsed
}

/** The URL, turned into a filter — dropping anything a person typed by hand. */
function filtersFromQuery(source: Record<string, unknown>): Partial<SkillFilter> {
  const level = stringParam(source.level)
  const format = stringParam(source.format)
  const sort = stringParam(source.sort)
  return {
    query: stringParam(source.q) ?? '',
    categoryId: stringParam(source.category),
    level: level && LEVELS.includes(level as SkillLevel) ? (level as SkillLevel) : null,
    format: format && FORMATS.includes(format as SessionFormat) ? (format as SessionFormat) : null,
    language: stringParam(source.language),
    weekday: numberParam(source.weekday, [0, 1, 2, 3, 4, 5, 6]),
    maxDurationMinutes: numberParam(source.maxDuration),
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as SkillFilter['sort']) : 'relevance',
  }
}

/** The filter, turned into a query string — omitting anything at its default. */
function queryFromFilters(filters: SkillFilter): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.query) params.q = filters.query
  if (filters.categoryId) params.category = filters.categoryId
  if (filters.level) params.level = filters.level
  if (filters.format) params.format = filters.format
  if (filters.language) params.language = filters.language
  if (filters.weekday !== null && filters.weekday !== undefined) params.weekday = String(filters.weekday)
  if (filters.maxDurationMinutes) params.maxDuration = String(filters.maxDurationMinutes)
  if (filters.sort && filters.sort !== 'relevance') params.sort = filters.sort
  return params
}

function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key] === undefined || a[key] === null ? '' : String(a[key])
    const right = b[key] === undefined || b[key] === null ? '' : String(b[key])
    if (left !== right) return false
  }
  return true
}

onMounted(async () => {
  const initial = filtersFromQuery(route.query as Record<string, unknown>)
  query.value = initial.query ?? ''
  await Promise.all([skills.search(initial), bookings.ensureConfig()])
})

watch(query, (value) => {
  if (debounce.value) clearTimeout(debounce.value)
  debounce.value = setTimeout(() => {
    void applyFilters({ query: value })
  }, 320)
})

// A back/forward navigation, or a link that arrives with different filters, must
// update the page — not just the address bar.
watch(
  () => route.query,
  (next, previous) => {
    if (sameParams(next, previous)) return
    const parsed = filtersFromQuery(next as Record<string, unknown>)
    if (sameParams(queryFromFilters(skills.filters), next as Record<string, unknown>)) return
    query.value = parsed.query ?? ''
    skills.resetFilters()
    void skills.search(parsed)
  },
)

async function applyFilters(overrides: Record<string, unknown> = {}): Promise<void> {
  await skills.search(overrides as never)
  const params = queryFromFilters(skills.filters)
  // `replace`, not `push`: a dozen keystrokes should not fill the back stack.
  if (!sameParams(params, route.query as Record<string, unknown>)) {
    await router.replace({ query: params })
  }
}

function clearAll(): void {
  query.value = ''
  skills.resetFilters()
  void applyFilters({
    query: '',
    categoryId: null,
    level: null,
    format: null,
    language: null,
    weekday: null,
    maxDurationMinutes: null,
    sort: 'relevance',
  })
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
      label: `Free on ${WEEKDAYS[f.weekday]}`,
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

    <div v-else class="mt-8 space-y-4">
      <AppEmptyState
        icon="search"
        title="No listings match those filters"
        :description="
          activeChips.length
            ? 'Nothing on the exchange matches this combination yet. Widen one filter and it may appear.'
            : 'Nothing has been published yet. Be the first to list a skill you would happily teach for an hour.'
        "
        action-label="Clear filters"
        @action="clearAll"
      />

      <!-- Tell the member which single filter is closing the door, and offer the
           one click that fixes it. "Try widening your filters" is advice; this is
           a control. -->
      <div v-if="activeChips.length" class="pp-card p-5">
        <h2 class="font-display text-sm font-semibold text-ink">Which filter is in the way?</h2>
        <p class="mt-1 text-xs text-muted">
          Each suggestion removes one filter and keeps the rest, so you can see what the community offers further out.
        </p>
        <ul class="mt-4 space-y-2">
          <li v-for="chip in activeChips" :key="`relax-${chip.label}`">
            <button
              type="button"
              class="w-full rounded-xl border border-line/70 bg-canvas/30 px-4 py-3 text-left text-sm text-muted transition hover:border-brand/30 hover:text-ink"
              @click="chip.clear()"
            >
              Drop <span class="font-medium text-ink">{{ chip.label }}</span>
              <span class="ml-1 text-xs">→ see more listings</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

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
