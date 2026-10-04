<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { env } from '@/lib/env'
import { getBackend } from '@/lib/backend'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppLogo from '@/components/ui/AppLogo.vue'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const fields = ref<Record<string, string>>({})
const demoAvailable = ref(false)
const demoCredentials = ref<{ member: { email: string; password: string }; admin: { email: string; password: string } } | null>(null)

onMounted(async () => {
  if (env.backendMode !== 'local') return
  const backend = await getBackend()
  demoAvailable.value = backend.capabilities.demoAccounts
  const local = backend as unknown as { demoCredentials?: { member: { email: string; password: string }; admin: { email: string; password: string } } }
  demoCredentials.value = local.demoCredentials ?? null
})

const redirectTarget = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'))

async function submit(): Promise<void> {
  submitting.value = true
  error.value = null
  fields.value = {}
  try {
    await auth.signIn(email.value, password.value)
    ui.success('Welcome back', 'Your sessions and wallet are ready.')
    await router.push(auth.needsOnboarding ? '/onboarding' : redirectTarget.value)
  } catch (e) {
    error.value = auth.errorMessage(e)
    fields.value = auth.fieldErrors(e)
  } finally {
    submitting.value = false
  }
}

async function demoSignIn(role: 'member' | 'admin'): Promise<void> {
  submitting.value = true
  error.value = null
  try {
    await auth.signInAsDemo(role)
    ui.success(role === 'admin' ? 'Signed in as steward' : 'Signed in as demo member')
    await router.push(role === 'admin' ? '/admin' : '/dashboard')
  } catch (e) {
    error.value = auth.errorMessage(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pp-container grid items-center gap-12 py-14 lg:grid-cols-2">
    <div class="mx-auto w-full max-w-md">
      <RouterLink to="/" class="inline-block"><AppLogo /></RouterLink>
      <h1 class="font-display mt-8 text-2xl font-bold tracking-tight text-ink">Welcome back</h1>
      <p class="mt-2 text-sm text-muted">Sign in to manage sessions, tokens and communities.</p>

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
          v-model="email"
          label="Email"
          type="email"
          icon="mail"
          autocomplete="email"
          placeholder="you@example.com"
          required
          :error="fields.email"
        />

        <div class="relative">
          <AppInput
            v-model="password"
            label="Password"
            :type="showPassword ? 'text' : 'password'"
            icon="lock"
            autocomplete="current-password"
            placeholder="••••••••"
            required
            :error="fields.password"
          />
          <button
            type="button"
            class="absolute top-8 right-3 rounded-lg p-1.5 text-muted transition hover:text-ink"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <AppIcon :name="showPassword ? 'mic-off' : 'eye'" :size="16" />
          </button>
        </div>

        <div class="flex items-center justify-between">
          <RouterLink to="/forgot-password" class="text-xs text-brand-bright hover:underline">
            Forgot your password?
          </RouterLink>
          <RouterLink to="/register" class="text-xs text-muted hover:text-ink">Need an account?</RouterLink>
        </div>

        <AppButton type="submit" block size="lg" :loading="submitting" icon-right="arrow-right">
          Sign in
        </AppButton>
      </form>

      <div v-if="demoAvailable" class="pp-card mt-8 p-5">
        <p class="flex items-center gap-2 text-xs font-semibold text-ink">
          <AppIcon name="spark" :size="15" class="text-brand-bright" /> Demo environment
        </p>
        <p class="mt-2 text-xs leading-relaxed text-muted">
          This deployment runs the in-browser reference backend, so the exchange is pre-populated with example members,
          sessions and ledger history. Sign in as either role to explore.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <AppButton variant="secondary" size="sm" :loading="submitting" @click="demoSignIn('member')">
            Demo member
          </AppButton>
          <AppButton variant="secondary" size="sm" :loading="submitting" @click="demoSignIn('admin')">
            Demo steward (admin)
          </AppButton>
        </div>
        <p v-if="demoCredentials" class="mt-3 font-mono text-[11px] text-muted">
          {{ demoCredentials.member.email }} / {{ demoCredentials.member.password }} ·
          {{ demoCredentials.admin.email }} / {{ demoCredentials.admin.password }}
        </p>
      </div>
    </div>

    <aside class="pp-card hidden p-8 lg:block">
      <h2 class="font-display text-lg font-semibold text-ink">Trade Time. Share Skills. Grow Together.</h2>
      <p class="mt-3 text-sm leading-relaxed text-muted">
        Every hour you teach earns one Time Token. Every hour you learn spends one. No prices, no subscriptions, no
        money — just people sharing what they know.
      </p>

      <ul class="mt-7 space-y-4">
        <li class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
            <AppIcon name="check" :size="15" />
          </span>
          <p class="text-sm text-muted"><span class="text-ink">Verified settlement.</span> Tokens move only after attendance is confirmed by both sides.</p>
        </li>
        <li class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
            <AppIcon name="check" :size="15" />
          </span>
          <p class="text-sm text-muted"><span class="text-ink">Built-in classroom.</span> WebRTC video, screen sharing and a session timer inside the app.</p>
        </li>
        <li class="flex gap-3">
          <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
            <AppIcon name="check" :size="15" />
          </span>
          <p class="text-sm text-muted"><span class="text-ink">Fair by design.</span> A guitar lesson and a coding lesson are worth exactly the same.</p>
        </li>
      </ul>

      <div class="pp-hairline mt-8 pt-6">
        <p class="text-xs text-muted">
          PeerPulse uses Firebase Authentication and Firestore in production; this build is running the
          <span class="text-ink">{{ env.backendMode }}</span> backend adapter.
        </p>
      </div>
    </aside>
  </div>
</template>
