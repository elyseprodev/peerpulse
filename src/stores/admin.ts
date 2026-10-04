import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  DisputeCase,
  ModerationReport,
  PlatformConfig,
  SettlementRecord,
  TokenTransaction,
  UserProfile,
} from '@shared/domain'
import { getBackend, type PlatformMetrics } from '@/lib/backend'

/**
 * Administrator console state.
 *
 * Every action here is additionally enforced server-side: Firestore rules grant
 * admins read access to the audit collections, and the Cloud Functions assert
 * the `admin` custom claim before touching wallets or moderation records.
 */
export const useAdminStore = defineStore('admin', () => {
  const metrics = ref<PlatformMetrics | null>(null)
  const members = ref<UserProfile[]>([])
  const reports = ref<ModerationReport[]>([])
  const disputes = ref<DisputeCase[]>([])
  const settlements = ref<SettlementRecord[]>([])
  const transactions = ref<TokenTransaction[]>([])
  const config = ref<PlatformConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadDashboard(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const backend = await getBackend()
      const [m, r, d, s, t, c] = await Promise.all([
        backend.getMetrics(),
        backend.listReports(),
        backend.listDisputes(),
        backend.listSettlements(),
        backend.listAllTransactions({ limit: 200 }),
        backend.getPlatformConfig(),
      ])
      metrics.value = m
      reports.value = r
      disputes.value = d
      settlements.value = s
      transactions.value = t
      config.value = c
      members.value = await backend.listMembers({ limit: 200 })
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load administrator data.'
    } finally {
      loading.value = false
    }
  }

  async function refreshMembers(): Promise<void> {
    const backend = await getBackend()
    members.value = await backend.listMembers({ limit: 200 })
  }

  async function resolveReport(id: string, status: ModerationReport['status'], resolution: string): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.resolveReport(id, { status, resolution })
    const index = reports.value.findIndex((r) => r.id === id)
    if (index >= 0) reports.value.splice(index, 1, updated)
  }

  async function resolveDispute(id: string, status: DisputeCase['status'], outcome: string): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.resolveDispute(id, { status, outcome })
    const index = disputes.value.findIndex((d) => d.id === id)
    if (index >= 0) disputes.value.splice(index, 1, updated)
  }

  async function setUserRole(uid: string, role: UserProfile['role']): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.setUserRole(uid, role)
    const index = members.value.findIndex((m) => m.uid === uid)
    if (index >= 0) members.value.splice(index, 1, updated)
  }

  async function setUserStatus(uid: string, status: UserProfile['status']): Promise<void> {
    const backend = await getBackend()
    const updated = await backend.setUserStatus(uid, status)
    const index = members.value.findIndex((m) => m.uid === uid)
    if (index >= 0) members.value.splice(index, 1, updated)
  }

  async function adjustWallet(uid: string, amount: number, reason: string): Promise<void> {
    const backend = await getBackend()
    await backend.adjustWallet(uid, amount, reason)
    transactions.value = await backend.listAllTransactions({ limit: 200 })
  }

  async function updateConfig(patch: Partial<PlatformConfig>): Promise<void> {
    const backend = await getBackend()
    config.value = await backend.updatePlatformConfig(patch)
  }

  return {
    metrics,
    members,
    reports,
    disputes,
    settlements,
    transactions,
    config,
    loading,
    error,
    loadDashboard,
    refreshMembers,
    resolveReport,
    resolveDispute,
    setUserRole,
    setUserStatus,
    adjustWallet,
    updateConfig,
  }
})
