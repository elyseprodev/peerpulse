import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SkillFilter, SkillListing, UserProfile } from '@shared/domain'
import { getBackend, type CreateSkillInput } from '@/lib/backend'

const emptyFilter: SkillFilter = {
  query: '',
  categoryId: null,
  level: null,
  format: null,
  language: null,
  weekday: null,
  maxDurationMinutes: null,
  sort: 'relevance',
}

export const useSkillsStore = defineStore('skills', () => {
  const listings = ref<SkillListing[]>([])
  const featured = ref<SkillListing[]>([])
  const owners = ref<Record<string, UserProfile>>({})
  const current = ref<SkillListing | null>(null)
  const filters = ref<SkillFilter>({ ...emptyFilter })
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasActiveFilters = computed(() =>
    Boolean(
      filters.value.query ||
        filters.value.categoryId ||
        filters.value.level ||
        filters.value.format ||
        filters.value.language ||
        filters.value.weekday !== null ||
        filters.value.maxDurationMinutes,
    ),
  )

  const resultCount = computed(() => listings.value.length)

  async function hydrateOwners(items: SkillListing[]): Promise<void> {
    const backend = await getBackend()
    const missing = [...new Set(items.map((s) => s.ownerUid))].filter((uid) => !owners.value[uid])
    if (!missing.length) return
    const profiles = await backend.getUsers(missing)
    profiles.forEach((profile) => {
      owners.value[profile.uid] = profile
    })
  }

  async function search(overrides: Partial<SkillFilter> = {}): Promise<void> {
    loading.value = true
    error.value = null
    try {
      filters.value = { ...filters.value, ...overrides }
      const backend = await getBackend()
      listings.value = await backend.listSkills({ ...filters.value, limit: 60 })
      await hydrateOwners(listings.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load skill listings.'
      listings.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadFeatured(limit = 6): Promise<void> {
    const backend = await getBackend()
    featured.value = await backend.listSkills({ limit, sort: 'rating' })
    await hydrateOwners(featured.value)
  }

  async function loadByOwner(ownerUid: string): Promise<SkillListing[]> {
    const backend = await getBackend()
    const items = await backend.listSkills({ ownerUid, includeUnpublished: true, limit: 50 })
    await hydrateOwners(items)
    return items
  }

  async function loadOne(id: string): Promise<SkillListing | null> {
    loading.value = true
    try {
      const backend = await getBackend()
      current.value = await backend.getSkill(id)
      if (current.value) await hydrateOwners([current.value])
      return current.value
    } finally {
      loading.value = false
    }
  }

  async function create(input: CreateSkillInput): Promise<SkillListing> {
    const backend = await getBackend()
    const created = await backend.createSkill(input)
    await hydrateOwners([created])
    return created
  }

  async function update(id: string, patch: Partial<SkillListing>): Promise<SkillListing> {
    const backend = await getBackend()
    return backend.updateSkill(id, patch)
  }

  async function remove(id: string): Promise<void> {
    const backend = await getBackend()
    await backend.removeSkill(id)
  }

  function resetFilters(): void {
    filters.value = { ...emptyFilter }
  }

  function ownerOf(skill: SkillListing): UserProfile | undefined {
    return owners.value[skill.ownerUid]
  }

  return {
    listings,
    featured,
    owners,
    current,
    filters,
    loading,
    error,
    hasActiveFilters,
    resultCount,
    search,
    loadFeatured,
    loadByOwner,
    loadOne,
    create,
    update,
    remove,
    resetFilters,
    ownerOf,
  }
})
