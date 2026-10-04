<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { UserProfile } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { getBackend } from '@/lib/backend'
import { SKILL_CATEGORIES } from '@/lib/catalog'
import AppInput from '@/components/ui/AppInput.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import MemberCard from '@/components/members/MemberCard.vue'

const auth = useAuthStore()

const members = ref<UserProfile[]>([])
const loading = ref(true)
const query = ref('')
const categoryId = ref<string | null>(null)
let debounce: ReturnType<typeof setTimeout> | null = null

const visible = computed(() => members.value.filter((m) => m.uid !== auth.profile?.uid))

async function load(): Promise<void> {
  loading.value = true
  try {
    const backend = await getBackend()
    members.value = await backend.listMembers({
      limit: 60,
      query: query.value || undefined,
      categoryId: categoryId.value,
    })
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(query, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(load, 300)
})

watch(categoryId, load)
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Members</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Everyone here trades on the same terms. Find somebody who teaches what you want to learn, or who wants to
          learn what you teach.
        </p>
      </div>
      <AppBadge tone="brand">{{ visible.length }} members</AppBadge>
    </header>

    <div class="mt-7 space-y-4">
      <AppInput v-model="query" icon="search" placeholder="Search by name, headline, bio or city" aria-label="Search members" />
      <div class="pp-scroll-x flex gap-2 pb-1">
        <button
          type="button"
          class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
          :class="!categoryId ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted hover:border-brand/30 hover:text-ink'"
          @click="categoryId = null"
        >
          All skills
        </button>
        <button
          v-for="category in SKILL_CATEGORIES"
          :key="category.id"
          type="button"
          class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
          :class="
            categoryId === category.id
              ? 'border-brand/40 bg-brand/12 text-brand-bright'
              : 'border-line text-muted hover:border-brand/30 hover:text-ink'
          "
          @click="categoryId = category.id"
        >
          Teaches {{ category.name }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <AppSkeleton v-for="n in 6" :key="n" card :lines="3" />
    </div>

    <div v-else-if="visible.length" class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <MemberCard v-for="member in visible" :key="member.uid" :member="member" />
    </div>

    <AppEmptyState
      v-else
      class="mt-8"
      icon="users"
      title="No members match that search"
      description="Try a different keyword or category — or invite somebody you know to join the exchange."
      action-label="See how it works"
      action-to="/how-it-works"
    />

    <div class="pp-card mt-10 p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="font-display text-base font-semibold text-ink">Members control their own visibility</h2>
          <p class="mt-1 max-w-2xl text-sm text-muted">
            Profiles only appear here when the member has enabled discovery and set their profile to public. Anything
            else stays private, and you can change your own settings at any time.
          </p>
        </div>
        <AppButton to="/settings" variant="secondary" icon="settings">Your privacy settings</AppButton>
      </div>
    </div>
  </div>
</template>
