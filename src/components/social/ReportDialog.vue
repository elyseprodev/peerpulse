<script setup lang="ts">
/**
 * One report dialog, used by every surface that can be reported.
 *
 * It is deliberately presentational: the parent owns the backend call, so the
 * same component serves a listing, a member, a post, a comment or a review
 * without knowing which. That mattered — before this, the reason list and the
 * "confidential" wording were duplicated per page, and only two surfaces had
 * them at all.
 */
import { computed, ref, watch } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { ModerationReport } from '@shared/domain'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** What is being reported, e.g. "this listing" — completes "Report …". */
    subject?: string
    /** The thing's visible name, shown so the reporter knows what they picked. */
    targetLabel?: string
    /** True while the parent is sending the report. */
    loading?: boolean
    /** Set by the parent when the send failed, so the dialog can explain itself. */
    error?: string | null
  }>(),
  { subject: 'this', targetLabel: '', loading: false, error: null },
)

const emit = defineEmits<{
  close: []
  submit: [payload: { reason: ModerationReport['reason']; details: string }]
}>()

const REASONS: Array<{ value: ModerationReport['reason']; label: string }> = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'misrepresentation', label: 'Misrepresentation or a false claim' },
  { value: 'no_show', label: 'Did not turn up' },
  { value: 'other', label: 'Something else' },
]

const reason = ref<ModerationReport['reason']>('spam')
const details = ref('')

/** A report with no explanation is not actionable, so a sentence is required. */
const MIN_DETAILS = 12
const canSubmit = computed(() => details.value.trim().length >= MIN_DETAILS)

// Reopen clean: a half-typed report about one listing must not reappear against
// the next thing the member reports.
watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = 'spam'
      details.value = ''
    }
  },
)

function submit(): void {
  if (!canSubmit.value) return
  emit('submit', { reason: reason.value, details: details.value.trim() })
}
</script>

<template>
  <AppModal :open="open" :title="`Report ${subject}`" size="sm" @close="emit('close')">
    <div class="space-y-4">
      <p v-if="targetLabel" class="rounded-xl border border-line/70 bg-canvas/40 p-3 text-xs text-muted">
        You are reporting <span class="font-medium text-ink">{{ targetLabel }}</span
        >. Stewards see your name; nobody else does.
      </p>

      <AppSelect v-model="reason" label="Reason" :options="REASONS" />

      <AppInput
        v-model="details"
        label="What happened?"
        textarea
        :rows="4"
        maxlength="800"
        :hint="`At least ${MIN_DETAILS} characters — details are what makes a report actionable.`"
      />

      <p v-if="error" role="alert" class="rounded-xl border border-danger/40 bg-danger/8 p-3 text-xs text-danger">
        {{ error }}
      </p>

      <p class="text-[11px] text-muted">
        Reports are confidential. A steward reviews what you send and can hide the content while investigating.
      </p>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="emit('close')">Cancel</AppButton>
      <AppButton
        variant="danger"
        :loading="loading"
        :disabled="!canSubmit"
        :title="canSubmit ? undefined : 'Add a few more details before sending'"
        @click="submit"
      >
        Send report
      </AppButton>
    </template>
  </AppModal>
</template>
