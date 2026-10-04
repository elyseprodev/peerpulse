<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { PrivacySettings } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useWalletStore } from '@/stores/wallet'
import { useBookingStore } from '@/stores/bookings'
import { env } from '@/lib/env'
import { getBackend } from '@/lib/backend'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppModal from '@/components/ui/AppModal.vue'

const auth = useAuthStore()
const ui = useUiStore()
const wallet = useWalletStore()
const bookings = useBookingStore()

const saving = ref(false)
const passwordOpen = ref(false)
const deleteOpen = ref(false)
const passwordForm = reactive({ current: '', next: '', confirm: '' })
const passwordError = ref<string | null>(null)

const privacy = reactive<PrivacySettings>({
  profileVisibility: 'public',
  showEmail: false,
  showAvailability: true,
  allowDirectRequests: true,
  appearInDiscovery: true,
})

onMounted(() => {
  if (auth.profile) Object.assign(privacy, auth.profile.privacy)
})

async function savePrivacy(): Promise<void> {
  saving.value = true
  try {
    await auth.saveProfile({ privacy: { ...privacy } })
    ui.success('Privacy updated', 'Your settings apply immediately across the exchange.')
  } catch (e) {
    ui.error('Could not save privacy settings', auth.errorMessage(e))
  } finally {
    saving.value = false
  }
}

async function changePassword(): Promise<void> {
  passwordError.value = null
  if (passwordForm.next !== passwordForm.confirm) {
    passwordError.value = 'The new passwords do not match.'
    return
  }
  saving.value = true
  try {
    const backend = await getBackend()
    await backend.changePassword(passwordForm.current, passwordForm.next)
    passwordOpen.value = false
    passwordForm.current = ''
    passwordForm.next = ''
    passwordForm.confirm = ''
    ui.success('Password changed', 'Use your new password the next time you sign in.')
  } catch (e) {
    passwordError.value = auth.errorMessage(e)
  } finally {
    saving.value = false
  }
}

/** Export everything the member owns, as JSON, from the backend. */
async function exportData(): Promise<void> {
  if (!auth.profile) return
  const backend = await getBackend()
  const [profile, transactions, allBookings, reviews, notifications] = await Promise.all([
    backend.getUser(auth.profile.uid),
    backend.listTransactions(auth.profile.uid, { limit: 500 }),
    backend.listBookings(auth.profile.uid),
    backend.listReviewsForUser(auth.profile.uid),
    backend.listNotifications(auth.profile.uid),
  ])
  const payload = {
    exportedAt: new Date().toISOString(),
    wallet: await backend.getWallet(auth.profile.uid),
    profile,
    transactions,
    bookings: allBookings,
    reviews,
    notifications,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `peerpulse-export-${auth.profile.uid}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  ui.success('Export ready', 'Your data has been downloaded as JSON.')
}

async function resetDemo(): Promise<void> {
  const backend = await getBackend()
  const local = backend as unknown as { resetDemoData?: () => Promise<void> }
  if (!local.resetDemoData) return
  await local.resetDemoData()
  await auth.init()
  ui.success('Demo data reset', 'The example exchange has been rebuilt.')
}

async function enablePush(): Promise<void> {
  ui.info(
    'Push notifications',
    env.fcmVapidKey
      ? 'Requesting browser permission…'
      : 'Configure VITE_FCM_VAPID_KEY and deploy the Cloud Function that sends Web Push messages to enable this.',
  )
}

function requestDeletion(): void {
  deleteOpen.value = true
}
</script>

<template>
  <div class="pp-container max-w-4xl py-10">
    <header>
      <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Settings & privacy</h1>
      <p class="mt-2 text-sm text-muted">
        Control what other members can see, manage your credentials and take your data with you whenever you like.
      </p>
    </header>

    <div class="mt-8 space-y-6">
      <!-- Privacy -->
      <section class="pp-card p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-lg font-semibold text-ink">Visibility & discovery</h2>
          <AppButton size="sm" :loading="saving" icon="check" @click="savePrivacy">Save privacy</AppButton>
        </div>

        <div class="mt-5 space-y-4">
          <div>
            <p class="text-sm font-medium text-ink">Who can see your profile</p>
            <div class="mt-2 grid gap-2 sm:grid-cols-3">
              <button
                v-for="option in [
                  { value: 'public', label: 'Public', hint: 'Anyone, including search engines' },
                  { value: 'members', label: 'Members only', hint: 'Signed-in members' },
                  { value: 'private', label: 'Private', hint: 'Only you' },
                ]"
                :key="option.value"
                type="button"
                class="rounded-xl border p-3 text-left transition"
                :class="
                  privacy.profileVisibility === option.value
                    ? 'border-brand/40 bg-brand/8'
                    : 'border-line hover:border-brand/30'
                "
                :aria-pressed="privacy.profileVisibility === option.value"
                @click="privacy.profileVisibility = option.value as PrivacySettings['profileVisibility']"
              >
                <span class="block text-sm font-medium text-ink">{{ option.label }}</span>
                <span class="mt-0.5 block text-[11px] text-muted">{{ option.hint }}</span>
              </button>
            </div>
          </div>

          <ul class="space-y-3">
            <li v-for="toggle in [
              { key: 'appearInDiscovery', label: 'Appear in member discovery', hint: 'Unlisted members can still be found via direct links to their listings.' },
              { key: 'showAvailability', label: 'Show my availability', hint: 'Hides your weekly windows from public profiles.' },
              { key: 'allowDirectRequests', label: 'Allow booking requests', hint: 'Turn off to pause new sessions without removing your listings.' },
              { key: 'showEmail', label: 'Show my email on my profile', hint: 'Off by default. Messaging happens through bookings.' },
            ]" :key="toggle.key" class="flex items-start justify-between gap-4 rounded-xl border border-line/70 bg-canvas/30 p-4">
              <div>
                <p class="text-sm font-medium text-ink">{{ toggle.label }}</p>
                <p class="mt-0.5 text-[11px] text-muted">{{ toggle.hint }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="privacy[toggle.key as keyof PrivacySettings] as boolean"
                :aria-label="toggle.label"
                class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition"
                :class="
                  privacy[toggle.key as keyof PrivacySettings]
                    ? 'border-brand/40 bg-brand/25'
                    : 'border-line bg-canvas'
                "
                @click="(privacy[toggle.key as keyof PrivacySettings] as boolean) = !privacy[toggle.key as keyof PrivacySettings]"
              >
                <span
                  class="absolute top-0.5 size-5 rounded-full transition-all"
                  :class="privacy[toggle.key as keyof PrivacySettings] ? 'left-5 bg-brand' : 'left-0.5 bg-muted'"
                />
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- Account -->
      <section class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Account</h2>
        <dl class="mt-4 space-y-3 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <dt class="text-muted">Email</dt>
            <dd class="text-ink">{{ auth.profile?.email }}</dd>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <dt class="text-muted">Member since</dt>
            <dd class="text-ink">{{ auth.profile ? new Date(auth.profile.createdAt).toLocaleDateString() : '—' }}</dd>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <dt class="text-muted">Role</dt>
            <dd>
              <AppBadge :tone="auth.isAdmin ? 'cyan' : 'muted'">{{ auth.profile?.role }}</AppBadge>
            </dd>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <dt class="text-muted">Authentication provider</dt>
            <dd class="text-ink">{{ env.backendMode === 'firebase' ? 'Firebase Authentication' : 'Local demo backend' }}</dd>
          </div>
        </dl>
        <div class="mt-5 flex flex-wrap gap-3">
          <AppButton variant="secondary" icon="lock" @click="passwordOpen = true">Change password</AppButton>
          <AppButton v-if="env.backendMode === 'firebase'" variant="secondary" icon="mail" to="/forgot-password">
            Send reset email
          </AppButton>
        </div>
      </section>

      <!-- Notifications -->
      <section class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Notifications</h2>
        <p class="mt-2 text-sm text-muted">
          In-app notifications are always on. Browser push uses Firebase Cloud Messaging and needs to be configured for
          the deployment before it can be enabled.
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <AppButton variant="secondary" icon="bell" @click="enablePush">Enable browser push</AppButton>
          <RouterLink to="/notifications" class="inline-flex items-center gap-2 text-sm text-brand-bright hover:underline">
            View in-app notifications <AppIcon name="chevron-right" :size="14" />
          </RouterLink>
        </div>
        <p v-if="!env.fcmVapidKey" class="mt-3 rounded-xl border border-line/70 bg-canvas/40 p-3 text-[11px] text-muted">
          <code class="text-ink">VITE_FCM_VAPID_KEY</code> is not set, so push is unavailable in this build. Notifications
          are still delivered in-app and recorded in Firestore.
        </p>
      </section>

      <!-- Appearance -->
      <section class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Appearance</h2>
        <p class="mt-2 text-sm text-muted">
          PeerPulse is designed dark-first. A light theme is available for high-ambient-light settings and respects
          your system preference on first visit.
        </p>
        <div class="mt-4 flex gap-2">
          <button
            type="button"
            class="rounded-xl border px-4 py-2 text-sm transition"
            :class="ui.theme === 'dark' ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted'"
            @click="ui.setTheme('dark')"
          >
            Dark
          </button>
          <button
            type="button"
            class="rounded-xl border px-4 py-2 text-sm transition"
            :class="ui.theme === 'light' ? 'border-brand/40 bg-brand/12 text-brand-bright' : 'border-line text-muted'"
            @click="ui.setTheme('light')"
          >
            Light
          </button>
        </div>
      </section>

      <!-- Data -->
      <section class="pp-card p-6">
        <h2 class="font-display text-lg font-semibold text-ink">Your data</h2>
        <p class="mt-2 text-sm text-muted">
          Export a complete copy of your profile, bookings, reviews, notifications and token ledger at any time.
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <AppButton variant="secondary" icon="chart" @click="exportData">Export my data (JSON)</AppButton>
          <AppButton v-if="env.backendMode === 'local'" variant="ghost" icon="refresh" @click="resetDemo">
            Reset demo data
          </AppButton>
          <AppButton variant="danger" icon="alert" @click="requestDeletion">Request account deletion</AppButton>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
            <p class="text-[11px] tracking-wide text-muted uppercase">Transactions</p>
            <p class="font-display mt-1 text-lg font-bold text-ink">{{ wallet.transactions.length }}</p>
          </div>
          <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
            <p class="text-[11px] tracking-wide text-muted uppercase">Bookings</p>
            <p class="font-display mt-1 text-lg font-bold text-ink">{{ bookings.bookings.length }}</p>
          </div>
          <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
            <p class="text-[11px] tracking-wide text-muted uppercase">Balance</p>
            <p class="font-display mt-1 text-lg font-bold text-ink">{{ wallet.balance }} TT</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Password modal -->
    <AppModal :open="passwordOpen" title="Change your password" size="sm" @close="passwordOpen = false">
      <div class="space-y-4">
        <AppInput v-model="passwordForm.current" label="Current password" type="password" autocomplete="current-password" />
        <AppInput v-model="passwordForm.next" label="New password" type="password" autocomplete="new-password" hint="At least 8 characters." />
        <AppInput v-model="passwordForm.confirm" label="Confirm new password" type="password" autocomplete="new-password" />
        <p v-if="passwordError" class="rounded-xl border border-danger/35 bg-danger/10 p-3 text-xs text-danger" role="alert">
          {{ passwordError }}
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="passwordOpen = false">Cancel</AppButton>
        <AppButton :loading="saving" icon="lock" @click="changePassword">Update password</AppButton>
      </template>
    </AppModal>

    <!-- Deletion modal -->
    <AppModal
      :open="deleteOpen"
      title="Request account deletion"
      description="Deletion is reviewed by a steward so that open bookings and unsettled sessions can be handled fairly."
      size="sm"
      @close="deleteOpen = false"
    >
      <div class="space-y-3 text-sm text-muted">
        <p>When your account is deleted:</p>
        <ul class="space-y-2">
          <li class="flex gap-2"><AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" /> Your profile, listings and community posts are removed.</li>
          <li class="flex gap-2"><AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" /> Open bookings are cancelled under the standard refund rules.</li>
          <li class="flex gap-2"><AppIcon name="check" :size="15" class="mt-0.5 text-brand-bright" /> Token ledger entries are retained in anonymised form so the exchange still balances.</li>
          <li class="flex gap-2"><AppIcon name="alert" :size="15" class="mt-0.5 text-danger" /> Any remaining Time Tokens are returned to the community pool — they have no cash value.</li>
        </ul>
        <p class="rounded-xl border border-line/70 bg-canvas/40 p-3 text-xs">
          Send a deletion request from your registered email to <span class="text-ink">stewards@peerpulse.app</span>, or
          contact a moderator in your community. In production, an administrator completes the deletion and records the
          reason.
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="deleteOpen = false">Close</AppButton>
        <AppButton variant="secondary" icon="mail" href="mailto:stewards@peerpulse.app?subject=Account%20deletion%20request">
          Email the stewards
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
