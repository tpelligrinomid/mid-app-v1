/**
 * Service Category classification for the Process Library.
 *
 * The contract-side backfill in service-category.ts walks active contracts and
 * their Deliverables lists. The Process Library is a single space of reusable
 * task templates with no contract behind it, so it gets its own walk rather than
 * a fifth set of branches through that one. Everything that defines the ANSWER --
 * the prompt, the taxonomy, the tiebreakers, the batch classifier -- is imported,
 * so the two paths cannot drift into disagreeing about what a category means.
 *
 * THIS WRITES TO CLICKUP, and carries the same rules as the contract backfill:
 *   - a task that already has a value is never touched, EXCEPT under overwrite
 *   - candidate state is read from ClickUp, not the local table
 *   - dry-run reports every proposed category without writing
 *
 * Two differences from the contract path, both deliberate:
 *
 *   No status gate. That gate exists because a live task sitting in "planned"
 *   usually has no description yet, so the model would be guessing. Library items
 *   are templates -- they carry a written External Description by construction,
 *   and status means nothing for them.
 *
 *   The local row is updated in the same step. The contract backfill lets the
 *   task sync carry values back, but roadmap generation reads
 *   compass_process_library directly and a daily sync would leave a day-long
 *   window where a classified process is still invisible to it. The DB write only
 *   follows a ClickUp write that succeeded, so the two cannot diverge.
 */

import { ClickUpClient, fetchWithRetry } from './client.js';
import { syncConfig } from '../../config/sync-config.js';
import { dbProxy } from '../../utils/db-proxy.js';
import {
  ALLOWED_MODELS,
  CLASSIFIER_MODEL,
  CLASSIFY_BATCH_SIZE,
  WRITE_THROTTLE_MS,
  classifyBatch,
  needsCategory,
  readExistingLabel,
  resolveServiceCategoryField,
  sleep,
  type ClickUpTaskLite,
} from './service-category.js';

interface ProcessLibraryTask extends ClickUpTaskLite {
  parent?: string | null;
}

export interface ProcessLibraryCategoryResult {
  dry_run: boolean;
  model: string;
  lists_scanned: number;
  /** Lists skipped because the space has no Service Category field on them. */
  lists_without_field: number;
  tasks_seen: number;
  candidates: number;
  classified: number;
  written: number;
  audit_mode: boolean;
  overwrite_mode: boolean;
  /** Valued items where the model agreed with what ClickUp already held. */
  audit_agree: number;
  /** Valued items where it disagreed. Written only in overwrite mode. */
  audit_disagree: number;
  /** Local compass_process_library rows updated to match what ClickUp now holds. */
  rows_updated: number;
  remaining: number;
  max_writes: number;
  option_labels: string[];
  proposals: Array<{
    task_id: string;
    name: string;
    list: string;
    proposed_category: string;
    written: boolean;
    existing_category?: string;
  }>;
  errors: Array<{ context: string; error: string }>;
}

/**
 * The library's "MiD Points Menu" flag and parent-task rule decide what is a real
 * menu item, and this must match the sync exactly -- classifying something the
 * sync does not store would write to ClickUp for a row that never lands here.
 */
function isMenuItem(task: ProcessLibraryTask): boolean {
  if (task.parent) return false;
  if (!Array.isArray(task.custom_fields)) return false;
  const field = task.custom_fields.find(
    (f) => f.id === syncConfig.processLibrary.customFields.midPointsMenu
  );
  return field?.value === true || field?.value === 'true';
}

/**
 * Prefer whichever description actually has words in it.
 *
 * Library items carry their real prose in the "External Description" custom field
 * and often leave ClickUp's native description empty. Classifying on the native
 * field alone would hand the model a bare template name.
 */
function bestDescription(task: ProcessLibraryTask): string {
  const native = (task.description || '').trim();
  if (native) return native;

  const field = (task.custom_fields || []).find(
    (f) => f.id === syncConfig.processLibrary.customFields.externalDescription
  );
  const external = field?.value;
  return external === undefined || external === null ? '' : String(external).trim();
}

export async function classifyProcessLibrary(options: {
  dryRun?: boolean;
  maxWrites?: number;
  /** Override the classifier model for a comparison run. Ignored if unrecognised. */
  model?: string;
  /**
   * Audit mode: also classify items that ALREADY carry a category and report where
   * the model disagrees. Never writes -- it forces dryRun, because the whole point
   * is to inspect values the normal path deliberately leaves alone.
   */
  audit?: boolean;
  /**
   * Overwrite mode: audit, but write the corrected value where the model disagrees.
   * Agreements are never rewritten, so this only touches values it considers wrong.
   *
   * The contract-side equivalent carries a warning that it cannot tell a human
   * correction from a machine default. Here the evidence is cleaner: the Execution
   * and Assets lists arrived stamped `Strategy` wholesale -- "Develop animated
   * video" and "Create & send newsletter" are not Strategy under any reading of the
   * taxonomy, and a person tagging them one at a time would not have produced that.
   * The library is also ~139 rows, so a dry run is small enough to read end to end
   * before committing. Do that first.
   */
  overwrite?: boolean;
} = {}): Promise<ProcessLibraryCategoryResult> {
  const overwrite = options.overwrite ?? false;
  const audit = overwrite ? true : (options.audit ?? false);
  // Audit alone is always read-only; overwrite honours dryRun like a normal run.
  const dryRun = audit && !overwrite ? true : (options.dryRun ?? false);
  const maxWrites = options.maxWrites ?? 200;
  const model =
    options.model && ALLOWED_MODELS.has(options.model) ? options.model : CLASSIFIER_MODEL;

  const result: ProcessLibraryCategoryResult = {
    dry_run: dryRun,
    model,
    audit_mode: audit,
    overwrite_mode: overwrite,
    audit_agree: 0,
    audit_disagree: 0,
    lists_scanned: 0,
    lists_without_field: 0,
    tasks_seen: 0,
    candidates: 0,
    classified: 0,
    written: 0,
    rows_updated: 0,
    remaining: 0,
    max_writes: maxWrites,
    option_labels: [],
    proposals: [],
    errors: [],
  };

  const token = syncConfig.clickup.apiToken;
  if (!token) throw new Error('CLICKUP_API_TOKEN environment variable is required');
  const client = new ClickUpClient(token);
  const spaceId = syncConfig.processLibrary.spaceId;

  const folders = await fetchWithRetry(() => client.getFolders(spaceId));
  console.log(`[Process Library Categories] ${folders.length} folders in space ${spaceId}`);

  for (const folder of folders) {
    let lists: Array<{ id: string; name: string }>;
    try {
      lists = await fetchWithRetry(() => client.getListsInFolder(folder.id));
    } catch (error) {
      if (ClickUpClient.isPermissionError(error)) {
        console.warn(`[Process Library Categories] Permission denied for folder ${folder.name}`);
        continue;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({ context: `folder:${folder.name}`, error: message });
      continue;
    }

    for (const list of lists) {
      try {
        const fields = await fetchWithRetry(() => client.getListCustomFields(list.id));
        const resolved = resolveServiceCategoryField(fields);

        if (!resolved) {
          // Not an error to shout about on its own -- but if EVERY list reports
          // this, the space has no Service Category field and the run is a no-op,
          // which the caller can only tell from this count.
          result.lists_without_field++;
          continue;
        }

        result.lists_scanned++;
        if (result.option_labels.length === 0) {
          result.option_labels = [...resolved.optionsByLabel.keys()];
        }

        const tasks: ProcessLibraryTask[] = await fetchWithRetry(() =>
          client.getTasksFromList(list.id, {
            archived: false,
            includeClosed: false,
            subtasks: false,
          })
        );

        const menuItems = tasks.filter(isMenuItem);
        result.tasks_seen += menuItems.length;

        // Audit and overwrite deliberately reconsider items that already carry a
        // value; the normal path only fills empties.
        const candidates = audit
          ? menuItems
          : menuItems.filter((task) => needsCategory(task, resolved.fieldId));
        result.candidates += candidates.length;

        // Budget is spent on CLASSIFICATION, not just writes -- the model call is
        // the expensive half, so stopping at the write boundary would still pay
        // for work that gets discarded.
        const budget = Math.max(0, maxWrites - result.classified);
        if (budget === 0) {
          result.remaining += candidates.length;
          continue;
        }
        if (candidates.length > budget) {
          result.remaining += candidates.length - budget;
        }
        const toClassify = candidates.slice(0, budget);
        if (toClassify.length === 0) continue;

        const allowedLabels = [...resolved.optionsByLabel.keys()];

        for (let i = 0; i < toClassify.length; i += CLASSIFY_BATCH_SIZE) {
          const batch = toClassify.slice(i, i + CLASSIFY_BATCH_SIZE);

          const enriched = batch.map((task) => ({
            ...task,
            description: bestDescription(task),
          }));

          let assignments: Map<string, string>;
          try {
            assignments = await classifyBatch(
              enriched,
              'MiD Process Library (reusable task templates, not client work)',
              `${folder.name} / ${list.name}`,
              allowedLabels,
              model
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push({ context: `classify:${list.name}`, error: message });
            continue;
          }

          for (const task of batch) {
            const label = assignments.get(task.id);
            if (!label) continue;

            result.classified++;
            const optionId = resolved.optionsByLabel.get(label.toUpperCase());
            if (!optionId) {
              result.errors.push({
                context: `option:${task.id}`,
                error: `Model returned "${label}", which is not an option on list ${list.name}`,
              });
              continue;
            }

            const existing = readExistingLabel(task, resolved);

            if (existing) {
              if (existing.toUpperCase() === label.toUpperCase()) {
                result.audit_agree++;
                result.proposals.push({
                  task_id: task.id,
                  name: task.name,
                  list: list.name,
                  proposed_category: label,
                  existing_category: existing,
                  written: false,
                });
                continue;
              }

              result.audit_disagree++;

              // Audit reports the disagreement and stops there. Only overwrite
              // replaces a value that is already set.
              if (!overwrite) {
                result.proposals.push({
                  task_id: task.id,
                  name: task.name,
                  list: list.name,
                  proposed_category: label,
                  existing_category: existing,
                  written: false,
                });
                continue;
              }
            }

            let written = false;
            if (!dryRun) {
              try {
                await client.setTaskCustomField(task.id, resolved.fieldId, optionId);
                written = true;
                result.written++;

                const { error: dbError } = await dbProxy.update(
                  'compass_process_library',
                  { service_category: label, updated_at: new Date().toISOString() },
                  { clickup_task_id: task.id }
                );
                if (dbError) {
                  // ClickUp already holds the value, so this is recoverable --
                  // the next sync brings it across.
                  result.errors.push({ context: `db:${task.id}`, error: dbError.message });
                } else {
                  result.rows_updated++;
                }

                await sleep(WRITE_THROTTLE_MS);
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push({ context: `write:${task.id}`, error: message });
              }
            }

            result.proposals.push({
              task_id: task.id,
              name: task.name,
              list: list.name,
              proposed_category: label,
              ...(existing ? { existing_category: existing } : {}),
              written,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ context: `list:${list.name}`, error: message });
      }
    }
  }

  console.log(
    `[Process Library Categories] ${result.candidates} candidates, ` +
    `${result.classified} classified, ${result.written} written, ` +
    `${result.rows_updated} rows updated, ${result.remaining} remaining, ` +
    (audit ? `agree=${result.audit_agree} disagree=${result.audit_disagree}, ` : '') +
    `${result.lists_without_field} lists without the field, ${result.errors.length} errors`
  );

  return result;
}

export default classifyProcessLibrary;
