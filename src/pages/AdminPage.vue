<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { DisputeCase, ModerationReport, PlatformConfig, UserProfile } from '@shared/domain'
import { useAuthStore } from '@/stores/auth'
import { useAdminStore } from '@/stores/admin'
import { useUiStore } from '@/stores/ui'
import { env } from '@/lib/env'
import { formatRelative } from '@/lib/format'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppStat from '@/components/ui/AppStat.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'

const auth = useAuthStore()
const admin = useAdminStore()
const ui = useUiStore()

type Tab = 'overview' | 'reports' | 'disputes' | 'members' | 'ledger' | 'policy'
const tab = ref<Tab>('overview')

const reportModal = reactive({ open: false, report: null as ModerationReport | null, status: 'resolved' as ModerationReport['status'], resolution: '' })
const disputeModal = reactive({ open: false, dispute: null as DisputeCase | null, status: 'resolved_refund' as DisputeCase['status'], outcome: '' })
const walletModal = reactive({ open: false, member: null as UserProfile | null, amount: 1, reason: '' })
const saving = ref(false)

const policy = reactive({
  tokensPerHour: 1,
  partialHourRule: 'nearest' as PlatformConfig['token']['partialHourRule'],
  roundingIncrementMinutes: 15,
  minSessionMinutes: 15,
  maxSessionMinutes: 180,
  signupGrantAmount: 3,
  signupGrantEnabled: true,
  minNoticeHours: 2,
  maxAdvanceDays: 60,
  autoConfirm: false,
  reserveTokensOnConfirm: false,
  minVerifiedMinutes: 10,
  autoSettleAfterHours: 24,
  requireBothConfirmations: true,
  disputeWindowHours: 72,
  freeCancellationHours: 24,
  lateCancellationRefundRatio: 1,
  noShowPenaltyTokens: 0,
})

onMounted(async () => {
  await admin.loadDashboard()
  if (admin.config) {
    Object.assign(policy, {
      tokensPerHour: admin.config.token.tokensPerHour,
      partialHourRule: admin.config.token.partialHourRule,
      roundingIncrementMinutes: admin.config.token.roundingIncrementMinutes,
      minSessionMinutes: admin.config.token.minSessionMinutes,
      maxSessionMinutes: admin.config.token.maxSessionMinutes,
      signupGrantAmount: admin.config.token.signupGrantAmount,
      signupGrantEnabled: admin.config.token.signupGrantEnabled,
      minNoticeHours: admin.config.booking.minNoticeHours,
      maxAdvanceDays: admin.config.booking.maxAdvanceDays,
      autoConfirm: admin.config.booking.autoConfirm,
      reserveTokensOnConfirm: admin.config.booking.reserveTokensOnConfirm,
      minVerifiedMinutes: admin.config.settlement.minVerifiedMinutes,
      autoSettleAfterHours: admin.config.settlement.autoSettleAfterHours,
      requireBothConfirmations: admin.config.settlement.requireBothConfirmations,
      disputeWindowHours: admin.config.settlement.disputeWindowHours,
      freeCancellationHours: admin.config.cancellation.freeCancellationHours,
      lateCancellationRefundRatio: admin.config.cancellation.lateCancellationRefundRatio,
      noShowPenaltyTokens: admin.config.cancellation.noShowPenaltyTokens,
    })
  }
})

const metrics = computed(() => admin.metrics)
const openReports = computed(() => admin.reports.filter((r) => r.status === 'open' || r.status === 'reviewing'))
const openDisputes = computed(() => admin.disputes.filter((d) => d.status === 'open'))

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'reports', label: 'Reports', icon: 'flag' },
  { id: 'disputes', label: 'Disputes', icon: 'shield' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'ledger', label: 'Token ledger', icon: 'tokens' },
  { id: 'policy', label: 'Policy', icon: 'settings' },
]

async function savePolicy(): Promise<void> {
  saving.value = true
  try {
    await admin.updateConfig({
      token: {
        tokensPerHour: Number(policy.tokensPerHour),
        partialHourRule: policy.partialHourRule,
        roundingIncrementMinutes: Number(policy.roundingIncrementMinutes),
        minSessionMinutes: Number(policy.minSessionMinutes),
        maxSessionMinutes: Number(policy.maxSessionMinutes),
        signupGrantEnabled: policy.signupGrantEnabled,
        signupGrantAmount: Number(policy.signupGrantAmount),
      },
      booking: {
        minNoticeHours: Number(policy.minNoticeHours),
        maxAdvanceDays: Number(policy.maxAdvanceDays),
        autoConfirm: policy.autoConfirm,
        reserveTokensOnConfirm: policy.reserveTokensOnConfirm,
        earlyEndToleranceMinutes: admin.config?.booking.earlyEndToleranceMinutes ?? 15,
      },
      settlement: {
        minVerifiedMinutes: Number(policy.minVerifiedMinutes),
        autoSettleAfterHours: Number(policy.autoSettleAfterHours),
        requireBothConfirmations: policy.requireBothConfirmations,
        disputeWindowHours: Number(policy.disputeWindowHours),
      },
      cancellation: {
        freeCancellationHours: Number(policy.freeCancellationHours),
        lateCancellationRefundRatio: Number(policy.lateCancellationRefundRatio),
        noShowPenaltyTokens: Number(policy.noShowPenaltyTokens),
      },
    })
    ui.success('Policy updated', 'New bookings and settlements use these rules immediately.')
  } catch (e) {
    ui.error('Could not update policy', e instanceof Error ? e.message : undefined)
  } finally {
    saving.value = false
  }
}

async function resolveReport(): Promise<void> {
  if (!reportModal.report) return
  saving.value = true
  try {
    await admin.resolveReport(reportModal.report.id, reportModal.status, reportModal.resolution)
    reportModal.open = false
    reportModal.resolution = ''
    ui.success('Report resolved')
  } catch (e) {
    ui.error('Could not resolve the report', e instanceof Error ? e.message : undefined)
  } finally {
    saving.value = false
  }
}

async function resolveDispute(): Promise<void> {
  if (!disputeModal.dispute) return
  saving.value = true
  try {
    await admin.resolveDispute(disputeModal.dispute.id, disputeModal.status, disputeModal.outcome)
    disputeModal.open = false
    disputeModal.outcome = ''
    ui.success('Dispute resolved', 'Both members have been notified with the outcome.')
  } catch (e) {
    ui.error('Could not resolve the dispute', e instanceof Error ? e.message : undefined)
  } finally {
    saving.value = false
  }
}

async function adjustWallet(): Promise<void> {
  if (!walletModal.member) return
  saving.value = true
  try {
    await admin.adjustWallet(walletModal.member.uid, Number(walletModal.amount), walletModal.reason)
    walletModal.open = false
    walletModal.reason = ''
    ui.success('Balance adjusted', 'The member has been notified and the ledger entry is permanent.')
  } catch (e) {
    ui.error('Could not adjust the balance', e instanceof Error ? e.message : undefined)
  } finally {
    saving.value = false
  }
}

async function setRole(member: UserProfile, role: UserProfile['role']): Promise<void> {
  await admin.setUserRole(member.uid, role)
  ui.success('Role updated', `${member.displayName} is now ${role}.`)
}

async function setStatus(member: UserProfile, status: UserProfile['status']): Promise<void> {
  await admin.setUserStatus(member.uid, status)
  ui.warn('Status updated', `${member.displayName} is now ${status}.`)
}

const SUSPENSION_NOTICE =
  'Suspension is enforced by Firestore rules and Cloud Functions — a suspended member cannot book, settle or write data, even with a modified client.'
</script>

<template>
  <div class="pp-container py-10">
    <header class="flex flex-wrap items-end justify-between gap-5">
      <div>
        <div class="flex items-center gap-2">
          <AppBadge tone="cyan">Administrator</AppBadge>
          <AppBadge tone="muted">{{ env.backendMode }} backend</AppBadge>
        </div>
        <h1 class="font-display mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Platform administration</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted">
          Moderation queue, dispute resolution, member management, the immutable token ledger and the policy that drives
          every settlement.
        </p>
      </div>
      <AppButton variant="secondary" icon="refresh" :loading="admin.loading" @click="admin.loadDashboard()">
        Refresh data
      </AppButton>
    </header>

    <nav class="pp-scroll-x mt-6 flex gap-2 pb-1" aria-label="Admin sections">
      <button
        v-for="item in TABS"
        :key="item.id"
        type="button"
        class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition"
        :class="tab === item.id ? 'border-cyan/45 bg-cyan/12 text-cyan' : 'border-line text-muted hover:border-cyan/30 hover:text-ink'"
        :aria-current="tab === item.id ? 'page' : undefined"
        @click="tab = item.id"
      >
        <AppIcon :name="item.icon" :size="15" />
        {{ item.label }}
        <span
          v-if="item.id === 'reports' && openReports.length"
          class="rounded-full bg-warn/20 px-1.5 text-[11px] text-warn"
        >
          {{ openReports.length }}
        </span>
        <span
          v-if="item.id === 'disputes' && openDisputes.length"
          class="rounded-full bg-danger/20 px-1.5 text-[11px] text-danger"
        >
          {{ openDisputes.length }}
        </span>
      </button>
    </nav>

    <AppSkeleton v-if="admin.loading && !metrics" class="mt-8" card :lines="4" />

    <!-- Overview -->
    <template v-else-if="tab === 'overview'">
      <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AppStat label="Members" :value="metrics?.members ?? 0" icon="users" hint="Registered accounts" />
        <AppStat label="Active listings" :value="metrics?.activeListings ?? 0" icon="seed" tone="cyan" hint="Published skills" />
        <AppStat label="Sessions completed" :value="metrics?.completedSessions ?? 0" icon="check" hint="Settled bookings" />
        <AppStat label="Hours traded" :value="`${metrics?.hoursTraded ?? 0}h`" icon="clock" tone="warn" hint="Verified time exchanged" />
        <AppStat label="Tokens in circulation" :value="metrics?.tokensInCirculation ?? 0" icon="tokens" hint="Sum of member balances" />
        <AppStat label="Ledger entries" :value="admin.transactions.length" icon="chart" tone="cyan" hint="Immutable rows loaded" />
        <AppStat label="Open reports" :value="metrics?.openReports ?? 0" icon="flag" tone="warn" hint="Awaiting moderation" />
        <AppStat label="Average rating" :value="(metrics?.averageRating ?? 0).toFixed(1)" icon="star" hint="Across all reviews" />
      </section>

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <section class="pp-card p-6">
          <h2 class="font-display text-lg font-semibold text-ink">Integrity checks</h2>
          <ul class="mt-4 space-y-3 text-sm">
            <li class="flex items-start gap-2.5">
              <AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" />
              <span class="text-muted">
                Ledger totals reconcile with wallet balances:
                <span class="font-mono text-ink">
                  {{ metrics?.tokensInCirculation }} in circulation ·
                  {{ admin.settlements.filter((s) => s.status === 'settled').length }} settlements recorded
                </span>
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" />
              <span class="text-muted">
                Every settlement carries a deterministic idempotency key, so a replayed function event cannot double-credit.
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <AppIcon name="check" :size="16" class="mt-0.5 text-brand-bright" />
              <span class="text-muted">
                Wallet writes are server-only. Firestore rules deny client writes to
                <code class="text-ink">wallets</code>, <code class="text-ink">tokenTransactions</code> and
                <code class="text-ink">settlements</code>.
              </span>
            </li>
            <li class="flex items-start gap-2.5">
              <AppIcon name="alert" :size="16" class="mt-0.5 text-warn" />
              <span class="text-muted">{{ SUSPENSION_NOTICE }}</span>
            </li>
          </ul>
        </section>

        <section class="pp-card p-6">
          <h2 class="font-display text-lg font-semibold text-ink">Recent settlements</h2>
          <ul v-if="admin.settlements.length" class="mt-4 space-y-3">
            <li v-for="settlement in admin.settlements.slice(0, 5)" :key="settlement.id" class="rounded-xl border border-line/70 bg-canvas/30 p-3.5">
              <div class="flex items-center justify-between gap-3">
                <p class="truncate font-mono text-xs text-ink">{{ settlement.bookingId }}</p>
                <AppBadge :tone="settlement.status === 'settled' ? 'brand' : settlement.status === 'refunded' ? 'warn' : 'danger'">
                  {{ settlement.status }}
                </AppBadge>
              </div>
              <p class="mt-2 text-[11px] text-muted">
                {{ settlement.verifiedMinutes }} min verified · {{ settlement.tokenAmount }} TT ·
                {{ formatRelative(settlement.createdAt) }}
              </p>
              <p class="mt-1 line-clamp-2 text-[11px] text-muted">{{ settlement.reason }}</p>
            </li>
          </ul>
          <p v-else class="mt-3 text-sm text-muted">No settlements recorded yet.</p>
        </section>
      </div>
    </template>

    <!-- Reports -->
    <section v-else-if="tab === 'reports'" class="mt-8">
      <ul v-if="admin.reports.length" class="space-y-3">
        <li v-for="report in admin.reports" :key="report.id" class="pp-card p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <AppBadge :tone="report.status === 'open' ? 'warn' : report.status === 'reviewing' ? 'cyan' : 'muted'">
                  {{ report.status }}
                </AppBadge>
                <AppBadge tone="muted">{{ report.targetType }}</AppBadge>
                <AppBadge v-if="report.priority === 'high'" tone="danger">High priority</AppBadge>
              </div>
              <p class="mt-2 text-sm font-medium text-ink">{{ report.targetLabel }}</p>
              <p class="mt-1 text-xs text-muted">{{ report.details }}</p>
              <p class="mt-2 font-mono text-[11px] text-muted">{{ report.targetPath }}</p>
              <p class="mt-1 text-[11px] text-muted">
                Reported by <span class="text-ink">{{ report.reporterUid }}</span> ·
                {{ formatRelative(report.createdAt) }} · reason: {{ report.reason }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <AppButton
                v-if="report.status === 'open' || report.status === 'reviewing'"
                size="sm"
                icon="shield"
                @click="((reportModal.report = report), (reportModal.open = true))"
              >
                Resolve
              </AppButton>
              <AppBadge v-else tone="brand">{{ report.resolution || 'closed' }}</AppBadge>
            </div>
          </div>
        </li>
      </ul>
      <AppEmptyState v-else icon="shield" title="No reports" description="Nothing has been reported. The community is behaving." />
    </section>

    <!-- Disputes -->
    <section v-else-if="tab === 'disputes'" class="mt-8">
      <ul v-if="admin.disputes.length" class="space-y-3">
        <li v-for="dispute in admin.disputes" :key="dispute.id" class="pp-card p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <AppBadge :tone="dispute.status === 'open' ? 'danger' : 'muted'">{{ dispute.status.replace('_', ' ') }}</AppBadge>
                <AppBadge tone="muted">Booking {{ dispute.bookingId }}</AppBadge>
              </div>
              <p class="mt-2 text-sm text-ink">{{ dispute.claim }}</p>
              <p v-if="dispute.evidence" class="mt-1 text-xs text-muted">Evidence: {{ dispute.evidence }}</p>
              <p class="mt-2 text-[11px] text-muted">
                Opened by {{ dispute.openedByUid }} against {{ dispute.againstUid }} ·
                {{ formatRelative(dispute.createdAt) }}
              </p>
              <p v-if="dispute.outcome" class="mt-2 rounded-xl border border-line/70 bg-canvas/40 p-3 text-xs text-muted">
                Outcome: {{ dispute.outcome }}
              </p>
            </div>
            <AppButton
              v-if="dispute.status === 'open'"
              size="sm"
              icon="shield"
              @click="((disputeModal.dispute = dispute), (disputeModal.open = true))"
            >
              Decide
            </AppButton>
          </div>
        </li>
      </ul>
      <AppEmptyState v-else icon="shield" title="No disputes" description="No member has contested a settlement." />
    </section>

    <!-- Members -->
    <section v-else-if="tab === 'members'" class="mt-8">
      <div class="pp-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-200 text-left text-sm">
            <caption class="sr-only">Member accounts</caption>
            <thead class="border-b border-line/60 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-medium">Member</th>
                <th class="px-4 py-3 font-medium">Role</th>
                <th class="px-4 py-3 font-medium">Status</th>
                <th class="px-4 py-3 font-medium">Sessions</th>
                <th class="px-4 py-3 font-medium">Joined</th>
                <th class="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in admin.members" :key="member.uid" class="border-b border-line/40 last:border-0">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3">
                    <AppAvatar :display-name="member.displayName" :seed="member.avatarSeed" :photo-url="member.photoURL" :size="32" />
                    <div class="min-w-0">
                      <p class="truncate text-ink">{{ member.displayName }}</p>
                      <p class="truncate text-[11px] text-muted">{{ member.email }}</p>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <AppBadge :tone="member.role === 'admin' ? 'cyan' : 'muted'">{{ member.role }}</AppBadge>
                </td>
                <td class="px-4 py-3">
                  <AppBadge :tone="member.status === 'active' ? 'brand' : 'danger'">{{ member.status }}</AppBadge>
                </td>
                <td class="px-4 py-3 text-muted">{{ member.stats.sessionsCompleted }}</td>
                <td class="px-4 py-3 text-muted">{{ formatRelative(member.createdAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1.5">
                    <AppButton
                      size="sm"
                      variant="ghost"
                      @click="setRole(member, member.role === 'admin' ? 'member' : 'admin')"
                    >
                      {{ member.role === 'admin' ? 'Demote' : 'Promote' }}
                    </AppButton>
                    <AppButton
                      size="sm"
                      variant="ghost"
                      @click="setStatus(member, member.status === 'active' ? 'suspended' : 'active')"
                    >
                      {{ member.status === 'active' ? 'Suspend' : 'Reinstate' }}
                    </AppButton>
                    <AppButton size="sm" variant="ghost" icon="tokens" @click="((walletModal.member = member), (walletModal.open = true))">
                      Ledger
                    </AppButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Ledger -->
    <section v-else-if="tab === 'ledger'" class="mt-8">
      <div class="pp-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-200 text-left text-sm">
            <caption class="sr-only">Token transactions across all members</caption>
            <thead class="border-b border-line/60 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-medium">Entry</th>
                <th class="px-4 py-3 font-medium">Member</th>
                <th class="px-4 py-3 font-medium">Type</th>
                <th class="px-4 py-3 font-medium">Amount</th>
                <th class="px-4 py-3 font-medium">Balance after</th>
                <th class="px-4 py-3 font-medium">Reason</th>
                <th class="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tx in admin.transactions" :key="tx.id" class="border-b border-line/40 last:border-0">
                <td class="px-4 py-3 font-mono text-[11px] text-muted">{{ tx.id }}</td>
                <td class="px-4 py-3 font-mono text-[11px] text-ink">{{ tx.uid }}</td>
                <td class="px-4 py-3">
                  <AppBadge :tone="tx.direction === 'credit' ? 'brand' : 'danger'">{{ tx.type }}</AppBadge>
                </td>
                <td class="px-4 py-3 font-mono" :class="tx.direction === 'credit' ? 'text-brand-bright' : 'text-danger'">
                  {{ tx.direction === 'credit' ? '+' : '−' }}{{ tx.amount }}
                </td>
                <td class="px-4 py-3 text-muted">{{ tx.balanceAfter ?? '—' }}</td>
                <td class="max-w-80 truncate px-4 py-3 text-xs text-muted">{{ tx.reason }}</td>
                <td class="px-4 py-3 text-[11px] text-muted">{{ formatRelative(tx.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p class="mt-4 text-xs text-muted">
        Ledger rows are append-only. Corrections are made by posting a new compensating entry with its own reason —
        nothing is edited or deleted.
      </p>
    </section>

    <!-- Policy -->
    <section v-else class="mt-8 grid gap-6 lg:grid-cols-3">
      <div class="pp-card p-6 lg:col-span-2">
        <h2 class="font-display text-lg font-semibold text-ink">Token economy</h2>
        <p class="mt-1 text-xs text-muted">
          Current version <span class="font-mono text-ink">{{ admin.config?.version }}</span> ·
          updated {{ admin.config ? formatRelative(admin.config.updatedAt) : '—' }}
        </p>

        <div class="mt-5 grid gap-4 sm:grid-cols-3">
          <AppInput v-model="policy.tokensPerHour" label="Tokens per hour" type="number" :min="0.25" :step="0.25" />
          <AppSelect
            v-model="policy.partialHourRule"
            label="Partial hour rule"
            :options="[
              { value: 'exact', label: 'Exact (no rounding)' },
              { value: 'nearest', label: 'Round to nearest' },
              { value: 'round_up', label: 'Round up' },
              { value: 'round_down', label: 'Round down' },
            ]"
          />
          <AppInput v-model="policy.roundingIncrementMinutes" label="Rounding step (minutes)" type="number" :min="5" :step="5" />
          <AppInput v-model="policy.minSessionMinutes" label="Minimum session (min)" type="number" :min="5" :step="5" />
          <AppInput v-model="policy.maxSessionMinutes" label="Maximum session (min)" type="number" :min="30" :step="15" />
          <AppInput v-model="policy.signupGrantAmount" label="Signup grant (tokens)" type="number" :min="0" :step="1" />
        </div>

        <h2 class="font-display mt-8 text-lg font-semibold text-ink">Booking rules</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <AppInput v-model="policy.minNoticeHours" label="Minimum notice (hours)" type="number" :min="0" />
          <AppInput v-model="policy.maxAdvanceDays" label="Maximum advance (days)" type="number" :min="1" />
        </div>
        <ul class="mt-4 space-y-3">
          <li v-for="toggle in [
            { key: 'autoConfirm', label: 'Auto-confirm bookings', hint: 'Skip teacher approval — useful for open office hours.' },
            { key: 'reserveTokensOnConfirm', label: 'Reserve learner tokens on confirm (escrow)', hint: 'Holds tokens when a booking is confirmed instead of only at settlement.' },
            { key: 'requireBothConfirmations', label: 'Require both confirmations to settle', hint: 'When off, verified attendance alone can settle a session.' },
            { key: 'signupGrantEnabled', label: 'Give new members introductory tokens', hint: 'Granted once at signup and recorded in the ledger as a grant.' },
          ]" :key="toggle.key" class="flex items-start justify-between gap-4 rounded-xl border border-line/70 bg-canvas/30 p-4">
            <div>
              <p class="text-sm font-medium text-ink">{{ toggle.label }}</p>
              <p class="mt-0.5 text-[11px] text-muted">{{ toggle.hint }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="Boolean(policy[toggle.key as keyof typeof policy])"
              :aria-label="toggle.label"
              class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition"
              :class="policy[toggle.key as keyof typeof policy] ? 'border-brand/40 bg-brand/25' : 'border-line bg-canvas'"
              @click="(policy[toggle.key as keyof typeof policy] as boolean) = !policy[toggle.key as keyof typeof policy]"
            >
              <span
                class="absolute top-0.5 size-5 rounded-full transition-all"
                :class="policy[toggle.key as keyof typeof policy] ? 'left-5 bg-brand' : 'left-0.5 bg-muted'"
              />
            </button>
          </li>
        </ul>

        <h2 class="font-display mt-8 text-lg font-semibold text-ink">Settlement & cancellation</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <AppInput v-model="policy.minVerifiedMinutes" label="Quorum (min)" type="number" :min="1" />
          <AppInput v-model="policy.autoSettleAfterHours" label="Auto-settle after (h)" type="number" :min="1" />
          <AppInput v-model="policy.disputeWindowHours" label="Dispute window (h)" type="number" :min="1" />
          <AppInput v-model="policy.freeCancellationHours" label="Free cancellation (h)" type="number" :min="0" />
          <AppInput v-model="policy.lateCancellationRefundRatio" label="Late refund ratio" type="number" :min="0" :max="1" :step="0.1" />
          <AppInput v-model="policy.noShowPenaltyTokens" label="No-show penalty (tokens)" type="number" :min="0" />
        </div>

        <div class="mt-6 flex justify-end">
          <AppButton :loading="saving" icon="check" @click="savePolicy">Save policy</AppButton>
        </div>
      </div>

      <div class="space-y-5">
        <div class="pp-card p-5">
          <h2 class="font-display text-sm font-semibold text-ink">What changing policy does</h2>
          <ul class="mt-3 space-y-2.5 text-xs text-muted">
            <li class="flex gap-2"><AppIcon name="check" :size="14" class="mt-0.5 text-brand-bright" /> Token amounts shown on listings and new bookings recalculate immediately.</li>
            <li class="flex gap-2"><AppIcon name="check" :size="14" class="mt-0.5 text-brand-bright" /> Existing commissions keep the amount they were booked with — history is never rewritten.</li>
            <li class="flex gap-2"><AppIcon name="check" :size="14" class="mt-0.5 text-brand-bright" /> The policy version is stamped on every ledger row written afterwards.</li>
            <li class="flex gap-2"><AppIcon name="alert" :size="14" class="mt-0.5 text-warn" /> Every change is attributed to your account and recorded with a timestamp.</li>
          </ul>
        </div>

        <div class="pp-card p-5">
          <h2 class="font-display text-sm font-semibold text-ink">In production</h2>
          <p class="mt-2 text-xs leading-relaxed text-muted">
            Policy documents live at <code class="text-ink">config/platform</code> and are writable only by members with
            the <code class="text-ink">admin</code> custom claim. The Cloud Functions read the same document at settle
            time, so what you change here is exactly what the server enforces.
          </p>
        </div>
      </div>
    </section>

    <!-- Modals -->
    <AppModal :open="reportModal.open" title="Resolve report" :description="reportModal.report?.targetLabel" @close="reportModal.open = false">
      <div class="space-y-4">
        <AppSelect
          v-model="reportModal.status"
          label="Outcome"
          :options="[
            { value: 'resolved', label: 'Resolved — action taken' },
            { value: 'dismissed', label: 'Dismissed — no violation' },
            { value: 'reviewing', label: 'Keep under review' },
          ]"
        />
        <AppInput
          v-model="reportModal.resolution"
          label="Resolution note"
          textarea
          :rows="3"
          hint="Shown to the reporter. Use 'removed' to hide the reported content, or leave a short explanation."
        />
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="reportModal.open = false">Cancel</AppButton>
        <AppButton :loading="saving" icon="shield" @click="resolveReport">Record outcome</AppButton>
      </template>
    </AppModal>

    <AppModal :open="disputeModal.open" title="Resolve dispute" :description="disputeModal.dispute?.claim" @close="disputeModal.open = false">
      <div class="space-y-4">
        <AppSelect
          v-model="disputeModal.status"
          label="Decision"
          :options="[
            { value: 'resolved_refund', label: 'Refund the learner' },
            { value: 'resolved_release', label: 'Release tokens to the teacher' },
            { value: 'resolved_split', label: 'Split the difference' },
            { value: 'closed', label: 'Close without action' },
          ]"
        />
        <AppInput
          v-model="disputeModal.outcome"
          label="Reasoning"
          textarea
          :rows="4"
          hint="Both members see this. Reference the verified attendance and any messages."
        />
        <p class="rounded-xl border border-line/70 bg-canvas/40 p-3 text-[11px] text-muted">
          Token movements from a dispute are posted as new ledger entries with the policy code
          <code class="text-ink">dispute_refund</code>, <code class="text-ink">dispute_release</code> or
          <code class="text-ink">admin_adjustment</code> — never as edits to existing rows.
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="disputeModal.open = false">Cancel</AppButton>
        <AppButton :loading="saving" icon="shield" @click="resolveDispute">Record decision</AppButton>
      </template>
    </AppModal>

    <AppModal
      :open="walletModal.open"
      title="Adjust a member balance"
      :description="walletModal.member?.displayName"
      size="sm"
      @close="walletModal.open = false"
    >
      <div class="space-y-4">
        <AppInput v-model="walletModal.amount" label="Amount (positive credits, negative debits)" type="number" :step="0.25" />
        <AppInput v-model="walletModal.reason" label="Reason" textarea :rows="3" required hint="Recorded permanently on the ledger row." />
        <p class="rounded-xl border border-warn/30 bg-warn/10 p-3 text-[11px] text-warn">
          Adjustments are auditable and notified to the member. Use them for proven problems, never as silent edits.
        </p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="walletModal.open = false">Cancel</AppButton>
        <AppButton :loading="saving" icon="tokens" @click="adjustWallet">Post adjustment</AppButton>
      </template>
    </AppModal>

    <p class="mt-10 text-xs text-muted">
      Signed in as {{ auth.profile?.displayName }} ({{ auth.profile?.uid }}). Administrator actions are logged with your
      identity.
    </p>
  </div>
</template>
