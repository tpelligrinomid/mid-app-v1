/**
 * Program sizing check.
 *
 * The retainer model asserts that an engagement burns ~12 points/month on strategy
 * and account management before anything ships, and that a program needs ~45-50
 * points to run properly -- which is where the 60 / 110 / 155 point tier bands come
 * from. Those figures were reasoned, not measured. Every hours-denominated floor
 * inherits them, so they are worth testing against what accounts actually consume
 * before anyone reprices.
 *
 * Read-only. Writes nothing.
 *
 * HOW PROGRAM COUNT IS INFERRED
 *
 * Five service categories sit in more than one program, so a category alone cannot
 * name the program that paid for it -- the model doc is explicit that program is not
 * derivable from category. What IS derivable is the reverse: some categories appear
 * in exactly one program, and their presence is proof that program ran.
 *
 *   Organic social, Podcast & video, Digital PR, Search & discovery -> Authority
 *   Email & nurture                                                 -> Reach
 *   Outbound                                                        -> Pursuit
 *
 * So this reports a LOWER BOUND. An account running Authority and Reach where Reach
 * happened to spend nothing on email that month reads as one program, not two. The
 * bound is only ever wrong in the direction of under-counting programs, which means
 * points-per-program is only ever over-stated -- the conservative direction for a
 * check asking "is 45-50 enough?".
 *
 * Paid media is deliberately excluded from the evidence set: it belongs to both Reach
 * and Pursuit, so it proves neither.
 */

import { Router, Request, Response } from 'express';
import { select } from '../../utils/edge-functions.js';
import { extractServiceCategoryLabel } from '../../services/clickup/service-category.js';

const router = Router();

const CRON_SECRET = process.env.CRON_SECRET;

function verifySecret(req: Request, res: Response, next: () => void) {
  if (!CRON_SECRET) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret as string;
  const provided = authHeader?.replace('Bearer ', '') || querySecret;
  if (!provided || provided !== CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/** Categories that belong to exactly one program, and so evidence it. */
const PROGRAM_EVIDENCE: Record<string, string> = {
  'ORGANIC SOCIAL': 'Authority',
  'PODCAST & VIDEO': 'Authority',
  'DIGITAL PR': 'Authority',
  'SEARCH & DISCOVERY': 'Authority',
  'EMAIL & NURTURE': 'Reach',
  'OUTBOUND': 'Pursuit',
};

/** Never program work -- this is the overhead the model reserves off the top. */
const OVERHEAD_CATEGORIES = new Set(['STRATEGY', 'ACCOUNT MANAGEMENT']);

/** Billed separately from the allotment, so it must not count against capacity. */
const EXCLUDED_CATEGORIES = new Set(['TECHNOLOGY', 'DIGITAL PR']);

interface ContractRow {
  contract_id: string;
  contract_name: string;
  amount: number | null;
  monthly_points_allotment: number | null;
  dollar_per_hour: number | null;
  contract_status: string;
  contract_type: string;
}

interface TaskRow {
  contract_id: string | null;
  points: number | null;
  date_done: string | null;
  custom_fields: unknown;
}

router.get('/program-sizing-check', verifySecret, async (req: Request, res: Response): Promise<void> => {
  try {
    const months = req.query.months ? Number(req.query.months) : 6;
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceIso = since.toISOString();

    const contracts = await select<ContractRow[]>('contracts', {
      select: 'contract_id,contract_name,amount,monthly_points_allotment,dollar_per_hour,contract_status,contract_type',
      filters: { contract_status: 'active' },
      limit: 500,
    });

    const byId = new Map((contracts || []).map(c => [c.contract_id, c]));

    // Paged rather than one large select: a six-month window across the whole book
    // runs to thousands of rows and the proxy caps a single response.
    const tasks: TaskRow[] = [];
    const PAGE = 1000;
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const page = await select<TaskRow[]>('pulse_tasks', {
        select: 'contract_id,points,date_done,custom_fields',
        filters: {
          date_done: { gte: sinceIso },
          is_archived: false,
          is_deleted: false,
          is_internal_only: false,
        },
        order: [{ column: 'date_done', ascending: true }],
        limit: PAGE,
        offset,
      });
      if (!page || page.length === 0) break;
      tasks.push(...page);
      if (page.length < PAGE) break;
    }

    interface Agg {
      contract_id: string;
      contract_name: string;
      amount: number | null;
      allotment: number | null;
      rate: number | null;
      total_points: number;
      overhead_points: number;
      program_points: number;
      excluded_points: number;
      months_active: Set<string>;
      programs: Set<string>;
      categories: Record<string, number>;
      uncategorized_points: number;
    }

    const aggs = new Map<string, Agg>();

    for (const task of tasks) {
      if (!task.contract_id || !task.points || task.points <= 0) continue;
      const contract = byId.get(task.contract_id);
      if (!contract || contract.contract_type !== 'recurring') continue;

      let agg = aggs.get(task.contract_id);
      if (!agg) {
        agg = {
          contract_id: contract.contract_id,
          contract_name: contract.contract_name,
          amount: contract.amount,
          allotment: contract.monthly_points_allotment,
          rate: contract.dollar_per_hour,
          total_points: 0,
          overhead_points: 0,
          program_points: 0,
          excluded_points: 0,
          months_active: new Set(),
          programs: new Set(),
          categories: {},
          uncategorized_points: 0,
        };
        aggs.set(task.contract_id, agg);
      }

      const label = extractServiceCategoryLabel({
        id: '',
        name: '',
        custom_fields: Array.isArray(task.custom_fields)
          ? (task.custom_fields as Array<{ id: string; name?: string; value?: unknown }>)
          : undefined,
      });
      const category = (label || '').toUpperCase();

      agg.total_points += task.points;
      if (task.date_done) agg.months_active.add(task.date_done.slice(0, 7));

      if (!category) {
        agg.uncategorized_points += task.points;
        continue;
      }

      agg.categories[category] = (agg.categories[category] || 0) + task.points;

      if (EXCLUDED_CATEGORIES.has(category)) {
        agg.excluded_points += task.points;
      } else if (OVERHEAD_CATEGORIES.has(category)) {
        agg.overhead_points += task.points;
      } else {
        agg.program_points += task.points;
      }

      const program = PROGRAM_EVIDENCE[category];
      if (program) agg.programs.add(program);
    }

    const rows = [...aggs.values()]
      .map(a => {
        const monthCount = Math.max(1, a.months_active.size);
        const programCount = Math.max(1, a.programs.size);
        const programPerMonth = a.program_points / monthCount;
        return {
          contract_name: a.contract_name,
          monthly_value: a.amount,
          allotment: a.allotment,
          rate: a.rate,
          months_observed: a.months_active.size,
          points_per_month: Math.round((a.total_points / monthCount) * 10) / 10,
          overhead_per_month: Math.round((a.overhead_points / monthCount) * 10) / 10,
          program_points_per_month: Math.round(programPerMonth * 10) / 10,
          uncategorized_per_month: Math.round((a.uncategorized_points / monthCount) * 10) / 10,
          programs_evidenced: [...a.programs].sort(),
          program_count: a.programs.size,
          points_per_program: Math.round((programPerMonth / programCount) * 10) / 10,
          utilization:
            a.allotment && a.allotment > 0
              ? Math.round(((a.total_points / monthCount) / a.allotment) * 100) / 100
              : null,
          top_categories: Object.entries(a.categories)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 5)
            .map(([k, v]) => `${k}:${Math.round((v / monthCount) * 10) / 10}`),
        };
      })
      .sort((a, b) => (b.monthly_value || 0) - (a.monthly_value || 0));

    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      if (!s.length) return null;
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };

    const withPrograms = rows.filter(r => r.program_count > 0);
    const byProgramCount: Record<number, { n: number; median_program_points: number | null; median_value: number | null }> = {};
    for (const count of new Set(withPrograms.map(r => r.program_count))) {
      const group = withPrograms.filter(r => r.program_count === count);
      byProgramCount[count] = {
        n: group.length,
        median_program_points: median(group.map(r => r.program_points_per_month)),
        median_value: median(group.map(r => r.monthly_value || 0)),
      };
    }

    res.json({
      success: true,
      window_months: months,
      contracts_analyzed: rows.length,
      tasks_scanned: tasks.length,
      model_assumptions: {
        overhead_points_per_month: 12,
        points_per_program: '45-50',
        tier_totals: { one_program: 60, two_programs: 110, three_programs: 155 },
      },
      observed: {
        median_points_per_month: median(rows.map(r => r.points_per_month)),
        median_overhead_per_month: median(rows.map(r => r.overhead_per_month)),
        median_program_points_per_month: median(rows.map(r => r.program_points_per_month)),
        median_points_per_program: median(withPrograms.map(r => r.points_per_program)),
        median_uncategorized_per_month: median(rows.map(r => r.uncategorized_per_month)),
        median_utilization: median(rows.filter(r => r.utilization !== null).map(r => r.utilization as number)),
      },
      by_program_count: byProgramCount,
      contracts: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
