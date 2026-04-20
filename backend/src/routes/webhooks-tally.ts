import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { select } from '../utils/edge-functions.js';
import { postSlackMessage } from '../services/slack/client.js';
import { ClickUpClient } from '../services/clickup/client.js';

const router = Router();

interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
  options?: Array<{ id: string; text: string }>;
}

interface TallyPayload {
  eventId: string;
  eventType: string;
  createdAt: string;
  data: {
    submissionId: string;
    formId: string;
    formName: string;
    createdAt: string;
    fields: TallyField[];
  };
}

interface ContractRow {
  contract_id: string;
  contract_name: string;
  external_id: string | null;
  clickup_folder_id: string | null;
  account_manager: string | null;
  slack_channel_internal: string | null;
}

interface ClickUpUserRow {
  id: string;
  full_name: string | null;
}

interface ClickUpListRow {
  id: string;
  name: string;
}

function verifyTallySignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string
): boolean {
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function findField(fields: TallyField[], label: string): TallyField | undefined {
  return fields.find((f) => f.label?.toLowerCase() === label.toLowerCase());
}

type RenderFormat = 'markdown' | 'slack';

function resolveValue(field: TallyField, format: RenderFormat = 'markdown'): string | null {
  const v = field.value;
  if (v === null || v === undefined) return null;

  if (field.type === 'DROPDOWN' && Array.isArray(v) && field.options) {
    const texts = (v as string[]).map((id) => {
      const opt = field.options!.find((o) => o.id === id);
      return opt?.text ?? id;
    });
    return texts.join(', ') || null;
  }

  if (field.type === 'FILE_UPLOAD' && Array.isArray(v)) {
    const files = v as Array<{ name?: string; url?: string }>;
    const links = files
      .filter((f) => f.url)
      .map((f) => {
        const name = f.name ?? 'file';
        return format === 'slack' ? `<${f.url}|${name}>` : `[${name}](${f.url})`;
      });
    return links.length > 0 ? links.join(', ') : null;
  }

  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : null;

  return JSON.stringify(v);
}

function buildTaskDescription(payload: TallyPayload): string {
  const lines: string[] = [];
  for (const field of payload.data.fields) {
    if (field.label?.toLowerCase() === 'contract') continue;
    const value = resolveValue(field, 'markdown');
    if (!value) continue;
    lines.push(`**${field.label}:** ${value}`);
    lines.push('');
  }
  lines.push('---');
  lines.push(`_Form: ${payload.data.formName}_`);
  lines.push(`_Submission ID: ${payload.data.submissionId}_`);
  lines.push(`_Submitted: ${payload.data.createdAt}_`);
  return lines.join('\n');
}

function dateToUnixMs(date: string): number | undefined {
  const parsed = new Date(`${date}T12:00:00Z`);
  return isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

async function postSuccessNotification(params: {
  contract: ContractRow;
  projectType: string;
  taskUrl: string;
  assigneeName: string | null;
  dueDate: string | null;
  submissionId: string;
}): Promise<void> {
  const { contract, projectType, taskUrl, assigneeName, dueDate, submissionId } = params;
  const fallbackChannel = process.env.TALLY_FALLBACK_SLACK_CHANNEL;

  const lines: string[] = [];
  lines.push(`:sparkles: *New project intake: ${projectType}*`);
  lines.push(`*Contract:* ${contract.contract_name}${contract.external_id ? ` (${contract.external_id})` : ''}`);
  if (assigneeName) lines.push(`*Assigned to:* ${assigneeName}`);
  else lines.push(`*Assigned to:* _(unassigned — no account manager set on contract)_`);
  if (dueDate) lines.push(`*Due:* ${dueDate}`);
  lines.push(`*Task:* <${taskUrl}|View in ClickUp>`);
  lines.push(`_Submission ID: ${submissionId}_`);
  const text = lines.join('\n');

  // Prefer the contract's internal channel; if missing or the post fails,
  // fall back to the default alert channel so nothing is silent.
  if (contract.slack_channel_internal) {
    try {
      const result = await postSlackMessage({ channel: contract.slack_channel_internal, text });
      if (result.ok) return;
      console.warn(
        `[Tally] Success notification to contract channel ${contract.slack_channel_internal} failed: ${result.error}`
      );
    } catch (err) {
      console.warn('[Tally] Success notification to contract channel threw:', err);
    }
  } else {
    console.warn(`[Tally] Contract "${contract.contract_name}" has no slack_channel_internal — using fallback channel`);
  }

  if (fallbackChannel) {
    const noteLines = [
      ...lines,
      '',
      contract.slack_channel_internal
        ? `_(posted here because the contract's Slack channel \`${contract.slack_channel_internal}\` rejected the message — bot may not be a member)_`
        : `_(posted here because the contract has no slack_channel_internal configured)_`,
    ];
    try {
      await postSlackMessage({ channel: fallbackChannel, text: noteLines.join('\n') });
    } catch (err) {
      console.error('[Tally] Fallback channel post for success notification threw:', err);
    }
  }
}

async function resolveAssigneeName(clickupUserId: string | null): Promise<string | null> {
  if (!clickupUserId) return null;
  try {
    const rows = await select<ClickUpUserRow[]>('pulse_clickup_users', {
      select: 'id, full_name',
      filters: { id: clickupUserId },
      limit: 1,
    });
    return rows?.[0]?.full_name ?? null;
  } catch (err) {
    console.warn('[Tally] Failed to resolve account manager name:', err);
    return null;
  }
}

async function postFailureAlert(
  reason: string,
  payload: TallyPayload | null,
  rawBodyText: string
): Promise<void> {
  const channel = process.env.TALLY_FALLBACK_SLACK_CHANNEL;
  if (!channel) {
    console.error('[Tally] No TALLY_FALLBACK_SLACK_CHANNEL configured — cannot post alert');
    return;
  }

  const lines: string[] = [];
  lines.push(':rotating_light: *Tally form submission needs attention*');
  lines.push('');
  lines.push(`*Reason:* ${reason}`);

  if (payload) {
    lines.push(`*Form:* ${payload.data.formName}`);
    lines.push(`*Submission ID:* ${payload.data.submissionId}`);
    lines.push(`*Submitted:* ${payload.data.createdAt}`);
    lines.push('');
    lines.push('*Submitted fields:*');
    const fieldLines = payload.data.fields
      .map((field) => {
        const value = resolveValue(field, 'slack');
        return value ? `• *${field.label}:* ${value}` : null;
      })
      .filter((line): line is string => line !== null);
    if (fieldLines.length > 0) {
      lines.push(...fieldLines);
    } else {
      lines.push('_(no filled fields)_');
    }
  } else {
    lines.push('');
    lines.push('*Raw body (parse failed):*');
    lines.push('```');
    lines.push(rawBodyText.slice(0, 2000));
    lines.push('```');
  }

  try {
    const result = await postSlackMessage({ channel, text: lines.join('\n') });
    if (!result.ok) {
      console.error(`[Tally] Slack alert post failed: ${result.error}`);
    }
  } catch (err) {
    console.error('[Tally] Slack alert threw:', err);
  }
}

/**
 * POST /api/webhooks/tally/project-intake
 *
 * Tally webhook → resolve contract → create ClickUp task in the "To Dos"
 * list inside the contract's ClickUp folder, assigned to the contract's
 * account manager. Any failure posts to TALLY_FALLBACK_SLACK_CHANNEL.
 *
 * Always returns 200 so Tally doesn't retry indefinitely; surface real
 * errors via Slack and logs.
 */
router.post('/project-intake', async (req: Request, res: Response): Promise<void> => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const rawBodyText = rawBody?.toString('utf-8') ?? '';

  // Optional HMAC verification. If TALLY_SIGNING_SECRET is unset, we skip
  // (useful for initial testing) — enable once you configure the secret in Tally.
  const secret = process.env.TALLY_SIGNING_SECRET;
  if (secret) {
    const signature = req.header('tally-signature');
    if (!verifyTallySignature(rawBody, signature, secret)) {
      console.warn('[Tally] Signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  let payload: TallyPayload;
  try {
    payload = req.body as TallyPayload;
    if (!payload?.data?.fields || !Array.isArray(payload.data.fields)) {
      throw new Error('Missing or invalid data.fields');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postFailureAlert(`Invalid payload: ${message}`, null, rawBodyText);
    res.status(200).json({ ok: false, error: 'invalid_payload' });
    return;
  }

  try {
    const contractField = findField(payload.data.fields, 'contract');
    const contractValue = contractField?.value;
    if (!contractValue || typeof contractValue !== 'string') {
      await postFailureAlert(
        'Contract hidden field was empty or missing. Check the Tally form URL includes `?contract=<external_id>`.',
        payload,
        rawBodyText
      );
      res.status(200).json({ ok: false, error: 'missing_contract' });
      return;
    }

    const contractRows = await select<ContractRow[]>('contracts', {
      select: 'contract_id, contract_name, external_id, clickup_folder_id, account_manager, slack_channel_internal',
      filters: { external_id: contractValue },
      limit: 1,
    });
    const contract = contractRows?.[0];
    if (!contract) {
      await postFailureAlert(
        `Contract "${contractValue}" not found (no match on contracts.external_id).`,
        payload,
        rawBodyText
      );
      res.status(200).json({ ok: false, error: 'contract_not_found' });
      return;
    }

    if (!contract.clickup_folder_id) {
      await postFailureAlert(
        `Contract "${contract.contract_name}" (${contractValue}) has no ClickUp folder ID configured.`,
        payload,
        rawBodyText
      );
      res.status(200).json({ ok: false, error: 'no_folder' });
      return;
    }

    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) {
      await postFailureAlert('CLICKUP_API_TOKEN is not configured on the backend.', payload, rawBodyText);
      res.status(200).json({ ok: false, error: 'no_clickup_token' });
      return;
    }

    const clickup = new ClickUpClient(token);

    const lists = (await clickup.getListsInFolder(contract.clickup_folder_id)) as ClickUpListRow[];
    const normalize = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');
    const todosList = lists.find((l) => l.name && normalize(l.name) === 'todos');
    if (!todosList) {
      await postFailureAlert(
        `No ToDos list found in folder ${contract.clickup_folder_id} (contract: ${contract.contract_name}). Looked for any list matching "ToDos" / "To Dos" / "To-Dos".`,
        payload,
        rawBodyText
      );
      res.status(200).json({ ok: false, error: 'no_todos_list' });
      return;
    }

    const projectTypeField = findField(payload.data.fields, 'Select the type of project');
    const projectType = (projectTypeField && resolveValue(projectTypeField)) || 'Project';
    const dueDateField = findField(payload.data.fields, 'Desired due date');
    const dueDateRaw = dueDateField?.value;
    const dueDateMs = typeof dueDateRaw === 'string' ? dateToUnixMs(dueDateRaw) : undefined;

    const assignees: number[] = [];
    if (contract.account_manager) {
      const amId = parseInt(contract.account_manager, 10);
      if (!Number.isNaN(amId)) assignees.push(amId);
    }

    const task = await clickup.createTask(todosList.id, {
      name: `${projectType} — ${contract.contract_name}`,
      markdown_content: buildTaskDescription(payload),
      assignees: assignees.length > 0 ? assignees : undefined,
      due_date: dueDateMs,
    });

    console.log(
      `[Tally] Created task ${task.id} in list ${todosList.id} for contract ${contract.contract_name} (${contractValue})`
    );

    // Fire-and-forget success notification to the contract's internal Slack
    // channel. Failures here don't change the HTTP response — the task is
    // already created.
    const assigneeName = await resolveAssigneeName(contract.account_manager);
    const dueDateDisplay = typeof dueDateRaw === 'string' ? dueDateRaw : null;
    postSuccessNotification({
      contract,
      projectType,
      taskUrl: task.url,
      assigneeName,
      dueDate: dueDateDisplay,
      submissionId: payload.data.submissionId,
    }).catch((err) => {
      console.error('[Tally] Success notification threw:', err);
    });

    res.status(200).json({ ok: true, task_id: task.id, task_url: task.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Tally] Handler error:', message);
    await postFailureAlert(`Unexpected error: ${message}`, payload, rawBodyText);
    res.status(200).json({ ok: false, error: 'internal_error' });
  }
});

export default router;
