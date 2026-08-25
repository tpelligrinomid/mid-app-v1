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
export const TIER_BANDS: Record<Tier, { minCapacityHours: number; maxCapacityHours: number | null; programs: number }> = {
  execute: { minCapacityHours: 32, maxCapacityHours: 48, programs: 1 },
  perform: { minCapacityHours: 48, maxCapacityHours: 96, programs: 2 },
  grow:    { minCapacityHours: 96, maxCapacityHours: null, programs: 3 },
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
    if (hours >= band.minCapacityHours && (band.maxCapacityHours === null || hours < band.maxCapacityHours)) {
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
  },
  month_thin_spread: {
    description: 'More active categories than the month has hours to serve properly',
    /** ~6 hours is the smallest library item that produces something substantial. */
    hoursPerCategory: 6,
  },
  overhead_under_reserved: {
    description: 'Strategy and account management below the monthly reserve',
    threshold: OVERHEAD_HOURS,
  },
  month_under_capacity: {
    description: 'Month allocates less than 85% of available hours',
    threshold: 0.85,
  },
  content_share_off_pattern: {
    description: 'Content share outside the expected range for the program',
    ranges: { authority: [0.35, 0.65], reach: [0, 0.45], pursuit: [0, 0.40] },
  },
  ramp_month: {
    description: 'Month one carrying heavy setup; roughly half a steady-state month of production',
  },
  goal_commitment_mismatch: {
    description: 'A goal commits beyond what the tier permits',
  },
  goal_target_not_monotonic: {
    description: 'A higher tier target at or below a lower tier one',
  },
} as const;

export type FlagCode = keyof typeof FLAG_CODES;

/**
 * What a tier may commit to.
 *
 * Without this, "scale the goals to the tier" produces the same MQL goal at three
 * different numbers — three prices for one promise, which is the failure the option
 * structure exists to prevent. Constraining the CLASS of commitment makes it checkable.
 */
export const COMMITMENT_LADDER: Record<Tier, string[]> = {
  execute: ['output'],
  perform: ['output', 'leading_indicator'],
  grow:    ['output', 'leading_indicator', 'business_outcome'],
};

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
    commitment_ladder: COMMITMENT_LADDER,
    flag_codes: FLAG_CODES,
    max_options: 3,
    /** Pursuit needs a four-to-six week ramp and content behind it; Execute cannot fund that. */
    pursuit_min_tier: 'perform' as Tier,
    pursuit_sold_alone: false,
  };
}
