<script setup lang="ts" generic="T extends string | number">
import { useId } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: T | null | undefined
    label?: string
    options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
    placeholder?: string
    hint?: string
    error?: string
    required?: boolean
    disabled?: boolean
    name?: string
  }>(),
  {},
)

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

/**
 * Emit the *original* option value, not the DOM string, so numeric v-models
 * (durations, minutes) stay numbers.
 */
function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const match = props.options.find((option) => String(option.value) === raw)
  emit('update:modelValue', (match ? match.value : raw) as T)
}
const id = `select-${useId()}`
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" :for="id" class="block text-sm font-medium text-ink">{{ label }}</label>
    <select
      :id="id"
      :name="name"
      :value="modelValue ?? ''"
      :disabled="disabled"
      :required="required"
      :aria-invalid="Boolean(error)"
      class="w-full appearance-none rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-sm text-ink transition-colors duration-200 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60"
      @change="onChange"
    >
      <option v-if="placeholder" value="">{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
        {{ option.label }}
      </option>
    </select>
    <p v-if="error" class="text-xs text-danger" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-muted">{{ hint }}</p>
  </div>
</template>
