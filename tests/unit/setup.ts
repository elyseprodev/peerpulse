/** jsdom polyfills and quiet defaults for the unit/component test environment. */
import { beforeAll, vi } from 'vitest'

beforeAll(() => {
  if (!('matchMedia' in window)) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
  }

  if (!('ResizeObserver' in window)) {
    // @ts-expect-error minimal stub is enough for component mounting
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  if (!('IntersectionObserver' in window)) {
    // @ts-expect-error minimal stub is enough for component mounting
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }

  if (!window.HTMLMediaElement.prototype.play) {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)

  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => 'blob:peerpulse-test')
    window.URL.revokeObjectURL = vi.fn()
  }

  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  }

  // Media device APIs are not implemented by jsdom; the video room tests only
  // assert graceful behaviour when they are missing or refused.
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
      configurable: true,
    })
  }

  // The local backend persists to localStorage; jsdom provides it natively.
  localStorage.clear()
})
