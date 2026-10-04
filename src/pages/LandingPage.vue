<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { SKILL_CATEGORIES } from '@/lib/catalog'
import { useSkillsStore } from '@/stores/skills'
import { useAuthStore } from '@/stores/auth'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppAvatar from '@/components/ui/AppAvatar.vue'
import SectionHeading from '@/components/ui/SectionHeading.vue'
import SkillCard from '@/components/skills/SkillCard.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'

const skills = useSkillsStore()
const auth = useAuthStore()

onMounted(() => {
  skills.loadFeatured(6)
})

const featured = computed(() => skills.featured)
const hasListings = computed(() => featured.value.length > 0)

const STEPS = [
  {
    icon: 'users',
    title: 'Create your account',
    body: 'A name, an email and a two-minute profile. New members start with three introductory Time Tokens.',
  },
  {
    icon: 'seed',
    title: 'List what you teach and want to learn',
    body: 'Teaching guitar? Learning Python? Both go on your profile so the exchange can find your match.',
  },
  {
    icon: 'calendar',
    title: 'Discover people and book a session',
    body: 'Browse listings, check real availability and agree a time. The room opens fifteen minutes before.',
  },
  {
    icon: 'tokens',
    title: 'Trade Time Tokens when it is done',
    body: 'Attendance is verified, the learner spends one token per hour and the teacher earns exactly the same.',
  },
]

const BENEFITS = [
  {
    icon: 'globe',
    title: 'Learning without a paywall',
    body: 'Your budget never decides what you can learn. Time is the only currency, and everyone has some.',
  },
  {
    icon: 'shield',
    title: 'Fair by design',
    body: 'An hour of guitar is worth an hour of coding. No skill is priced above another — the ledger proves it.',
  },
  {
    icon: 'users',
    title: 'Built on reciprocity',
    body: 'Teaching is how you earn, learning is how you spend. Both sides stay visible, accountable and generous.',
  },
  {
    icon: 'spark',
    title: 'Knowledge that stays local',
    body: 'Your neighbours, colleagues and community groups hold skills no course catalogue ever lists.',
  },
]
</script>

<template>
  <div>
    <!-- ── Hero ─────────────────────────────────────────────────────────── -->
    <section class="relative overflow-hidden pt-14 pb-20 sm:pt-20">
      <div class="pp-grid-lines pointer-events-none absolute inset-0 -z-1" aria-hidden="true" />
      <div class="pp-container grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div class="pp-stagger">
          <div class="flex flex-wrap items-center gap-2" style="--i: 0">
            <AppBadge tone="brand" dot>Time-bank exchange · live</AppBadge>
            <AppBadge tone="cyan">No money changes hands</AppBadge>
          </div>

          <h1 class="font-display mt-6 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink sm:text-5xl lg:text-6xl" style="--i: 1">
            Trade Time.<br />
            Share Skills.<br />
            <span class="pp-gradient-text">Grow Together.</span>
          </h1>

          <p class="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg" style="--i: 2">
            PeerPulse is a community skill exchange built on a simple promise:
            <span class="text-ink">one hour of teaching earns one Time Token</span>, and one Time Token buys one hour of
            learning from someone else. A guitar lesson and a programming lesson are worth exactly the same.
          </p>

          <div class="mt-8 flex flex-wrap items-center gap-3" style="--i: 3">
            <AppButton v-if="!auth.isAuthenticated" to="/register" size="lg" icon-right="arrow-right">
              Start exchanging — it's free
            </AppButton>
            <AppButton v-else to="/dashboard" size="lg" icon-right="arrow-right">Go to your dashboard</AppButton>
            <AppButton to="/skills" variant="secondary" size="lg" icon="search">Explore skills</AppButton>
          </div>

          <dl class="mt-10 grid max-w-lg grid-cols-3 gap-4" style="--i: 4">
            <div>
              <dt class="text-[11px] tracking-wide text-muted uppercase">Exchange rate</dt>
              <dd class="font-display mt-1 text-xl font-bold text-brand-bright">1 h = 1 TT</dd>
            </div>
            <div>
              <dt class="text-[11px] tracking-wide text-muted uppercase">New member grant</dt>
              <dd class="font-display mt-1 text-xl font-bold text-ink">3 TT</dd>
            </div>
            <div>
              <dt class="text-[11px] tracking-wide text-muted uppercase">Settlement</dt>
              <dd class="font-display mt-1 text-xl font-bold text-ink">Verified</dd>
            </div>
          </dl>
        </div>

        <!-- Interactive-looking product preview (real component vocabulary) -->
        <div class="relative">
          <div class="pp-card animate-[fade-up_0.7s_cubic-bezier(0.22,1,0.36,1)_both] p-5 shadow-glow">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <AppAvatar display-name="Sam Okonkwo" seed="demo_sam" :size="40" />
                <div>
                  <p class="text-sm font-semibold text-ink">Guitar for absolute beginners</p>
                  <p class="text-[11px] text-muted">Sam Okonkwo · Manchester, UK</p>
                </div>
              </div>
              <div class="text-right">
                <p class="font-display text-base font-bold text-brand-bright">1 TT</p>
                <p class="text-[11px] text-muted">60 min</p>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-7 gap-1.5" role="img" aria-label="Weekly availability preview">
              <div
                v-for="(day, index) in ['M', 'T', 'W', 'T', 'F', 'S', 'S']"
                :key="index"
                class="rounded-lg border border-line/60 py-1.5 text-center text-[10px] text-muted"
                :class="[0, 2, 5].includes(index) ? 'bg-brand/15 text-brand-bright border-brand/30' : ''"
              >
                {{ day }}
              </div>
              <div
                v-for="slot in 21"
                :key="`s${slot}`"
                class="h-1.5 rounded"
                :class="[3, 4, 10, 11, 17, 18, 19].includes(slot) ? 'bg-brand/60' : 'bg-line/50'"
              />
            </div>

            <div class="pp-hairline mt-5 space-y-3 pt-4">
              <div class="flex items-center justify-between text-xs">
                <span class="inline-flex items-center gap-2 text-muted">
                  <AppIcon name="check" :size="14" class="text-brand-bright" /> Teacher confirmed
                </span>
                <span class="text-muted">14:02</span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="inline-flex items-center gap-2 text-muted">
                  <AppIcon name="check" :size="14" class="text-brand-bright" /> Learner confirmed
                </span>
                <span class="text-muted">14:03</span>
              </div>
              <div class="rounded-xl border border-brand/30 bg-brand/10 p-3">
                <p class="text-xs font-semibold text-brand-bright">Session settled · 58 min verified</p>
                <p class="mt-1 text-[11px] text-muted">
                  Sam +1 TT earned · Tomás −1 TT spent · both sides recorded in the ledger
                </p>
              </div>
            </div>
          </div>

          <div class="pp-card absolute -bottom-6 -left-4 hidden w-56 p-4 sm:block">
            <p class="text-[11px] tracking-wide text-muted uppercase">Your balance</p>
            <p class="font-display mt-1 text-2xl font-bold text-ink">
              {{ auth.profile ? 3 : 3 }} <span class="text-sm font-medium text-muted">Time Tokens</span>
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
              <div class="h-full w-3/5 rounded-full bg-gradient-to-r from-brand to-cyan" />
            </div>
            <p class="mt-2 text-[11px] text-muted">3 hours of learning available to you today.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── How it works ─────────────────────────────────────────────────── -->
    <section class="pp-container py-16" aria-labelledby="how-heading">
      <SectionHeading
        eyebrow="How it works"
        title="Four steps from “I could teach that” to “I just learned it”"
        description="PeerPulse keeps the mechanics of a time bank and hides the accounting. You focus on the session; the ledger does the rest."
      />
      <ol id="how-heading" class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <li v-for="(step, index) in STEPS" :key="step.title" class="pp-card pp-card-hover relative p-6">
          <span class="font-display absolute top-5 right-5 text-3xl font-bold text-line/80">{{ index + 1 }}</span>
          <span class="grid size-11 place-items-center rounded-2xl bg-brand/12 text-brand-bright ring-1 ring-brand/25">
            <AppIcon :name="step.icon" :size="20" />
          </span>
          <h3 class="font-display mt-4 text-base font-semibold text-ink">{{ step.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted">{{ step.body }}</p>
        </li>
      </ol>
    </section>

    <!-- ── Featured skills ──────────────────────────────────────────────── -->
    <section class="pp-container py-16" aria-labelledby="skills-heading">
      <div class="flex flex-wrap items-end justify-between gap-6">
        <SectionHeading
          eyebrow="Featured skills"
          title="What people are trading right now"
          description="Every listing is a real member offering real time. Filter by category, level, language or when you are free."
        />
        <AppButton to="/skills" variant="secondary" icon-right="arrow-right">Browse all skills</AppButton>
      </div>

      <div v-if="skills.loading && !hasListings" class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <AppSkeleton v-for="n in 3" :key="n" card :lines="3" />
      </div>

      <div v-else-if="hasListings" id="skills-heading" class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <SkillCard
          v-for="skill in featured"
          :key="skill.id"
          :skill="skill"
          :owner="skills.ownerOf(skill)"
          :config="null"
        />
      </div>

      <!-- Honest empty state: no listings have been created yet -->
      <div v-else id="skills-heading" class="pp-card mt-10 p-8 text-center">
        <h3 class="font-display text-lg font-semibold text-ink">The exchange is waiting for its first listing</h3>
        <p class="mx-auto mt-2 max-w-lg text-sm text-muted">
          Nothing is fabricated here — this space fills up with real members. Create your profile and publish the first
          skill you would happily teach.
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-3">
          <AppButton to="/register" icon-right="arrow-right">Publish your first skill</AppButton>
          <AppButton to="/how-it-works" variant="secondary">See how a session settles</AppButton>
        </div>
      </div>
    </section>

    <!-- ── Categories ───────────────────────────────────────────────────── -->
    <section class="pp-container py-10">
      <SectionHeading eyebrow="Categories" title="Eight categories, one exchange rate" />
      <ul class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <li v-for="category in SKILL_CATEGORIES" :key="category.id">
          <RouterLink
            :to="`/skills?category=${category.id}`"
            class="pp-card pp-card-hover group flex h-full flex-col gap-2 p-4"
          >
            <span
              class="grid size-9 place-items-center rounded-xl ring-1"
              :style="{ color: category.accent, background: `${category.accent}1f`, borderColor: `${category.accent}33` }"
            >
              <AppIcon :name="category.icon" :size="17" />
            </span>
            <p class="font-display text-sm font-semibold text-ink group-hover:text-brand-bright">{{ category.name }}</p>
            <p class="text-[11px] leading-relaxed text-muted">{{ category.description }}</p>
            <p class="mt-auto text-[11px] text-muted/80">{{ category.examples.slice(0, 3).join(' · ') }}</p>
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- ── Fair exchange ────────────────────────────────────────────────── -->
    <section class="pp-container py-16">
      <div class="pp-card overflow-hidden">
        <div class="grid gap-0 lg:grid-cols-2">
          <div class="p-8 sm:p-10">
            <AppBadge tone="brand">Fair & democratic exchange</AppBadge>
            <h2 class="font-display mt-5 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Nobody's hour is worth more than anybody else's
            </h2>
            <p class="mt-4 text-sm leading-relaxed text-muted">
              In a normal marketplace a lawyer's hour out-earns a carer's hour. PeerPulse removes price from the
              equation: the unit of exchange is <span class="text-ink">time itself</span>.
            </p>
            <ul class="mt-6 space-y-4">
              <li class="flex gap-3">
                <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
                  <AppIcon name="check" :size="15" />
                </span>
                <p class="text-sm text-muted">
                  <span class="text-ink">One hour = one Time Token.</span> Partial hours follow a published rounding
                  policy, never a hidden fee.
                </p>
              </li>
              <li class="flex gap-3">
                <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
                  <AppIcon name="check" :size="15" />
                </span>
                <p class="text-sm text-muted">
                  <span class="text-ink">Every movement is auditable.</span> Each token debit has a matching credit and
                  an immutable ledger row you can read in your wallet.
                </p>
              </li>
              <li class="flex gap-3">
                <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand-bright">
                  <AppIcon name="check" :size="15" />
                </span>
                <p class="text-sm text-muted">
                  <span class="text-ink">Tokens are not money.</span> They cannot be bought, sold, transferred for cash
                  or withdrawn. They represent time owed and time given.
                </p>
              </li>
            </ul>
          </div>

          <div class="border-t border-line/60 bg-canvas/40 p-8 sm:p-10 lg:border-t-0 lg:border-l">
            <p class="text-[11px] tracking-wide text-muted uppercase">A settled session, line by line</p>

            <div class="mt-5 space-y-3">
              <div class="rounded-xl border border-line/70 bg-surface/60 p-4">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold text-ink">Guitar for absolute beginners</p>
                  <span class="text-xs text-muted">60 min</span>
                </div>
                <p class="mt-1 text-[11px] text-muted">Sam teaches · Tomás learns</p>
              </div>

              <div class="flex items-center justify-between rounded-xl border border-line/70 bg-surface/60 px-4 py-3">
                <span class="text-xs text-muted">Learner debit</span>
                <span class="font-mono text-xs text-danger">−1.0000 TT</span>
              </div>
              <div class="flex items-center justify-between rounded-xl border border-line/70 bg-surface/60 px-4 py-3">
                <span class="text-xs text-muted">Teacher credit</span>
                <span class="font-mono text-xs text-brand-bright">+1.0000 TT</span>
              </div>
              <div class="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/10 px-4 py-3">
                <span class="text-xs font-medium text-ink">Net tokens created</span>
                <span class="font-mono text-xs text-brand-bright">0.0000 TT</span>
              </div>
              <p class="text-[11px] leading-relaxed text-muted">
                The exchange never mints tokens for itself: a settlement always moves credit from one member to
                another. Integrity checks run on every write.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Benefits ─────────────────────────────────────────────────────── -->
    <section class="pp-container py-16">
      <SectionHeading
        eyebrow="Community benefits"
        title="What a skills exchange does for a community"
        align="center"
      />
      <div class="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <article v-for="benefit in BENEFITS" :key="benefit.title" class="pp-card pp-card-hover p-6">
          <span class="grid size-11 place-items-center rounded-2xl bg-cyan/10 text-cyan ring-1 ring-cyan/25">
            <AppIcon :name="benefit.icon" :size="20" />
          </span>
          <h3 class="font-display mt-4 text-base font-semibold text-ink">{{ benefit.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted">{{ benefit.body }}</p>
        </article>
      </div>
    </section>

    <!-- ── A brighter future ────────────────────────────────────────────── -->
    <section class="relative overflow-hidden py-20">
      <div class="pp-container">
        <div class="pp-card relative overflow-hidden p-8 text-center sm:p-14">
          <div
            class="pointer-events-none absolute inset-0 opacity-70"
            style="background: radial-gradient(40rem 20rem at 50% 0%, rgba(16,185,129,0.22), transparent 70%)"
            aria-hidden="true"
          />
          <div class="relative">
            <AppBadge tone="cyan">A brighter future</AppBadge>
            <h2 class="font-display mx-auto mt-5 max-w-2xl text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              Imagine a neighbourhood where everyone's knowledge is currency
            </h2>
            <p class="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
              A retired electrician teaching a teenager to rewire a lamp. A nurse learning Portuguese before a move
              abroad. A designer helping a community garden with its signage and learning to keep bees in return. Nobody
              invoices anybody. Time balances out, and trust compounds.
            </p>

            <div class="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
              <div class="rounded-2xl border border-line/70 bg-canvas/40 p-4">
                <p class="font-display text-2xl font-bold text-brand-bright">Skills stay</p>
                <p class="mt-1 text-xs text-muted">Knowledge circulates instead of retiring with one person.</p>
              </div>
              <div class="rounded-2xl border border-line/70 bg-canvas/40 p-4">
                <p class="font-display text-2xl font-bold text-brand-bright">Access opens</p>
                <p class="mt-1 text-xs text-muted">Money stops being the gatekeeper of learning.</p>
              </div>
              <div class="rounded-2xl border border-line/70 bg-canvas/40 p-4">
                <p class="font-display text-2xl font-bold text-brand-bright">Trust grows</p>
                <p class="mt-1 text-xs text-muted">Every completed hour is a relationship, not a transaction.</p>
              </div>
            </div>

            <div class="mt-9 flex flex-wrap justify-center gap-3">
              <AppButton to="/register" size="lg" icon-right="arrow-right">Join the exchange</AppButton>
              <AppButton to="/how-it-works" variant="secondary" size="lg">Read the details first</AppButton>
            </div>
            <p class="mt-4 text-xs text-muted">
              Free to join · {{ SKILL_CATEGORIES.length }} categories · Time Tokens can never be bought or withdrawn
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
