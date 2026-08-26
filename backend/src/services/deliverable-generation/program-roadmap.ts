/**
 * Program roadmap — option validation, technology resolution, payload assembly.
 *
 * Kept out of processor.ts because none of it touches the points path, and the points
 * path is the thing this change must not disturb.
 *
 * See docs/program-roadmap-spec.md. The numbers and matrices come from
 * config/roadmap-model.ts, which is also what /api/compass/roadmap-config serves to the
 * frontend — so the generation form validates against the same definition enforced here.
 */

import { select } from '../../utils/edge-functions.js';
import {
  COMMITMENT_TERMS,
  OVERHEAD_CATEGORY,
  OVERHEAD_HOURS,
  PROGRAM_MATRIX,
  TIER_BANDS,
  capacityHours,
  isCommitmentTerm,
  rollUpCategory,
  tierForCapacity,
  type Program,
  type Tier,
} from '../../config/roadmap-model.js';

const MAX_OPTIONS = 3;
const ROADMAP_STAGES = new Set(['foundation', 'execution', 'analysis']);
const STAGE_LABEL: Record<string, RoadmapStage> = {
  foundation: 'Foundation',
  execution: 'Execution',
  analysis: 'Analysis',
};

/**
 * What the generation form sends, one per option.
 *
 * The form posts capacity HOURS rather than a fee, which is the right way round now that
 * tier bands are hours: the strategist picks the capacity and the fee falls out of the
 * contract rate. `monthly_budget` is still accepted for callers that price in dollars.
 *
 * Field names are tolerant because the frontend settled on its own before this contract
 * was final, and rejecting a whole generation over `name` versus `label` helps nobody.
 * What is NOT tolerated is a missing `programs`: the eligibility filter, the allocation map
 * and the content-share flag all read it, and there is nothing sensible to infer it from.
 */
export interface RoadmapOptionInput {
  option_id?: string;
  /** `name` is the frontend's spelling. */
  label?: string;
  name?: string;
  tier: Tier;
  programs: Program[];
  /** Capacity hours. Preferred. */
  monthly_hours?: number;
  /** Service fee. Used when monthly_hours is absent. */
  monthly_budget?: number;
  /** Catalog selections from the Pulse tech stack, already filtered to billable + active. */
  technology_ids?: string[];
  /** Proposed contract length in months. Narrative only — affects no capacity or flag. */
  term_months?: number;
  /** Contract commitment term. Closed vocabulary, see COMMITMENT_TERMS. */
  commitment?: string;
  /** Free text from the strategist, carried into generation context. */
  notes?: string;
}

/**
 * Normalise one option from whatever the caller sent.
 *
 * `growth` is accepted as an alias for `grow`. The config endpoint publishes `grow`, but
 * failing a six-call generation over an obvious synonym is not a useful kind of strict.
 *
 * TIER IS DERIVED when absent. The form treats it as optional and omits it when unset, and
 * a strategist has no reason to fill it in: capacity decides the band, the form already
 * computes and displays that band from monthly_hours, and asking someone to restate it is
 * how a whole generation fails on `unknown tier ""`. A supplied tier still wins, and is
 * still validated against the band it claims.
 */
export function normalizeOptionInput(
  raw: Record<string, unknown>,
  dollarPerHour: number
): RoadmapOptionInput {
  const monthlyHours = typeof raw.monthly_hours === 'number' ? raw.monthly_hours : undefined;

  const tierRaw = String(raw.tier ?? '').trim().toLowerCase();
  const declared = tierRaw === 'growth' ? 'grow' : tierRaw;
  const derived =
    typeof raw.monthly_budget === 'number'
      ? tierForCapacity(raw.monthly_budget / dollarPerHour)
      : monthlyHours !== undefined
        ? tierForCapacity(monthlyHours)
        : null;
  const tier = (declared || derived || '') as Tier;

  const monthlyBudget =
    typeof raw.monthly_budget === 'number'
      ? raw.monthly_budget
      : monthlyHours !== undefined
        ? Math.round(monthlyHours * dollarPerHour * 100) / 100
        : undefined;

  return {
    option_id: raw.option_id as string | undefined,
    label: (raw.label ?? raw.name) as string | undefined,
    tier,
    programs: (raw.programs ?? []) as Program[],
    monthly_hours: monthlyHours,
    monthly_budget: monthlyBudget,
    technology_ids: (raw.technology_ids ?? []) as string[],
    term_months: raw.term_months as number | undefined,
    commitment: raw.commitment as string | undefined,
    notes: raw.notes as string | undefined,
  };
}

/**
 * Accept either the frontend envelope or a bare option array.
 *
 * The form posts `{ options: [...], hours_model: { hourly_rate }, recommended_option_index }`.
 * The rate on the envelope is ignored: contracts.dollar_per_hour is the authority, and two
 * sources for one number is how a signed roadmap ends up quoting a rate nobody set.
 */
export function normalizeOptionsRequest(
  body: unknown,
  dollarPerHour: number
): { options: RoadmapOptionInput[]; recommendedIndex: number | null; postedRate: number | null } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const list = (raw.options ?? raw.roadmap_options ?? (Array.isArray(raw) ? raw : [])) as Array<Record<string, unknown>>;
  const hoursModel = (raw.hours_model ?? {}) as Record<string, unknown>;
  const postedRate = typeof hoursModel.hourly_rate === 'number' ? hoursModel.hourly_rate : null;
  const idx = raw.recommended_option_index;

  return {
    options: (list || []).map((o) => normalizeOptionInput(o, dollarPerHour)),
    recommendedIndex: typeof idx === 'number' ? idx : null,
    postedRate,
  };
}

/** What goes into the submission payload, one per option. */
export interface ResolvedRoadmapOption {
  option_id: string;
  label: string;
  tier: Tier;
  programs: Program[];
  program_allocation: Record<string, Program>;
  monthly_budget: number;
  technology_monthly: number;
  technology_one_time: number;
  total_monthly: number;
  hours_available: number;
  overhead_hours: number;
  program_hours: number;
  /** Echoed straight back so the editor and markdown export can show them. */
  term_months?: number;
  commitment?: string;
  notes?: string;
  /** Set from the form's recommended_option_index; MM writes the rationale for it. */
  recommended?: boolean;
}

export interface TechnologyResolution {
  monthly: number;
  one_time: number;
  /** Kept on the deliverable for display. Deliberately NOT sent to the generator. */
  items: Array<{
    technology_id: string;
    name: string;
    vendor: string | null;
    quantity: number;
    client_price_monthly: number;
    client_price_one_time: number;
  }>;
  warnings: string[];
}

interface CatalogRow {
  technology_id: string;
  name: string;
  vendor: string | null;
  is_active: boolean;
  is_client_billable: boolean;
  default_client_price: number | null;
  default_billing_cadence: string | null;
}

interface AssignmentRow {
  technology_id: string;
  contract_id: string;
  status: string | null;
  deactivated_on: string | null;
  client_price: number | null;
  client_billable_override: boolean | null;
  billing_cadence: string | null;
  quantity: number | null;
}

interface LibraryRow {
  process_id: string;
  name: string;
  description: string | null;
  phase: string | null;
  service_category: string | null;
  time_estimate_ms: number | null;
}

export type RoadmapStage = 'Foundation' | 'Execution' | 'Analysis';

export interface LibraryItem {
  /**
   * Without this the generator has no id to echo onto a row, every row lands with
   * process_id null, and both baseline flags -- which skip null rows -- can never fire on
   * anything generated. Two of the nine codes would be dead.
   */
  process_id: string;
  task: string;
  description: string;
  stage: RoadmapStage;
  service_category: string;
  baseline_hours: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every option is checked before anything is generated, and generation refuses if any
 * one fails.
 *
 * Partial generation would hand back a two-option proposal where three were asked for,
 * with nothing on the document saying why the third is missing.
 *
 * Note what is NOT here: a month exceeding its capacity. That is the generator's output,
 * so it can only be judged afterwards, and it is handled as a repair loop rather than a
 * refusal — a six-call generation must not be discarded because one month runs 0.4 hours
 * over.
 */
export function validateOptions(
  options: RoadmapOptionInput[],
  dollarPerHour: number | null | undefined
): string[] {
  const errors: string[] = [];

  if (!options.length) {
    errors.push('At least one roadmap option is required.');
    return errors;
  }
  if (options.length > MAX_OPTIONS) {
    errors.push(`A roadmap carries at most ${MAX_OPTIONS} options; ${options.length} were given.`);
  }
  if (!dollarPerHour || dollarPerHour <= 0) {
    errors.push("Set the contract's hourly rate before generating.");
    // Every remaining check divides by it, so stop here.
    return errors;
  }

  options.forEach((opt, i) => {
    const where = opt.label || `Option ${i + 1}`;

    if (!TIER_BANDS[opt.tier]) {
      errors.push(`${where}: unknown tier "${opt.tier}".`);
      return;
    }
    if (!opt.monthly_budget || opt.monthly_budget <= 0) {
      errors.push(`${where}: monthly_hours (or monthly_budget) is required.`);
      return;
    }

    // Nothing can stand in for this. The eligibility filter, the allocation map and the
    // content-share flag all read it, and tier gives only the count, never which.
    if (!opt.programs?.length) {
      errors.push(
        `${where}: programs are required — ${TIER_BANDS[opt.tier]?.programs ?? 1} of ` +
        `authority, reach, pursuit.`
      );
    }

    if (opt.commitment && !isCommitmentTerm(opt.commitment)) {
      errors.push(
        `${where}: unknown commitment "${opt.commitment}". ` +
        `Expected one of ${COMMITMENT_TERMS.map((t) => t.value).join(', ')}.`
      );
    }

    const capacity = capacityHours(opt.monthly_budget!, dollarPerHour);
    const actualTier = tierForCapacity(capacity);

    if (actualTier === null) {
      errors.push(
        `${where}: $${opt.monthly_budget!.toLocaleString()} at $${dollarPerHour}/hr is ` +
        `${capacity.toFixed(1)} hours — below Execute's floor of ${TIER_BANDS.execute.min_capacity_hours}.`
      );
    } else if (actualTier !== opt.tier) {
      errors.push(
        `${where}: $${opt.monthly_budget!.toLocaleString()} at $${dollarPerHour}/hr is ` +
        `${capacity.toFixed(1)} hours, which is ${actualTier}, not ${opt.tier}.`
      );
    }

    const expected = TIER_BANDS[opt.tier].programs;
    const programs = opt.programs || [];
    if (programs.length !== expected) {
      errors.push(
        `${where}: ${opt.tier} runs ${expected} ${expected === 1 ? 'program' : 'programs'}; ` +
        `${programs.length} selected.`
      );
    }

    // Outbound needs domains, inbox warming and a four-to-six week ramp before anything
    // sends, plus content and a landing page behind it. Execute cannot fund that, and
    // Pursuit alone is infrastructure with nothing to send.
    if (programs.includes('pursuit')) {
      if (opt.tier === 'execute') {
        errors.push(`${where}: Pursuit starts at Perform, paired with Authority or Reach.`);
      }
      if (programs.length === 1) {
        errors.push(`${where}: Pursuit is never sold on its own.`);
      }
    }

    const unknown = programs.filter((p) => !PROGRAM_MATRIX[p]);
    if (unknown.length) {
      errors.push(`${where}: unknown program(s) ${unknown.join(', ')}.`);
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Technology
// ---------------------------------------------------------------------------

/** Normalise a catalog cadence to a monthly figure. */
function toMonthly(price: number, cadence: string | null): { monthly: number; unknown: boolean } {
  switch ((cadence || 'monthly').trim().toLowerCase()) {
    case 'monthly':
      return { monthly: price, unknown: false };
    case 'quarterly':
      return { monthly: price / 3, unknown: false };
    case 'annual':
    case 'annually':
    case 'yearly':
      return { monthly: price / 12, unknown: false };
    case 'weekly':
      return { monthly: price * (52 / 12), unknown: false };
    default:
      // Treated as monthly and reported. Refusing here would block a whole generation on
      // one catalog row's spelling, which is worse than a visible warning.
      return { monthly: price, unknown: true };
  }
}

/**
 * Price an option's technology selection at CLIENT price.
 *
 * Assignments inherit from the catalog — in the live data the override columns are almost
 * always null — so every field resolves as COALESCE(assignment, catalog default).
 *
 * Six things here are quietly wrong if missed, and each is commented at the point it
 * matters rather than in a block nobody reads.
 */
export async function resolveTechnology(
  contractId: string,
  technologyIds: string[]
): Promise<TechnologyResolution> {
  const empty: TechnologyResolution = { monthly: 0, one_time: 0, items: [], warnings: [] };
  if (!technologyIds?.length) return empty;

  const catalog = await select<CatalogRow[]>('technologies', {
    select: 'technology_id,name,vendor,is_active,is_client_billable,default_client_price,default_billing_cadence',
    filters: { technology_id: { in: technologyIds } },
  });

  const assignments = await select<AssignmentRow[]>('contract_technologies', {
    select: 'technology_id,contract_id,status,deactivated_on,client_price,client_billable_override,billing_cadence,quantity',
    filters: { contract_id: contractId, technology_id: { in: technologyIds } },
  });

  const assignmentFor = new Map((assignments || []).map((a) => [a.technology_id, a]));
  const result: TechnologyResolution = { monthly: 0, one_time: 0, items: [], warnings: [] };

  for (const tech of catalog || []) {
    const ct = assignmentFor.get(tech.technology_id);

    // The catalog carries retired tools. Quoting one commits us to a platform we no
    // longer run.
    if (!tech.is_active) {
      result.warnings.push(`${tech.name} is inactive in the catalog and was excluded.`);
      continue;
    }

    // The flag is authoritative, and the per-contract override is the exception it was
    // built for: a tool globally non-billable can still be billed to one account.
    // Inferring billability from a blank price would get both cases wrong.
    const billable = ct?.client_billable_override ?? tech.is_client_billable;
    if (!billable) continue;

    if (ct && (ct.status !== 'active' || ct.deactivated_on)) continue;

    // Client price, never internal cost — they diverge, and internal cost is a margin
    // figure that must never reach a client-facing proposal.
    const price = ct?.client_price ?? tech.default_client_price;
    if (price === null || price === undefined) {
      // Fail loudly. Contributing 0 would under-quote silently, which is the failure mode
      // that survives review.
      throw new Error(
        `${tech.name} is billable but has no client price set. ` +
        `Set one in the tech stack catalog before generating.`
      );
    }

    const cadence = ct?.billing_cadence ?? tech.default_billing_cadence;
    // Defaults to 1 everywhere today, so an unmultiplied quote stays correct until the
    // first multi-seat tool and is then silently short.
    const qty = ct?.quantity ?? 1;

    let monthly = 0;
    let oneTime = 0;

    if ((cadence || '').trim().toLowerCase() === 'one_time') {
      // Setup and implementation fees. Amortising these would overstate the recurring
      // number and make options incomparable.
      oneTime = price * qty;
      result.one_time += oneTime;
    } else {
      const norm = toMonthly(price, cadence);
      if (norm.unknown) {
        result.warnings.push(
          `${tech.name} has an unrecognised billing cadence "${cadence}"; treated as monthly.`
        );
      }
      monthly = norm.monthly * qty;
      result.monthly += monthly;
    }

    result.items.push({
      technology_id: tech.technology_id,
      name: tech.name,
      vendor: tech.vendor,
      quantity: qty,
      client_price_monthly: Math.round(monthly * 100) / 100,
      client_price_one_time: Math.round(oneTime * 100) / 100,
    });
  }

  result.monthly = Math.round(result.monthly * 100) / 100;
  result.one_time = Math.round(result.one_time * 100) / 100;
  return result;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/**
 * The library items any of the sold programs may draw from.
 *
 * Sent as a union across options with the matrix alongside; Master Marketer applies the
 * matrix per option, so a Reach-only option cannot draw an Authority category that is in
 * the payload for another option.
 *
 * Filtered on hours rather than points: this path never reads the points column, and an
 * item with no estimate has nothing to plan against.
 *
 * Strategy & account management is always included regardless of the programs sold -- see
 * the carve-out below.
 */
export async function loadEligibleLibrary(programs: Program[]): Promise<LibraryItem[]> {
  const eligible = new Set<string>();
  for (const program of programs) {
    for (const category of PROGRAM_MATRIX[program] || []) eligible.add(category);
  }

  // Strategy & account management is in no program's matrix, because it is not sold as one.
  // But overhead is planned as ordinary rows, so the generator has to receive those items --
  // Facilitate Client Meetings and the Develop ... Plan Document set -- or it cannot emit the
  // coordination rows the plan requires and every option trips overhead_under_reserved.
  //
  // Unconditional: it runs under every engagement regardless of what was bought, and
  // program_matrix enforcement exempts it for the same reason.
  eligible.add(OVERHEAD_CATEGORY);

  const rows = await select<LibraryRow[]>('compass_process_library', {
    select: 'process_id,name,description,phase,service_category,time_estimate_ms',
    filters: { is_active: true },
  });

  return (rows || [])
    .filter((r) => {
      if (!r.name?.trim()) return false;
      if (!r.time_estimate_ms || r.time_estimate_ms <= 0) return false;
      if (!r.phase || !ROADMAP_STAGES.has(r.phase.toLowerCase())) return false;
      const rolled = rollUpCategory(r.service_category);
      return rolled !== null && eligible.has(rolled);
    })
    .map((r) => ({
      process_id: r.process_id,
      task: r.name,
      description: r.description || r.name,
      stage: STAGE_LABEL[r.phase!.toLowerCase()]!,
      // Rolled up so the generator and the eligibility matrix speak the same names.
      service_category: rollUpCategory(r.service_category)!,
      baseline_hours: Math.round((r.time_estimate_ms! / 3_600_000) * 100) / 100,
    }));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Decide, once per option, which program each eligible category is serving.
 *
 * Five categories sit in more than one program, so a row's `program` is an assignment
 * nothing downstream can verify — and the content-share flag is computed off exactly that
 * field. A generator free to label rows could satisfy the flag by labelling. Fixing the
 * allocation up front removes that degree of freedom and makes the allocation itself
 * reviewable.
 *
 * Where a category is eligible for more than one of the sold programs, it is assigned to
 * the first in the option's own order — the strategist's ordering, not ours.
 */
function programAllocation(programs: Program[]): Record<string, Program> {
  const allocation: Record<string, Program> = {};
  for (const program of programs) {
    for (const category of PROGRAM_MATRIX[program] || []) {
      if (!(category in allocation)) allocation[category] = program;
    }
  }
  return allocation;
}

export async function buildOptions(
  contractId: string,
  inputs: RoadmapOptionInput[],
  dollarPerHour: number,
  recommendedIndex: number | null = null
): Promise<{
  options: ResolvedRoadmapOption[];
  technology: Record<string, TechnologyResolution>;
  recommendedOptionId: string | null;
}> {
  const options: ResolvedRoadmapOption[] = [];
  const technology: Record<string, TechnologyResolution> = {};

  for (const [i, input] of inputs.entries()) {
    const optionId = input.option_id || `opt_${input.tier}_${input.programs.join('_')}`;
    const tech = await resolveTechnology(contractId, input.technology_ids || []);
    technology[optionId] = tech;

    const capacity = capacityHours(input.monthly_budget!, dollarPerHour);

    options.push({
      option_id: optionId,
      label: input.label || `${titleCase(input.tier)} — ${input.programs.map(titleCase).join(' + ')}`,
      tier: input.tier,
      programs: input.programs,
      program_allocation: programAllocation(input.programs),
      monthly_budget: input.monthly_budget!,
      technology_monthly: tech.monthly,
      technology_one_time: tech.one_time,
      total_monthly: Math.round((input.monthly_budget! + tech.monthly) * 100) / 100,
      hours_available: Math.round(capacity * 100) / 100,
      overhead_hours: OVERHEAD_HOURS,
      program_hours: Math.round((capacity - OVERHEAD_HOURS) * 100) / 100,
      ...(input.term_months !== undefined && { term_months: input.term_months }),
      ...(input.commitment !== undefined && { commitment: input.commitment }),
      ...(input.notes !== undefined && { notes: input.notes }),
      // Resolved from the form's index before the sort below reorders anything.
      recommended: recommendedIndex === i,
    });
  }

  // Ascending tier order. Options generated blind to each other read as three unrelated
  // plans, and nothing makes the accountability ladder visible; generating in order lets
  // each option see the ones below it and hold its goals strictly above them.
  const rank: Record<Tier, number> = { execute: 0, perform: 1, grow: 2 };
  options.sort((a, b) => rank[a.tier] - rank[b.tier] || a.monthly_budget - b.monthly_budget);

  // Resolved before the sort, so an index into the form's order still points at the right
  // option after reordering.
  const recommendedOptionId = options.find((o) => o.recommended)?.option_id ?? null;

  return { options, technology, recommendedOptionId };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
