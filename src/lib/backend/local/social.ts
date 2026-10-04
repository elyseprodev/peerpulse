/** Local backend — communities, posts, comments, reports and moderation. */
import type {
  Community,
  CommunityComment,
  CommunityMember,
  CommunityPost,
  DisputeCase,
  ModerationReport,
} from '@shared/domain'
import {
  commentReplyDraft,
  disputeResolvedDraft,
  refundIssuedDraft,
  reportResolvedDraft,
} from '@shared/notify'
import { persist, slugify, sortBy, uid, type LocalDatabase } from './db'
import { pushDraft } from './notify'
import { BackendRequestError, type CreateCommunityInput, type CreatePostInput, type CreateReportInput } from '../types'

function fail(code: string, message: string): never {
  throw new BackendRequestError({ code, message })
}

export function listCommunities(
  db: LocalDatabase,
  options: { limit?: number; memberUid?: string; categoryId?: string } = {},
): Community[] {
  let items = Object.values(db.communities)
  if (options.memberUid) {
    const joined = new Set(
      Object.entries(db.communityMembers)
        .filter(([, members]) => members.some((m) => m.uid === options.memberUid))
        .map(([id]) => id),
    )
    items = items.filter((c) => joined.has(c.id))
  }
  if (options.categoryId) items = items.filter((c) => c.categoryId === options.categoryId)
  const sorted = sortBy(items, (c) => c.memberCount, 'desc')
  return options.limit ? sorted.slice(0, options.limit) : sorted
}

export function getCommunity(db: LocalDatabase, id: string): Community | null {
  return db.communities[id] ?? null
}

export function createCommunity(db: LocalDatabase, input: CreateCommunityInput): Community {
  const now = new Date().toISOString()
  const id = uid('cm')
  const owner = db.users[input.ownerUid]
  if (!owner) fail('user/not-found', 'Your member profile could not be found.')
  const community: Community = {
    id,
    name: input.name.slice(0, 80),
    slug: slugify(input.name),
    description: input.description.slice(0, 600),
    categoryId: input.categoryId,
    visibility: input.visibility,
    ownerUids: [input.ownerUid],
    moderatorUids: [input.ownerUid],
    memberCount: 1,
    postCount: 0,
    tags: input.tags,
    rules: input.rules,
    createdAt: now,
    updatedAt: now,
  }
  db.communities[id] = community
  db.communityMembers[id] = [
    { uid: owner.uid, displayName: owner.displayName, avatarSeed: owner.avatarSeed, role: 'owner', joinedAt: now },
  ]
  persist('db', 'communities')
  return community
}

export function joinCommunity(db: LocalDatabase, communityId: string, actorUid: string): Community {
  const community = db.communities[communityId]
  if (!community) fail('community/not-found', 'That community no longer exists.')
  const members = db.communityMembers[communityId] ?? []
  if (members.some((m) => m.uid === actorUid)) return community
  const user = db.users[actorUid]
  if (!user) fail('user/not-found', 'Your member profile could not be found.')
  members.push({
    uid: actorUid,
    displayName: user.displayName,
    avatarSeed: user.avatarSeed,
    role: 'member',
    joinedAt: new Date().toISOString(),
  })
  db.communityMembers[communityId] = members
  community.memberCount = members.length
  community.updatedAt = new Date().toISOString()
  persist('db', 'communities', `communityMembers|${communityId}`)
  return community
}

export function leaveCommunity(db: LocalDatabase, communityId: string, actorUid: string): Community {
  const community = db.communities[communityId]
  if (!community) fail('community/not-found', 'That community no longer exists.')
  if (community.ownerUids.includes(actorUid)) {
    fail('community/owner', 'Community owners cannot leave — transfer ownership first or ask a steward.')
  }
  const members = (db.communityMembers[communityId] ?? []).filter((m) => m.uid !== actorUid)
  db.communityMembers[communityId] = members
  community.memberCount = members.length
  community.updatedAt = new Date().toISOString()
  persist('db', 'communities', `communityMembers|${communityId}`)
  return community
}

export function listCommunityMembers(db: LocalDatabase, communityId: string): CommunityMember[] {
  return db.communityMembers[communityId] ?? []
}

export function listPosts(
  db: LocalDatabase,
  options: { communityId?: string; limit?: number; kind?: CommunityPost['kind'] } = {},
): CommunityPost[] {
  let items = Object.values(db.posts).filter((p) => p.moderation.state !== 'hidden' && p.moderation.state !== 'removed')
  if (options.communityId) items = items.filter((p) => p.communityId === options.communityId)
  if (options.kind) items = items.filter((p) => p.kind === options.kind)
  const sorted = sortBy(items, (p) => (p.pinned ? 1 : 0) * 1e15 + Date.parse(p.createdAt), 'desc')
  return options.limit ? sorted.slice(0, options.limit) : sorted
}

export function createPost(db: LocalDatabase, input: CreatePostInput): CommunityPost {
  const community = db.communities[input.communityId]
  if (!community) fail('community/not-found', 'That community no longer exists.')
  const author = db.users[input.authorUid]
  if (!author) fail('user/not-found', 'Your member profile could not be found.')
  const now = new Date().toISOString()
  const id = uid('post')
  const post: CommunityPost = {
    id,
    communityId: input.communityId,
    authorUid: input.authorUid,
    authorName: author.displayName,
    authorSeed: author.avatarSeed,
    kind: input.kind,
    title: input.title.slice(0, 160),
    body: input.body.slice(0, 6000),
    link: input.link ?? null,
    reactions: {},
    commentCount: 0,
    pinned: false,
    moderation: { state: 'clean', reason: null },
    event: input.event ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.posts[id] = post
  community.postCount += 1
  community.updatedAt = now
  persist('db', 'posts', 'communities')
  return post
}

export function reactToPost(db: LocalDatabase, postId: string, actorUid: string, emoji: string): CommunityPost {
  const post = db.posts[postId]
  if (!post) fail('post/not-found', 'That post no longer exists.')
  const reactions = { ...post.reactions }
  if (reactions[actorUid] === emoji) delete reactions[actorUid]
  else reactions[actorUid] = emoji

  post.reactions = reactions
  post.updatedAt = new Date().toISOString()
  persist('db', 'posts')
  return post
}

export function listComments(db: LocalDatabase, postId: string): CommunityComment[] {
  return sortBy(
    Object.values(db.comments).filter((c) => c.postId === postId && c.moderation.state !== 'removed'),
    (c) => Date.parse(c.createdAt),
    'asc',
  )
}

export function createComment(
  db: LocalDatabase,
  input: { postId: string; communityId: string; authorUid: string; body: string },
): CommunityComment {
  const post = db.posts[input.postId]
  if (!post) fail('post/not-found', 'That post no longer exists.')
  const author = db.users[input.authorUid]
  if (!author) fail('user/not-found', 'Your member profile could not be found.')
  const id = uid('cmt')
  const comment: CommunityComment = {
    id,
    postId: input.postId,
    communityId: input.communityId,
    authorUid: input.authorUid,
    authorName: author.displayName,
    authorSeed: author.avatarSeed,
    body: input.body.slice(0, 3000),
    moderation: { state: 'clean', reason: null },
    createdAt: new Date().toISOString(),
  }
  db.comments[id] = comment
  post.commentCount += 1
  post.updatedAt = comment.createdAt

  if (post.authorUid !== input.authorUid) {
    pushDraft(
      db,
      commentReplyDraft({
        recipientUid: post.authorUid,
        authorName: author.displayName,
        communityId: post.communityId,
        postId: post.id,
        postTitle: post.title,
        commentBody: comment.body,
      }),
    )
  }
  persist('db', 'comments', 'posts')
  return comment
}

/* ─────────────────────────── moderation ─────────────────────────── */

export function createReport(db: LocalDatabase, input: CreateReportInput): ModerationReport {
  const now = new Date().toISOString()
  const id = uid('rpt')
  const report: ModerationReport = {
    id,
    reporterUid: input.reporterUid,
    targetType: input.targetType,
    targetId: input.targetId,
    targetPath: input.targetPath,
    targetLabel: input.targetLabel,
    reason: input.reason,
    details: input.details.slice(0, 2000),
    status: 'open',
    priority: input.reason === 'harassment' ? 'high' : 'normal',
    resolution: null,
    handledByUid: null,
    handledAt: null,
    createdAt: now,
    updatedAt: now,
  }
  db.reports[id] = report

  // Flag the reported document so moderators can see it in context.
  if (input.targetType === 'post' && db.posts[input.targetId]) {
    db.posts[input.targetId].moderation = { state: 'flagged', reason: input.reason }
  }
  if (input.targetType === 'review' && db.reviews[input.targetId]) {
    db.reviews[input.targetId].moderation = { state: 'flagged', reason: input.reason }
  }

  persist('db', 'reports')
  return report
}

export function resolveReport(
  db: LocalDatabase,
  id: string,
  patch: { status: ModerationReport['status']; resolution: string },
  actorUid: string,
): ModerationReport {
  const report = db.reports[id]
  if (!report) fail('report/not-found', 'That report could not be found.')
  const now = new Date().toISOString()
  report.status = patch.status
  report.resolution = patch.resolution
  report.handledByUid = actorUid
  report.handledAt = now
  report.updatedAt = now

  if (patch.status === 'resolved') {
    if (report.targetType === 'post' && db.posts[report.targetId]) {
      const post = db.posts[report.targetId]
      post.moderation = { state: patch.resolution === 'removed' ? 'removed' : 'clean', reason: patch.resolution }
    }
    if (report.targetType === 'review' && db.reviews[report.targetId]) {
      db.reviews[report.targetId].moderation = {
        state: patch.resolution === 'removed' ? 'removed' : 'clean',
        reason: patch.resolution,
      }
    }
  }

  pushDraft(
    db,
    reportResolvedDraft({
      reporterUid: report.reporterUid,
      upheld: patch.status === 'resolved',
      resolution: patch.resolution || `Status: ${patch.status}`,
    }),
  )

  persist('db', 'reports', 'posts', `notifications|${report.reporterUid}`)
  return report
}

export function listReports(db: LocalDatabase): ModerationReport[] {
  return sortBy(Object.values(db.reports), (r) => Date.parse(r.createdAt), 'desc')
}

export function listDisputes(db: LocalDatabase): DisputeCase[] {
  return sortBy(Object.values(db.disputes), (d) => Date.parse(d.createdAt), 'desc')
}

export function resolveDispute(
  db: LocalDatabase,
  id: string,
  patch: { status: DisputeCase['status']; outcome: string },
  actorUid: string,
): DisputeCase {
  const dispute = db.disputes[id]
  if (!dispute) fail('dispute/not-found', 'That dispute could not be found.')
  const now = new Date().toISOString()
  dispute.status = patch.status
  dispute.outcome = patch.outcome
  dispute.handledByUid = actorUid
  dispute.updatedAt = now

  const booking = db.bookings[dispute.bookingId]
  if (booking && patch.status !== 'open') {
    booking.status = 'completed'
    booking.revision += 1
    booking.updatedAt = now
    booking.settlement.note = `Dispute resolved by a steward: ${patch.outcome}`
  }

  // Both sides are told, and a refund reads as a refund. Production used
  // `session_disputed` for this, which is the type for *opening* a dispute.
  pushDraft(db, disputeResolvedDraft(dispute, true, patch.outcome))
  pushDraft(db, disputeResolvedDraft(dispute, false, patch.outcome))
  if (booking && patch.status !== 'open' && patch.status !== 'resolved_release') {
    const refundTokens = booking.settlement.refundTxId ? Math.abs(booking.tokenAmount / 2) : 0
    if (refundTokens > 0) pushDraft(db, refundIssuedDraft(booking, refundTokens, patch.outcome))
  }
  persist('db', 'disputes', 'bookings')
  return dispute
}
