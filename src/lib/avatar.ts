/**
 * Deterministic generated avatars.
 *
 * We never ship stock photos of real people as "members", so every profile
 * without an uploaded photo gets a stable, distinct, brand-coloured SVG avatar
 * derived from its uid. The same seed always produces the same avatar, which
 * keeps the UI recognisable across devices and in screenshots.
 */

const PALETTE = [
  ['#10B981', '#22D3EE'],
  ['#34D399', '#0EA5E9'],
  ['#22D3EE', '#10B981'],
  ['#A3E635', '#10B981'],
  ['#2DD4BF', '#3B82F6'],
  ['#FBBF24', '#10B981'],
  ['#F472B6', '#22D3EE'],
  ['#60A5FA', '#34D399'],
] as const

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function avatarColors(seed: string): { from: string; to: string } {
  const [from, to] = PALETTE[hash(seed) % PALETTE.length]
  return { from, to }
}

/**
 * Inline SVG avatar: gradient disc + abstract "pulse" ring whose angle and
 * radius vary with the seed.
 */
export function avatarDataUri(seed: string, label = ''): string {
  const { from, to } = avatarColors(seed)
  const id = hash(seed)
  const angle = (id % 360).toFixed(0)
  const ringRotation = ((id >> 3) % 360).toFixed(0)
  const dotY = 18 + (id % 12)
  const initialsLabel = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <defs>
    <linearGradient id="g${id}" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="28" fill="#0B1F2D"/>
  <circle cx="48" cy="48" r="30" fill="url(#g${id})" opacity="0.18"/>
  <circle cx="48" cy="48" r="30" fill="none" stroke="url(#g${id})" stroke-width="3" transform="rotate(${ringRotation} 48 48)" stroke-dasharray="120 70" stroke-linecap="round"/>
  <circle cx="48" cy="${dotY + 30}" r="9" fill="url(#g${id})"/>
  ${
    initialsLabel
      ? `<text x="48" y="76" text-anchor="middle" font-family="Inter, sans-serif" font-size="17" font-weight="700" fill="#E7F6F0" opacity="0.92">${initialsLabel}</text>`
      : ''
  }
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function resolveAvatarUrl(profile: { photoURL?: string | null; avatarSeed?: string; displayName?: string }): string {
  if (profile.photoURL) return profile.photoURL
  return avatarDataUri(profile.avatarSeed || profile.displayName || 'peerpulse', profile.displayName ?? '')
}
