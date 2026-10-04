import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Community, CommunityComment, CommunityMember, CommunityPost } from '@shared/domain'
import { getBackend, type CreatePostInput } from '@/lib/backend'

export const useCommunityStore = defineStore('community', () => {
  const communities = ref<Community[]>([])
  const current = ref<Community | null>(null)
  const members = ref<CommunityMember[]>([])
  const posts = ref<CommunityPost[]>([])
  const comments = ref<Record<string, CommunityComment[]>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  const events = computed(() =>
    posts.value.filter((p) => p.kind === 'event' && p.event).sort((a, b) => Date.parse(a.event!.startAt) - Date.parse(b.event!.startAt)),
  )
  const questions = computed(() => posts.value.filter((p) => p.kind === 'question'))
  const resources = computed(() => posts.value.filter((p) => p.kind === 'resource'))

  async function loadAll(): Promise<void> {
    loading.value = true
    try {
      const backend = await getBackend()
      communities.value = await backend.listCommunities({ limit: 50 })
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load communities.'
    } finally {
      loading.value = false
    }
  }

  async function loadOne(id: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const backend = await getBackend()
      const [community, memberList, postList] = await Promise.all([
        backend.getCommunity(id),
        backend.listCommunityMembers(id),
        backend.listPosts({ communityId: id, limit: 60 }),
      ])
      current.value = community
      members.value = memberList
      posts.value = postList
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load that community.'
    } finally {
      loading.value = false
    }
  }

  async function loadFeed(limit = 12): Promise<void> {
    const backend = await getBackend()
    posts.value = await backend.listPosts({ limit })
  }

  async function create(input: { name: string; description: string; categoryId: string; visibility: Community['visibility']; tags: string[]; rules: string[] }): Promise<Community> {
    const backend = await getBackend()
    const created = await backend.createCommunity({ ...input, ownerUid: 'self' })
    communities.value = [created, ...communities.value]
    return created
  }

  async function join(id: string, uid: string): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.joinCommunity(id, uid)
    patchCommunity(updated)
    members.value = await backend.listCommunityMembers(id)
  }

  async function leave(id: string, uid: string): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.leaveCommunity(id, uid)
    patchCommunity(updated)
    members.value = await backend.listCommunityMembers(id)
  }

  function patchCommunity(community: Community): void {
    const index = communities.value.findIndex((c) => c.id === community.id)
    if (index >= 0) communities.value.splice(index, 1, community)
    if (current.value?.id === community.id) current.value = community
  }

  function isMember(uid: string | undefined, communityId?: string): boolean {
    if (!uid) return false
    const id = communityId ?? current.value?.id
    return members.value.some((m) => m.uid === uid && (!id || true))
  }

  async function createPost(input: CreatePostInput): Promise<CommunityPost> {
    const backend = await getBackend()
    const created = await backend.createPost(input)
    posts.value = [created, ...posts.value]
    if (current.value) current.value.postCount += 1
    return created
  }

  async function react(postId: string, uid: string, emoji: string): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.reactToPost(postId, uid, emoji)
    const index = posts.value.findIndex((p) => p.id === postId)
    if (index >= 0) posts.value.splice(index, 1, updated)
  }

  async function loadComments(postId: string): Promise<CommunityComment[]> {
    const backend = await getBackend()
    const items = await backend.listComments(postId)
    comments.value = { ...comments.value, [postId]: items }
    return items
  }

  async function addComment(input: { postId: string; communityId: string; authorUid: string; body: string }): Promise<void> {
    const backend = await getBackend()
    const created = await backend.createComment(input)
    comments.value = { ...comments.value, [input.postId]: [...(comments.value[input.postId] ?? []), created] }
    const index = posts.value.findIndex((p) => p.id === input.postId)
    if (index >= 0) posts.value.splice(index, 1, { ...posts.value[index], commentCount: posts.value[index].commentCount + 1 })
  }

  function dispose(): void {
    current.value = null
    posts.value = []
    members.value = []
    comments.value = {}
  }

  return {
    communities,
    current,
    members,
    posts,
    comments,
    loading,
    error,
    events,
    questions,
    resources,
    loadAll,
    loadOne,
    loadFeed,
    create,
    join,
    leave,
    isMember,
    createPost,
    react,
    loadComments,
    addComment,
    dispose,
  }
})
