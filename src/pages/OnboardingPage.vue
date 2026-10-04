<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AvailabilityBlock, SessionFormat, SkillLevel } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useSkillsStore } from '@/stores/skills'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_AVAILABILITY, INTEREST_OPTIONS, LANGUAGE_OPTIONS, SKILL_CATEGORIES, SESSION_FORMAT_LABELS } from '@/lib/catalog'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AvailabilityEditor from '@/components/schedule/AvailabilityEditor.vue'

const auth = useAuthStore()
const skills = useSkillsStore()
const ui = useUiStore()
const router = useRouter()

const STEPS = [
  { title: 'Your profile', icon: 'users' },
  { title: 'Skills you teach', icon: 'seed' },
  { title: 'Skills you want', icon: 'target' },
  { title: 'Interests & format', icon: 'spark' },
  { title: 'Availability', icon: 'calendar' },
  { title: 'Review', icon: 'check' },
]

const step = ref(0)
const saving = ref(false)
const error = ref<string | null>(null)

/* Step 1 — profile */
const headline = ref('')
const bio = ref('')
const location = ref('')
const languages = ref<string[]>(['en'])

/* Step 2 — teach */
const draft = ref({
  title: '',
  categoryId: '',
  level: 'beginner' as SkillLevel,
  format: 'video' as SessionFormat,
  durationMinutes: 60,
  description: '',
})
const createdListings = ref<{ id: string; title: string }[]>([])
const teachCategories = ref<string[]>([])

/* Step 3 — learn */
const learnCategories = ref<string[]>([])
const learnListings = ref<string[]>([])

/* Step 4 — interests */
const interests = ref<string[]>([])
const preferredFormats = ref<SessionFormat[]>(['video'])

/* Step 5 — availability */
const availability = ref<AvailabilityBlock[]>([...DEFAULT_AVAILABILITY])

const profile = computed(() => auth.profile)
const stepTitle = computed(() => STEPS[step.value].title)
const progress = computed(() => Math.round(((step.value + 1) / STEPS.length) * 100))

onMounted(() => {
  if (!profile.value) return
  const p = profile.value
  step.value = Math.min(p.onboarding.step ?? 0, STEPS.length - 1)
  headline.value = p.headline
  bio.value = p.bio
  location.value = p.location
  languages.value = p.languages.length ? p.languages : ['en']
  teachCategories.value = [...p.teachCategories]
  learnCategories.value = [...p.learnCategories]
  interests.value = [...p.interests]
  preferredFormats.value = p.preferredFormats.length ? [...p.preferredFormats] : ['video']
  availability.value = p.availability.length ? [...p.availability] : [...DEFAULT_AVAILABILITY]
  skills.loadByOwner(p.uid).then((items) => {
    createdListings.value = items.map((s) => ({ id: s.id, title: s.title }))
  })
})

/** Persist progress after every step so members can leave and come back. */
async function persist(nextStep: number, completed = false): Promise<void> {
  saving.value = true
  error.value = null
  try {
    const patch = {
      headline: headline.value,
      bio: bio.value,
      location: location.value,
      languages: languages.value,
      teachCategories: teachCategories.value,
      learnCategories: learnCategories.value,
      learnSkillIds: learnListings.value,
      interests: interests.value,
      preferredFormats: preferredFormats.value,
      availability: availability.value,
    }
    await auth.saveOnboarding(patch, {
      step: completed ? STEPS.length - 1 : nextStep,
      completed,
      completedAt: completed ? new Date().toISOString() : null,
    })
  } catch (e) {
    error.value = auth.errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function next(): Promise<void> {
  const target = Math.min(step.value + 1, STEPS.length - 1)
  await persist(target)
  step.value = target
}

async function back(): Promise<void> {
  const target = Math.max(step.value - 1, 0)
  await persist(target)
  step.value = target
}

async function saveLater(): Promise<void> {
  await persist(step.value)
  ui.success('Progress saved', 'You can finish your profile whenever you like.')
  await router.push('/dashboard')
}

async function createListing(): Promise<void> {
  if (!profile.value) return
  error.value = null
  if (!draft.value.title.trim() || draft.value.description.trim().length < 30) {
    error.value = 'Add a title and at least a sentence or two describing what you will teach.'
    return
  }
  saving.value = true
  try {
    const created = await skills.create({
      ownerUid: profile.value.uid,
      title: draft.value.title,
      categoryId: draft.value.categoryId || teachCategories.value[0] || 'life',
      description: draft.value.description,
      outcomes: [],
      level: draft.value.level,
      languages: languages.value,
      format: draft.value.format,
      durationMinutes: Number(draft.value.durationMinutes),
      tags: [],
    })
    createdListings.value = [{ id: created.id, title: created.title }, ...createdListings.value]
    if (!teachCategories.value.includes(created.categoryId)) teachCategories.value.push(created.categoryId)
    draft.value = {
      title: '',
      categoryId: created.categoryId,
      level: 'beginner',
      format: 'video',
      durationMinutes: 60,
      description: '',
    }
    await auth.refreshProfile()
    ui.success('Listing published', `${created.title} is now discoverable by other members.`)
  } catch (e) {
    error.value = auth.errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function finish(): Promise<void> {
  await persist(STEPS.length - 1, true)
  ui.success('Your profile is ready', 'Welcome to the exchange — your three Time Tokens are waiting.')
  await router.push('/dashboard')
}

watch(step, () => window.scrollTo({ top: 0, behavior: 'smooth' }))
</script>

<template>
  <div class="pp-container max-w-4xl py-10">
    <!-- Progress -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="text-xs tracking-wide text-muted uppercase">Onboarding · step {{ step + 1 }} of {{ STEPS.length }}</p>
        <h1 class="font-display mt-1 text-2xl font-bold tracking-tight text-ink">{{ stepTitle }}</h1>
      </div>
      <AppButton variant="ghost" size="sm" icon="clock" @click="saveLater">Save & finish later</AppButton>
    </div>

    <div class="mt-5 h-1.5 overflow-hidden rounded-full bg-line/60" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
      <div class="h-full rounded-full bg-gradient-to-r from-brand to-cyan transition-all duration-500" :style="{ width: `${progress}%` }" />
    </div>

    <ol class="pp-scroll-x mt-6 flex gap-2 pb-1">
      <li
        v-for="(item, index) in STEPS"
        :key="item.title"
        class="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] whitespace-nowrap"
        :class="
          index === step
            ? 'border-brand/40 bg-brand/12 text-brand-bright'
            : index < step
              ? 'border-line/70 text-muted'
              : 'border-line/50 text-muted/70'
        "
      >
        <AppIcon :name="index < step ? 'check' : item.icon" :size="13" />
        {{ item.title }}
      </li>
    </ol>

    <div
      v-if="error"
      class="mt-6 flex items-start gap-2.5 rounded-xl border border-danger/35 bg-danger/10 p-3.5 text-sm text-danger"
      role="alert"
    >
      <AppIcon name="alert" :size="17" class="mt-0.5" />
      <span>{{ error }}</span>
    </div>

    <div class="pp-card mt-6 p-6 sm:p-8">
      <!-- Step 1 -->
      <section v-if="step === 0" class="space-y-5">
        <p class="text-sm text-muted">
          This is what other members see when they consider booking with you. Keep it human — honesty about your level
          gets better matches than overstatement.
        </p>
        <AppInput v-model="headline" label="Headline" placeholder="e.g. Guitarist trading riffs for code" maxlength="90" />
        <AppInput
          v-model="bio"
          label="About you"
          textarea
          :rows="5"
          maxlength="900"
          placeholder="What do you do, what are you learning, and how do you like to teach?"
        />
        <div class="grid gap-5 sm:grid-cols-2">
          <AppInput v-model="location" label="Location" icon="map-pin" placeholder="City, Country" />
          <div>
            <p class="text-sm font-medium text-ink">Languages you speak</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="language in LANGUAGE_OPTIONS"
                :key="language.code"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs transition"
                :class="
                  languages.includes(language.code)
                    ? 'border-brand/40 bg-brand/12 text-brand-bright'
                    : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                "
                :aria-pressed="languages.includes(language.code)"
                @click="languages = languages.includes(language.code) ? languages.filter((c) => c !== language.code) : [...languages, language.code]"
              >
                {{ language.label }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Step 2 -->
      <section v-else-if="step === 1" class="space-y-5">
        <p class="text-sm text-muted">
          List at least one skill you would happily teach for an hour. You can add more later from your profile.
        </p>

        <ul v-if="createdListings.length" class="space-y-2">
          <li
            v-for="listing in createdListings"
            :key="listing.id"
            class="flex items-center justify-between rounded-xl border border-brand/25 bg-brand/8 px-4 py-3"
          >
            <span class="flex items-center gap-2 text-sm text-ink">
              <AppIcon name="check" :size="15" class="text-brand-bright" /> {{ listing.title }}
            </span>
            <AppBadge tone="brand">Published</AppBadge>
          </li>
        </ul>

        <div class="rounded-2xl border border-line/70 bg-canvas/30 p-5">
          <p class="text-sm font-semibold text-ink">Add a listing</p>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <AppInput v-model="draft.title" label="What will you teach?" placeholder="e.g. Guitar for absolute beginners" class="sm:col-span-2" />
            <AppSelect
              v-model="draft.categoryId"
              label="Category"
              placeholder="Choose a category"
              :options="SKILL_CATEGORIES.map((c) => ({ value: c.id, label: c.name }))"
            />
            <AppSelect
              v-model="draft.level"
              label="Level you teach"
              :options="[
                { value: 'beginner', label: 'Beginner-friendly' },
                { value: 'intermediate', label: 'Intermediate' },
                { value: 'advanced', label: 'Advanced' },
                { value: 'any', label: 'All levels' },
              ]"
            />
            <AppSelect
              v-model="draft.format"
              label="Session format"
              :options="Object.entries(SESSION_FORMAT_LABELS).map(([value, meta]) => ({ value, label: meta.label }))"
            />
            <AppSelect
              v-model="draft.durationMinutes"
              label="Standard length"
              :options="[30, 45, 60, 90, 120].map((m) => ({ value: m, label: `${m} minutes (${m / 60} TT)` }))"
            />
            <AppInput
              v-model="draft.description"
              label="Description"
              textarea
              :rows="4"
              class="sm:col-span-2"
              placeholder="What happens in the session, what should the learner bring, and what will they walk away with?"
            />
          </div>
          <div class="mt-4 flex justify-end">
            <AppButton :loading="saving" icon="plus" @click="createListing">Publish listing</AppButton>
          </div>
        </div>

        <div>
          <p class="text-sm font-medium text-ink">Or just pick the categories you can help with</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="category in SKILL_CATEGORIES"
              :key="category.id"
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs transition"
              :class="
                teachCategories.includes(category.id)
                  ? 'border-brand/40 bg-brand/12 text-brand-bright'
                  : 'border-line text-muted hover:border-brand/30 hover:text-ink'
              "
              :aria-pressed="teachCategories.includes(category.id)"
              @click="teachCategories = teachCategories.includes(category.id) ? teachCategories.filter((c) => c !== category.id) : [...teachCategories, category.id]"
            >
              {{ category.name }}
            </button>
          </div>
        </div>
      </section>

      <!-- Step 3 -->
      <section v-else-if="step === 2" class="space-y-5">
        <p class="text-sm text-muted">
          What do you want to learn? We use this to suggest members and to show your goals on your profile.
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="category in SKILL_CATEGORIES"
            :key="category.id"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs transition"
            :class="
              learnCategories.includes(category.id)
                ? 'border-cyan/40 bg-cyan/12 text-cyan'
                : 'border-line text-muted hover:border-cyan/30 hover:text-ink'
            "
            :aria-pressed="learnCategories.includes(category.id)"
            @click="learnCategories = learnCategories.includes(category.id) ? learnCategories.filter((c) => c !== category.id) : [...learnCategories, category.id]"
          >
            {{ category.name }}
          </button>
        </div>
        <p class="text-xs text-muted">
          {{ learnCategories.length }} selected. You can change these any time — learning goals move as fast as you do.
        </p>
      </section>

      <!-- Step 4 -->
      <section v-else-if="step === 3" class="space-y-5">
        <div>
          <p class="text-sm font-medium text-ink">What brings you here?</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              v-for="interest in INTEREST_OPTIONS"
              :key="interest"
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs transition"
              :class="
                interests.includes(interest)
                  ? 'border-brand/40 bg-brand/12 text-brand-bright'
                  : 'border-line text-muted hover:border-brand/30 hover:text-ink'
              "
              :aria-pressed="interests.includes(interest)"
              @click="interests = interests.includes(interest) ? interests.filter((i) => i !== interest) : [...interests, interest]"
            >
              {{ interest }}
            </button>
          </div>
        </div>

        <div>
          <p class="text-sm font-medium text-ink">Preferred learning formats</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              v-for="(meta, value) in SESSION_FORMAT_LABELS"
              :key="value"
              type="button"
              class="flex items-start gap-3 rounded-xl border p-4 text-left transition"
              :class="
                preferredFormats.includes(value as SessionFormat)
                  ? 'border-brand/40 bg-brand/8'
                  : 'border-line hover:border-brand/30'
              "
              :aria-pressed="preferredFormats.includes(value as SessionFormat)"
              @click="preferredFormats = preferredFormats.includes(value as SessionFormat) ? preferredFormats.filter((f) => f !== value) : [...preferredFormats, value as SessionFormat]"
            >
              <span class="grid size-9 place-items-center rounded-xl bg-brand/12 text-brand-bright">
                <AppIcon :name="meta.icon" :size="16" />
              </span>
              <span>
                <span class="block text-sm font-medium text-ink">{{ meta.label }}</span>
                <span class="mt-0.5 block text-xs text-muted">{{ meta.description }}</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- Step 5 -->
      <section v-else-if="step === 4" class="space-y-5">
        <p class="text-sm text-muted">
          When are you usually free to teach? Booking requests are checked against these windows, and you can still
          accept exceptions manually.
        </p>
        <AvailabilityEditor v-model="availability" :timezone="profile?.timezone" />
      </section>

      <!-- Step 6 -->
      <section v-else class="space-y-6">
        <p class="text-sm text-muted">One last look before you start exchanging.</p>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-line/70 bg-canvas/30 p-5">
            <p class="text-xs tracking-wide text-muted uppercase">Profile</p>
            <p class="font-display mt-2 text-base font-semibold text-ink">{{ profile?.displayName }}</p>
            <p class="text-sm text-muted">{{ headline || 'No headline yet' }}</p>
            <p class="mt-2 text-xs text-muted">{{ location || 'Location not set' }} · {{ languages.join(', ') }}</p>
          </div>
          <div class="rounded-2xl border border-brand/30 bg-brand/8 p-5">
            <p class="text-xs tracking-wide text-brand-bright uppercase">Starting balance</p>
            <p class="font-display mt-2 text-3xl font-bold text-ink">3 <span class="text-sm font-medium text-muted">Time Tokens</span></p>
            <p class="mt-2 text-xs text-muted">
              Enough for three hours of learning before your first teaching session settles.
            </p>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="rounded-2xl border border-line/70 bg-canvas/30 p-4">
            <p class="text-xs tracking-wide text-muted uppercase">Teaching</p>
            <p class="mt-1 text-sm text-ink">{{ createdListings.length }} listing(s)</p>
            <p class="text-xs text-muted">{{ teachCategories.length }} categories</p>
          </div>
          <div class="rounded-2xl border border-line/70 bg-canvas/30 p-4">
            <p class="text-xs tracking-wide text-muted uppercase">Learning</p>
            <p class="mt-1 text-sm text-ink">{{ learnCategories.length }} categories</p>
            <p class="text-xs text-muted">{{ interests.length }} interests</p>
          </div>
          <div class="rounded-2xl border border-line/70 bg-canvas/30 p-4">
            <p class="text-xs tracking-wide text-muted uppercase">Availability</p>
            <p class="mt-1 text-sm text-ink">{{ availability.length }} weekly slots</p>
            <p class="text-xs text-muted">{{ preferredFormats.join(', ') || 'No format selected' }}</p>
          </div>
        </div>

        <p class="text-xs leading-relaxed text-muted">
          By finishing onboarding you confirm you understand that Time Tokens are credit for time, that they cannot be
          bought, sold or withdrawn, and that all skills are exchanged at the same rate: one hour, one token.
        </p>
      </section>

      <!-- Footer nav -->
      <div class="pp-hairline mt-8 flex flex-wrap items-center justify-between gap-3 pt-6">
        <AppButton v-if="step > 0" variant="ghost" icon="arrow-left" @click="back">Back</AppButton>
        <span v-else />
        <div class="flex flex-wrap items-center gap-3">
          <span v-if="saving" class="text-xs text-muted">Saving…</span>
          <AppButton v-if="step < STEPS.length - 1" :loading="saving" icon-right="arrow-right" @click="next">
            Continue
          </AppButton>
          <AppButton v-else :loading="saving" icon="check" @click="finish">Finish and enter PeerPulse</AppButton>
        </div>
      </div>
    </div>
  </div>
</template>
