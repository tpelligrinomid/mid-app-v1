import { Router, Request, Response } from 'express';
import archiver from 'archiver';
import { select } from '../../utils/edge-functions.js';
import { sendCachedRequest } from '../../services/claude/client.js';

const router = Router();

const CRON_SECRET = process.env.CRON_SECRET;

function verifySecret(req: Request, res: Response, next: () => void) {
  if (!CRON_SECRET) {
    console.warn('[TaskAnalysis] CRON_SECRET not configured, allowing request');
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

const CATEGORIES = [
  'Web Development',
  'Tech Stack',
  'Marketing Ops',
  'Account Management',
  'Content Creation',
  'Podcast',
  'Design/Creative',
  'Paid Media',
  'ABM',
  'SEO/AEO',
  'Performance/Reporting',
  'Strategy/Research',
  'Video',
  'Other',
] as const;

type Category = (typeof CATEGORIES)[number];

// "Tech Stack" is a literal cost-tracking task name, not a category of service work.
// It's pre-classified here without an AI call; the AI taxonomy below excludes it.
function preClassifyByName(name: string): Category | null {
  const normalized = (name ?? '').trim().toLowerCase();
  if (normalized === 'tech stack') return 'Tech Stack';
  return null;
}

const TAXONOMY_PROMPT = `You are a marketing operations analyst classifying agency tasks into exactly one category from a fixed taxonomy.

Categories (use the exact name shown):

- Web Development: building, updating, or maintaining websites and web apps. Page builds, CMS work, HubSpot/WordPress development, landing pages, site migrations, technical implementation in the browser layer.
- Marketing Ops: hands-on configuration of marketing technology platforms AND the operating model around them. CRM/MAP admin (HubSpot, Marketo, Salesforce, Pardot), workflow and automation builds inside those platforms, integration work (Zapier, n8n, native connectors), lead routing implementation, attribution implementation, data piping between systems, lead lifecycle definition (MQL/SQL/PQL), marketing process documentation, team enablement and training, internal tooling for the marketing team. Anything that is platform configuration OR process/operating-model work for the marketing function.
- Account Management: client-facing relationship and project management. Status calls, QBRs, account reviews, scoping conversations, contract renewals, internal coordination on behalf of an account, project management overhead.
- Content Creation: writing or producing long-form and short-form written content. Blogs, eBooks, whitepapers, case studies, website copy, email copy, sales enablement content, ghostwriting.
- Podcast: anything tied to podcast production. Episode planning, recording, editing, show notes, guest outreach, podcast distribution, podcast-specific promotion.
- Design/Creative: visual design and creative production. Brand identity, graphic design, illustration, motion graphics, presentation/deck design, creative direction, asset production for any channel (excluding video editing — see Video).
- Paid Media: paid advertising across channels. Google Ads, LinkedIn Ads, Meta Ads, programmatic, paid social campaign management, ad creative coordination, bid/budget management, paid reporting that ties back to campaign management.
- ABM: account-based marketing programs. Target account list building, 1:1 / 1:few campaigns, account research, ABM platform work (6sense, Demandbase), account scoring, ABM-specific orchestration.
- SEO/AEO: organic search and answer-engine optimization. Keyword research, on-page SEO, technical SEO, link building, schema markup, content optimization for search, AI search visibility (AEO/GEO).
- Performance/Reporting: analytics, reporting, and performance analysis that is not specific to a single campaign. Dashboards, monthly/quarterly reports, attribution analysis, KPI tracking, marketing analytics deliverables.
- Strategy/Research: strategic planning, positioning, and research deliverables. Marketing plans, GTM strategy, persona/ICP work, competitive research, audits, brand strategy, messaging frameworks.
- Video: video production specifically. Video editing, video shoots, motion video, video scripting, YouTube/social video production. (Use Design/Creative for static design work and Podcast for podcast audio/video.)
- Other: anything that genuinely does not fit the above. Use sparingly — prefer the closest fit when in doubt.

Classification rules:
1. Read the task name and description carefully.
2. Pick exactly ONE category from the list above. Use the EXACT name as shown (e.g. "Tech Stack/Ops", not "Tech Ops").
3. If a task could fit multiple categories, choose the one that best describes the PRIMARY work being done, not the channel it serves.
4. Provide a confidence score from 0.0 to 1.0 reflecting how clearly the task fits the chosen category.
5. Reserve "Other" for tasks that genuinely don't fit any category. Do not use it as a fallback for ambiguous tasks.

Output format: Return ONLY a valid JSON array. No prose, no markdown fences, no explanation. Each element must have exactly these three keys:
[{"id": "<task_id>", "category": "<exact category name>", "confidence": <number between 0 and 1>}]

The "id" must match the input task id verbatim. The "category" must be one of the 13 names listed above, character-for-character.`;

const BATCH_SIZE = 25;

interface ContractRow {
  contract_id: string;
  contract_name: string;
  external_id: string | null;
  priority: string | null;
  account_manager: string | null;
  team_manager: string | null;
  engagement_type: string | null;
  contract_type: string | null;
  monthly_points_allotment: number | null;
  amount: number | null;
}

interface TaskRow {
  task_id: string;
  contract_id: string | null;
  name: string;
  description: string | null;
  status: string | null;
  list_type: string | null;
  points: number | null;
  date_done: string | null;
  clickup_task_id: string | null;
}

interface ClickUpUserRow {
  id: string;
  full_name: string | null;
}

interface Classification {
  id: string;
  category: string;
  confidence: number;
}

interface EnrichedTask {
  task_id: string;
  clickup_task_id: string | null;
  contract_id: string | null;
  contract_name: string;
  contract_external_id: string | null;
  priority: string | null;
  contract_type: string | null;
  engagement_type: string | null;
  monthly_points_allotment: number | null;
  amount: number | null;
  account_manager: string;
  team_manager: string;
  name: string;
  description: string;
  list_type: string | null;
  points: number | null;
  date_done: string | null;
  category: Category;
  confidence: number;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(values: unknown[]): string {
  return values.map(csvEscape).join(',') + '\n';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}

interface BatchResult {
  classifications: Classification[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

async function classifyBatch(tasks: TaskRow[]): Promise<BatchResult> {
  const payload = tasks.map((t) => ({
    id: t.task_id,
    name: truncate(t.name ?? '', 200),
    description: truncate(t.description ?? '', 500),
  }));
  const userMessage = `Classify the following ${payload.length} tasks. Return a JSON array with one entry per task.\n\n${JSON.stringify(payload)}`;

  const result = await sendCachedRequest(TAXONOMY_PROMPT, userMessage, {
    model: 'claude-haiku-4-5',
    maxTokens: 4096,
    temperature: 0,
  });

  const text = result.text.trim();
  // Strip optional ```json fences in case the model adds them despite instructions
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse classifier output as JSON: ${(err as Error).message}. Raw: ${cleaned.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Classifier returned non-array: ${cleaned.slice(0, 300)}`);
  }
  return { classifications: parsed as Classification[], usage: result.usage };
}

router.post('/task-analysis-report', verifySecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  const daysParam = parseInt(String(req.query.days ?? '90'), 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 90;

  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days);

  console.log(`[TaskAnalysis] Starting report for last ${days} days (${periodStart.toISOString()} to ${periodEnd.toISOString()})`);

  try {
    // 1. Active non-hosting contracts, excluding internal engagement type
    const allContractRows = await select<ContractRow[]>('contracts', {
      select: 'contract_id,contract_name,external_id,priority,account_manager,team_manager,engagement_type,contract_type,monthly_points_allotment,amount',
      filters: {
        contract_status: 'active',
        hosting: false,
      },
    });
    // Client-side filter so contracts with null engagement_type are kept; only
    // contracts explicitly tagged 'internal' are excluded.
    const contractRows = allContractRows.filter((c) => c.engagement_type !== 'internal');
    const internalCount = allContractRows.length - contractRows.length;
    console.log(`[TaskAnalysis] ${contractRows.length} active contracts (excluded ${internalCount} internal)`);

    if (contractRows.length === 0) {
      res.status(404).json({ error: 'No active non-internal non-hosting contracts found' });
      return;
    }

    const contractMap = new Map(contractRows.map((c) => [c.contract_id, c]));
    const contractIds = contractRows.map((c) => c.contract_id);

    // 2. ClickUp users for manager name lookups
    const managerIds = new Set<string>();
    for (const c of contractRows) {
      if (c.account_manager) managerIds.add(c.account_manager);
      if (c.team_manager) managerIds.add(c.team_manager);
    }
    const usersMap = new Map<string, string>();
    if (managerIds.size > 0) {
      const userRows = await select<ClickUpUserRow[]>('pulse_clickup_users', {
        select: 'id,full_name',
        filters: { id: { in: Array.from(managerIds) } },
      });
      for (const u of userRows) {
        if (u.full_name) usersMap.set(u.id, u.full_name);
      }
    }

    // 3. All delivered tasks across all contracts in the window.
    // Mirror client-status-report filters: parent tasks only (no subtasks),
    // non-internal, non-deleted, non-archived. Subtasks usually have null
    // points because the point estimate lives on the parent.
    // Paginate to avoid PostgREST's default 1000-row cap.
    const PAGE_SIZE = 1000;
    const taskRows: TaskRow[] = [];
    let offset = 0;
    while (true) {
      const page = await select<TaskRow[]>('pulse_tasks', {
        select: 'task_id,contract_id,name,description,status,list_type,points,date_done,clickup_task_id',
        filters: {
          contract_id: { in: contractIds },
          status: 'delivered',
          date_done: { gte: periodStart.toISOString() },
          parent_task_id: { is: null },
          is_internal_only: false,
          is_deleted: false,
          is_archived: false,
        },
        order: [{ column: 'task_id', ascending: true }],
        limit: PAGE_SIZE,
        offset,
      });
      taskRows.push(...page);
      console.log(`[TaskAnalysis] Fetched ${taskRows.length} tasks so far (page ${page.length} rows)`);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    console.log(`[TaskAnalysis] ${taskRows.length} delivered tasks in window`);

    if (taskRows.length === 0) {
      res.status(404).json({ error: 'No delivered tasks found in the window' });
      return;
    }

    // 4. Pre-classify cost-tracking tasks by name, then batch-classify the rest via Claude
    const classifications = new Map<string, Classification>();
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    let totalInput = 0;
    let totalOutput = 0;

    const tasksToClassify: TaskRow[] = [];
    let preClassifiedCount = 0;
    for (const task of taskRows) {
      const preCategory = preClassifyByName(task.name ?? '');
      if (preCategory) {
        classifications.set(task.task_id, {
          id: task.task_id,
          category: preCategory,
          confidence: 1.0,
        });
        preClassifiedCount++;
      } else {
        tasksToClassify.push(task);
      }
    }
    console.log(`[TaskAnalysis] Pre-classified ${preClassifiedCount} tasks by name; ${tasksToClassify.length} need AI classification`);

    const batches: TaskRow[][] = [];
    for (let i = 0; i < tasksToClassify.length; i += BATCH_SIZE) {
      batches.push(tasksToClassify.slice(i, i + BATCH_SIZE));
    }
    const totalBatches = batches.length;

    const processBatch = async (batch: TaskRow[], idx: number): Promise<void> => {
      const batchNum = idx + 1;
      console.log(`[TaskAnalysis] Classifying batch ${batchNum}/${totalBatches} (${batch.length} tasks)`);
      try {
        const { classifications: batchClassifications, usage } = await classifyBatch(batch);
        for (const r of batchClassifications) {
          classifications.set(r.id, r);
        }
        totalCacheCreate += usage.cache_creation_input_tokens ?? 0;
        totalCacheRead += usage.cache_read_input_tokens ?? 0;
        totalInput += usage.input_tokens;
        totalOutput += usage.output_tokens;
      } catch (err) {
        console.error(`[TaskAnalysis] Batch ${batchNum} failed:`, err);
        // Continue — unclassified tasks fall through to "Other" below
      }
    };

    // Run batch 0 alone to warm the prompt cache, then fan out the rest.
    // If we fired all batches in parallel up front, every worker would pay the
    // cache-write premium for the same prefix instead of reading from cache.
    const CONCURRENCY = 5;
    if (batches.length > 0) {
      await processBatch(batches[0], 0);
    }
    let nextIndex = 1;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= batches.length) return;
        await processBatch(batches[idx], idx);
      }
    });
    await Promise.all(workers);

    console.log(`[TaskAnalysis] Classified ${classifications.size}/${taskRows.length} tasks`);

    // 5. Enrich tasks with contract + manager info + classification
    const enriched: EnrichedTask[] = taskRows.map((t) => {
      const contract = t.contract_id ? contractMap.get(t.contract_id) : undefined;
      const cls = classifications.get(t.task_id);
      const rawCategory = cls?.category;
      const category: Category = rawCategory && isCategory(rawCategory) ? rawCategory : 'Other';
      return {
        task_id: t.task_id,
        clickup_task_id: t.clickup_task_id,
        contract_id: t.contract_id,
        contract_name: contract?.contract_name ?? '(unknown)',
        contract_external_id: contract?.external_id ?? null,
        priority: contract?.priority ?? null,
        contract_type: contract?.contract_type ?? null,
        engagement_type: contract?.engagement_type ?? null,
        monthly_points_allotment: contract?.monthly_points_allotment ?? null,
        amount: contract?.amount ?? null,
        account_manager: contract?.account_manager ? (usersMap.get(contract.account_manager) ?? contract.account_manager) : '',
        team_manager: contract?.team_manager ? (usersMap.get(contract.team_manager) ?? contract.team_manager) : '',
        name: t.name ?? '',
        description: t.description ?? '',
        list_type: t.list_type,
        points: t.points === null || t.points === undefined ? null : Number(t.points),
        date_done: t.date_done,
        category,
        confidence: cls?.confidence ?? 0,
      };
    });

    // 6. Build tasks.csv (one row per task)
    let tasksCsv = rowToCsv([
      'task_id',
      'clickup_task_id',
      'contract_name',
      'contract_external_id',
      'priority',
      'contract_type',
      'engagement_type',
      'monthly_points_allotment',
      'amount',
      'account_manager',
      'team_manager',
      'category',
      'confidence',
      'list_type',
      'task_name',
      'task_description',
      'points',
      'date_done',
    ]);
    for (const t of enriched) {
      tasksCsv += rowToCsv([
        t.task_id,
        t.clickup_task_id,
        t.contract_name,
        t.contract_external_id,
        t.priority,
        t.contract_type,
        t.engagement_type,
        t.monthly_points_allotment,
        t.amount,
        t.account_manager,
        t.team_manager,
        t.category,
        t.confidence.toFixed(2),
        t.list_type,
        t.name,
        truncate(t.description, 1000),
        // Preserve null vs zero — null means "no points estimate", not "zero effort"
        t.points === null ? '' : t.points,
        t.date_done,
      ]);
    }

    // 7. Build rollup.csv (contract × category — one row per contract, columns = categories)
    interface RollupEntry {
      taskCounts: Map<Category, number>;
      pointTotals: Map<Category, number>;
      contractName: string;
      contractExternalId: string | null;
      priority: string | null;
      contractType: string | null;
      engagementType: string | null;
      monthlyPointsAllotment: number | null;
      amount: number | null;
    }
    const rollupMap = new Map<string, RollupEntry>();
    for (const t of enriched) {
      const key = t.contract_id ?? 'unknown';
      let entry = rollupMap.get(key);
      if (!entry) {
        entry = {
          taskCounts: new Map(),
          pointTotals: new Map(),
          contractName: t.contract_name,
          contractExternalId: t.contract_external_id,
          priority: t.priority,
          contractType: t.contract_type,
          engagementType: t.engagement_type,
          monthlyPointsAllotment: t.monthly_points_allotment,
          amount: t.amount,
        };
        rollupMap.set(key, entry);
      }
      entry.taskCounts.set(t.category, (entry.taskCounts.get(t.category) ?? 0) + 1);
      entry.pointTotals.set(t.category, (entry.pointTotals.get(t.category) ?? 0) + (t.points ?? 0));
    }

    const rollupHeaders: string[] = [
      'contract_name',
      'contract_external_id',
      'priority',
      'contract_type',
      'engagement_type',
      'monthly_points_allotment',
      'amount',
      'total_tasks',
      'total_points',
    ];
    for (const c of CATEGORIES) {
      rollupHeaders.push(`${c} (tasks)`);
      rollupHeaders.push(`${c} (points)`);
    }
    let rollupCsv = rowToCsv(rollupHeaders);

    const sortedContracts = Array.from(rollupMap.entries()).sort((a, b) => a[1].contractName.localeCompare(b[1].contractName));
    for (const [, entry] of sortedContracts) {
      let totalTasks = 0;
      let totalPoints = 0;
      for (const c of CATEGORIES) {
        totalTasks += entry.taskCounts.get(c) ?? 0;
        totalPoints += entry.pointTotals.get(c) ?? 0;
      }
      const row: unknown[] = [
        entry.contractName,
        entry.contractExternalId,
        entry.priority,
        entry.contractType,
        entry.engagementType,
        entry.monthlyPointsAllotment,
        entry.amount,
        totalTasks,
        totalPoints.toFixed(2),
      ];
      for (const c of CATEGORIES) {
        row.push(entry.taskCounts.get(c) ?? 0);
        row.push((entry.pointTotals.get(c) ?? 0).toFixed(2));
      }
      rollupCsv += rowToCsv(row);
    }

    // Add a portfolio-total row at the bottom
    const portfolioTaskCounts = new Map<Category, number>();
    const portfolioPointTotals = new Map<Category, number>();
    for (const t of enriched) {
      portfolioTaskCounts.set(t.category, (portfolioTaskCounts.get(t.category) ?? 0) + 1);
      portfolioPointTotals.set(t.category, (portfolioPointTotals.get(t.category) ?? 0) + (t.points ?? 0));
    }
    let portfolioTaskTotal = 0;
    let portfolioPointTotal = 0;
    // Header layout: contract_name, contract_external_id, priority, contract_type,
    // engagement_type, monthly_points_allotment, amount, total_tasks, total_points,
    // then the per-category columns. Pad the contract-metadata cells for the total row.
    const portfolioRow: unknown[] = ['PORTFOLIO TOTAL', '', '', '', '', '', '', 0, 0];
    for (const c of CATEGORIES) {
      const tc = portfolioTaskCounts.get(c) ?? 0;
      const pt = portfolioPointTotals.get(c) ?? 0;
      portfolioTaskTotal += tc;
      portfolioPointTotal += pt;
      portfolioRow.push(tc);
      portfolioRow.push(pt.toFixed(2));
    }
    portfolioRow[7] = portfolioTaskTotal;
    portfolioRow[8] = portfolioPointTotal.toFixed(2);
    rollupCsv += rowToCsv(portfolioRow);

    // 8. Stream a zip with both files + a summary
    const elapsedMs = Date.now() - startTime;
    const summary = {
      generated_at: new Date().toISOString(),
      window_days: days,
      window_start: periodStart.toISOString(),
      window_end: periodEnd.toISOString(),
      contracts_evaluated: contractRows.length,
      contracts_excluded_internal: internalCount,
      tasks_total: taskRows.length,
      tasks_pre_classified_by_name: preClassifiedCount,
      tasks_ai_classified: classifications.size - preClassifiedCount,
      tasks_unclassified_fallback_to_other: taskRows.length - classifications.size,
      claude_usage: {
        cache_creation_input_tokens: totalCacheCreate,
        cache_read_input_tokens: totalCacheRead,
        input_tokens: totalInput,
        output_tokens: totalOutput,
      },
      elapsed_ms: elapsedMs,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `task-analysis-${days}d-${stamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      console.error('[TaskAnalysis] Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Archive failed' });
      }
    });
    archive.pipe(res);
    archive.append(tasksCsv, { name: 'tasks.csv' });
    archive.append(rollupCsv, { name: 'rollup.csv' });
    archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });
    await archive.finalize();

    console.log(`[TaskAnalysis] Done in ${elapsedMs}ms — ${taskRows.length} tasks, ${classifications.size} classified`);
  } catch (err) {
    console.error('[TaskAnalysis] Failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

export default router;
