<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Community } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useCommunityStore } from '@/stores/community'
import { useUiStore } from '@/stores/ui'
import { SKILL_CATEGORIES, categoryAccent, categoryName } from '@/lib/catalog'
import { formatRelative, pluralize } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'

const auth = useAuthStore()
const community = useCommunityStore()
const ui = useUiStore()
const router = useRouter()

const categoryFilter = ref<string | null>(null)
const showCreate = ref(false)
const submitting = ref(false)
const form = reactive({ name: '', description: '', categoryId: 'music', visibility: 'public' as Community['visibility'], rules: '' })
const error = ref<string | null>(null)

const visible = computed(() =>
  community.communities.filter((c) => !categoryFilter.value || c.categoryId === categoryFilter.value),
)

const myCommunities = computed(() =>
  community.communities.filter((c) => c.memberCount > 0).slice(0, 3),
)

const totalMembers = computed(() => community.communities.reduce((sum, c) => sum + c.memberCount, 0))

onMounted(async () => {
  await community.loadAll()
  await community.loadFeed(6)
})

async function create(): Promise<void> {
  submitting.value = true
  error.value = null
  try {
    const created = await community.create({
      name: form.name,
      description: form.description,
      categoryId: form.categoryId,
      visibility: form.visibility,
      tags: [],
      rules: form.rules
        .split('\n')
        .map((rule) => rule.trim())
        .filter(Boolean),
    })
    showCreate.value = false
    form.name = ''
    form.description = ''
    form.rules = ''
    ui.success('Community created', 'Invite members by sharing the link — you are the first moderator.')
    await router.push(`/communities/${created.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create the community.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Communities</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Skill-based spaces for questions, resources and events. Learning is social — the exchange works best when
          people keep talking between sessions.
        </p>
      </div>
      <AppButton v-if="auth.isAuthenticated" icon="plus" @click="showCreate = true">Start a community</AppButton>
      <AppButton v-else to="/register" icon-right="arrow-right">Join to take part</AppButton>
    </header>

    <div class="mt-6 grid gap-4 sm:grid-cols-3">
      <div class="pp-card p-4">
        <p class="text-[11px] tracking-wide text-muted uppercase">Communities</p>
        <p class="font-display mt-1 text-2xl font-bold text-ink">{{ community.communities.length }}</p>
      </div>
      <div class="pp-card p-4">
        <p class="text-[11px] tracking-wide text-muted uppercase">Members taking part</p>
        <p class="font-display mt-1 text-2xl font-bold text-ink">{{ totalMembers }}</p>
      </div>
      <div class="pp-card p-4">
        <p class="text-[11px] tracking-wide text-muted uppercase">Recent posts</p>
        <p class="font-display mt-1 text-2xl font-bold text-ink">{{ community.posts.length }}</p>
      </div>
    </div>

    <div class="pp-scroll-x mt-6 flex gap-2 pb-1">
      <button
        type="button"
        class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
        :class="!categoryFilter ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted hover:border-brand/30 hover:text-ink'"
        @click="categoryFilter = null"
      >
        All topics
      </button>
      <button
        v-for="category in SKILL_CATEGORIES"
        :key="category.id"
        type="button"
        class="rounded-full border px-3.5 py-2 text-xs whitespace-nowrap transition"
        :class="
          categoryFilter === category.id
            ? 'border-brand/40 bg-brand/12 text-brand-bright'
            : 'border-line text-muted hover:border-brand/30 hover:text-ink'
        "
        @click="categoryFilter = category.id"
      >
        {{ category.name }}
      </button>
    </div>

    <div v-if="community.loading && !community.communities.length" class="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <AppSkeleton v-for="n in 3" :key="n" card :lines="3" />
    </div>

    <div v-else-if="visible.length" class="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="item in visible"
        :key="item.id"
        :to="`/communities/${item.id}`"
        class="pp-card pp-card-hover group flex h-full flex-col p-6"
      >
        <div class="flex items-center justify-between">
          <span
            class="grid size-10 place-items-center rounded-xl ring-1"
            :style="{
              color: categoryAccent(item.categoryId),
              background: `${categoryAccent(item.categoryId)}1f`,
              borderColor: `${categoryAccent(item.categoryId)}33`,
            }"
          >
            <AppIcon name="users" :size="18" />
          </span>
          <AppBadge :tone="item.visibility === 'public' ? 'muted' : 'cyan'">{{ item.visibility }}</AppBadge>
        </div>
        <h2 class="font-display mt-4 text-base font-semibold text-ink group-hover:text-brand-bright">{{ item.name }}</h2>
        <p class="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{{ item.description }}</p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <AppBadge v-for="tag in item.tags.slice(0, 3)" :key="tag" tone="muted">#{{ tag }}</AppBadge>
        </div>
        <div class="pp-hairline mt-auto flex items-center justify-between pt-4 text-[11px] text-muted">
          <span>{{ pluralize(item.memberCount, 'member') }}</span>
          <span>{{ pluralize(item.postCount, 'post') }} · {{ formatRelative(item.updatedAt) }}</span>
        </div>
      </RouterLink>
    </div>

    <AppEmptyState
      v-else
      class="mt-8"
      icon="users"
      title="No communities for that topic yet"
      description="Communities are created by members. Start one and gather the people learning the same thing as you."
      action-label="Start a community"
      action-to="/communities"
    />

    <!-- Recent discussion -->
    <section v-if="community.posts.length" class="mt-12">
      <h2 class="font-display text-lg font-semibold text-ink">Latest across all communities</h2>
      <ul class="mt-4 space-y-3">
        <li v-for="post in community.posts.slice(0, 5)" :key="post.id">
          <RouterLink
            :to="`/communities/${post.communityId}`"
            class="pp-card pp-card-hover flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div class="min-w-0">
              <p class="flex items-center gap-2 text-sm font-medium text-ink">
                <AppBadge :tone="post.kind === 'question' ? 'cyan' : post.kind === 'event' ? 'warn' : 'brand'">
                  {{ post.kind }}
                </AppBadge>
                {{ post.title }}
              </p>
              <p class="mt-1 line-clamp-1 text-xs text-muted">{{ post.body }}</p>
            </div>
            <span class="text-[11px] whitespace-nowrap text-muted">
              {{ post.authorName }} · {{ formatRelative(post.createdAt) }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Create community -->
    <AppModal
      :open="showCreate"
      title="Start a community"
      description="Give it a clear purpose so members know what belongs here."
      @close="showCreate = false"
    >
      <div class="space-y-4">
        <AppInput v-model="form.name" label="Name" placeholder="e.g. Guitar Circle" maxlength="80" required />
        <AppInput
          v-model="form.description"
          label="What is it for?"
          textarea
          :rows="3"
          maxlength="600"
          placeholder="Who should join, what gets shared, and how often?"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect
            v-model="form.categoryId"
            label="Related skill category"
            :options="SKILL_CATEGORIES.map((c) => ({ value: c.id, label: c.name }))"
          />
          <AppSelect
            v-model="form.visibility"
            label="Visibility"
            :options="[
              { value: 'public', label: 'Public — anyone can read' },
              { value: 'members', label: 'Members only — sign-in required' },
              { value: 'private', label: 'Private — invited members only' },
            ]"
          />
        </div>
        <AppInput
          v-model="form.rules"
          label="House rules (one per line)"
          textarea
          :rows="3"
          placeholder="Be kind about early attempts&#10;Tag your experience level"
        />
        <div v-if="error" class="rounded-xl border border-danger/35 bg-danger/10 p-3 text-xs text-danger" role="alert">
          {{ error }}
        </div>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="showCreate = false">Cancel</AppButton>
        <AppButton :loading="submitting" icon="plus" @click="create">Create community</AppButton>
      </template>
    </AppModal>

    <div v-if="myCommunities.length && auth.isAuthenticated" class="pp-card mt-10 p-6">
      <h2 class="font-display text-base font-semibold text-ink">Your spaces</h2>
      <ul class="mt-3 flex flex-wrap gap-2">
        <li v-for="item in myCommunities" :key="item.id">
          <RouterLink
            :to="`/communities/${item.id}`"
            class="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-brand/40 hover:text-ink"
          >
            {{ item.name }}
            <span class="text-[10px]">{{ categoryName(item.categoryId) }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
