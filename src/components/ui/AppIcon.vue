<script setup lang="ts">
/**
 * Single-source icon set (24×24 stroke icons, tree-shakeable by name).
 * Using inline paths keeps the bundle small and guarantees the icon language
 * stays consistent across the whole product.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    strokeWidth?: number
    /** Decorative icons are hidden from screen readers by default. */
    label?: string
  }>(),
  { size: 20, strokeWidth: 1.7 },
)

const PATHS: Record<string, string> = {
  // navigation & structure
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'external-link': 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  // brand & skills
  pulse: 'M3 12h4l2.5-6 4 12L16 12h5',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8',
  music: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  languages: 'M4 6h9M8.5 6c0 5-2 9-5 11M6 12c1.5 3 4 5 7 6M13 20l4-10 4 10M14.5 17h5',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  palette: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a2 2 0 0 1 0-4h4a4 4 0 0 0-5-9zM7.5 10.5h.01M10 7.5h.01M14.5 7.5h.01',
  briefcase: 'M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  heart: 'M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z',
  book: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM17 7h2v13H8',
  tools: 'M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-2-2 8-8zM3 21l4-4M6 14l4 4',
  // actions
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  filter: 'M4 6h16M7 12h10M10 18h4',
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5 9 17.5 20 6.5',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  send: 'M4 12l16-8-6 16-3-6z',
  refresh: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11.5 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 11a2 2 0 1 1 0 4z',
  // product concepts
  wallet: 'M3 8h18v11H3zM3 8l3-4h12l3 4M16 13.5h2',
  tokens: 'M12 3v18M8 7h6a3 3 0 0 1 0 6H8h7a3 3 0 0 1 0 6H8',
  calendar: 'M4 6h16v14H4zM8 3v4M16 3v4M4 11h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  hourglass: 'M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4',
  users: 'M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9.5 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 4.3a3.5 3.5 0 0 1 0 6.8M21 19v-1.5a4 4 0 0 0-3-3.9',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6zM10.5 20a2 2 0 0 0 3 0',
  star: 'M12 3.5l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.8z',
  flag: 'M5 21V4h9l-1 3h6l-2 5 2 5H9l-1-3H5',
  shield: 'M12 3l8 3v6c0 5-3.5 8.3-8 9.7C7.5 20.3 4 17 4 12V6z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gift: 'M4 11h16v9H4zM4 8h16v3H4zM12 8v12M8 8a2.5 2.5 0 1 1 0-5c2 0 4 5 4 5M16 8a2.5 2.5 0 1 0 0-5c-2 0-4 5-4 5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.6-3.5-9S9.5 5.5 12 3z',
  'map-pin': 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  link: 'M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L5.7 13.6a4 4 0 0 0 5.7 5.7L13 17.7',
  // video room
  video: 'M3 7h11v10H3zM14 11l7-4v10l-7-4z',
  'video-off': 'M3 7h11v10H3zM14 11l7-4v10l-7-4M3 3l18 18',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6',
  'mic-off': 'M9 5a3 3 0 0 1 6 0v5M12 15a3 3 0 0 0 3-3v-1M5 11a7 7 0 0 0 11 5.3M12 18v3M9 21h6M4 4l16 16',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  phone: 'M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1A1 1 0 0 1 5 4z',
  'phone-off': 'M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1.1 1A16 16 0 0 1 4 5.1A1 1 0 0 1 5 4zM3 3l18 18',
  chat: 'M4 5h16v11H9l-5 4z',
  reply: 'M9 10H14a4 4 0 0 1 0 8h-3M9 10l3-3M9 10l3 3',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  thumb: 'M7 21V10l4-7 1.5 1a2 2 0 0 1 .8 2.3L12 10h5.5a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 16.3 20H10z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  seed: 'M12 21c0-6 3-9 8-10-1 6-4 9-8 10zM12 21C12 15 9 12 4 11c1 6 4 9 8 10zM12 21v-6',
}

const paths = computed(() => (PATHS[props.name] ?? PATHS.info).split('M').filter(Boolean).map((p) => `M${p}`))
const dimension = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    :width="dimension"
    :height="dimension"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="strokeWidth"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : 'presentation'"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    class="shrink-0"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
