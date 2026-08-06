/**
 * Service Category backfill
 *
 * Classifies parent tasks in the Deliverables lists of active contracts and
 * writes the result to ClickUp's "Service Category" dropdown custom field.
 *
 * THIS WRITES TO CLICKUP. Everything else in this codebase treats ClickUp as
 * the source of truth and only reads. There is no undo on a write, so:
 *   - a task that already has a value is NEVER touched (a human correcting the
 *     model must stick permanently)
 *   - candidate state is read from ClickUp, not pulse_tasks — the local copy can
 *     be 15 minutes stale, and staleness here means overwriting someone's edit
 *   - dry-run reports every proposed category without writing
 *
 * Scope deliberately mirrors the sync cron: contracts with contract_status
 * 'active', lists where detectListType() === 'Deliverables', parent tasks only,
 * skipping archived.
 *
 * Runs are BOUNDED by maxWrites. The first backfill is thousands of tasks and
 * ClickUp allows ~100 req/min, so a single unbounded run would take hours and
 * die on redeploy. Because already-classified tasks are skipped, successive runs
 * resume naturally with no cursor state.
 */

import { ClickUpClient, fetchWithRetry } from './client.js';
import { detectListType, mapStatus, shouldSkipList, syncConfig } from '../../config/sync-config.js';
import { dbProxy } from '../../utils/db-proxy.js';
import { sendStructured } from '../claude/client.js';

const CLASSIFIER_MODEL = 'claude-haiku-4-5';
const CLASSIFY_BATCH_SIZE = 20;
const SERVICE_CATEGORY_FIELD_NAME = 'service category';

/** ClickUp allows ~100 req/min. 700ms between writes keeps us under with headroom. */
const WRITE_THROTTLE_MS = 700;

/**
 * Only classify work that has actually started.
 *
 * A task sitting in "planned" usually has no description written yet, so the
 * model would be reading a bare title and guessing. That guess is permanent —
 * a task with a value is never revisited — so a cheap wrong answer now costs
 * more than waiting for the task to be worked.
 *
 * Compared against mapStatus() rather than the raw ClickUp string so every
 * board variant is covered: working/in progress -> working, and
 * delivered/complete/closed -> delivered.
 *
 * This deliberately also excludes 'blocked' (waiting on client / on hold) and
 * 'archived'. Waiting-on-client work has usually been started and may well have
 * a usable description; skipped_by_status reports how many are being held back
 * so the call can be made on real numbers.
 */
const CLASSIFIABLE_STATUSES = new Set(['working', 'delivered']);

export const SERVICE_CATEGORY_PROMPT = `You are classifying marketing agency tasks into a single service category.

Read the task name and description. Return EXACTLY ONE value from the list below.
Return only the category name. No explanation, no punctuation, no other text.

## THE DECISION RULE

Tag the PRIMARY SKILL the task required — not the deliverable it belongs to,
not the campaign it supports, and not the client goal behind it.

If a task genuinely required more than one skill, choose the one that consumed
the most effort. When two are close, use the tiebreaker order at the bottom.

## CATEGORIES

ACCOUNT MANAGEMENT
Client communication, status calls, scheduling, meeting coordination, QBR
logistics, internal handoffs, delivery administration, onboarding logistics.
Not: producing anything.

STRATEGY
Roadmapping, quarterly and 90-day planning, campaign strategy, competitive
analysis, positioning work, recommendations, interpreting results.
Not: building the deliverable that came out of the thinking.

PLANNING DOCUMENTS ARE ALWAYS STRATEGY, whatever domain they plan — content
plans, campaign plans, ABM plans, media plans, launch plans, roadmaps. This
holds whether we lead the plan or collaborate with the client on it;
collaborating on a plan is still strategy work. Writing the plan is Strategy.
Building the thing the plan describes is that thing's category.

MARKETING OPERATIONS
CRM administration, marketing automation configuration, workflow and lifecycle
build, lead scoring and routing, list and data hygiene, field and property
management, system integrations, tracking and tag implementation, form setup.
Includes standing up and configuring marketing tools for the client -- "<Tool>
Set Up" is Marketing operations unless the tool clearly serves another
discipline (reporting tool -> Analytics, outbound tool -> Outbound).
Not: dashboards or reports built on the data (Analytics & reporting).

ANALYTICS & REPORTING
Reporting infrastructure, dashboard build, data source integrations, custom
report design, attribution configuration, conversion and event tracking design,
data QA, recurring report production, pulling performance data.
Not: configuring the CRM the data comes from (Marketing operations).
Not: deciding what the data means (Strategy).

CONTENT
Writing and editing in any format — blog posts, thought leadership, whitepapers,
case studies, email copy, ad copy, outbound sequence copy, landing page copy,
sales enablement material, video scripts, social copy.
Not: designing or building where the copy lives.
Not: optimizing existing published content for search (Search & discovery).

SEARCH & DISCOVERY
Technical SEO, keyword and entity research, optimization or refresh of existing
published content, internal linking, schema markup, GEO/AEO work, site audits,
crawl and indexation issues, page speed work.
Not: writing net-new content (Content).

DESIGN
Visual work in any format — ad creative, landing page and web design, social
graphics, infographics, premium asset layout, brand application, presentation
design, illustration.
Not: the copy inside it. Not: the front-end build that follows.

DEVELOPMENT
Front-end build, page and template implementation, code changes, integrations,
custom functionality, site maintenance, plugin work, technical fixes.
Includes ongoing website management and upkeep — "manage web", "website
maintenance", and recurring monthly site management tasks are DEVELOPMENT.
Not: the design that preceded it.

PAID MEDIA
Paid channel strategy, campaign build and launch, audience and list targeting,
bid and budget management, optimization, campaign-level reporting, platform
administration. Includes account-based paid.
Not: ad creative (Design). Not: ad copy (Content).

EMAIL & NURTURE
Lifecycle and nurture strategy, sequence build inside the marketing platform,
list segmentation, deliverability on the client's own domain, newsletter
operations and sends.
Not: cold outreach on alternative domains (Outbound).
Not: the email copy itself (Content).
Not: underlying CRM or automation configuration (Marketing operations).

OUTBOUND
Cold outreach on alternative or burner domains. Domain and inbox provisioning,
DNS authentication, inbox warming, list building and enrichment, signal
research, sequence configuration, deliverability monitoring, inbox rotation,
reply triage and routing.
Not: nurture to an owned list (Email & nurture).
Not: the sequence copy itself (Content).

ORGANIC SOCIAL
Organic channel strategy, post creation and scheduling, community management,
comment and DM response, employee advocacy programs, social listening.
Not: paid amplification of a post (Paid media).

DEFAULT WHEN THE DELIVERABLE IS SOCIAL POSTS: a task whose deliverable is social
posts is ORGANIC SOCIAL even when it carries no verb -- "<Conference> Social
Posts", "Develop Social Posts - <Event>", "Social Post - <Person>". Do not split
near-identical task names between Organic social and Content.
Tag CONTENT only when the task is explicitly copywriting ("Write social copy
for X"), or when a larger written asset leads and social rides along
("March Blog & Social Posts" is Content -- the blog leads).

PODCAST & VIDEO
Show strategy, guest booking, recording coordination, audio and video editing,
production, show notes, clip creation and repurposing.
Not: a blog post written from an episode (Content).

NAMING PATTERN — always PODCAST & VIDEO:
A task named "<task id> - <Show Name> - <Person Name>" (an alphanumeric id,
then the show, then a guest's name) is a podcast episode record. Classify it
PODCAST & VIDEO even when the name carries no other signal and there is no
description. Do not infer a different category from surrounding tasks.

TECHNOLOGY
Tech stack line items ONLY -- software licenses, seats, and subscriptions billed
as technology spend rather than service delivery. In practice these are tasks
named "Tech stack [Month]" or explicit license/seat management.

NOT tool setup or configuration. Standing a tool up FOR a client takes the
category of the work that tool does, not Technology: "Swan Set Up" is Marketing
operations, "Set up Databox" is Analytics & reporting, "Set up HeyReach
sequences" is Outbound. If the task is configuring software to do marketing
work, it is that marketing discipline. Technology is the line item, not the
labour.

DIGITAL PR
Media relations, link building, contributed article placement, podcast
guesting, awards and speaking submissions. Currently subcontracted.

## TIEBREAKERS

When two categories seem equally valid, apply in this order:

1. Producing something beats coordinating it.
   A task that creates a deliverable is never Account management.
   "Manage <thing>" takes the category of the thing being managed, not Account
   management: "Manage web" is Development, "Manage ABM" is Marketing
   operations, "Manage guest outreach" is Digital PR. Account management is
   coordinating PEOPLE — calls, scheduling, handoffs — not owning a workstream.

2. Building beats planning — except the plan itself.
   If the task produced an artifact, tag the artifact's skill, not Strategy.
   The exception is a planning document: the plan IS the strategy artifact.
   "Develop Content Plan Document" is Strategy, not Content.
   "Write the blog posts in the content plan" is Content.

3. The medium beats the message.
   "Write LinkedIn posts" is Content. "Schedule and post to LinkedIn" is
   Organic social. "Design the LinkedIn ad" is Design. "Launch the LinkedIn
   ad campaign" is Paid media.
   When there is NO verb at all, the medium decides: a bare "<Event> Social
   Posts" is Organic social, not Content. Consistency matters more than the
   split here -- these recur monthly and must not alternate.

4. Cold beats owned.
   Anything on alternative or burner domains is Outbound, regardless of what
   the task otherwise resembles.

5. New beats existing.
   Creating content is Content. Improving already-published content so it
   ranks or gets cited is Search & discovery.

6. For a multi-skill deliverable, pick the largest share of effort.
   A new landing page design is usually Design.
   A landing page built from an approved design is usually Development.
   A landing page copy draft is Content.
   Landing page tracking setup is Marketing operations.

## EXAMPLES

"Write Q3 thought leadership post — AI in manufacturing" -> CONTENT
"Refresh 2023 pillar page for AEO" -> SEARCH & DISCOVERY
"Build landing page from approved Figma" -> DEVELOPMENT
"Design landing page for gated report" -> DESIGN
"Landing page copy — compliance guide" -> CONTENT
"Set up conversion tracking on new landing page" -> MARKETING OPERATIONS
"Manage web" -> DEVELOPMENT
"Manage web - February" -> DEVELOPMENT
"Manage ABM" -> MARKETING OPERATIONS
"Set up ABM" -> MARKETING OPERATIONS
"Q3 planning session prep" -> STRATEGY
"Develop Content Plan Document" -> STRATEGY
"Develop ABM Plan Document" -> STRATEGY
"Collaborate with client on Q4 media plan" -> STRATEGY
"Monthly client status call" -> ACCOUNT MANAGEMENT
"Build Q3 performance dashboard in Databox" -> ANALYTICS & REPORTING
"Pull and format monthly reporting" -> ANALYTICS & REPORTING
"Launch LinkedIn ABM campaign — enterprise fintech list" -> PAID MEDIA
"Write 5 ad variants for LinkedIn campaign" -> CONTENT
"Design creative for LinkedIn campaign" -> DESIGN
"Build nurture sequence in HubSpot" -> EMAIL & NURTURE
"Write nurture emails 1-4" -> CONTENT
"Warm 12 new inboxes for outbound" -> OUTBOUND
"Enrich target account list in BitScale" -> OUTBOUND
"Write cold sequence for cybersecurity vertical" -> CONTENT
"Reply triage — outbound responses week of 3/12" -> OUTBOUND
"Schedule and publish 8 social posts" -> ORGANIC SOCIAL
"NPPC 2025 Conference Social Posts" -> ORGANIC SOCIAL
"HousingWire AI Summit Social Posts" -> ORGANIC SOCIAL
"Develop Social Posts - NAMFS" -> ORGANIC SOCIAL
"Social Post - Jeff Young" -> ORGANIC SOCIAL
"Write social copy for product launch" -> CONTENT
"March Blog & Social Posts" -> CONTENT
"Edit podcast episode 42" -> PODCAST & VIDEO
"86dx3dek6 - Robotics Invest - Anne De Leeuw" -> PODCAST & VIDEO
"86dx3c35q - Robotics Invest - Adam Lloyd Cohen" -> PODCAST & VIDEO
"Cut 6 clips from episode 42" -> PODCAST & VIDEO
"Blog post from episode 42 transcript" -> CONTENT
"Technical SEO audit" -> SEARCH & DISCOVERY
"Fix broken internal links" -> SEARCH & DISCOVERY
"Clean duplicate contacts in HubSpot" -> MARKETING OPERATIONS
"Add HeyReach seats" -> TECHNOLOGY
"Tech stack [July]" -> TECHNOLOGY
"Swan Set Up" -> MARKETING OPERATIONS
"Set up Databox" -> ANALYTICS & REPORTING
"Pitch guest post to industry publication" -> DIGITAL PR
"Manage guest outreach" -> DIGITAL PR
"Competitive positioning analysis" -> STRATEGY
"Onboard new client to portal" -> ACCOUNT MANAGEMENT

You will receive multiple tasks at once. Classify each one independently and
return a result for every task id you are given.`;

interface FolderToSync {
  contract_id: string;
  clickup_folder_id: string;
  contract_name?: string;
}

interface ClickUpTaskLite {
  id: string;
  name: string;
  description?: string;
  parent?: string | null;
  archived?: boolean;
  status?: { status?: string };
  tags?: Array<{ name?: string }>;
  custom_fields?: Array<{ id: string; name?: string; value?: unknown }>;
}

export interface ServiceCategoryResult {
  dry_run: boolean;
  folders_scanned: number;
  /** Total active contracts with a folder, before chunking. */
  folders_total: number;
  folder_offset: number;
  /** Offset to pass next to continue the walk, or null when finished. */
  next_folder_offset: number | null;
  lists_scanned: number;
  lists_skipped: number;
  parent_tasks_seen: number;
  /** Uncategorized parent tasks held back by the status gate, keyed by raw ClickUp status. */
  skipped_by_status: Record<string, number>;
  candidates: number;
  classified: number;
  written: number;
  unclassified: number;
  remaining: number;
  max_writes: number;
  option_labels: string[];
  audit_mode: boolean;
  overwrite_mode: boolean;
  audit_agree: number;
  audit_disagree: number;
  proposals: Array<{
    task_id: string;
    name: string;
    contract_id: string;
    proposed_category: string;
    written: boolean;
    existing_category?: string;
  }>;
  errors: Array<{ context: string; error: string }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Locate the Service Category field on a list and map label -> option UUID. */
function resolveServiceCategoryField(
  fields: Awaited<ReturnType<ClickUpClient['getListCustomFields']>>
): {
  fieldId: string;
  optionsByLabel: Map<string, string>;
  labelsById: Map<string, string>;
  labelsByIndex: Map<number, string>;
} | null {
  const field = fields.find(
    (f) => (f.name || '').trim().toLowerCase() === SERVICE_CATEGORY_FIELD_NAME
  );
  if (!field) return null;

  const optionsByLabel = new Map<string, string>();
  const labelsById = new Map<string, string>();
  const labelsByIndex = new Map<number, string>();
  (field.type_config?.options || []).forEach((opt: any, idx: number) => {
    // ClickUp populates `name` for dropdowns and `label` for labels fields.
    const label = (opt.label ?? opt.name ?? '').trim();
    if (!label) return;
    if (opt.id) {
      optionsByLabel.set(label.toUpperCase(), opt.id);
      labelsById.set(opt.id, label);
    }
    labelsByIndex.set(typeof opt.orderindex === 'number' ? opt.orderindex : idx, label);
  });
  if (optionsByLabel.size === 0) return null;

  return { fieldId: field.id, optionsByLabel, labelsById, labelsByIndex };
}

/**
 * A task needs classifying only when the Service Category entry is absent, or
 * present with no `value` key. ClickUp omits the key rather than sending null,
 * so `'value' in entry` is the reliable test — checking truthiness would treat
 * a legitimately-set option as empty.
 */
function needsCategory(task: ClickUpTaskLite, fieldId: string): boolean {
  const entry = (task.custom_fields || []).find((f) => f.id === fieldId);
  if (!entry) return true;
  if (!('value' in entry)) return true;
  return entry.value === null || entry.value === undefined || entry.value === '';
}

/**
 * Read a task's current Service Category back as a human label.
 *
 * ClickUp returns a dropdown value as the option UUID, but older fields and
 * some API paths return the numeric orderindex instead, so both are handled.
 * Returns null when the field is empty or the value maps to nothing.
 */
function readExistingLabel(
  task: ClickUpTaskLite,
  resolved: { fieldId: string; labelsById: Map<string, string>; labelsByIndex: Map<number, string> }
): string | null {
  const entry = (task.custom_fields || []).find((f) => f.id === resolved.fieldId);
  const v = entry && 'value' in entry ? entry.value : undefined;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return resolved.labelsById.get(v) ?? null;
  if (typeof v === 'number') return resolved.labelsByIndex.get(v) ?? null;
  return null;
}

async function classifyBatch(
  tasks: ClickUpTaskLite[],
  contractName: string,
  listName: string,
  allowedLabels: string[]
): Promise<Map<string, string>> {
  const schema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            // The enum makes an out-of-taxonomy label structurally impossible,
            // so there is no validation or retry path to maintain.
            category: { type: 'string', enum: allowedLabels },
          },
          required: ['task_id', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };

  const payload = tasks.map((t) => ({
    task_id: t.id,
    name: t.name,
    description: (t.description || '').slice(0, 600),
    status: t.status?.status || '',
    tags: (t.tags || []).map((tag) => tag.name).filter(Boolean),
  }));

  const userMessage =
    `Client: ${contractName}\nList: ${listName}\n\nTasks:\n` +
    JSON.stringify(payload, null, 2);

  const { parsed } = await sendStructured<{
    results: Array<{ task_id: string; category: string }>;
  }>(SERVICE_CATEGORY_PROMPT, userMessage, {
    model: CLASSIFIER_MODEL,
    schema,
    temperature: 0,
    cacheSystemPrompt: true,
  });

  const out = new Map<string, string>();
  for (const r of parsed.results || []) {
    if (r?.task_id && r?.category) out.set(r.task_id, r.category);
  }
  return out;
}

export async function backfillServiceCategories(options: {
  dryRun?: boolean;
  folderId?: string;
  maxWrites?: number;
  limitLists?: number;
  folderOffset?: number;
  folderLimit?: number;
  /**
   * Audit mode: classify tasks that ALREADY have a Service Category and report
   * where the model disagrees with the stored value. Never writes -- it forces
   * dryRun, because the whole point is to inspect values we deliberately do not
   * overwrite (they may be human corrections, or they may be ClickUp AI guesses,
   * and this is how we tell the difference).
   */
  audit?: boolean;
  /**
   * Overwrite mode: like audit, but actually writes the corrected value where
   * the model disagrees with what is stored. Agreements are never rewritten, so
   * this only ever touches values it considers wrong.
   *
   * This deliberately breaks the "never touch an existing value" invariant. That
   * rule was there to protect human corrections, but auditing showed ~22% of
   * stored values are wrong in a systematic way (blog posts tagged Strategy),
   * which is a machine's error pattern, not a person's. We cannot tell a human
   * correction from a ClickUp AI guess, so this WILL clobber human edits if any
   * exist -- run with dryRun first and read the disagreement list.
   */
  overwrite?: boolean;
} = {}): Promise<ServiceCategoryResult> {
  const overwrite = options.overwrite ?? false;
  const audit = overwrite ? true : (options.audit ?? false);
  // audit alone is always read-only; overwrite honours dryRun like a normal run.
  const dryRun = audit && !overwrite ? true : (options.dryRun ?? false);
  const maxWrites = options.maxWrites ?? 400;
  const limitLists = options.limitLists;
  const onlyFolder = options.folderId;
  const folderOffset = Math.max(0, options.folderOffset ?? 0);
  const folderLimit = options.folderLimit;

  const client = new ClickUpClient(syncConfig.clickup.apiToken!);

  const result: ServiceCategoryResult = {
    dry_run: dryRun,
    folders_scanned: 0,
    folders_total: 0,
    folder_offset: folderOffset,
    next_folder_offset: null,
    lists_scanned: 0,
    lists_skipped: 0,
    parent_tasks_seen: 0,
    skipped_by_status: {},
    candidates: 0,
    classified: 0,
    written: 0,
    unclassified: 0,
    remaining: 0,
    max_writes: maxWrites,
    option_labels: [],
    audit_mode: audit,
    overwrite_mode: overwrite,
    audit_agree: 0,
    audit_disagree: 0,
    proposals: [],
    errors: [],
  };

  const { data: allFolders } = await dbProxy.select<FolderToSync[]>('contracts', {
    columns: 'contract_id, clickup_folder_id, contract_name',
    filters: { contract_status: 'active' },
  });

  const allMatching = (allFolders || []).filter(
    (f) => f.clickup_folder_id && (!onlyFolder || f.clickup_folder_id === onlyFolder)
  );

  // A scan of every active contract outruns the proxy's connection window
  // (observed: dropped at 455s), so callers can walk it in chunks. A contract
  // added mid-walk could be missed; the next run picks it up.
  const folders =
    folderLimit === undefined
      ? allMatching.slice(folderOffset)
      : allMatching.slice(folderOffset, folderOffset + folderLimit);

  result.folders_total = allMatching.length;
  result.folder_offset = folderOffset;
  result.next_folder_offset =
    folderOffset + folders.length < allMatching.length ? folderOffset + folders.length : null;

  let budgetSpent = 0;

  for (const folder of folders) {
    if (limitLists !== undefined && result.lists_scanned >= limitLists) break;
    result.folders_scanned++;

    let lists;
    try {
      lists = await fetchWithRetry(() => client.getListsInFolder(folder.clickup_folder_id));
    } catch (error) {
      result.errors.push({
        context: `folder ${folder.clickup_folder_id}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      continue;
    }

    for (const list of lists) {
      if (limitLists !== undefined && result.lists_scanned >= limitLists) break;
      if (detectListType(list.name) !== 'Deliverables') continue;
      if (syncConfig.clickup.blacklistedLists.byId.includes(list.id)) continue;
      if (shouldSkipList(list.name)) continue;

      // Resolve the field per list — options can differ, so never reuse another
      // list's UUIDs. A missing field is logged and skipped, not fatal.
      let resolved;
      try {
        const fields = await fetchWithRetry(() => client.getListCustomFields(list.id));
        resolved = resolveServiceCategoryField(fields);
      } catch (error) {
        result.errors.push({
          context: `custom fields for list ${list.id}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.lists_skipped++;
        continue;
      }

      if (!resolved) {
        result.errors.push({
          context: `list ${list.id} (${list.name})`,
          error: 'No "Service Category" dropdown field with options found',
        });
        result.lists_skipped++;
        continue;
      }

      result.lists_scanned++;
      const labels = [...resolved.optionsByLabel.keys()];
      if (result.option_labels.length === 0) result.option_labels = labels;

      // Page the list. Read candidate state from ClickUp, never pulse_tasks.
      const candidates: ClickUpTaskLite[] = [];
      let page = 0;
      try {
        while (page <= 100) {
          const tasks = (await fetchWithRetry(() =>
            client.getTasksFromList(list.id, {
              archived: false,
              includeClosed: true,
              // Parent tasks only. ClickUp omits subtasks unless asked, and we
              // discard every one below, so requesting them just pages through
              // thousands of rows to throw them away. The task.parent guard
              // below stays as defense in depth.
              subtasks: false,
              page,
            })
          )) as ClickUpTaskLite[];

          if (!tasks.length) break;

          for (const task of tasks) {
            if (task.parent) continue; // parent tasks only
            if (task.archived) continue;
            result.parent_tasks_seen++;

            // Order matters: test emptiness first so skipped_by_status counts
            // only tasks the gate is actually withholding, not the already-
            // classified ones it would have skipped regardless.
            const isEmpty = needsCategory(task, resolved.fieldId);
            if (audit ? isEmpty : !isEmpty) continue;

            const mapped = mapStatus(task.status?.status, 'Deliverables');
            if (!CLASSIFIABLE_STATUSES.has(mapped)) {
              const raw = (task.status?.status || '(none)').toLowerCase();
              result.skipped_by_status[raw] = (result.skipped_by_status[raw] || 0) + 1;
              continue;
            }

            candidates.push(task);
          }
          page++;
        }
      } catch (error) {
        result.errors.push({
          context: `tasks for list ${list.id}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.lists_skipped++;
        continue;
      }

      result.candidates += candidates.length;

      // Respect the per-run write budget; anything beyond it is reported as
      // remaining and picked up by the next run.
      const budgetLeft = Math.max(0, maxWrites - budgetSpent);
      if (budgetLeft === 0) {
        result.remaining += candidates.length;
        continue;
      }
      const toProcess = candidates.slice(0, budgetLeft);
      result.remaining += candidates.length - toProcess.length;

      for (let i = 0; i < toProcess.length; i += CLASSIFY_BATCH_SIZE) {
        const batch = toProcess.slice(i, i + CLASSIFY_BATCH_SIZE);

        let categories: Map<string, string>;
        try {
          categories = await classifyBatch(
            batch,
            folder.contract_name || folder.contract_id,
            list.name,
            labels
          );
        } catch (error) {
          result.errors.push({
            context: `classify batch in list ${list.id}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          result.unclassified += batch.length;
          continue;
        }

        for (const task of batch) {
          const label = categories.get(task.id);
          if (!label) {
            result.unclassified++;
            continue;
          }
          const optionId = resolved.optionsByLabel.get(label.toUpperCase());
          if (!optionId) {
            // Should be unreachable — the schema enum is built from these labels.
            result.unclassified++;
            result.errors.push({
              context: `task ${task.id}`,
              error: `Model returned label outside the option map: ${label}`,
            });
            continue;
          }

          result.classified++;
          const existing = audit ? readExistingLabel(task, resolved) : null;
          const agrees = !!(existing && existing.toUpperCase() === label.toUpperCase());
          if (audit) {
            if (agrees) result.audit_agree++;
            else result.audit_disagree++;
          }

          // Nothing to do when the stored value already matches. Skipping here
          // (rather than writing an identical value) keeps the write budget
          // spent only on actual corrections.
          if (audit && agrees) {
            if (result.proposals.length < 300) {
              result.proposals.push({
                task_id: task.id,
                name: task.name,
                contract_id: folder.contract_id,
                proposed_category: label,
                written: false,
                existing_category: existing ?? '(unreadable)',
              });
            }
            continue;
          }

          const proposal = {
            task_id: task.id,
            name: task.name,
            contract_id: folder.contract_id,
            proposed_category: label,
            written: false,
            ...(audit ? { existing_category: existing ?? '(unreadable)' } : {}),
          };

          if (!dryRun) {
            try {
              await client.setTaskCustomField(task.id, resolved.fieldId, optionId);
              result.written++;
              budgetSpent++;
              proposal.written = true;
              await sleep(WRITE_THROTTLE_MS);
            } catch (error) {
              result.errors.push({
                context: `write ${task.id}`,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          } else {
            budgetSpent++;
          }

          if (result.proposals.length < 300) result.proposals.push(proposal);
        }
      }
    }
  }

  return result;
}
