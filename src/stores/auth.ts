import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserProfile, UserRole } from '@shared/domain'
import { getBackend, isBackendError, type AuthSession, type PeerPulseBackend, type SignUpInput } from '@/lib/backend'

/**
 * Session + profile state.
 *
 * The store never decides permissions on its own: `isAdmin` mirrors the role on
 * the member document, and every privileged backend call is re-checked
 * server-side (Firestore rules + Cloud Function assertions).
 */
export const useAuthStore = defineStore('auth', () => {
  const backend = ref<PeerPulseBackend | null>(null)
  const session = ref<AuthSession | null>(null)
  const profile = ref<UserProfile | null>(null)
  const ready = ref(false)
  const loading = ref(false)
  let unsubscribe: (() => void) | null = null

  const isAuthenticated = computed(() => Boolean(session.value && profile.value))
  const isAdmin = computed(() => profile.value?.role === 'admin')
  const needsOnboarding = computed(() => Boolean(profile.value && !profile.value.onboarding.completed))
  const displayName = computed(() => profile.value?.displayName ?? session.value?.displayName ?? 'Guest')
  const tokenBalance = computed(() => profile.value?.stats.tokensEarned ?? 0)

  async function init(): Promise<void> {
    if (backend.value) return
    const instance = await getBackend()
    backend.value = instance
    unsubscribe?.()
    unsubscribe = instance.onSessionChange(async (next) => {
      session.value = next
      profile.value = next ? await instance.getUser(next.uid) : null
      ready.value = true
    })
    if (!session.value) ready.value = true
  }

  async function refreshProfile(): Promise<void> {
    if (!backend.value || !session.value) return
    profile.value = await backend.value.getUser(session.value.uid)
  }

  async function signIn(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      const instance = await getBackend()
      backend.value = instance
      const next = await instance.signIn(email, password)
      session.value = next
      profile.value = await instance.getUser(next.uid)
      ready.value = true
    } finally {
      loading.value = false
    }
  }

  async function signUp(input: SignUpInput): Promise<void> {
    loading.value = true
    try {
      const instance = await getBackend()
      backend.value = instance
      const next = await instance.signUp(input)
      session.value = next
      profile.value = await instance.getUser(next.uid)
      ready.value = true
    } finally {
      loading.value = false
    }
  }

  async function signInAsDemo(role: UserRole = 'member', uid?: string): Promise<void> {
    const instance = await getBackend()
    backend.value = instance
    if (!instance.signInAsDemo) {
      throw new Error('Demo accounts are only available in local mode.')
    }
    const next = await instance.signInAsDemo(role, uid)
    session.value = next
    profile.value = await instance.getUser(next.uid)
    ready.value = true
  }

  async function signOut(): Promise<void> {
    if (!backend.value) return
    await backend.value.signOut()
    session.value = null
    profile.value = null
  }

  async function saveProfile(patch: Partial<UserProfile>): Promise<void> {
    if (!backend.value || !profile.value) return
    profile.value = await backend.value.saveProfile(profile.value.uid, patch)
  }

  async function saveOnboarding(
    patch: Partial<UserProfile>,
    onboarding: Partial<UserProfile['onboarding']>,
  ): Promise<void> {
    if (!backend.value || !profile.value) return
    profile.value = await backend.value.saveOnboarding(profile.value.uid, patch, onboarding)
  }

  /** Translate backend errors into field-level messages for forms. */
  function fieldErrors(error: unknown): Record<string, string> {
    if (isBackendError(error)) return error.fields ?? {}
    return {}
  }

  function errorMessage(error: unknown): string {
    if (isBackendError(error)) return error.message
    if (error instanceof Error) return error.message
    return 'Something went wrong. Please try again.'
  }

  return {
    backend,
    session,
    profile,
    ready,
    loading,
    isAuthenticated,
    isAdmin,
    needsOnboarding,
    displayName,
    tokenBalance,
    init,
    refreshProfile,
    signIn,
    signUp,
    signInAsDemo,
    signOut,
    saveProfile,
    saveOnboarding,
    fieldErrors,
    errorMessage,
  }
})
