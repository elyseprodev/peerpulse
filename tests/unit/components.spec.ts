import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory } from 'vue-router'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppStat from '@/components/ui/AppStat.vue'

/** A router is required because AppButton renders RouterLink for `to` props. */
const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })

const global = { plugins: [router] }

describe('AppButton', () => {
  it('renders its label and defaults to a submit-less button', () => {
    const wrapper = mount(AppButton, { props: { variant: 'primary' }, slots: { default: 'Save changes' }, global })
    expect(wrapper.text()).toBe('Save changes')
    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
  })

  it('renders an anchor for href and a RouterLink for to', () => {
    const link = mount(AppButton, { props: { href: 'https://example.org' }, slots: { default: 'Docs' }, global })
    expect(link.element.tagName).toBe('A')
    expect(link.attributes('href')).toBe('https://example.org')

    const internal = mount(AppButton, { props: { to: '/' }, slots: { default: 'Home' }, global })
    expect(internal.element.tagName).toBe('A')
    // The href is not decoration: without it the element is not focusable, is not
    // announced as a link, and cannot be opened in a new tab. A `href` bound as
    // `undefined` alongside `to` used to remove the one RouterLink computed.
    expect(internal.attributes('href')).toBe('#/')
    expect(internal.text()).toBe('Home')
  })

  it('keeps button-only attributes off links and anchors', () => {
    const internal = mount(AppButton, { props: { to: '/', type: 'submit', disabled: true }, slots: { default: 'Home' }, global })
    expect(internal.attributes('href')).toBe('#/')
    expect(internal.attributes('type')).toBeUndefined()
    expect(internal.attributes('disabled')).toBeUndefined()

    const external = mount(AppButton, { props: { href: 'https://example.org', type: 'submit' }, slots: { default: 'Docs' }, global })
    expect(external.attributes('type')).toBeUndefined()
  })

  it('disables interaction while loading and marks the state for assistive tech', () => {
    const wrapper = mount(AppButton, { props: { loading: true }, slots: { default: 'Saving' }, global })
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')
  })

  it('renders a leading and trailing icon', () => {
    const wrapper = mount(AppButton, { props: { icon: 'plus', iconRight: 'arrow-right' }, slots: { default: 'Book' }, global })
    expect(wrapper.findAll('svg')).toHaveLength(2)
  })
})

describe('AppIcon', () => {
  it('renders a decorative svg for known names and hides it from screen readers', () => {
    const wrapper = mount(AppIcon, { props: { name: 'tokens' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('falls back gracefully for an unknown icon name', () => {
    const wrapper = mount(AppIcon, { props: { name: 'definitely-not-an-icon' } })
    expect(wrapper.find('svg').exists()).toBe(true)
  })
})

describe('AppBadge and AppStat', () => {
  it('applies the requested tone class', () => {
    const wrapper = mount(AppBadge, { props: { tone: 'danger' }, slots: { default: 'Disputed' } })
    expect(wrapper.classes().join(' ')).toContain('text-danger')
    expect(wrapper.text()).toBe('Disputed')
  })

  it('renders a metric with its hint', () => {
    const wrapper = mount(AppStat, { props: { label: 'Hours traded', value: 128.5, hint: 'Across all communities' } })
    expect(wrapper.text()).toContain('Hours traded')
    expect(wrapper.text()).toContain('128.5')
    expect(wrapper.text()).toContain('Across all communities')
  })
})

describe('AppInput', () => {
  it('associates the label, hint and error with the field', () => {
    const wrapper = mount(AppInput, {
      props: { modelValue: '', label: 'Headline', hint: 'Shown on your profile', error: 'Too long' },
    })
    const id = wrapper.find('input').attributes('id')
    expect(id).toBeTruthy()
    expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true)
    expect(wrapper.attributes('aria-describedby') || wrapper.find('input').attributes('aria-describedby')).toBeTruthy()
    expect(wrapper.text()).toContain('Too long')
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
  })

  it('emits the typed value on input', async () => {
    const wrapper = mount(AppInput, { props: { modelValue: '' } })
    await wrapper.find('input').setValue('Berlin')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Berlin'])
  })

  it('forwards caller attributes to the control, not the wrapper', () => {
    // With `inheritAttrs` left on, `aria-label` landed on the outer div: a search
    // box looked labelled in the source and had no accessible name at all.
    const wrapper = mount(AppInput, {
      props: { modelValue: '' },
      attrs: { 'aria-label': 'Search members', autocomplete: 'off', inputmode: 'search', id: 'member-search' },
    })
    const input = wrapper.find('input')
    expect(wrapper.attributes('aria-label')).toBeUndefined()
    expect(input.attributes('aria-label')).toBe('Search members')
    expect(input.attributes('autocomplete')).toBe('off')
    expect(input.attributes('inputmode')).toBe('search')
    expect(input.attributes('id')).toBe('member-search')
  })

  it('forwards caller attributes to a textarea too', () => {
    const wrapper = mount(AppInput, { props: { modelValue: '', textarea: true }, attrs: { 'aria-label': 'Your note' } })
    expect(wrapper.find('textarea').attributes('aria-label')).toBe('Your note')
  })

  it('accepts string row counts on a textarea (static template attributes)', () => {
    const wrapper = mount(AppInput, { props: { modelValue: '', textarea: true, rows: '4', maxlength: '400' } })
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('rows')).toBe('4')
    expect(textarea.attributes('maxlength')).toBe('400')
  })
})

describe('AppSelect', () => {
  const options = [
    { value: 30, label: '30 minutes' },
    { value: 60, label: '60 minutes' },
  ]

  it('emits the original typed value, not the DOM string', async () => {
    const wrapper = mount(AppSelect, { props: { modelValue: 30, options } })
    await wrapper.find('select').setValue('60')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([60])
  })

  it('keeps the selected numeric option selected', () => {
    const wrapper = mount(AppSelect, { props: { modelValue: 60, options } })
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('60')
  })

  it('forwards caller attributes to the select itself', () => {
    const wrapper = mount(AppSelect, { props: { modelValue: 30, options }, attrs: { 'aria-label': 'Sort results' } })
    expect(wrapper.attributes('aria-label')).toBeUndefined()
    expect(wrapper.find('select').attributes('aria-label')).toBe('Sort results')
  })
})

describe('AppModal', () => {
  // The dialog teleports to <body>, so assertions read from there.
  it('renders nothing while closed and the dialog once open', async () => {
    document.body.innerHTML = ''
    const wrapper = mount(AppModal, {
      props: { open: false, title: 'Confirm settlement', description: 'One token each way.' },
      slots: { default: '<p>Body</p>' },
    })
    expect(document.body.textContent).not.toContain('Confirm settlement')

    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.textContent).toContain('Confirm settlement')
    expect(document.body.textContent).toContain('One token each way.')
    expect(document.body.textContent).toContain('Body')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // `aria-modal` marks it as a dialog for assistive technology.
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    document.body.innerHTML = ''
    const wrapper = mount(AppModal, { props: { open: true, title: 'Confirm' }, attachTo: document.body })
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('closes when the backdrop is clicked but not when the panel is', async () => {
    document.body.innerHTML = ''
    const wrapper = mount(AppModal, { props: { open: true, title: 'Confirm' }, attachTo: document.body })
    await flushPromises()

    const panel = document.querySelector('[role="dialog"] .pp-card') as HTMLElement
    panel.click()
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()

    ;(document.querySelector('[role="dialog"]') as HTMLElement).click()
    await flushPromises()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })
})

describe('AppEmptyState', () => {
  it('offers a constructive next action', () => {
    const wrapper = mount(AppEmptyState, {
      props: { title: 'No listings yet', description: 'Publish one to start trading.', actionLabel: 'Add a listing' },
      global,
    })
    expect(wrapper.text()).toContain('No listings yet')
    expect(wrapper.text()).toContain('Add a listing')
  })
})
