<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { AvailabilityBlock, SkillLevel, SkillListing, SessionFormat } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useSkillsStore } from '@/stores/skills'
import { useBookingStore } from '@/stores/bookings'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_AVAILABILITY, INTEREST_OPTIONS, LANGUAGE_OPTIONS, SKILL_CATEGORIES, SESSION_FORMAT_LABELS } from '@/lib/catalog'
import { formatDuration, formatHours } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AvailabilityEditor from '@/components/schedule/AvailabilityEditor.vue'

const auth = useAuthStore()
const skills = useSkillsStore()
const bookings = useBookingStore()
const ui = useUiStore()

const saving = ref(false)
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const listings = ref<SkillListing[]>([])

const form = reactive({
  displayName: '',
  headline: '',
  bio: '',
  location: '',
  timezone: '',
  languages: [] as string[],
  interests: [] as string[],
  learnCategories: [] as string[],
  preferredFormats: ['video'] as SessionFormat[],
  teachCategories: [] as string[],
  availability: [...DEFAULT_AVAILABILITY] as AvailabilityBlock[],
})

const listingForm = reactive({
  title: '',
  categoryId: '',
  description: '',
  outcomes: '',
  level: 'beginner' as SkillLevel,
  format: 'video' as SessionFormat,
  durationMinutes: 60,
  tags: '',
})

const profile = computed(() => auth.profile)

onMounted(async () => {
  if (!profile.value) return
  const p = profile.value
  Object.assign(form, {
    displayName: p.displayName,
    headline: p.headline,
    bio: p.bio,
    location: p.location,
    timezone: p.timezone,
    languages: [...p.languages],
    interests: [...p.interests],
    learnCategories: [...p.learnCategories],
    preferredFormats: p.preferredFormats.length ? [...p.preferredFormats] : ['video'],
    teachCategories: [...p.teachCategories],
    availability: p.availability.length ? [...p.availability] : [...DEFAULT_AVAILABILITY],
  })
  listings.value = await skills.loadByOwner(p.uid)
  await bookings.ensureConfig()
})

async function save(): Promise<void> {
  saving.value = true
  try {
    await auth.saveProfile({
      displayName: form.displayName,
      headline: form.headline,
      bio: form.bio,
      location: form.location,
      timezone: form.timezone,
      languages: form.languages,
      interests: form.interests,
      learnCategories: form.learnCategories,
      preferredFormats: form.preferredFormats,
      availability: form.availability,
    })
    ui.success('Profile updated', 'Your public profile now shows the latest details.')
  } catch (e) {
    ui.error('Could not save', auth.errorMessage(e))
  } finally {
    saving.value = false
  }
}

function openEditor(listing?: SkillListing): void {
  editingId.value = listing?.id ?? null
  listingForm.title = listing?.title ?? ''
  listingForm.categoryId = listing?.categoryId ?? SKILL_CATEGORIES[0].id
  listingForm.description = listing?.description ?? ''
  listingForm.outcomes = (listing?.outcomes ?? []).join('\n')
  listingForm.level = listing?.level ?? 'beginner'
  listingForm.format = listing?.format ?? 'video'
  listingForm.durationMinutes = listing?.durationMinutes ?? 60
  listingForm.tags = (listing?.tags ?? []).join(', ')
  editorOpen.value = true
}

async function saveListing(): Promise<void> {
  if (!profile.value) return
  saving.value = true
  try {
    const payload = {
      title: listingForm.title,
      categoryId: listingForm.categoryId,
      description: listingForm.description,
      outcomes: listingForm.outcomes.split('\n').map((o) => o.trim()).filter(Boolean),
      level: listingForm.level,
      format: listingForm.format,
      durationMinutes: Number(listingForm.durationMinutes),
      tags: listingForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      languages: form.languages,
    }
    if (editingId.value) {
      await skills.update(editingId.value, payload)
      ui.success('Listing updated')
    } else {
      await skills.create({ ownerUid: profile.value.uid, ...payload })
      ui.success('Listing published', 'Members can now find and book this skill.')
      await auth.refreshProfile()
    }
    listings.value = await skills.loadByOwner(profile.value.uid)
    editorOpen.value = false
  } catch (e) {
    ui.error('Could not save the listing', auth.errorMessage(e))
  } finally {
    saving.value = false
  }
}

async function removeListing(listing: SkillListing): Promise<void> {
  try {
    await skills.remove(listing.id)
    listings.value = await skills.loadByOwner(profile.value!.uid)
    ui.info('Listing removed', `${listing.title} is no longer visible in the exchange.`)
  } catch (e) {
    ui.error('Could not remove the listing', auth.errorMessage(e))
  }
}

async function toggleStatus(listing: SkillListing): Promise<void> {
  const next = listing.status === 'published' ? 'paused' : 'published'
  await skills.update(listing.id, { status: next })
  listings.value = await skills.loadByOwner(profile.value!.uid)
  ui.success(next === 'published' ? 'Listing is live again' : 'Listing paused', 'You can switch it back any time.')
}

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-5">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">My profile</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Everything here is what other members see. Complete profiles get booked roughly twice as often as empty ones —
          say what you teach, how you teach it and when you are free.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton v-if="profile" :to="`/members/${profile.uid}`" variant="secondary" icon="eye">View public profile</AppButton>
        <AppButton :loading="saving" icon="check" @click="save">Save changes</AppButton>
      </div>
    </header>

    <div class="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <!-- Main form -->
      <div class="space-y-6">
        <section class="pp-card p-6">
          <h2 class="font-display text-lg font-semibold text-ink">Identity</h2>
          <div class="mt-5 flex items-center gap-4">
            <AppAvatar
              :display-name="form.displayName || 'You'"
              :seed="profile?.avatarSeed ?? 'you'"
              :photo-url="profile?.photoURL"
              :size="64"
            />
            <div class="text-xs text-muted">
              <p class="text-ink">Profile image</p>
              <p class="mt-1">
                PeerPulse generates a stable, brand-coloured avatar from your account id. Photo uploads are supported in
                production through Firebase Storage — see the deployment guide.
              </p>
            </div>
          </div>

          <div class="mt-5 grid gap-5 sm:grid-cols-2">
            <AppInput v-model="form.displayName" label="Display name" required />
            <AppInput v-model="form.location" label="Location" icon="map-pin" placeholder="City, Country" />
            <AppInput v-model="form.headline" label="Headline" class="sm:col-span-2" maxlength="90" placeholder="One line that says what you bring" />
            <AppInput
              v-model="form.bio"
              label="About you"
              textarea
              :rows="5"
              class="sm:col-span-2"
              maxlength="900"
              placeholder="Your background, how you like to teach, and what you are learning right now."
            />
            <AppInput v-model="form.timezone" label="Timezone" hint="IANA name, e.g. Europe/Berlin" />
          </div>
        </section>

        <section class="pp-card p-6">
          <h2 class="font-display text-lg font-semibold text-ink">Languages & interests</h2>
          <div class="mt-5">
            <p class="text-sm font-medium text-ink">Languages you speak</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="language in LANGUAGE_OPTIONS"
                :key="language.code"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs transition"
                :class="
                  form.languages.includes(language.code)
                    ? 'border-brand/40 bg-brand/12 text-brand-bright'
                    : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                "
                :aria-pressed="form.languages.includes(language.code)"
                @click="form.languages = toggleIn(form.languages, language.code)"
              >
                {{ language.label }}
              </button>
            </div>
          </div>

          <div class="mt-6">
            <p class="text-sm font-medium text-ink">Interests</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="interest in INTEREST_OPTIONS"
                :key="interest"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs transition"
                :class="
                  form.interests.includes(interest)
                    ? 'border-brand/40 bg-brand/12 text-brand-bright'
                    : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                "
                :aria-pressed="form.interests.includes(interest)"
                @click="form.interests = toggleIn(form.interests, interest)"
              >
                {{ interest }}
              </button>
            </div>
          </div>

          <div class="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p class="text-sm font-medium text-ink">Categories you can teach</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="category in SKILL_CATEGORIES"
                  :key="category.id"
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-xs transition"
                  :class="
                    form.teachCategories.includes(category.id)
                      ? 'border-brand/40 bg-brand/12 text-brand-bright'
                      : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                  "
                  @click="form.teachCategories = toggleIn(form.teachCategories, category.id)"
                >
                  {{ category.name }}
                </button>
              </div>
            </div>
            <div>
              <p class="text-sm font-medium text-ink">Categories you want to learn</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="category in SKILL_CATEGORIES"
                  :key="category.id"
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-xs transition"
                  :class="
                    form.learnCategories.includes(category.id)
                      ? 'border-cyan/40 bg-cyan/12 text-cyan'
                      : 'border-line text-muted hover:border-cyan/30 hover:text-ink'
                  "
                  @click="form.learnCategories = toggleIn(form.learnCategories, category.id)"
                >
                  {{ category.name }}
                </button>
              </div>
            </div>
          </div>

          <div class="mt-6">
            <p class="text-sm font-medium text-ink">Preferred learning formats</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="(meta, value) in SESSION_FORMAT_LABELS"
                :key="value"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs transition"
                :class="
                  form.preferredFormats.includes(value as SessionFormat)
                    ? 'border-brand/40 bg-brand/12 text-brand-bright'
                    : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                "
                @click="form.preferredFormats = toggleIn(form.preferredFormats, value) as SessionFormat[]"
              >
                {{ meta.label }}
              </button>
            </div>
          </div>
        </section>

        <section class="pp-card p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-display text-lg font-semibold text-ink">Weekly availability</h2>
            <AppButton variant="secondary" size="sm" icon="check" :loading="saving" @click="save">Save availability</AppButton>
          </div>
          <div class="mt-4">
            <AvailabilityEditor v-model="form.availability" :timezone="form.timezone" />
          </div>
        </section>
      </div>

      <!-- Listings -->
      <aside class="space-y-5">
        <section class="pp-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="font-display text-base font-semibold text-ink">Your skill listings</h2>
            <AppBadge tone="brand">{{ listings.filter((l) => l.status === 'published').length }} live</AppBadge>
          </div>

          <ul v-if="listings.length" class="mt-4 space-y-3">
            <li v-for="listing in listings" :key="listing.id" class="rounded-xl border border-line/70 bg-canvas/30 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-ink">{{ listing.title }}</p>
                  <p class="mt-0.5 text-[11px] text-muted">
                    {{ formatDuration(listing.durationMinutes) }} · {{ listing.bookingCount }} bookings ·
                    {{ listing.completedCount }} completed
                  </p>
                </div>
                <AppBadge :tone="listing.status === 'published' ? 'brand' : 'warn'">{{ listing.status }}</AppBadge>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <AppButton size="sm" variant="ghost" icon="edit" @click="openEditor(listing)">Edit</AppButton>
                <AppButton size="sm" variant="ghost" icon="refresh" @click="toggleStatus(listing)">
                  {{ listing.status === 'published' ? 'Pause' : 'Publish' }}
                </AppButton>
                <AppButton size="sm" variant="ghost" icon="trash" @click="removeListing(listing)">Remove</AppButton>
              </div>
            </li>
          </ul>
          <p v-else class="mt-3 text-sm text-muted">
            No listings yet. Teaching is how you earn Time Tokens, so start with something you could happily explain for
            an hour.
          </p>

          <AppButton class="mt-4" block icon="plus" @click="openEditor()">Add a listing</AppButton>
        </section>

        <section class="pp-card p-5">
          <h2 class="font-display text-base font-semibold text-ink">Stats visible on your profile</h2>
          <ul class="mt-3 space-y-2 text-xs text-muted">
            <li class="flex items-center justify-between"><span>Sessions completed</span><span class="text-ink">{{ profile?.stats.sessionsCompleted ?? 0 }}</span></li>
            <li class="flex items-center justify-between"><span>Teaching hours</span><span class="text-ink">{{ formatHours((profile?.stats.teachingHours ?? 0) * 60) }}</span></li>
            <li class="flex items-center justify-between"><span>Tokens earned</span><span class="text-ink">{{ profile?.stats.tokensEarned ?? 0 }}</span></li>
            <li class="flex items-center justify-between"><span>Reviews</span><span class="text-ink">{{ profile?.stats.reviewCount ?? 0 }}</span></li>
          </ul>
          <p class="mt-3 text-[11px] text-muted">
            These are maintained by the server from settled sessions and cannot be edited by hand.
          </p>
        </section>

        <div class="pp-card p-5">
          <p class="flex items-center gap-2 text-sm font-semibold text-ink">
            <AppIcon name="eye" :size="16" class="text-brand-bright" /> Privacy
          </p>
          <p class="mt-2 text-xs leading-relaxed text-muted">
            Profile visibility, availability sharing and discovery settings live in Settings, so you can share exactly
            what you are comfortable with.
          </p>
          <AppButton to="/settings" variant="secondary" size="sm" class="mt-3" icon-right="arrow-right">
            Open settings
          </AppButton>
        </div>
      </aside>
    </div>

    <!-- Listing editor -->
    <AppModal
      :open="editorOpen"
      :title="editingId ? 'Edit listing' : 'New listing'"
      description="Members book the clearest listings — be specific about what happens in the hour."
      size="lg"
      @close="editorOpen = false"
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="listingForm.title" label="Title" class="sm:col-span-2" maxlength="120" required placeholder="e.g. Knife skills in one hour" />
        <AppSelect
          v-model="listingForm.categoryId"
          label="Category"
          :options="SKILL_CATEGORIES.map((c) => ({ value: c.id, label: c.name }))"
        />
        <AppSelect
          v-model="listingForm.level"
          label="Level you teach"
          :options="[
            { value: 'beginner', label: 'Beginner-friendly' },
            { value: 'intermediate', label: 'Intermediate' },
            { value: 'advanced', label: 'Advanced' },
            { value: 'any', label: 'All levels' },
          ]"
        />
        <AppSelect
          v-model="listingForm.format"
          label="Format"
          :options="Object.entries(SESSION_FORMAT_LABELS).map(([value, meta]) => ({ value, label: meta.label }))"
        />
        <AppSelect
          v-model="listingForm.durationMinutes"
          label="Standard length"
          :options="[30, 45, 60, 90, 120].map((m) => ({ value: m, label: `${m} minutes (${m / 60} TT)` }))"
        />
        <AppInput
          v-model="listingForm.description"
          label="Description"
          textarea
          :rows="4"
          class="sm:col-span-2"
          placeholder="What happens, what to bring, and how you teach."
        />
        <AppInput
          v-model="listingForm.outcomes"
          label="Outcomes (one per line)"
          textarea
          :rows="3"
          class="sm:col-span-2"
          placeholder="Play four open chords cleanly&#10;Build a 15-minute practice routine"
        />
        <AppInput v-model="listingForm.tags" label="Tags (comma separated)" class="sm:col-span-2" placeholder="guitar, beginners, acoustic" />
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="editorOpen = false">Cancel</AppButton>
        <AppButton :loading="saving" icon="check" @click="saveListing">
          {{ editingId ? 'Save listing' : 'Publish listing' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
