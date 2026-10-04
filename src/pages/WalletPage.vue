<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { TokenTransaction } from '@shared/domain'
import { availableBalance } from '@shared/tokenPolicy'
import { useAuthStore } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import { useBookingStore } from '@/stores/bookings'
import { formatDateTimeRange, formatDuration, formatRelative } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppStat from '@/components/ui/AppStat.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import TokenExplainer from '@/components/wallet/TokenExplainer.vue'

const auth = useAuthStore()
const wallet = useWalletStore()
const bookings = useBookingStore()

type Filter = 'all' | 'credit' | 'debit' | 'pending'
const filter = ref<Filter>('all')

const uid = computed(() => auth.profile?.uid ?? '')
const spendable = computed(() => (wallet.wallet ? availableBalance(wallet.wallet) : 0))

const TX_TYPE_LABELS: Record<string, string> = {
  signup_grant: 'Welcome grant',
  credit: 'Session earned',
  debit: 'Session spent',
  escrow_hold: 'Tokens reserved',
  escrow_release: 'Reserved tokens used',
  refund: 'Refund',
  admin_adjustment: 'Steward adjustment',
  penalty: 'Policy adjustment',
}

const filtered = computed(() => {
  switch (filter.value) {
    case 'credit':
      return wallet.transactions.filter((t) => t.direction === 'credit')
    case 'debit':
      return wallet.transactions.filter((t) => t.direction === 'debit')
    case 'pending':
      return wallet.transactions.filter((t) => t.status === 'pending')
    default:
      return wallet.transactions
  }
})

/** Sessions that will settle soon — shown as expected movements. */
const upcomingValue = computed(() =>
  bookings.upcoming.reduce(
    (acc, booking) => {
      if (booking.teacherUid === uid.value) acc.earn += booking.tokenAmount
      else acc.spend += booking.tokenAmount
      return acc
    },
    { earn: 0, spend: 0 },
  ),
)

function txTone(tx: TokenTransaction): 'brand' | 'danger' | 'warn' | 'muted' {
  if (tx.status === 'pending') return 'warn'
  if (tx.status === 'reversed') return 'muted'
  return tx.direction === 'credit' ? 'brand' : 'danger'
}

onMounted(async () => {
  if (!uid.value) return
  await Promise.all([wallet.load(uid.value), bookings.load(uid.value)])
})
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Time Token wallet</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Your balance, your history and the rules behind every movement. Nothing here can be bought, sold or withdrawn
          — tokens are credit for time given and time received.
        </p>
      </div>
      <AppButton to="/bookings" variant="secondary" icon="calendar">View bookings</AppButton>
    </header>

    <AppSkeleton v-if="wallet.loading && !wallet.wallet" class="mt-8" card :lines="3" />

    <template v-else>
      <!-- Balance hero -->
      <section class="pp-card mt-8 overflow-hidden">
        <div class="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
          <div class="p-6 sm:p-8">
            <p class="text-xs tracking-wide text-muted uppercase">Available balance</p>
            <p class="font-display mt-2 flex items-baseline gap-3 text-5xl font-extrabold tracking-tight text-ink">
              {{ wallet.balance }}
              <span class="text-base font-medium text-muted">Time Tokens</span>
            </p>
            <p class="mt-2 text-sm text-muted">
              ≈ {{ wallet.balance }} hours of learning credit · {{ spendable }} spendable right now
              <template v-if="wallet.held"> ({{ wallet.held }} reserved for confirmed sessions)</template>
            </p>

            <div class="mt-6 grid gap-3 sm:grid-cols-3">
              <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
                <p class="text-[11px] tracking-wide text-muted uppercase">Earned (teaching)</p>
                <p class="font-display mt-1 text-lg font-bold text-brand-bright">+{{ wallet.earned }}</p>
              </div>
              <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
                <p class="text-[11px] tracking-wide text-muted uppercase">Spent (learning)</p>
                <p class="font-display mt-1 text-lg font-bold text-danger">−{{ wallet.spent }}</p>
              </div>
              <div class="rounded-xl border border-line/70 bg-canvas/40 p-3">
                <p class="text-[11px] tracking-wide text-muted uppercase">Welcome grant</p>
                <p class="font-display mt-1 text-lg font-bold text-ink">{{ wallet.granted }}</p>
              </div>
            </div>
          </div>

          <div class="border-t border-line/60 bg-canvas/40 p-6 sm:p-8 lg:border-t-0 lg:border-l">
            <p class="text-xs tracking-wide text-muted uppercase">Expected movements</p>
            <div class="mt-4 space-y-3">
              <div class="flex items-center justify-between rounded-xl border border-brand/25 bg-brand/8 px-4 py-3">
                <span class="text-xs text-muted">You will earn from {{ bookings.upcoming.filter((b) => b.teacherUid === uid).length }} upcoming sessions</span>
                <span class="font-mono text-sm text-brand-bright">+{{ upcomingValue.earn }} TT</span>
              </div>
              <div class="flex items-center justify-between rounded-xl border border-danger/25 bg-danger/8 px-4 py-3">
                <span class="text-xs text-muted">You will spend on {{ bookings.upcoming.filter((b) => b.learnerUid === uid).length }} upcoming sessions</span>
                <span class="font-mono text-sm text-danger">−{{ upcomingValue.spend }} TT</span>
              </div>
            </div>

            <div v-if="wallet.pending.length" class="mt-5">
              <p class="text-xs font-medium text-warn">{{ wallet.pending.length }} pending transaction(s)</p>
              <ul class="mt-2 space-y-2">
                <li v-for="tx in wallet.pending.slice(0, 3)" :key="tx.id" class="text-[11px] text-muted">
                  {{ tx.reason }} · {{ formatRelative(tx.createdAt) }}
                </li>
              </ul>
            </div>

            <p class="mt-5 rounded-xl border border-line/70 bg-surface/60 p-3 text-[11px] leading-relaxed text-muted">
              Wallet policy version <span class="font-mono text-ink">{{ wallet.wallet?.policyVersion }}</span> · last
              updated {{ wallet.wallet ? formatRelative(wallet.wallet.updatedAt) : '—' }} by
              <span class="font-mono">{{ wallet.wallet?.updatedBy }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Hours -->
      <section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Hours traded">
        <AppStat label="Teaching hours" :value="`${wallet.taughtHours}h`" hint="Verified and settled" icon="clock" tone="brand" />
        <AppStat label="Learning hours" :value="`${wallet.learnedHours}h`" hint="Verified and settled" icon="book" tone="cyan" />
        <AppStat label="Completed sessions" :value="auth.profile?.stats.sessionsCompleted ?? 0" hint="Both directions" icon="check" tone="brand" />
        <AppStat
          label="Average session"
          :value="`${formatDuration(bookings.past.length ? Math.round(bookings.past.reduce((s, b) => s + b.durationMinutes, 0) / bookings.past.length) : 0)}`"
          hint="Across your history"
          icon="hourglass"
          tone="warn"
        />
      </section>

      <div class="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <!-- Ledger -->
        <section aria-labelledby="ledger">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ledger" class="font-display text-lg font-semibold text-ink">Transaction history</h2>
            <div class="flex gap-1.5" role="tablist" aria-label="Filter transactions">
              <button
                v-for="option in (['all', 'credit', 'debit', 'pending'] as Filter[])"
                :key="option"
                type="button"
                role="tab"
                :aria-selected="filter === option"
                class="rounded-full border px-3 py-1.5 text-[11px] capitalize transition"
                :class="
                  filter === option
                    ? 'border-brand/40 bg-brand/12 text-brand-bright'
                    : 'border-line text-muted hover:border-brand/30 hover:text-ink'
                "
                @click="filter = option"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <ul v-if="filtered.length" class="mt-4 space-y-2.5">
            <li v-for="tx in filtered" :key="tx.id" class="pp-card p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <AppBadge :tone="txTone(tx)">{{ TX_TYPE_LABELS[tx.type] ?? tx.type }}</AppBadge>
                    <span v-if="tx.status === 'pending'" class="text-[11px] text-warn">Pending</span>
                    <span v-else-if="tx.status === 'reversed'" class="text-[11px] text-muted">Reversed</span>
                  </div>
                  <p class="mt-2 text-sm font-medium text-ink">{{ tx.reason }}</p>
                  <p class="mt-0.5 text-[11px] text-muted">
                    {{ formatRelative(tx.createdAt) }} · policy
                    <span class="font-mono">{{ tx.policyCode }}</span>
                    · id <span class="font-mono">{{ tx.id }}</span>
                  </p>
                </div>
                <div class="text-right">
                  <p
                    class="font-mono text-sm font-semibold"
                    :class="tx.direction === 'credit' ? 'text-brand-bright' : 'text-danger'"
                  >
                    {{ tx.direction === 'credit' ? '+' : '−' }}{{ tx.amount }} TT
                  </p>
                  <p v-if="tx.balanceAfter !== null" class="text-[11px] text-muted">balance {{ tx.balanceAfter }}</p>
                </div>
              </div>
            </li>
          </ul>

          <AppEmptyState
            v-else
            class="mt-4"
            icon="tokens"
            title="No transactions yet"
            description="Complete a session and both sides of the exchange will appear here with the verified minutes and the resulting balance."
            action-label="Book your first session"
            action-to="/skills"
          />
        </section>

        <!-- Explainer + settled sessions -->
        <aside class="space-y-6">
          <TokenExplainer :config="bookings.config" />

          <section v-if="bookings.past.length" class="pp-card p-5">
            <h2 class="font-display text-sm font-semibold text-ink">Settled sessions</h2>
            <ul class="mt-3 space-y-3">
              <li v-for="booking in bookings.past.slice(0, 5)" :key="booking.id" class="text-xs">
                <div class="flex items-center justify-between gap-3">
                  <span class="min-w-0 truncate text-ink">{{ booking.skillTitle }}</span>
                  <span
                    class="font-mono whitespace-nowrap"
                    :class="booking.teacherUid === uid ? 'text-brand-bright' : 'text-danger'"
                  >
                    {{ booking.teacherUid === uid ? '+' : '−' }}{{ booking.tokenAmount }}
                  </span>
                </div>
                <p class="mt-0.5 text-[10px] text-muted">
                  {{ formatDateTimeRange(booking.startAt, booking.endAt) }} ·
                  {{ booking.completion.verifiedMinutes ?? booking.durationMinutes }} min verified
                </p>
              </li>
            </ul>
          </section>

          <div class="pp-card p-5">
            <p class="flex items-center gap-2 text-sm font-semibold text-ink">
              <AppIcon name="shield" :size="16" class="text-brand-bright" /> Your balance is server-maintained
            </p>
            <p class="mt-2 text-xs leading-relaxed text-muted">
              No browser session can write a balance. Every movement is applied inside a database transaction by trusted
              server code, with a matching ledger row that can never be edited or deleted — only superseded by a new
              entry with its own reason.
            </p>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>
