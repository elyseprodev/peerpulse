<script setup lang="ts" generic="T extends string | number">
import { computed, useAttrs, useId } from 'vue'

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
 * As in `AppInput`: attributes go on the `<select>`, not the wrapper. A caller's
 * `aria-label` on the wrapper left the select itself unnamed, and `inheritAttrs`
 * on by default made that the *silent* behaviour.
 */
defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

/**
 * Emit the *original* option value, not the DOM string, so numeric v-models
 * (durations, minutes) stay numbers.
 */
function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const match = props.options.find((option) => String(option.value) === raw)
  emit('update:modelValue', (match ? match.value : raw) as T)
}
const generatedId = `select-${useId()}`
/** A caller that passes its own `id` keeps it — and the label follows it there. */
const id = computed(() => (attrs.id as string | undefined) || generatedId)
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" :for="id" class="block text-sm font-medium text-ink">{{ label }}</label>
    <select
      v-bind="$attrs"
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
