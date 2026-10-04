import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  title: string
  description?: string
  tone: 'success' | 'error' | 'info' | 'warn'
  timeout: number
}

let counter = 0

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const mobileNavOpen = ref(false)
  const theme = ref<'dark' | 'light'>(
    typeof document !== 'undefined' && document.documentElement.classList.contains('light') ? 'light' : 'dark',
  )

  function toast(input: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): number {
    const id = ++counter
    const toastItem: Toast = { id, timeout: input.timeout ?? 5000, ...input }
    toasts.value.push(toastItem)
    if (toastItem.timeout > 0) {
      setTimeout(() => dismiss(id), toastItem.timeout)
    }
    return id
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function success(title: string, description?: string): void {
    toast({ title, description, tone: 'success' })
  }
  function error(title: string, description?: string): void {
    toast({ title, description, tone: 'error', timeout: 8000 })
  }
  function info(title: string, description?: string): void {
    toast({ title, description, tone: 'info' })
  }
  function warn(title: string, description?: string): void {
    toast({ title, description, tone: 'warn', timeout: 7000 })
  }

  function setTheme(next: 'dark' | 'light'): void {
    theme.value = next
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('light', next === 'light')
      document.documentElement.dataset.theme = next
    }
    try {
      localStorage.setItem('peerpulse.theme', next)
    } catch {
      /* storage may be unavailable */
    }
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return {
    toasts,
    mobileNavOpen,
    theme,
    toast,
    dismiss,
    success,
    error,
    info,
    warn,
    setTheme,
    toggleTheme,
  }
})
