<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useNotificationStore } from '@/stores/notifications'
import { useWalletStore } from '@/stores/wallet'
import { env } from '@/lib/env'
import AppLogo from '../ui/AppLogo.vue'
import AppButton from '../ui/AppButton.vue'
import AppAvatar from '../ui/AppAvatar.vue'
import AppIcon from '../ui/AppIcon.vue'
import AppToasts from '../ui/AppToasts.vue'

const auth = useAuthStore()
const ui = useUiStore()
const notifications = useNotificationStore()
const wallet = useWalletStore()
const route = useRoute()
const router = useRouter()

const scrolled = ref(false)
const userMenuOpen = ref(false)
const bellOpen = ref(false)

const GUEST_LINKS: { to: string; label: string; icon?: string }[] = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/skills', label: 'Explore skills' },
  { to: '/communities', label: 'Communities' },
]

const MEMBER_LINKS: { to: string; label: string; icon: string }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/skills', label: 'Skills', icon: 'search' },
  { to: '/bookings', label: 'Bookings', icon: 'calendar' },
  { to: '/wallet', label: 'Wallet', icon: 'wallet' },
  { to: '/communities', label: 'Communities', icon: 'users' },
]

const isActive = (path: string) => route.path === path || (path !== '/' && route.path.startsWith(`${path}/`))

const me = computed(() => auth.profile)
const balance = computed(() => (wallet.wallet ? wallet.wallet.balance : null))
const unread = computed(() => notifications.unreadCount)
const backendBadge = computed(() => (env.backendMode === 'local' ? 'Demo backend' : 'Firebase'))

function onScroll(): void {
  scrolled.value = window.scrollY > 8
}

watch(
  () => route.fullPath,
  () => {
    ui.mobileNavOpen = false
    userMenuOpen.value = false
    bellOpen.value = false
  },
)

watch(
  () => auth.profile?.uid,
  async (uid) => {
    if (!uid) return
    await Promise.all([notifications.load(uid), wallet.load(uid)])
  },
  { immediate: true },
)

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

async function signOut(): Promise<void> {
  await auth.signOut()
  notifications.dispose()
  wallet.dispose()
  await router.push('/')
  ui.info('Signed out', 'See you next session.')
}
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-xl focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
    >
      Skip to content
    </a>

    <header
      class="sticky top-0 z-50 transition-all duration-300"
      :class="scrolled ? 'pp-glass border-b border-line/60 shadow-card' : 'border-b border-transparent'"
    >
      <div class="pp-container flex h-16 items-center justify-between gap-4">
        <RouterLink to="/" aria-label="PeerPulse home" class="shrink-0 rounded-xl">
          <AppLogo />
        </RouterLink>

        <nav class="hidden items-center gap-1 lg:flex" aria-label="Main">
          <template v-if="auth.isAuthenticated">
            <RouterLink
              v-for="link in MEMBER_LINKS"
              :key="link.to"
              :to="link.to"
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
              :class="isActive(link.to) ? 'bg-brand/12 text-brand-bright' : 'text-muted hover:bg-white/5 hover:text-ink'"
            >
              <AppIcon :name="link.icon" :size="16" />
              {{ link.label }}
            </RouterLink>
            <RouterLink
              v-if="auth.isAdmin"
              to="/admin"
              class="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
              :class="isActive('/admin') ? 'bg-cyan/12 text-cyan' : 'text-muted hover:bg-white/5 hover:text-ink'"
            >
              <AppIcon name="shield" :size="16" />
              Admin
            </RouterLink>
          </template>
          <template v-else>
            <RouterLink
              v-for="link in GUEST_LINKS"
              :key="link.to"
              :to="link.to"
              class="rounded-xl px-3 py-2 text-sm font-medium transition-colors"
              :class="isActive(link.to) ? 'bg-brand/12 text-brand-bright' : 'text-muted hover:bg-white/5 hover:text-ink'"
            >
              {{ link.label }}
            </RouterLink>
          </template>
        </nav>

        <div class="flex items-center gap-2">
          <RouterLink
            v-if="auth.isAuthenticated && balance !== null"
            to="/wallet"
            class="hidden items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand-bright transition hover:bg-brand/20 sm:inline-flex"
            :aria-label="`Time Token wallet, ${balance} tokens available`"
          >
            <AppIcon name="tokens" :size="15" />
            {{ balance }} <span class="font-normal text-muted">TT</span>
          </RouterLink>

          <button
            v-if="auth.isAuthenticated"
            type="button"
            class="rounded-xl p-2 text-muted transition hover:bg-white/5 hover:text-ink"
            :aria-label="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="ui.toggleTheme()"
          >
            <AppIcon :name="ui.theme === 'dark' ? 'spark' : 'eye'" :size="18" />
          </button>

          <div v-if="auth.isAuthenticated" class="relative">
            <button
              type="button"
              class="relative rounded-xl p-2 text-muted transition hover:bg-white/5 hover:text-ink"
              aria-label="Notifications"
              :aria-expanded="bellOpen"
              @click="((bellOpen = !bellOpen), (userMenuOpen = false))"
            >
              <AppIcon name="bell" :size="18" />
              <span
                v-if="unread"
                class="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand"
              >
                {{ unread > 9 ? '9+' : unread }}
              </span>
            </button>
            <div
              v-if="bellOpen"
              class="pp-card absolute right-0 mt-2 w-80 max-w-[85vw] overflow-hidden p-0"
              role="menu"
            >
              <div class="pp-hairline flex items-center justify-between px-4 py-3">
                <p class="text-sm font-semibold text-ink">Notifications</p>
                <button
                  v-if="unread && me"
                  type="button"
                  class="text-[11px] text-brand-bright hover:underline"
                  @click="notifications.markAllRead(me.uid)"
                >
                  Mark all read
                </button>
              </div>
              <ul v-if="notifications.items.length" class="max-h-80 overflow-y-auto">
                <li v-for="item in notifications.items.slice(0, 6)" :key="item.id">
                  <RouterLink
                    :to="item.link ?? '/notifications'"
                    class="block px-4 py-3 transition hover:bg-white/4"
                    @click="notifications.markRead(item.id)"
                  >
                    <p class="flex items-center gap-2 text-xs font-semibold" :class="item.read ? 'text-muted' : 'text-ink'">
                      <span v-if="!item.read" class="size-1.5 shrink-0 rounded-full bg-brand" />
                      {{ item.title }}
                    </p>
                    <p class="mt-0.5 line-clamp-2 text-[11px] text-muted">{{ item.body }}</p>
                  </RouterLink>
                </li>
              </ul>
              <p v-else class="px-4 py-6 text-center text-xs text-muted">Nothing new yet.</p>
              <RouterLink
                to="/notifications"
                class="pp-hairline block px-4 py-3 text-center text-xs font-medium text-brand-bright hover:bg-white/4"
              >
                View all notifications
              </RouterLink>
            </div>
          </div>

          <div v-if="auth.isAuthenticated && me" class="relative">
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-white/5"
              aria-label="Account menu"
              :aria-expanded="userMenuOpen"
              @click="((userMenuOpen = !userMenuOpen), (bellOpen = false))"
            >
              <AppAvatar :display-name="me.displayName" :seed="me.avatarSeed" :photo-url="me.photoURL" :size="32" />
              <AppIcon name="chevron-down" :size="15" class="text-muted" />
            </button>
            <div v-if="userMenuOpen" class="pp-card absolute right-0 mt-2 w-56 overflow-hidden p-1.5" role="menu">
              <div class="px-3 py-2">
                <p class="truncate text-sm font-semibold text-ink">{{ me.displayName }}</p>
                <p class="truncate text-[11px] text-muted">{{ me.email }}</p>
              </div>
              <RouterLink
                to="/profile"
                class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-ink"
                role="menuitem"
              >
                <AppIcon name="users" :size="16" /> My profile
              </RouterLink>
              <RouterLink
                to="/settings"
                class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-ink"
                role="menuitem"
              >
                <AppIcon name="settings" :size="16" /> Settings & privacy
              </RouterLink>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-ink"
                role="menuitem"
                @click="signOut"
              >
                <AppIcon name="logout" :size="16" /> Sign out
              </button>
            </div>
          </div>

          <template v-else>
            <AppButton to="/signin" variant="ghost" size="sm">Sign in</AppButton>
            <AppButton to="/register" size="sm" icon-right="arrow-right">Join free</AppButton>
          </template>

          <button
            type="button"
            class="rounded-xl p-2 text-muted transition hover:bg-white/5 hover:text-ink lg:hidden"
            :aria-expanded="ui.mobileNavOpen"
            aria-label="Toggle navigation menu"
            @click="ui.mobileNavOpen = !ui.mobileNavOpen"
          >
            <AppIcon :name="ui.mobileNavOpen ? 'close' : 'menu'" :size="20" />
          </button>
        </div>
      </div>

      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="-translate-y-2 opacity-0"
      >
        <nav v-if="ui.mobileNavOpen" class="pp-glass lg:hidden" aria-label="Mobile">
          <div class="pp-container space-y-1 py-3">
            <RouterLink
              v-for="link in auth.isAuthenticated ? MEMBER_LINKS : GUEST_LINKS"
              :key="link.to"
              :to="link.to"
              class="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition"
              :class="isActive(link.to) ? 'bg-brand/12 text-brand-bright' : 'text-muted hover:bg-white/5 hover:text-ink'"
            >
              <AppIcon v-if="link.icon" :name="link.icon" :size="17" />
              {{ link.label }}
            </RouterLink>
            <RouterLink
              v-if="auth.isAdmin"
              to="/admin"
              class="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-cyan transition hover:bg-white/5"
            >
              <AppIcon name="shield" :size="17" /> Admin
            </RouterLink>
            <div class="pp-hairline flex items-center justify-between pt-3">
              <span class="text-[11px] text-muted">Backend: {{ backendBadge }}</span>
              <button type="button" class="text-[11px] text-brand-bright" @click="ui.toggleTheme()">
                {{ ui.theme === 'dark' ? 'Light theme' : 'Dark theme' }}
              </button>
            </div>
          </div>
        </nav>
      </Transition>
    </header>

    <main id="main" class="flex-1 pb-16">
      <slot />
    </main>

    <footer class="pp-hairline mt-auto border-line/60 bg-surface/40">
      <div class="pp-container grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <AppLogo />
          <p class="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            Trade Time. Share Skills. Grow Together. PeerPulse runs on time, not money — every hour you teach earns
            an hour you can learn.
          </p>
          <p class="mt-4 inline-flex items-center gap-2 rounded-full border border-line/70 px-3 py-1 text-[11px] text-muted">
            <AppIcon name="shield" :size="13" />
            Time Tokens are credit for time. They are not money and cannot be bought, sold or withdrawn.
          </p>
        </div>
        <nav aria-label="Platform">
          <p class="font-display text-xs font-semibold tracking-[0.14em] text-ink uppercase">Platform</p>
          <ul class="mt-4 space-y-2.5 text-sm text-muted">
            <li><RouterLink to="/how-it-works" class="hover:text-brand-bright">How it works</RouterLink></li>
            <li><RouterLink to="/skills" class="hover:text-brand-bright">Explore skills</RouterLink></li>
            <li><RouterLink to="/communities" class="hover:text-brand-bright">Communities</RouterLink></li>
            <li><RouterLink to="/members" class="hover:text-brand-bright">Members</RouterLink></li>
          </ul>
        </nav>
        <nav aria-label="Trust">
          <p class="font-display text-xs font-semibold tracking-[0.14em] text-ink uppercase">Trust & safety</p>
          <ul class="mt-4 space-y-2.5 text-sm text-muted">
            <li><RouterLink to="/community-guidelines" class="hover:text-brand-bright">Community guidelines</RouterLink></li>
            <li><RouterLink to="/privacy" class="hover:text-brand-bright">Privacy</RouterLink></li>
            <li><RouterLink to="/terms" class="hover:text-brand-bright">Terms of exchange</RouterLink></li>
            <li><RouterLink to="/how-it-works#disputes" class="hover:text-brand-bright">Dispute process</RouterLink></li>
          </ul>
        </nav>
        <nav aria-label="Account">
          <p class="font-display text-xs font-semibold tracking-[0.14em] text-ink uppercase">Your account</p>
          <ul class="mt-4 space-y-2.5 text-sm text-muted">
            <li><RouterLink to="/register" class="hover:text-brand-bright">Create an account</RouterLink></li>
            <li><RouterLink to="/signin" class="hover:text-brand-bright">Sign in</RouterLink></li>
            <li><RouterLink to="/wallet" class="hover:text-brand-bright">Time Token wallet</RouterLink></li>
            <li><RouterLink to="/calendar" class="hover:text-brand-bright">Booking calendar</RouterLink></li>
          </ul>
        </nav>
      </div>
      <div class="pp-hairline border-line/60">
        <div class="pp-container flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted sm:flex-row">
          <p>© {{ new Date().getFullYear() }} PeerPulse. Built for community skill exchange.</p>
          <p class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5">
              <span class="size-1.5 rounded-full bg-brand" /> Backend: {{ backendBadge }}
            </span>
          </p>
        </div>
      </div>
    </footer>

    <AppToasts />
  </div>
</template>
