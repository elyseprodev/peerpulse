<script setup lang="ts">
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
</script>

<template>
  <div class="pp-container py-24">
    <div class="mx-auto max-w-lg text-center">
      <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
        <AppIcon name="search" :size="24" />
      </span>
      <h1 class="font-display mt-6 text-3xl font-extrabold tracking-tight text-ink">That hour is not on the calendar</h1>
      <p class="mt-3 text-sm leading-relaxed text-muted">
        The page you were looking for does not exist, has been removed, or was never published. Time well spent is still
        one click away.
      </p>
      <div class="mt-7 flex flex-wrap justify-center gap-3">
        <AppButton to="/" icon="home">Back to the landing page</AppButton>
        <AppButton to="/skills" variant="secondary" icon="search">Explore skills</AppButton>
        <AppButton to="/dashboard" variant="ghost" icon-right="arrow-right">Your dashboard</AppButton>
      </div>
    </div>
  </div>
</template>
