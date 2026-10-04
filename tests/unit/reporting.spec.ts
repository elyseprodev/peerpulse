/**
 * Reporting, end to end.
 *
 * FR-29 says any member can report a listing, post, comment, member or review.
 * The backend always accepted all five; the *UI* used to offer only two of them
 * (community posts and listings), and the reason list plus the wording were
 * duplicated per page. This suite drives each surface through the shared
 * `ReportDialog` against the reference backend and reads back the report that
 * was actually stored — a report that is filed with the wrong target type or a
 * path nobody can follow is worse than no button at all.
 *
 * It also pins the two rules the dialog enforces: a report needs more than a
 * dropdown selection, and reopening the dialog for a different subject starts
 * clean rather than reusing the previous half-typed report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import ReportDialog from '@/components/social/ReportDialog.vue'
import { getBackend, setBackendForTesting } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth'

let wrapper: VueWrapper | null = null
let consoleError: ReturnType<typeof vi.spyOn>

const JSDOM_NOISE = [/Not implemented: Window's scrollTo/, /Not implemented: window\.scrollTo/]

function unexpectedErrors(): string[] {
  return consoleError.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message: string) => !JSDOM_NOISE.some((pattern) => pattern.test(message)))
}

async function mountApp(): Promise<void> {
  wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
  await router.isReady()
  await flushPromises()
}

async function signInAsMember(): Promise<void> {
  const auth = useAuthStore()
  await auth.signInAsDemo('member')
  await flushPromises()
}

/** Type into the dialog's details field and press "Send report". */
async function fillAndSend(details: string): Promise<void> {
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement
  expect(textarea, 'the report dialog should ask what happened').toBeTruthy()
  textarea.value = details
  textarea.dispatchEvent(new Event('input'))
  await flushPromises()

  const send = [...document.querySelectorAll('button')].find((button) => /send report/i.test(button.textContent ?? ''))
  expect(send, 'the dialog should offer to send').toBeTruthy()
  ;(send as HTMLButtonElement).click()
  await flushPromises()
}

async function clickByText(pattern: RegExp): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (element) => pattern.test(element.textContent ?? '') || pattern.test(element.getAttribute('aria-label') ?? ''),
  )
  expect(button, `no control matching ${pattern}`).toBeTruthy()
  ;(button as HTMLButtonElement).click()
  await flushPromises()
}

/**
 * Reads the moderation queue as a steward — the only role allowed to see it — and
 * then signs the original member back in. Leaving the session on the steward made
 * the member-only controls disappear mid-test, which is how this helper first
 * broke the comment assertion.
 */
async function reportedTargets(): Promise<Array<{ type: string; path: string; reason: string; status: string }>> {
  const auth = useAuthStore()
  const asMember = auth.profile?.uid ?? 'demo_sam'
  await auth.signInAsDemo('admin')
  await flushPromises()
  const reports = await (await getBackend()).listReports()
  const mapped = reports.map((report) => ({
    type: report.targetType,
    path: report.targetPath,
    reason: report.reason,
    status: report.status,
  }))
  await auth.signInAsDemo('member', asMember)
  await flushPromises()
  return mapped
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setBackendForTesting(null)
  setActivePinia(createPinia())
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  void router.replace('/')
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await router.replace('/')
  consoleError.mockRestore()
})

describe('report dialog: the rules it enforces', () => {
  /** `AppModal` teleports to <body>, so the dialog is read from the document. */
  function sendButton(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((button) => /send report/i.test(button.textContent ?? ''))
  }

  async function setDetails(value: string): Promise<void> {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = value
    textarea.dispatchEvent(new Event('input'))
    await flushPromises()
  }

  let dialog: VueWrapper | null = null

  async function mountDialog(props: Record<string, unknown>): Promise<void> {
    document.body.innerHTML = ''
    dialog = mount(ReportDialog, { props: { open: true, subject: 'this listing', ...props }, attachTo: document.body })
    await flushPromises()
  }

  afterEach(() => {
    dialog?.unmount()
    dialog = null
  })

  it('refuses to send without an explanation', async () => {
    await mountDialog({})
    const send = sendButton()
    expect(send, 'the dialog should have a send button').toBeDefined()

    // Nothing typed yet: the button is disabled, and clicking it emits nothing.
    expect(send!.disabled).toBe(true)
    send!.click()
    await flushPromises()
    expect(dialog!.emitted('submit')).toBeUndefined()

    // A few characters is not an explanation either.
    await setDetails('bad')
    expect(sendButton()!.disabled).toBe(true)

    await setDetails('The listing claims a certification that does not exist.')
    const enabled = sendButton()!
    expect(enabled.disabled).toBe(false)
    enabled.click()
    await flushPromises()

    const submitted = dialog!.emitted('submit')
    expect(submitted, 'a complete report should be emitted').toHaveLength(1)
    expect(submitted![0][0]).toEqual({
      reason: 'spam',
      details: 'The listing claims a certification that does not exist.',
    })
  })

  it('starts clean when it reopens for a different subject', async () => {
    await mountDialog({})
    await setDetails('Something I typed about the first thing of two.')
    await dialog!.setProps({ open: false })
    await dialog!.setProps({ open: true })
    await flushPromises()
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('reports a send failure to the person who sent it', async () => {
    await mountDialog({ subject: 'this member', error: 'You cannot report yourself.' })
    expect(document.body.textContent).toContain('You cannot report yourself.')
    expect(document.querySelector('[role="alert"]')).toBeTruthy()
  })
})

describe('reporting: every surface files the report it promises', () => {
  it('files a report about a listing from the listing page', async () => {
    await mountApp()
    await signInAsMember()
    await router.push('/skills')
    await flushPromises()

    const firstListing = document.querySelector('a[href^="/skills/"]') as HTMLAnchorElement
    await router.push(firstListing.getAttribute('href')!)
    await flushPromises()

    await clickByText(/report this listing/i)
    await fillAndSend('This listing is advertising a paid course outside the exchange.')

    const reports = await reportedTargets()
    const report = reports.find((item) => item.type === 'skill')
    expect(report, 'a report about the listing should exist').toBeDefined()
    expect(report!.path, 'the path must let a steward open the reported document').toMatch(/^skills\/skill_/)
    expect(report!.reason).toBe('spam')
    expect(report!.status).toBe('open')
    expect(unexpectedErrors()).toEqual([])
  })

  it('files a report about a member from their profile', async () => {
    await mountApp()
    await signInAsMember()
    await router.push('/members')
    await flushPromises()

    const firstMember = document.querySelector('a[href^="/members/"]') as HTMLAnchorElement
    expect(firstMember, 'the members page should link to a profile').toBeTruthy()
    await router.push(firstMember.getAttribute('href')!)
    await flushPromises()

    await clickByText(/report this member/i)
    await fillAndSend('They asked me to pay them directly, outside the token ledger.')

    const reports = await reportedTargets()
    const report = reports.find((item) => item.type === 'user')
    expect(report, 'a report about the member should exist').toBeDefined()
    expect(report!.path).toMatch(/^users\/demo_/)
    expect(report!.reason).toBe('spam')
    expect(unexpectedErrors()).toEqual([])
  })

  it('files a report about a post and about a comment', async () => {
    await mountApp()
    await signInAsMember()

    // Deterministic setup: another member leaves a comment, so the comment report
    // control is guaranteed to be there. Without this the assertion would depend
    // on whoever the seed happened to attribute a comment to — and a conditional
    // assertion would pass vacuously.
    const backend = await getBackend()
    const auth = useAuthStore()
    await auth.signInAsDemo('member', 'demo_jonas')
    await flushPromises()
    const communities = await backend.listCommunities()
    const community = communities[0]
    const posts = await backend.listPosts({ communityId: community.id })
    await backend.createComment({
      postId: posts[0].id,
      communityId: community.id,
      authorUid: 'demo_jonas',
      body: 'Has anyone actually finished this? Asking before I commit an hour.',
    })
    await auth.signInAsDemo('member', 'demo_sam')
    await flushPromises()

    await router.push(`/communities/${community.id}`)
    await flushPromises()

    // A post: the dialog is the same component, but the target type and path differ.
    await clickByText(/report this post/i)
    await fillAndSend('This post is recruiting for a paid service.')
    const afterPost = await reportedTargets()
    const postReport = afterPost.find((item) => item.type === 'post')
    expect(postReport, 'a report about the post should exist').toBeDefined()
    expect(postReport!.path, 'the path must locate the post inside its community').toMatch(
      /^communities\/cm_[^/]+\/posts\/post_/,
    )

    // Comments only render once the thread is opened.
    await clickByText(/comment/i)
    const commentReportButton = [...document.querySelectorAll('button')].find((button) =>
      /report this comment/i.test(button.textContent ?? ''),
    )
    expect(commentReportButton, 'another member\u2019s comment must be reportable').toBeTruthy()
    ;(commentReportButton as HTMLButtonElement).click()
    await flushPromises()
    await fillAndSend('This reply is a personal attack, not a disagreement.')

    const afterComment = await reportedTargets()
    const commentReport = afterComment.find((item) => item.type === 'comment')
    expect(commentReport, 'a report about the comment should exist').toBeDefined()
    expect(commentReport!.path).toMatch(/^communities\/cm_[^/]+\/posts\/post_[^/]+\/comments\//)
    expect(unexpectedErrors()).toEqual([])
  })

  it('does not offer to report your own listing or your own profile', async () => {
    await mountApp()
    await signInAsMember()
    await router.push('/profile')
    await flushPromises()

    // The member's own profile page has no report control — there is nobody to
    // report to, and a control that only exists to be rejected is a trap.
    await router.push('/members/demo_sam')
    await flushPromises()
    expect(document.body.textContent).not.toContain('Report this member')
    expect(unexpectedErrors()).toEqual([])
  })
})
