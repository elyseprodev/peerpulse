/**
 * Skill taxonomy.
 *
 * The category list is shipped with the app (it is a closed vocabulary used for
 * filtering and for community mapping). Individual skill *listings* always live
 * in Firestore — the app never invents listings, so an empty database shows an
 * honest empty state.
 */
export interface SkillCategory {
  id: string
  name: string
  description: string
  icon: string
  /** Tailwind-friendly accent used for category chips. */
  accent: string
  /** Example skills — editorial copy for the taxonomy, not fake users. */
  examples: string[]
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: 'music',
    name: 'Music & Audio',
    description: 'Instruments, theory, production and ear training.',
    icon: 'music',
    accent: '#34D399',
    examples: ['Guitar', 'Piano', 'Music theory', 'Home recording'],
  },
  {
    id: 'languages',
    name: 'Languages',
    description: 'Conversation practice, grammar drills and exam prep.',
    icon: 'languages',
    accent: '#22D3EE',
    examples: ['Spanish', 'Japanese', 'Sign language', 'IELTS speaking'],
  },
  {
    id: 'technology',
    name: 'Technology',
    description: 'Programming, data, infrastructure and product craft.',
    icon: 'code',
    accent: '#60A5FA',
    examples: ['Python', 'Vue & TypeScript', 'SQL', 'Linux basics'],
  },
  {
    id: 'design',
    name: 'Design & Creative',
    description: 'Visual design, illustration, photography and writing.',
    icon: 'palette',
    accent: '#F472B6',
    examples: ['UI design', 'Illustration', 'Photography', 'Copywriting'],
  },
  {
    id: 'business',
    name: 'Business & Career',
    description: 'Interviews, finance literacy, marketing and leadership.',
    icon: 'briefcase',
    accent: '#FBBF24',
    examples: ['CV review', 'Public speaking', 'Bookkeeping', 'Negotiation'],
  },
  {
    id: 'wellbeing',
    name: 'Health & Wellbeing',
    description: 'Movement, mindfulness, cooking and sleep.',
    icon: 'heart',
    accent: '#2DD4BF',
    examples: ['Yoga', 'Meditation', 'Meal planning', 'Running form'],
  },
  {
    id: 'academics',
    name: 'Academics',
    description: 'Maths, sciences, study skills and exam technique.',
    icon: 'book',
    accent: '#A3E635',
    examples: ['Algebra', 'Physics', 'Essay structure', 'Statistics'],
  },
  {
    id: 'life',
    name: 'Practical & Life Skills',
    description: 'Repairs, gardening, budgeting, DIY and everyday know-how.',
    icon: 'tools',
    accent: '#FB923C',
    examples: ['Bike repair', 'Sewing', 'Gardening', 'Budgeting'],
  },
]

export const CATEGORY_MAP: Record<string, SkillCategory> = Object.fromEntries(
  SKILL_CATEGORIES.map((c) => [c.id, c]),
)

export function categoryName(id: string): string {
  return CATEGORY_MAP[id]?.name ?? 'Other'
}

export function categoryAccent(id: string): string {
  return CATEGORY_MAP[id]?.accent ?? '#10B981'
}

export const SESSION_FORMAT_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  video: { label: 'Live video', description: 'Face-to-face over the built-in classroom.', icon: 'video' },
  voice: { label: 'Voice call', description: 'Audio only — great for language practice.', icon: 'mic' },
  chat: { label: 'Guided chat', description: 'Text-based session with structured prompts.', icon: 'chat' },
  async: { label: 'Async feedback', description: 'Share work, get written feedback within 48h.', icon: 'clock' },
}

export const SKILL_LEVEL_LABELS: Record<string, string> = {
  beginner: 'Beginner-friendly',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  any: 'All levels',
}

export const INTEREST_OPTIONS = [
  'Learning a language',
  'Career change',
  'Creative practice',
  'Fitness & health',
  'Coding side projects',
  'Community teaching',
  'Exam preparation',
  'Hobbies & crafts',
  'Mentoring beginners',
  'Remote collaboration',
]

/** Sensible default weekly availability offered during onboarding. */
export const DEFAULT_AVAILABILITY = [
  { weekday: 1, start: '18:00', end: '21:00' },
  { weekday: 3, start: '18:00', end: '21:00' },
  { weekday: 6, start: '10:00', end: '14:00' },
]

export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Mandarin' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'sw', label: 'Swahili' },
]

export function languageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? code.toUpperCase()
}
