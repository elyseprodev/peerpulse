<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null | undefined
    label?: string
    type?: string
    placeholder?: string
    hint?: string
    error?: string
    required?: boolean
    disabled?: boolean
    autocomplete?: string
    icon?: string
    min?: number
    max?: number
    step?: number
    /** Static template attributes arrive as strings; accept both. */
    rows?: number | string
    maxlength?: number | string
    textarea?: boolean
    name?: string
  }>(),
  { type: 'text' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/**
 * Attributes belong on the control, not on the wrapper.
 *
 * With the default `inheritAttrs: true`, a caller's `aria-label`, `autocomplete`
 * or `inputmode` lands on the outer `<div>` — so `aria-label="Search members"`
 * looked correct in the source and did nothing, while the input itself had no
 * accessible name. `$attrs` is bound to the `<input>`/`<textarea>` below instead,
 * which is where assistive technology looks. (`id` and `name` have props of their
 * own; a caller-set `id` therefore still wins through `$attrs` on the control.)
 */
defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const generatedId = `field-${useId()}`
/** A caller that passes its own `id` keeps it — and the label follows it there. */
const id = computed(() => (attrs.id as string | undefined) || generatedId)
const rowsValue = computed(() => (props.rows === undefined ? undefined : Number(props.rows)))
const maxlengthValue = computed(() =>
  props.maxlength === undefined ? undefined : String(props.maxlength),
)
const describedBy = computed(() => (props.error ? `${id}-error` : props.hint ? `${id}-hint` : undefined))

const inputClasses = computed(() => [
  'w-full rounded-xl bg-canvas/60 border text-ink placeholder:text-muted/60',
  'px-3.5 py-2.5 text-sm transition-colors duration-200',
  props.icon ? 'pl-10' : '',
  props.error
    ? 'border-danger/60 focus:border-danger'
    : 'border-line focus:border-brand focus:ring-2 focus:ring-brand/25',
  props.disabled ? 'opacity-60' : '',
])
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" :for="id" class="flex items-center gap-1.5 text-sm font-medium text-ink">
      {{ label }}
      <span v-if="required" class="text-brand-bright" aria-hidden="true">*</span>
      <span v-if="required" class="sr-only">(required)</span>
    </label>

    <div class="relative">
      <AppIcon
        v-if="icon"
        :name="icon"
        :size="17"
        class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
      />
      <textarea
        v-if="textarea"
        v-bind="$attrs"
        :id="id"
        :name="name"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :rows="rowsValue ?? 4"
        :maxlength="maxlengthValue"
        :aria-invalid="Boolean(error)"
        :aria-describedby="describedBy"
        :class="[inputClasses, 'resize-y min-h-24']"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
      <input
        v-else
        v-bind="$attrs"
        :id="id"
        :name="name"
        :type="type"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :autocomplete="autocomplete"
        :min="min"
        :max="max"
        :step="step"
        :maxlength="maxlengthValue"
        :aria-invalid="Boolean(error)"
        :aria-describedby="describedBy"
        :class="inputClasses"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <p v-if="error" :id="`${id}-error`" class="flex items-center gap-1.5 text-xs text-danger" role="alert">
      <AppIcon name="alert" :size="14" /> {{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-hint`" class="text-xs text-muted">{{ hint }}</p>
  </div>
</template>
