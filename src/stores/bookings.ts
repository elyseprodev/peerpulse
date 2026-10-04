import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Booking, DisputeCase, PlatformConfig, SettlementRecord } from '@shared/domain'
import { getBackend, type CreateBookingInput, type SettlementOutcomeResult } from '@/lib/backend'

export type BookingTab = 'upcoming' | 'requests' | 'past' | 'cancelled'

export const useBookingStore = defineStore('bookings', () => {
  const bookings = ref<Booking[]>([])
  const config = ref<PlatformConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastSettlement = ref<SettlementRecord | null>(null)

  const now = () => Date.now()

  const upcoming = computed(() =>
    bookings.value
      .filter((b) => ['confirmed', 'in_progress'].includes(b.status) && Date.parse(b.endAt) >= now() - 3_600_000)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
  )
  const requests = computed(() =>
    bookings.value
      .filter((b) => b.status === 'requested' && Date.parse(b.endAt) >= now() - 3_600_000)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
  )
  const past = computed(() =>
    bookings.value
      .filter((b) => b.status === 'completed' || b.status === 'disputed')
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
  )
  const cancelled = computed(() =>
    bookings.value
      .filter((b) => ['cancelled', 'declined', 'no_show'].includes(b.status))
      .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)),
  )

  const nextSession = computed(() => upcoming.value[0] ?? null)
  const pendingActionCount = computed(() => requests.value.length)

  const completedHours = computed(() =>
    Math.round((past.value.reduce((sum, b) => sum + b.durationMinutes, 0) / 60) * 10) / 10,
  )

  async function load(uid: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const backend = await getBackend()
      const [items, platformConfig] = await Promise.all([backend.listBookings(uid), backend.getPlatformConfig()])
      bookings.value = items
      config.value = platformConfig
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not load your bookings.'
    } finally {
      loading.value = false
    }
  }

  async function ensureConfig(): Promise<PlatformConfig> {
    if (config.value) return config.value
    const backend = await getBackend()
    config.value = await backend.getPlatformConfig()
    return config.value
  }

  async function create(input: CreateBookingInput): Promise<Booking> {
    const backend = await getBackend()
    const booking = await backend.createBooking(input)
    bookings.value = [booking, ...bookings.value.filter((b) => b.id !== booking.id)]
    return booking
  }

  function replace(booking: Booking): void {
    const index = bookings.value.findIndex((b) => b.id === booking.id)
    if (index >= 0) bookings.value.splice(index, 1, booking)
    else bookings.value.unshift(booking)
  }

  async function confirm(id: string): Promise<Booking> {
    const backend = await getBackend()
    const booking = await backend.confirmBooking(id)
    replace(booking)
    return booking
  }

  async function decline(id: string, reason: string): Promise<Booking> {
    const backend = await getBackend()
    const booking = await backend.declineBooking(id, reason)
    replace(booking)
    return booking
  }

  async function cancel(id: string, reason: string): Promise<Booking> {
    const backend = await getBackend()
    const booking = await backend.cancelBooking(id, reason)
    replace(booking)
    return booking
  }

  async function reschedule(id: string, startAt: string, endAt: string, reason: string): Promise<Booking> {
    const backend = await getBackend()
    const booking = await backend.rescheduleBooking(id, startAt, endAt, reason)
    replace(booking)
    return booking
  }

  async function confirmCompletion(id: string, uid: string): Promise<SettlementOutcomeResult> {
    const backend = await getBackend()
    const result = await backend.confirmCompletion(id, uid)
    replace(result.booking)
    if (result.settlement) lastSettlement.value = result.settlement
    return result
  }

  async function requestSettlement(id: string): Promise<SettlementOutcomeResult> {
    const backend = await getBackend()
    const result = await backend.requestSettlement(id)
    replace(result.booking)
    if (result.settlement) lastSettlement.value = result.settlement
    return result
  }

  async function dispute(id: string, claim: string): Promise<DisputeCase> {
    const backend = await getBackend()
    const disputeCase = await backend.raiseDispute(id, claim)
    const booking = await backend.getBooking(id)
    if (booking) replace(booking)
    return disputeCase
  }

  function byId(id: string): Booking | undefined {
    return bookings.value.find((b) => b.id === id)
  }

  return {
    bookings,
    config,
    loading,
    error,
    lastSettlement,
    upcoming,
    requests,
    past,
    cancelled,
    nextSession,
    pendingActionCount,
    completedHours,
    load,
    ensureConfig,
    create,
    confirm,
    decline,
    cancel,
    reschedule,
    confirmCompletion,
    requestSettlement,
    dispute,
    byId,
  }
})
