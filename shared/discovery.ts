/**
 * Marketplace discovery: filtering, search and ordering.
 *
 * This module exists because the two backends drifted. `listSkills` was
 * implemented twice — once against Firestore, once against the local store — and
 * they disagreed on three things a member would notice:
 *
 *   1. **Search found teachers in local mode and not in production.** The local
 *      implementation searched the owner's display name and headline; the
 *      Firestore one searched only the listing's own fields, so "Spanish with
 *      Mei" worked locally and returned nothing when deployed.
 *   2. **The Firestore path truncated before filtering.** It pushed
 *      `limit(60)` into the query and applied level, language, duration, weekday
 *      and text filters *afterwards*, so a matching listing ranked 61st was
 *      invisible. The local path filtered first and then limited.
 *   3. **Relevance scoring differed** by the `bookingCount` term.
 *
 * Rather than patch two copies into agreement, both backends now call the
 * functions below. Firestore still pushes down the constraints it can
 * (`status`, `categoryId`, `format`) — that is what keeps the query indexed and
 * cheap — and everything else is decided here, so production and local mode
 * cannot disagree again. `tests/unit/discovery.spec.ts` pins each rule, and a
 * static check asserts both backends call this module rather than reimplementing
 * it.
 */
import type { AvailabilityBlock, SkillFilter, SkillListing, UserProfile } from './domain'

/** The owner fields discovery is allowed to read. */
export interface DiscoveryOwner {
  uid?: string
  displayName?: string
  headline?: string
  availability?: AvailabilityBlock[]
}

const FORMAT_MATCHES_FILTER = (skill: SkillListing, filter: SkillFilter): boolean =>
  !filter.format || skill.format === filter.format

/**
 * A listing that may appear in the marketplace at all.
 *
 * The rule lives here so the two backends cannot disagree about what "published"
 * means: a hidden or removed listing is a moderator's decision, and only
 * `includeUnpublished` (the owner's own view) overrides it.
 */
export function isDiscoverable(skill: SkillListing): boolean {
  return skill.status === 'published' && !['hidden', 'removed'].includes(skill.moderation?.state ?? 'clean')
}

/** Every field text search looks at, including the teacher's own words. */
function searchableText(skill: SkillListing, owner?: DiscoveryOwner): string[] {
  return [
    skill.title,
    skill.description,
    ...skill.tags,
    ...skill.outcomes,
    owner?.displayName ?? '',
    owner?.headline ?? '',
  ]
}

export function matchesSkillQuery(skill: SkillListing, query: string, owner?: DiscoveryOwner): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return searchableText(skill, owner).some((field) => (field ?? '').toLowerCase().includes(needle))
}

/**
 * Does the listing satisfy the filter? `owner` is only consulted for the two
 * rules that are about the person rather than the listing: text search over the
 * teacher's name, and the weekday filter, which asks whether the teacher is
 * available at all that day.
 */
export function matchesSkillFilters(skill: SkillListing, filter: SkillFilter, owner?: DiscoveryOwner): boolean {
  if (filter.categoryId && skill.categoryId !== filter.categoryId) return false
  // A listing marked `any` suits every level, so it satisfies any level filter.
  if (filter.level && filter.level !== 'any' && skill.level !== filter.level && skill.level !== 'any') return false
  if (!FORMAT_MATCHES_FILTER(skill, filter)) return false
  if (filter.language && !skill.languages.includes(filter.language)) return false
  if (filter.maxDurationMinutes && skill.durationMinutes > filter.maxDurationMinutes) return false
  if (filter.weekday !== null && filter.weekday !== undefined) {
    if (!(owner?.availability ?? []).some((block) => block.weekday === filter.weekday)) return false
  }
  if (filter.query && !matchesSkillQuery(skill, filter.query, owner)) return false
  return true
}

/** Average rating, or 0 for a listing nobody has reviewed yet. */
export function skillRating(skill: SkillListing): number {
  return skill.reviewCount ? skill.ratingSum / skill.reviewCount : 0
}

/**
 * Relevance is deliberately simple and explainable: a good rating dominates,
 * then finished sessions (proof it works), then interest in the form of
 * bookings. It is not a learning-to-rank model and does not pretend to be.
 */
export function relevanceScore(skill: SkillListing): number {
  return skillRating(skill) * 100 + skill.completedCount * 5 + skill.bookingCount * 5
}

const COMPARATORS: Record<NonNullable<SkillFilter['sort']>, (a: SkillListing, b: SkillListing) => number> = {
  relevance: (a, b) => relevanceScore(b) - relevanceScore(a),
  rating: (a, b) => skillRating(b) - skillRating(a),
  recent: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  duration: (a, b) => a.durationMinutes - b.durationMinutes,
}

/**
 * Order listings. Ties break on id so the same data always renders in the same
 * order — an unstable sort makes a cached page and a reload disagree, and makes
 * tests flaky for reasons unrelated to the change under review.
 */
export function sortSkills(skills: SkillListing[], sort: SkillFilter['sort'] = 'relevance'): SkillListing[] {
  const compare = COMPARATORS[sort ?? 'relevance'] ?? COMPARATORS.relevance
  return [...skills].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id))
}

/**
 * The whole discovery pipeline: filter, then order, then limit — in that order.
 *
 * The order is the fix described at the top of this file: limiting first and
 * filtering afterwards silently loses matches.
 *
 * `includeUnpublished` is how the owner's own view (their profile editor) sees a
 * draft or a paused listing. It is a parameter rather than something the call
 * site pre-filters, because doing it at the call site is how one backend ended up
 * able to see drafts and the other not.
 */
export function discoverSkills(
  skills: SkillListing[],
  filter: SkillFilter = {},
  owners: Record<string, DiscoveryOwner> = {},
  limit?: number,
  options: { includeUnpublished?: boolean } = {},
): SkillListing[] {
  const visible = options.includeUnpublished ? skills : skills.filter(isDiscoverable)
  const filtered = visible.filter((skill) => matchesSkillFilters(skill, filter, owners[skill.ownerUid]))
  const ordered = sortSkills(filtered, filter.sort)
  return limit ? ordered.slice(0, limit) : ordered
}

/** Narrow a `UserProfile` to the fields discovery reads, for callers that have full profiles. */
export function discoveryOwner(profile: UserProfile): DiscoveryOwner {
  return {
    uid: profile.uid,
    displayName: profile.displayName,
    headline: profile.headline,
    availability: profile.availability,
  }
}

/** True when the filter needs client-side evaluation, so the query must not truncate. */
export function needsClientSideFiltering(filter: SkillFilter): boolean {
  return Boolean(
    filter.level ||
      filter.language ||
      filter.maxDurationMinutes ||
      filter.weekday !== null && filter.weekday !== undefined ||
      filter.query,
  )
}
