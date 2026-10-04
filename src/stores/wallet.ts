import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { TokenTransaction, Wallet } from '@shared/domain'
import { availableBalance } from '@shared'
import { getBackend } from '@/lib/backend'

export const useWalletStore = defineStore('wallet', () => {
  const wallet = ref<Wallet | null>(null)
  const transactions = ref<TokenTransaction[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let stopWatch: (() => void) | null = null

  const balance = computed(() => wallet.value?.balance ?? 0)
  const held = computed(() => wallet.value?.held ?? 0)
  const spendable = computed(() => (wallet.value ? availableBalance(wallet.value) : 0))
  const earned = computed(() => wallet.value?.lifetimeEarned ?? 0)
  const spent = computed(() => wallet.value?.lifetimeSpent ?? 0)
  const granted = computed(() => wallet.value?.lifetimeGranted ?? 0)
  const pending = computed(() => transactions.value.filter((t) => t.status === 'pending'))

  /** Teaching and learning hours derived from settled transactions. */
  const taughtHours = computed(() =>
    transactions.value
      .filter((t) => t.direction === 'credit' && t.type === 'credit' && t.status === 'posted')
      .reduce((sum, t) => sum + t.amount, 0),
  )
  const learnedHours = computed(() =>
    transactions.value
      .filter((t) => t.direction === 'debit' && t.status === 'posted' && t.type !== 'escrow_hold')
      .reduce((sum, t) => sum + t.amount, 0),
  )

  async function load(uid: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const backend = await getBackend()
      wallet.value = await backend.getWallet(uid)
      transactions.value = await backend.listTransactions(uid, { limit: 100 })
      stopWatch?.()
      stopWatch = backend.watchWallet(uid, (next) => {
        wallet.value = next
      })
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load your wallet.'
    } finally {
      loading.value = false
    }
  }

  async function refreshTransactions(uid: string): Promise<void> {
    const backend = await getBackend()
    transactions.value = await backend.listTransactions(uid, { limit: 100 })
    wallet.value = await backend.getWallet(uid)
  }

  function dispose(): void {
    stopWatch?.()
    stopWatch = null
  }

  return {
    wallet,
    transactions,
    loading,
    error,
    balance,
    held,
    spendable,
    earned,
    spent,
    granted,
    pending,
    taughtHours,
    learnedHours,
    load,
    refreshTransactions,
    dispose,
  }
})
