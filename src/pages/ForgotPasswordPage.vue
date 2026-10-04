<script setup lang="ts">
import { ref } from 'vue'
import { getBackend } from '@/lib/backend'
import { env } from '@/lib/env'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppLogo from '@/components/ui/AppLogo.vue'

const email = ref('')
const submitting = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

async function submit(): Promise<void> {
  submitting.value = true
  error.value = null
  try {
    const backend = await getBackend()
    await backend.sendPasswordReset(email.value)
    sent.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not start the reset process.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="pp-container py-16">
    <div class="mx-auto w-full max-w-md">
      <RouterLink to="/" class="inline-block"><AppLogo /></RouterLink>
      <h1 class="font-display mt-8 text-2xl font-bold tracking-tight text-ink">Reset your password</h1>
      <p class="mt-2 text-sm text-muted">
        Enter the email you signed up with and we will send a secure reset link.
      </p>

      <div v-if="sent" class="pp-card mt-8 p-6" role="status">
        <span class="grid size-10 place-items-center rounded-xl bg-brand/12 text-brand-bright">
          <AppIcon name="mail" :size="18" />
        </span>
        <h2 class="font-display mt-4 text-base font-semibold text-ink">Check your inbox</h2>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          If an account exists for <span class="text-ink">{{ email }}</span>, a reset link is on its way. The link
          expires after one hour.
        </p>
        <p v-if="env.backendMode === 'local'" class="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          This deployment runs the in-browser demo backend, which has no email service. In production the reset link is
          delivered by Firebase Authentication. Demo passwords are shown on the sign-in page.
        </p>
        <div class="mt-5">
          <AppButton to="/signin" variant="secondary" size="sm" icon="arrow-left">Back to sign in</AppButton>
        </div>
      </div>

      <form v-else class="mt-8 space-y-5" novalidate @submit.prevent="submit">
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
        />
        <AppButton type="submit" block :loading="submitting" icon-right="arrow-right">Send reset link</AppButton>
        <p class="text-center text-xs text-muted">
          <RouterLink to="/signin" class="text-brand-bright hover:underline">Return to sign in</RouterLink>
        </p>
      </form>
    </div>
  </div>
</template>
