<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppLogo from '@/components/ui/AppLogo.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()

const displayName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const accepted = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const fields = ref<Record<string, string>>({})

const strength = computed(() => {
  const value = password.value
  let score = 0
  if (value.length >= 8) score += 1
  if (/[A-Z]/.test(value)) score += 1
  if (/[0-9]/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  return score
})

const strengthLabel = computed(() => ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength.value] ?? 'Weak')
const strengthTone = computed(() => ['bg-danger', 'bg-danger', 'bg-warn', 'bg-brand', 'bg-brand'][strength.value] ?? 'bg-danger')

async function submit(): Promise<void> {
  fields.value = {}
  error.value = null

  if (password.value !== confirmPassword.value) {
    fields.value = { confirmPassword: 'Passwords do not match.' }
    return
  }
  if (!accepted.value) {
    error.value = 'Please accept the community guidelines and terms of exchange to continue.'
    return
  }

  submitting.value = true
  try {
    await auth.signUp({
      email: email.value,
      password: password.value,
      displayName: displayName.value,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    ui.success('Account created', 'Three introductory Time Tokens have been added to your wallet.')
    await router.push('/onboarding')
  } catch (e) {
    error.value = auth.errorMessage(e)
    fields.value = auth.fieldErrors(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pp-container grid items-start gap-12 py-14 lg:grid-cols-2">
    <div class="mx-auto w-full max-w-md">
      <RouterLink to="/" class="inline-block"><AppLogo /></RouterLink>
      <h1 class="font-display mt-8 text-2xl font-bold tracking-tight text-ink">Create your PeerPulse account</h1>
      <p class="mt-2 text-sm text-muted">
        Two minutes now, then you can list a skill, book a session and start trading time.
      </p>

      <form class="mt-8 space-y-5" novalidate @submit.prevent="submit">
        <div
          v-if="error"
          class="flex items-start gap-2.5 rounded-xl border border-danger/35 bg-danger/10 p-3.5 text-sm text-danger"
          role="alert"
        >
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>{{ error }}</span>
        </div>

        <AppInput
          v-model="displayName"
          label="Display name"
          icon="users"
          autocomplete="name"
          placeholder="How other members will see you"
          required
          :error="fields.displayName"
        />
        <AppInput
          v-model="email"
          label="Email"
          type="email"
          icon="mail"
          autocomplete="email"
          placeholder="you@example.com"
          required
          :error="fields.email"
        />
        <div>
          <AppInput
            v-model="password"
            label="Password"
            type="password"
            icon="lock"
            autocomplete="new-password"
            placeholder="At least 8 characters"
            required
            :error="fields.password"
          />
          <div v-if="password" class="mt-2 flex items-center gap-2">
            <div class="flex h-1.5 flex-1 gap-1">
              <span
                v-for="n in 4"
                :key="n"
                class="h-full flex-1 rounded-full"
                :class="n <= strength ? strengthTone : 'bg-line/60'"
              />
            </div>
            <span class="text-[11px] text-muted">{{ strengthLabel }}</span>
          </div>
        </div>
        <AppInput
          v-model="confirmPassword"
          label="Confirm password"
          type="password"
          icon="lock"
          autocomplete="new-password"
          required
          :error="fields.confirmPassword"
        />

        <label class="flex items-start gap-2.5 text-xs text-muted">
          <input v-model="accepted" type="checkbox" class="mt-0.5 size-4 accent-[#10B981]" />
          <span>
            I agree to the
            <RouterLink to="/community-guidelines" class="text-brand-bright hover:underline">community guidelines</RouterLink>
            and
            <RouterLink to="/terms" class="text-brand-bright hover:underline">terms of exchange</RouterLink>, and I
            understand Time Tokens are credit for time — not money, and never withdrawable.
          </span>
        </label>

        <AppButton type="submit" block size="lg" :loading="submitting" icon-right="arrow-right">
          Create account
        </AppButton>
      </form>

      <p class="mt-6 text-center text-xs text-muted">
        Already a member?
        <RouterLink to="/signin" class="text-brand-bright hover:underline">Sign in</RouterLink>
      </p>
    </div>

    <aside class="pp-card p-8">
      <h2 class="font-display text-lg font-semibold text-ink">What happens after you sign up</h2>
      <ol class="mt-6 space-y-5">
        <li class="flex gap-4">
          <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-brand/12 font-display text-sm font-bold text-brand-bright">1</span>
          <div>
            <p class="text-sm font-medium text-ink">Guided onboarding</p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              Tell us what you can teach, what you want to learn, your languages and your weekly availability. You can
              pause at any step and finish later.
            </p>
          </div>
        </li>
        <li class="flex gap-4">
          <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-brand/12 font-display text-sm font-bold text-brand-bright">2</span>
          <div>
            <p class="text-sm font-medium text-ink">Three introductory Time Tokens</p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              Enough for three hours of learning before you have taught anything. The grant is recorded in your ledger
              as a grant, never as a purchase.
            </p>
          </div>
        </li>
        <li class="flex gap-4">
          <span class="grid size-8 shrink-0 place-items-center rounded-xl bg-brand/12 font-display text-sm font-bold text-brand-bright">3</span>
          <div>
            <p class="text-sm font-medium text-ink">Your first listing</p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              Publish one skill you would happily teach for an hour. Clear titles and honest outcomes get booked first.
            </p>
          </div>
        </li>
      </ol>

      <div class="mt-8 rounded-2xl border border-line/70 bg-canvas/40 p-4">
        <p class="flex items-center gap-2 text-xs font-semibold text-ink">
          <AppIcon name="shield" :size="15" class="text-brand-bright" /> Your data, your choices
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted">
          Profile visibility, availability sharing and direct-request settings are all under your control in Settings →
          Privacy, and can be changed at any time.
        </p>
      </div>
    </aside>
  </div>
</template>
