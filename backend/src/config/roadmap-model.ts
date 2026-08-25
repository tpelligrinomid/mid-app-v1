/**
 * The program roadmap model — one definition, three consumers.
 *
 * These values decide what a tier costs, which categories a program may draw from, and
 * when a plan gets flagged. They are needed in three places and must agree in all of
 * them:
 *
 *   1. Backend logic — payload assembly, option validation, soft-flag computation
 *   2. The frontend — generation-form validation and flag styling, via
 *      GET /api/compass/roadmap-config
 *   3. Master Marketer — receives the relevant slice inside the generation payload
 *
 * The frontend explicitly asked not to hold a second hardcoded copy, and they were right
 * to: a duplicated eligibility matrix drifts silently, and the first symptom is a roadmap
 * that passes the form and is refused by the backend.
 *
 * See docs/program-roadmap-spec.md for the reasoning behind each number.
 */

/** Effort hours per legacy point. Measured across 71 in-scope process library items. */
export const HOURS_PER_POINT = 0.78;

/**
 * Monthly reserve for strategy and account management, before any program work.
 *
 * 12.6 observed points/month × 0.78. Near-constant in absolute hours at every tier, which
 * is why its *share* falls as the fee rises — 31% at Execute, 20% at Perform, 10% at Grow,
 * against the retainer model's predicted 30 / 20 / 12.
 */
export const OVERHEAD_HOURS = 9.8;

/**
 * Overhead is IN the plan, as ordinary rows.
 *
 * Strategy and account management is not a reserve skimmed off the top -- it is work that
 * gets billed to tasks like everything else. Preparing a plan, standing up a VM, running a
 * monthly status call: each is a library item with hours against it, and the library
 * carries them already (`Develop Marketing Roadmap Document`, `Client Onboarding & Kickoff`,
 * `Facilitate Client Meetings`).
 *
 * So the generator allocates against the FULL capacity and emits strategy and account
 * management rows like any other. OVERHEAD_HOURS is the expectation for how much of a month
 * they should come to, not a subtraction from what may be planned -- which is what makes
 * `overhead_under_reserved` a real signal: a month with 2 hours of coordination on a
 * 32-hour engagement is under-serving the account, and that is worth saying.
 *
 * `program_hours` on an option is therefore GUIDANCE, not a per-month ceiling. Because
 * overhead is lumpy, a month-one plan legitimately spends 24 hours on strategy and setup
 * while month three spends five. The month's real ceiling is the full `hours_available`.
 */

/**
 * The rate at which hours bill the same as the old $100 point.
 *
 * Below it, a program roadmap quotes less than the points menu did for the same work;
 * above it, more. Reported for context; nothing branches on it.
 */
export const BREAK_EVEN_RATE = 129;

/**
 * NOT a conversion for task hours. Task hours come from
 * compass_process_library.time_estimate_ms directly. HOURS_PER_POINT exists only to
 * translate figures that were originally expressed in points, such as OVERHEAD_HOURS.
 */

export type Tier = 'execute' | 'perform' | 'grow';
export type Program = 'authority' | 'reach' | 'pursuit';

/**
 * Tiers are bands of CAPACITY HOURS, not dollars.
 *
 * Under dollar bands the same tier bought wildly different amounts of work: $4,000 at
 * $125/hr is 32 capacity hours, but at $175/hr it is 22.9 — two contracts labelled Execute
 * differing by 40%, with neither Execute archetype fitting at the higher rate.
 *
 * Hours bands hold the scope promise constant and let a harder account pay more for it,
 * which is what the rate variable exists for. Published pricing reads "from $4,000", so a
 * floor that rises with the rate breaks no promise.
 */
export const TIER_BANDS: Record<Tier, { min_capacity_hours: number; max_capacity_hours: number | null; programs: number }> = {
  execute: { min_capacity_hours: 32, max_capacity_hours: 48, programs: 1 },
  perform: { min_capacity_hours: 48, max_capacity_hours: 96, programs: 2 },
  grow:    { min_capacity_hours: 96, max_capacity_hours: null, programs: 3 },
};

/** capacity = what the service fee buys at the contract's blended rate. */
export function capacityHours(monthlyBudget: number, dollarPerHour: number): number {
  if (!dollarPerHour || dollarPerHour <= 0) {
    throw new Error('dollar_per_hour must be set on the contract before generating');
  }
  return monthlyBudget / dollarPerHour;
}

/** Hours left for program work once the overhead reserve is taken off the top. */
export function programHours(monthlyBudget: number, dollarPerHour: number): number {
  return capacityHours(monthlyBudget, dollarPerHour) - OVERHEAD_HOURS;
}

/** The tier a budget lands in at a given rate, or null when below the Execute floor. */
export function tierForCapacity(hours: number): Tier | null {
  for (const tier of ['execute', 'perform', 'grow'] as Tier[]) {
    const band = TIER_BANDS[tier];
    if (hours >= band.min_capacity_hours && (band.max_capacity_hours === null || hours < band.max_capacity_hours)) {
      return tier;
    }
  }
  return null;
}

/**
 * Which categories each program may draw from, in rolled-up names.
 *
 * This is an ELIGIBILITY FILTER, never a derivation. Five categories sit in more than one
 * program, so a category cannot name the program that paid for it — that is what each
 * option's program_allocation map is for.
 */
export const PROGRAM_MATRIX: Record<Program, string[]> = {
  authority: [
    'Content',
    'Design',
    'Analytics & reporting',
    'Organic social',
    'Podcast & video',
  ],
  reach: [
    'Content',
    'Design',
    'Development',
    'Marketing operations',
    'Analytics & reporting',
    'Paid media',
    'Email & nurture',
  ],
  pursuit: [
    'Content',
    'Design',
    'Development',
    'Marketing operations',
    'Analytics & reporting',
    'Paid media',
    'Outbound',
  ],
};

/**
 * Stored ClickUp category -> the rolled-up name the matrix and the client portal use.
 *
 * Fifteen stored values roll up to twelve. Two merges and two exclusions:
 *
 *   Strategy + Account management -> the overhead reserve, never a program category
 *   Search & discovery -> Content, matching the published pricing table
 *   Technology -> excluded entirely; billed separately and never consumes hours
 *   Digital PR -> subcontracted, billed separately, never consumes hours
 *
 * Storing at full granularity and rolling up here means splitting SEO back out later costs
 * nothing and needs no reclassification.
 */
export const CATEGORY_ROLLUP: Record<string, string> = {
  'ACCOUNT MANAGEMENT':    'Strategy & account management',
  'STRATEGY':              'Strategy & account management',
  'MARKETING OPERATIONS':  'Marketing operations',
  'ANALYTICS & REPORTING': 'Analytics & reporting',
  'CONTENT':               'Content',
  'SEARCH & DISCOVERY':    'Content',
  'DESIGN':                'Design',
  'DEVELOPMENT':           'Development',
  'PAID MEDIA':            'Paid media',
  'EMAIL & NURTURE':       'Email & nurture',
  'OUTBOUND':              'Outbound',
  'ORGANIC SOCIAL':        'Organic social',
  'PODCAST & VIDEO':       'Podcast & video',
  'DIGITAL PR':            'Digital PR',
  'TECHNOLOGY':            'Technology',
};

/** The overhead reserve. Runs under every engagement, never sold on its own. */
export const OVERHEAD_CATEGORY = 'Strategy & account management';

/** Billed separately from the fee, so neither may consume hours. */
export const NON_HOUR_CATEGORIES = new Set(['Technology', 'Digital PR']);

export function rollUpCategory(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return CATEGORY_ROLLUP[stored.trim().toUpperCase()] ?? null;
}

/**
 * Soft flag vocabulary. Closed set — the frontend styles on `code`, so adding one is a
 * coordinated change, not a backend detail.
 *
 * Every flag here is arithmetic over rows the generator has already emitted, which is why
 * the backend computes them rather than the model: deterministic, identical on every
 * regeneration, and the thresholds move without redeploying a prompt. Master Marketer keeps
 * only the ramp *narrative* in its phase text.
 *
 * None of these block. They prompt a strategist who may well have a reason.
 */
export const FLAG_CODES = {
  row_below_baseline: {
    description: 'Row scheduled at less than half its library baseline with no reason given',
    threshold: 0.5,
    scope: 'month' as const,
  },
  month_thin_spread: {
    description: 'More active categories than the month has hours to serve properly',
    /** ~6 hours is the smallest library item that produces something substantial. */
    hours_per_category: 6,
    /**
     * A FLAT cap where set, not a min() against the hours threshold.
     *
     * min() only ever tightens. At the Execute floor, program_hours / 6 is 3.7, so a
     * min(3.7, 4) fires on the four-category Execute / Reach archetype for every engagement
     * between $4,000 and $4,225 at $125 -- the published entry price and the most common
     * Execute engagement. The cap was added to stop the guard evaporating at the TOP of the
     * band; a min() moved the failure to the bottom instead.
     *
     * Flat 4 holds at every point in the band: the archetype passes at the floor, and
     * narrowness still binds at the ceiling where the hours threshold would allow six.
     *
     * Only Execute is capped. Perform composes more freely by design, and 86 program hours
     * across nine eligible categories is ~9.5 hours each, which is legitimate.
     *
     * The count EXCLUDES Strategy & account management: it runs under every engagement, so
     * counting it would charge every plan one category for something it cannot avoid.
     */
    tier_category_cap: { execute: 4, perform: null, grow: null } as Record<Tier, number | null>,
    scope: 'month' as const,
  },
  row_above_baseline: {
    description: 'Row scheduled at more than twice its library baseline with no reason given',
    threshold: 2,
    scope: 'month' as const,
  },
  overhead_under_reserved: {
    description: 'Strategy and account management across the plan falls short of the expectation',
    /**
     * Checked across the WHOLE PLAN, not per month, because overhead is lumpy by nature.
     *
     * The library bears this out: the only recurring coordination item is
     * `Facilitate Client Meetings` at 5h/month, while the planning work sits in one-time
     * `Develop X Plan Document` items running 10-45h. So month one legitimately carries
     * 20+ hours of strategy and months two and three carry five. A per-month check against
     * 9.8 would fire on every correctly composed steady month -- which is how a flag column
     * gets ignored.
     *
     * Fires below 60% of `OVERHEAD_HOURS × months`, so genuine under-service still shows
     * while normal lumpiness does not.
     */
    threshold: 0.6,
    scope: 'plan' as const,
  },
  month_under_capacity: {
    description: 'Month allocates less than 85% of available hours',
    threshold: 0.85,
    scope: 'month' as const,
  },
  content_share_off_pattern: {
    description: 'Content share outside the expected range for the programs sold',
    /**
     * Computed off `service_category`, NOT off a row's `program`.
     *
     * Routing it through program_allocation made it fire on almost every correctly composed
     * Perform option. At Authority + Reach, Content, Design and Analytics are all shared,
     * so first-in-ordering hands whichever program was listed first roughly 80% of the
     * hours -- and both orderings trip a bound. A flag column that is usually wrong is one
     * strategists stop reading.
     *
     * The question the flag actually asks is how much of the month is content production
     * versus everything else, which the category answers directly -- without an allocation
     * that cannot represent a category split, and without depending on the order the
     * strategist happened to list programs in.
     *
     * Range is chosen by the option's programs: the widest bound among them, since a
     * two-program option can legitimately sit anywhere between its programs' patterns.
     */
    computed_from: 'service_category',
    ranges: { authority: [0.35, 0.65], reach: [0, 0.45], pursuit: [0, 0.40] } as Record<Program, [number, number]>,
    scope: 'month' as const,
  },
  ramp_month: {
    description: 'Month one carrying heavy setup; roughly half a steady-state month of production',
    scope: 'month' as const,
  },
  goal_commitment_mismatch: {
    description: 'A goal commits beyond what the tier permits',
    scope: 'option' as const,
  },
  goal_target_not_monotonic: {
    description: 'A higher tier target at or below a lower tier one',
    scope: 'document' as const,
  },
} as const;

export type FlagCode = keyof typeof FLAG_CODES;

/**
 * Soft flags mean two different things to a strategist and want styling to match.
 *
 * `content_share_off_pattern` says the generator composed this badly; `row_below_baseline`
 * after an edit says you just did. Same level, opposite response.
 */
export type FlagSeverity = 'review' | 'notice';

export interface RoadmapFlag {
  level: 'soft';
  code: FlagCode;
  message: string;
  severity?: FlagSeverity;
  /**
   * Where the flag attaches. Three levels, because three different things go wrong:
   *
   *   month    -- this month is composed badly
   *   option   -- this option is composed badly across its whole plan
   *   document -- these options disagree with each other
   *
   * `overhead_under_reserved` is option-level: overhead is lumpy month to month, so it is
   * only meaningful summed across the plan.
   */
  scope: 'month' | 'option' | 'document';
  /** Set on document-scope flags so the viewer can highlight both sides of a comparison. */
  option_ids?: string[];
}

/** Flags that compare options against each other, and so attach to the document. */
export const CROSS_OPTION_FLAGS: FlagCode[] = ['goal_target_not_monotonic'];

/** Flags meaningful only across a whole option, not a single month. */
export const OPTION_LEVEL_FLAGS: FlagCode[] = [
  'overhead_under_reserved',
  'goal_commitment_mismatch',
];

/**
 * Both baseline flags skip hand-added rows.
 *
 * A custom row has process_id null and therefore no baseline, so comparing against it
 * either divides by zero or fires on every row a strategist adds by hand.
 */
export const BASELINE_FLAGS: FlagCode[] = ['row_below_baseline', 'row_above_baseline'];

/**
 * Max active PROGRAM categories in a month before month_thin_spread fires.
 *
 * Count excludes OVERHEAD_CATEGORY -- see tier_category_cap.
 */
export function maxCategoriesForMonth(tier: Tier, programHours: number): number {
  const cap = FLAG_CODES.month_thin_spread.tier_category_cap[tier];
  // Flat where a cap exists; the hours threshold governs only the uncapped tiers.
  return cap ?? programHours / FLAG_CODES.month_thin_spread.hours_per_category;
}

/**
 * What class of GOAL a tier may commit to.
 *
 * Named `goal_` deliberately. An earlier `commitment_ladder` was read by the frontend as
 * the contract commitment vocabulary and rendered in that picker, which would have offered
 * a strategist "output / leading_indicator / business_outcome" where they expected
 * "monthly / annual". Contract commitment is COMMITMENT_TERMS below.
 */

/**
 * What a tier may commit to.
 *
 * Without this, "scale the goals to the tier" produces the same MQL goal at three
 * different numbers — three prices for one promise, which is the failure the option
 * structure exists to prevent. Constraining the CLASS of commitment makes it checkable.
 */
export const GOAL_COMMITMENT_LADDER: Record<Tier, string[]> = {
  execute: ['output'],
  perform: ['output', 'leading_indicator'],
  grow:    ['output', 'leading_indicator', 'business_outcome'],
};

/**
 * Contract commitment terms — how long the client is committing for.
 *
 * Entirely unrelated to the goal commitment ladder above. This drives the term and renewal
 * framing in the roadmap narrative; it does not affect capacity, tier, or any flag.
 */
export const COMMITMENT_TERMS = [
  { value: 'monthly', label: 'Month to month' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: '6 months' },
  { value: 'annual', label: 'Annual' },
] as const;

export type CommitmentTerm = (typeof COMMITMENT_TERMS)[number]['value'];

export function isCommitmentTerm(v: string): v is CommitmentTerm {
  return COMMITMENT_TERMS.some((t) => t.value === v);
}

/**
 * Acceptable content share for an option, taken as the widest bound across its programs.
 *
 * A Perform option running Authority + Reach can sit legitimately anywhere between
 * Authority's content-led pattern and Reach's distribution-led one, so bounding it to
 * either alone would flag a correct plan.
 */
export function contentShareRange(programs: Program[]): [number, number] {
  const ranges = programs.map((p) => FLAG_CODES.content_share_off_pattern.ranges[p]).filter(Boolean);
  if (!ranges.length) return [0, 1];
  return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
}

/** Everything the frontend needs, in one payload. */
export function roadmapModelConfig() {
  return {
    constants: {
      hours_per_point: HOURS_PER_POINT,
      overhead_hours: OVERHEAD_HOURS,
      break_even_rate: BREAK_EVEN_RATE,
    },
    tier_bands: TIER_BANDS,
    program_matrix: PROGRAM_MATRIX,
    category_rollup: CATEGORY_ROLLUP,
    overhead_category: OVERHEAD_CATEGORY,
    non_hour_categories: [...NON_HOUR_CATEGORIES],
    goal_commitment_ladder: GOAL_COMMITMENT_LADDER,
    commitment_terms: COMMITMENT_TERMS,
    flag_codes: FLAG_CODES,
    cross_option_flags: CROSS_OPTION_FLAGS,
    option_level_flags: OPTION_LEVEL_FLAGS,
    baseline_flags: BASELINE_FLAGS,
    max_options: 3,
    /** Overhead is planned as ordinary rows, not reserved outside the plan. */
    overhead_in_plan: true,
    /** Pursuit needs a four-to-six week ramp and content behind it; Execute cannot fund that. */
    pursuit_min_tier: 'perform' as Tier,
    pursuit_sold_alone: false,
  };
}
