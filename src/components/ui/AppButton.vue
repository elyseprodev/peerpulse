<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from './AppIcon.vue'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'soft'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    to?: string
    href?: string
    disabled?: boolean
    loading?: boolean
    block?: boolean
    icon?: string
    iconRight?: string
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-on-brand hover:bg-brand-bright active:bg-brand-deep shadow-[0_10px_30px_-12px_rgba(16,185,129,0.75)] font-semibold',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-brand/60 hover:bg-surface-2/70',
  soft: 'bg-brand/12 text-brand-bright border border-brand/25 hover:bg-brand/20',
  ghost: 'text-muted hover:text-ink hover:bg-white/5',
  outline: 'border border-brand/40 text-brand-bright hover:bg-brand/10',
  danger: 'bg-danger/15 text-danger border border-danger/35 hover:bg-danger/25',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-7 text-base gap-2.5 rounded-2xl',
}

const classes = computed(() => [
  'inline-flex items-center justify-center whitespace-nowrap transition-all duration-200 select-none',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright',
  VARIANTS[props.variant],
  SIZES[props.size],
  props.block ? 'w-full' : '',
  props.disabled || props.loading ? 'opacity-55 pointer-events-none' : '',
])

const tag = computed(() => (props.to ? RouterLink : props.href ? 'a' : 'button'))

/**
 * Bind only the props the chosen element understands, and never bind one to
 * `undefined`.
 *
 * This is subtler than it looks. `RouterLink` renders its own `href` and spreads
 * the remaining attributes over it, so passing `href: undefined` — which is what
 * `:href="href"` does for a router link — *removes the href it just computed*.
 * An anchor without an href is not focusable, not announced as a link and cannot
 * be opened in a new tab; the only thing that still worked was a mouse click,
 * because RouterLink's click handler does not need the attribute. Keyboard users
 * could not reach a single one of these buttons, and that is invisible to anyone
 * testing with a mouse.
 */
const linkProps = computed(() => (props.to ? { to: props.to } : props.href ? { href: props.href } : {}))
const buttonProps = computed(() =>
  props.to || props.href ? {} : { type: props.type, disabled: props.disabled || props.loading },
)
</script>

<template>
  <component :is="tag" v-bind="{ ...linkProps, ...buttonProps }" :aria-busy="loading || undefined" :class="classes">
    <span
      v-if="loading"
      class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <AppIcon v-else-if="icon" :name="icon" :size="size === 'sm' ? 15 : 17" />
    <slot />
    <AppIcon v-if="iconRight && !loading" :name="iconRight" :size="size === 'sm' ? 15 : 17" />
  </component>
</template>
