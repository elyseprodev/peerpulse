<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string
    title: string
    description?: string
    align?: 'left' | 'center'
    /**
     * Heading level. Defaults to `h2`, which is right for a section inside a
     * page that already has its `h1`. Pass `as="h1"` when this *is* the page
     * title — four pages did, and rendered a document with no first-level
     * heading at all, so a screen-reader user could not tell what the page was.
     */
    as?: 'h1' | 'h2' | 'h3'
  }>(),
  { align: 'left', as: 'h2' },
)
</script>

<template>
  <header :class="align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'">
    <p v-if="eyebrow" class="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/8 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-brand-bright uppercase">
      {{ eyebrow }}
    </p>
    <component :is="as" class="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{{ title }}</component>
    <p v-if="description" class="mt-3 text-sm leading-relaxed text-muted sm:text-base">{{ description }}</p>
  </header>
</template>
