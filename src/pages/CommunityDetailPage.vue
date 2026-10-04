<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { CommunityComment, CommunityPost } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useCommunityStore } from '@/stores/community'
import { useUiStore } from '@/stores/ui'
import { getBackend } from '@/lib/backend'
import { categoryAccent, categoryName } from '@/lib/catalog'
import { formatDateTimeRange, formatRelative, pluralize } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'

const route = useRoute()
const auth = useAuthStore()
const community = useCommunityStore()
const ui = useUiStore()

type Tab = 'discussion' | 'questions' | 'resources' | 'events' | 'members'
const tab = ref<Tab>('discussion')
const composerOpen = ref(false)
const commentDrafts = reactive<Record<string, string>>({})
const reportTarget = ref<CommunityPost | null>(null)
const reportReason = ref<'spam' | 'harassment' | 'inappropriate' | 'misrepresentation' | 'other'>('spam')
const reportDetails = ref('')
const submitting = ref(false)

const form = reactive({
  kind: 'post' as CommunityPost['kind'],
  title: '',
  body: '',
  link: '',
  eventStart: '',
  eventDuration: 60,
})

const communityId = computed(() => String(route.params.id))
const current = computed(() => community.current)
const uid = computed(() => auth.profile?.uid ?? '')
const isMember = computed(() => community.members.some((m) => m.uid === uid.value))
const isModerator = computed(
  () => Boolean(current.value) && (current.value!.ownerUids.includes(uid.value) || current.value!.moderatorUids.includes(uid.value)),
)

const visiblePosts = computed(() => {
  switch (tab.value) {
    case 'questions':
      return community.questions
    case 'resources':
      return community.resources
    case 'events':
      return community.events
    default:
      return community.posts
  }
})

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'discussion', label: 'Discussion', icon: 'chat' },
  { id: 'questions', label: 'Questions', icon: 'info' },
  { id: 'resources', label: 'Resources', icon: 'link' },
  { id: 'events', label: 'Events', icon: 'calendar' },
  { id: 'members', label: 'Members', icon: 'users' },
]

onMounted(async () => {
  await community.loadOne(communityId.value)
  await Promise.all(community.posts.slice(0, 4).map((post) => community.loadComments(post.id)))
})

onBeforeUnmount(() => community.dispose())

async function join(): Promise<void> {
  try {
    await community.join(communityId.value, uid.value)
    ui.success('Joined', 'You can now post, comment and react here.')
  } catch (e) {
    ui.error('Could not join', e instanceof Error ? e.message : undefined)
  }
}

async function leave(): Promise<void> {
  try {
    await community.leave(communityId.value, uid.value)
    ui.info('Left the community', 'You can rejoin at any time.')
  } catch (e) {
    ui.error('Could not leave', e instanceof Error ? e.message : undefined)
  }
}

async function publish(): Promise<void> {
  if (!auth.profile) return
  submitting.value = true
  try {
    await community.createPost({
      communityId: communityId.value,
      authorUid: auth.profile.uid,
      kind: form.kind,
      title: form.title,
      body: form.body,
      link: form.link || null,
      event:
        form.kind === 'event' && form.eventStart
          ? {
              startAt: new Date(form.eventStart).toISOString(),
              durationMinutes: Number(form.eventDuration),
              location: 'PeerPulse video room',
              capacity: null,
            }
          : null,
    })
    composerOpen.value = false
    form.title = ''
    form.body = ''
    form.link = ''
    form.eventStart = ''
    ui.success('Posted', 'Members following this community will see it in their feed.')
  } catch (e) {
    ui.error('Could not publish', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}

async function react(post: CommunityPost, emoji: string): Promise<void> {
  await community.react(post.id, uid.value, emoji)
}

const REACTIONS = ['👏', '💡', '❤️', '🙌']

function reactionCounts(post: CommunityPost): { emoji: string; count: number; mine: boolean }[] {
  const counts = new Map<string, number>()
  Object.values(post.reactions).forEach((emoji) => counts.set(emoji, (counts.get(emoji) ?? 0) + 1))
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count, mine: post.reactions[uid.value] === emoji }))
}

async function submitComment(post: CommunityPost): Promise<void> {
  const body = commentDrafts[post.id]?.trim()
  if (!body || !auth.profile) return
  await community.addComment({
    postId: post.id,
    communityId: communityId.value,
    authorUid: auth.profile.uid,
    body,
  })
  commentDrafts[post.id] = ''
}

async function toggleComments(post: CommunityPost): Promise<void> {
  if (!community.comments[post.id]) await community.loadComments(post.id)
}

async function submitReport(): Promise<void> {
  if (!reportTarget.value || !auth.profile) return
  submitting.value = true
  try {
    const backend = await getBackend()
    await backend.createReport({
      reporterUid: auth.profile.uid,
      targetType: 'post',
      targetId: reportTarget.value.id,
      targetPath: `communities/${communityId.value}/posts/${reportTarget.value.id}`,
      targetLabel: reportTarget.value.title,
      reason: reportReason.value,
      details: reportDetails.value,
    })
    reportTarget.value = null
    reportDetails.value = ''
    ui.success('Report sent', 'A steward will review this post.')
  } catch (e) {
    ui.error('Could not send the report', e instanceof Error ? e.message : undefined)
  } finally {
    submitting.value = false
  }
}

function commentsFor(postId: string): CommunityComment[] {
  return community.comments[postId] ?? []
}
</script>

<template>
  <div class="pp-container py-10">
    <AppSkeleton v-if="community.loading && !current" card :lines="6" />

    <AppEmptyState
      v-else-if="!current"
      icon="users"
      title="Community not found"
      description="It may have been closed by its owner or a moderator."
      action-label="Browse communities"
      action-to="/communities"
    />

    <template v-else>
      <header class="pp-card overflow-hidden">
        <div class="h-2 w-full" :style="{ background: `linear-gradient(90deg, ${categoryAccent(current.categoryId)}, transparent)` }" />
        <div class="p-6">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <AppBadge tone="brand">{{ categoryName(current.categoryId) }}</AppBadge>
                <AppBadge tone="muted">{{ current.visibility }}</AppBadge>
                <AppBadge v-if="isModerator" tone="cyan">You moderate this</AppBadge>
              </div>
              <h1 class="font-display mt-3 text-2xl font-bold tracking-tight text-ink">{{ current.name }}</h1>
              <p class="mt-2 max-w-2xl text-sm text-muted">{{ current.description }}</p>
              <p class="mt-3 text-xs text-muted">
                {{ pluralize(current.memberCount, 'member') }} · {{ pluralize(current.postCount, 'post') }} · created
                {{ formatRelative(current.createdAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <AppButton v-if="auth.isAuthenticated && !isMember" icon="plus" @click="join">Join community</AppButton>
              <AppButton v-else-if="isMember && !isModerator" variant="secondary" icon="logout" @click="leave">
                Leave
              </AppButton>
              <AppButton v-if="isMember" icon="edit" @click="composerOpen = true">New post</AppButton>
              <AppButton v-else-if="!auth.isAuthenticated" to="/signin" variant="secondary" icon-right="arrow-right">
                Sign in to post
              </AppButton>
            </div>
          </div>

          <ul v-if="current.rules.length" class="mt-5 flex flex-wrap gap-2">
            <li v-for="rule in current.rules" :key="rule" class="rounded-full border border-line/70 px-3 py-1 text-[11px] text-muted">
              {{ rule }}
            </li>
          </ul>
        </div>
      </header>

      <nav class="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Community sections">
        <button
          v-for="item in TABS"
          :key="item.id"
          type="button"
          class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition"
          :class="tab === item.id ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted hover:border-brand/30 hover:text-ink'"
          :aria-current="tab === item.id ? 'page' : undefined"
          @click="tab = item.id"
        >
          <AppIcon :name="item.icon" :size="15" />
          {{ item.label }}
        </button>
      </nav>

      <!-- Members tab -->
      <section v-if="tab === 'members'" class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="member in community.members" :key="member.uid" class="pp-card flex items-center gap-3 p-4">
          <AppAvatar :display-name="member.displayName" :seed="member.avatarSeed" :size="40" />
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/members/${member.uid}`" class="block truncate text-sm font-medium text-ink hover:text-brand-bright">
              {{ member.displayName }}
            </RouterLink>
            <p class="text-[11px] text-muted">Joined {{ formatRelative(member.joinedAt) }}</p>
          </div>
          <AppBadge :tone="member.role === 'owner' ? 'brand' : member.role === 'moderator' ? 'cyan' : 'muted'">
            {{ member.role }}
          </AppBadge>
        </article>
      </section>

      <!-- Feed -->
      <section v-else class="mt-6 space-y-4">
        <AppEmptyState
          v-if="!visiblePosts.length"
          compact
          icon="chat"
          :title="tab === 'events' ? 'No events scheduled' : 'Nothing posted here yet'"
          :description="
            isMember
              ? 'Start the conversation — a question, a resource or an event give other members something to reply to.'
              : 'Join the community to start the first discussion.'
          "
        />

        <article v-for="post in visiblePosts" :key="post.id" class="pp-card p-5">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 items-start gap-3">
              <AppAvatar :display-name="post.authorName" :seed="post.authorSeed" :size="40" />
              <div class="min-w-0">
                <p class="text-sm font-medium text-ink">
                  {{ post.authorName }}
                  <span class="text-[11px] text-muted">· {{ formatRelative(post.createdAt) }}</span>
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <AppBadge :tone="post.kind === 'question' ? 'cyan' : post.kind === 'event' ? 'warn' : 'brand'">
                    {{ post.kind }}
                  </AppBadge>
                  <AppBadge v-if="post.pinned" tone="muted">Pinned</AppBadge>
                </div>
              </div>
            </div>
            <button
              v-if="auth.isAuthenticated"
              type="button"
              class="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-danger"
              aria-label="Report this post"
              @click="reportTarget = post"
            >
              <AppIcon name="flag" :size="15" />
            </button>
          </div>

          <h2 class="font-display mt-4 text-base font-semibold text-ink">{{ post.title }}</h2>
          <p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">{{ post.body }}</p>

          <a
            v-if="post.link"
            :href="post.link"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-flex items-center gap-1.5 text-xs text-cyan hover:underline"
          >
            <AppIcon name="external-link" :size="13" /> {{ post.link }}
          </a>

          <div v-if="post.event" class="mt-4 rounded-xl border border-warn/25 bg-warn/8 p-3.5">
            <p class="flex items-center gap-2 text-xs font-medium text-warn">
              <AppIcon name="calendar" :size="14" /> {{ formatDateTimeRange(post.event.startAt, new Date(Date.parse(post.event.startAt) + post.event.durationMinutes * 60_000).toISOString()) }}
            </p>
            <p class="mt-1 text-[11px] text-muted">{{ post.event.location }}</p>
          </div>

          <!-- Reactions -->
          <div class="pp-hairline mt-4 flex flex-wrap items-center gap-2 pt-4">
            <button
              v-for="reaction in reactionCounts(post)"
              :key="reaction.emoji"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
              :class="reaction.mine ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted hover:border-brand/30'"
              :disabled="!auth.isAuthenticated"
              @click="react(post, reaction.emoji)"
            >
              {{ reaction.emoji }} {{ reaction.count }}
            </button>
            <div v-if="auth.isAuthenticated" class="flex gap-1">
              <button
                v-for="emoji in REACTIONS"
                :key="emoji"
                type="button"
                class="rounded-full border border-line px-2 py-1 text-xs opacity-60 transition hover:opacity-100"
                :aria-label="`React with ${emoji}`"
                @click="react(post, emoji)"
              >
                {{ emoji }}
              </button>
            </div>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-ink"
              @click="toggleComments(post)"
            >
              <AppIcon name="chat" :size="14" /> {{ pluralize(post.commentCount, 'comment') }}
            </button>
          </div>

          <!-- Comments -->
          <div v-if="community.comments[post.id]" class="mt-4 space-y-3 border-t border-line/60 pt-4">
            <div v-for="comment in commentsFor(post.id)" :key="comment.id" class="flex items-start gap-3">
              <AppAvatar :display-name="comment.authorName" :seed="comment.authorSeed" :size="28" />
              <div class="min-w-0">
                <p class="text-xs font-medium text-ink">
                  {{ comment.authorName }}
                  <span class="text-[10px] font-normal text-muted">· {{ formatRelative(comment.createdAt) }}</span>
                </p>
                <p class="mt-0.5 text-xs leading-relaxed text-muted">{{ comment.body }}</p>
              </div>
            </div>

            <div v-if="isMember" class="flex items-end gap-2">
              <div class="flex-1">
                <AppInput
                  v-model="commentDrafts[post.id]"
                  placeholder="Add a constructive reply…"
                  aria-label="Add a comment"
                />
              </div>
              <AppButton size="sm" icon="send" @click="submitComment(post)">Reply</AppButton>
            </div>
          </div>
        </article>
      </section>
    </template>

    <!-- Composer -->
    <AppModal :open="composerOpen" title="Share with the community" @close="composerOpen = false">
      <div class="space-y-4">
        <AppSelect
          v-model="form.kind"
          label="What are you posting?"
          :options="[
            { value: 'post', label: 'Discussion' },
            { value: 'question', label: 'Question' },
            { value: 'resource', label: 'Resource' },
            { value: 'event', label: 'Event' },
          ]"
        />
        <AppInput v-model="form.title" label="Title" maxlength="160" required placeholder="Keep it specific and friendly" />
        <AppInput
          v-model="form.body"
          label="Body"
          textarea
          :rows="5"
          maxlength="6000"
          placeholder="Add the context somebody needs to reply usefully."
        />
        <AppInput v-model="form.link" label="Link (optional)" placeholder="https://" />
        <div v-if="form.kind === 'event'" class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.eventStart" label="Starts" type="datetime-local" />
          <AppSelect
            v-model="form.eventDuration"
            label="Duration"
            :options="[
              { value: 30, label: '30 minutes' },
              { value: 60, label: '1 hour' },
              { value: 90, label: '90 minutes' },
              { value: 120, label: '2 hours' },
            ]"
          />
        </div>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="composerOpen = false">Cancel</AppButton>
        <AppButton :loading="submitting" icon="send" @click="publish">Publish</AppButton>
      </template>
    </AppModal>

    <!-- Report post -->
    <AppModal :open="Boolean(reportTarget)" title="Report this post" size="sm" @close="reportTarget = null">
      <div class="space-y-4">
        <AppSelect
          v-model="reportReason"
          label="Reason"
          :options="[
            { value: 'spam', label: 'Spam or advertising' },
            { value: 'harassment', label: 'Harassment' },
            { value: 'inappropriate', label: 'Inappropriate content' },
            { value: 'misrepresentation', label: 'Misrepresentation' },
            { value: 'other', label: 'Something else' },
          ]"
        />
        <AppInput v-model="reportDetails" label="Details" textarea :rows="3" maxlength="800" />
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="reportTarget = null">Cancel</AppButton>
        <AppButton variant="danger" :loading="submitting" @click="submitReport">Send report</AppButton>
      </template>
    </AppModal>
  </div>
</template>
