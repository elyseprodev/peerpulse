import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AppNotification } from '@shared/domain'
import { getBackend } from '@/lib/backend'

export const useNotificationStore = defineStore('notifications', () => {
  const items = ref<AppNotification[]>([])
  const loading = ref(false)
  let stopWatch: (() => void) | null = null

  const unread = computed(() => items.value.filter((n) => !n.read))
  const unreadCount = computed(() => unread.value.length)

  async function load(uid: string): Promise<void> {
    loading.value = true
    try {
      const backend = await getBackend()
      items.value = await backend.listNotifications(uid)
      stopWatch?.()
      stopWatch = backend.watchNotifications(uid, (next) => {
        items.value = next
      })
    } finally {
      loading.value = false
    }
  }

  async function markRead(id: string): Promise<void> {
    const backend = await getBackend()
    await backend.markNotificationRead(id)
    const item = items.value.find((n) => n.id === id)
    if (item) item.read = true
  }

  async function markAllRead(uid: string): Promise<void> {
    const backend = await getBackend()
    await backend.markAllNotificationsRead(uid)
    items.value = items.value.map((n) => ({ ...n, read: true }))
  }

  function dispose(): void {
    stopWatch?.()
    stopWatch = null
    items.value = []
  }

  return { items, loading, unread, unreadCount, load, markRead, markAllRead, dispose }
})
