<script setup lang="ts">
withDefaults(defineProps<{ lines?: number; height?: string; card?: boolean }>(), { lines: 3, height: '1rem' })
</script>

<template>
  <div v-if="card" class="pp-card space-y-3 p-5" role="status" aria-label="Loading content">
    <div class="pp-skeleton h-5 w-1/3" />
    <div v-for="n in lines" :key="n" class="pp-skeleton" :style="{ height, width: n === lines ? '60%' : '100%' }" />
    <span class="sr-only">Loading…</span>
  </div>
  <div v-else class="space-y-2.5" role="status" aria-label="Loading content">
    <div v-for="n in lines" :key="n" class="pp-skeleton" :style="{ height, width: n === lines ? '55%' : '100%' }" />
    <span class="sr-only">Loading…</span>
  </div>
</template>
