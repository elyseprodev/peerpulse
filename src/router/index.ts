import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Route table.
 *
 * `meta.requiresAuth` / `meta.requiresAdmin` are *UX* guards only. The real
 * authorisation lives in Firestore Security Rules and in the Cloud Functions,
 * so bypassing the router grants nothing.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('@/pages/LandingPage.vue'),
    meta: { title: 'Trade Time. Share Skills. Grow Together.' },
  },
  {
    path: '/how-it-works',
    name: 'how-it-works',
    component: () => import('@/pages/HowItWorksPage.vue'),
    meta: { title: 'How PeerPulse works' },
  },
  {
    path: '/skills',
    name: 'skills',
    component: () => import('@/pages/SkillsExplorePage.vue'),
    meta: { title: 'Explore skills' },
  },
  {
    path: '/skills/:id',
    name: 'skill-detail',
    component: () => import('@/pages/SkillDetailPage.vue'),
    meta: { title: 'Skill listing' },
  },
  {
    path: '/members',
    name: 'members',
    component: () => import('@/pages/MembersPage.vue'),
    meta: { title: 'Members' },
  },
  {
    path: '/members/:uid',
    name: 'member-profile',
    component: () => import('@/pages/MemberProfilePage.vue'),
    meta: { title: 'Member profile' },
  },
  {
    path: '/communities',
    name: 'communities',
    component: () => import('@/pages/CommunitiesPage.vue'),
    meta: { title: 'Communities' },
  },
  {
    path: '/communities/:id',
    name: 'community-detail',
    component: () => import('@/pages/CommunityDetailPage.vue'),
    meta: { title: 'Community' },
  },
  { path: '/signin', name: 'signin', component: () => import('@/pages/SignInPage.vue'), meta: { title: 'Sign in', guestOnly: true } },
  { path: '/register', name: 'register', component: () => import('@/pages/SignUpPage.vue'), meta: { title: 'Create your account', guestOnly: true } },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/pages/ForgotPasswordPage.vue'),
    meta: { title: 'Reset your password', guestOnly: true },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/pages/OnboardingPage.vue'),
    meta: { title: 'Set up your profile', requiresAuth: true },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/pages/DashboardPage.vue'),
    meta: { title: 'Dashboard', requiresAuth: true },
  },
  {
    path: '/bookings',
    name: 'bookings',
    component: () => import('@/pages/BookingsPage.vue'),
    meta: { title: 'Bookings', requiresAuth: true },
  },
  {
    path: '/calendar',
    name: 'calendar',
    component: () => import('@/pages/CalendarPage.vue'),
    meta: { title: 'Booking calendar', requiresAuth: true },
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('@/pages/WalletPage.vue'),
    meta: { title: 'Time Token wallet', requiresAuth: true },
  },
  {
    path: '/rooms/:roomId',
    name: 'video-room',
    component: () => import('@/pages/VideoRoomPage.vue'),
    meta: { title: 'Live session', requiresAuth: true },
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/pages/NotificationsPage.vue'),
    meta: { title: 'Notifications', requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/pages/ProfileEditPage.vue'),
    meta: { title: 'My profile', requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/SettingsPage.vue'),
    meta: { title: 'Settings & privacy', requiresAuth: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/pages/AdminPage.vue'),
    meta: { title: 'Administration', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/community-guidelines',
    name: 'guidelines',
    component: () => import('@/pages/GuidelinesPage.vue'),
    meta: { title: 'Community guidelines' },
  },
  { path: '/privacy', name: 'privacy', component: () => import('@/pages/PrivacyPage.vue'), meta: { title: 'Privacy' } },
  { path: '/terms', name: 'terms', component: () => import('@/pages/TermsPage.vue'), meta: { title: 'Terms of exchange' } },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { title: 'Page not found' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 96 }
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'signin', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'dashboard' }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: auth.needsOnboarding ? 'onboarding' : 'dashboard' }
  }
  if (auth.isAuthenticated && auth.needsOnboarding && to.name !== 'onboarding' && !to.meta.guestOnly) {
    return { name: 'onboarding' }
  }
  return true
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : null
  document.title = title ? `${title} · PeerPulse` : 'PeerPulse — Trade Time. Share Skills. Grow Together.'
})

export default router
