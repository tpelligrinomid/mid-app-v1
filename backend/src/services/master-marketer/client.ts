/**
 * Master Marketer API Client
 *
 * HTTP client for the Master Marketer AI analysis service.
 * Follows the HubSpot pattern: native fetch, module-level config, exported functions.
 *
 * Environment variables:
 * - MASTER_MARKETER_URL: Base URL (e.g. https://your-master-marketer.onrender.com)
 * - MASTER_MARKETER_API_KEY: Shared API key for authentication
 */

import type {
  MeetingNotesSubmission,
  SubmitJobResponse,
  JobStatusResponse,
} from './types.js';
import type { DeliverableSubmission, DeliverableConvertSubmission } from '../deliverable-generation/types.js';

interface MasterMarketerConfig {
  baseUrl: string;
  apiKey: string;
}

function getConfig(): MasterMarketerConfig {
  const baseUrl = process.env.MASTER_MARKETER_URL;
  const apiKey = process.env.MASTER_MARKETER_API_KEY;

  if (!baseUrl) {
    throw new Error('MASTER_MARKETER_URL is required');
  }
  if (!apiKey) {
    throw new Error('MASTER_MARKETER_API_KEY is required');
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

/**
 * Make an authenticated request to the Master Marketer API
 */
async function masterMarketerFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getConfig();

  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Master Marketer API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Submit meeting notes for AI analysis
 * Returns a job ID for polling
 */
export async function submitMeetingNotes(
  data: MeetingNotesSubmission
): Promise<SubmitJobResponse> {
  return masterMarketerFetch<SubmitJobResponse>('/api/intake/meeting-notes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Submit a deliverable for AI generation.
 * Routes to the correct type-specific endpoint:
 *   Generators: /api/generate/research, /api/generate/roadmap, /api/generate/seo-audit, etc.
 *   Reformatters: /api/intake/plan, /api/intake/brief
 *
 * Includes callback_url so MM can POST results back when the job completes,
 * and metadata (deliverable_id, contract_id, title) for MM to echo back.
 */
export async function submitDeliverable(
  data: DeliverableSubmission
): Promise<SubmitJobResponse> {
  const backendUrl = process.env.BACKEND_URL;
  const callbackUrl = backendUrl
    ? `${backendUrl.replace(/\/+$/, '')}/api/webhooks/master-marketer/job-complete`
    : undefined;

  const payload = {
    ...data,
    ...(callbackUrl && { callback_url: callbackUrl }),
    metadata: {
      ...data.metadata,
      deliverable_id: data.metadata?.deliverable_id,
      contract_id: data.contract_id,
      title: data.title,
    },
  };

  // MM route prefixes: /api/generate/ for generators, /api/intake/ for reformatters (plan, brief)
  const GENERATE_ROUTE_TYPES = new Set(['research', 'roadmap', 'seo_audit', 'content_plan', 'abm_plan']);
  const prefix = GENERATE_ROUTE_TYPES.has(data.deliverable_type) ? '/api/generate' : '/api/intake';
  const slug = data.deliverable_type.replace(/_/g, '-');
  const endpoint = `${prefix}/${encodeURIComponent(slug)}`;
  return masterMarketerFetch<SubmitJobResponse>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Submit an existing document for reformatting/conversion.
 * Always routes to /api/intake/{type} (the reformat endpoints).
 * Supported types: roadmap, plan, brief.
 */
export async function submitConvert(
  deliverableType: string,
  data: DeliverableConvertSubmission
): Promise<SubmitJobResponse> {
  const backendUrl = process.env.BACKEND_URL;
  const callbackUrl = backendUrl
    ? `${backendUrl.replace(/\/+$/, '')}/api/webhooks/master-marketer/job-complete`
    : undefined;

  const payload = {
    ...data,
    ...(callbackUrl && { callback_url: callbackUrl }),
  };

  const endpoint = `/api/intake/${encodeURIComponent(deliverableType)}`;
  return masterMarketerFetch<SubmitJobResponse>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Check the status of a processing job
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return masterMarketerFetch<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * Recover job output by Trigger.dev run ID.
 * Fallback for when the webhook callback fails to deliver.
 */
export async function getJobByRunId(triggerRunId: string): Promise<JobStatusResponse> {
  return masterMarketerFetch<JobStatusResponse>(`/api/jobs/by-run/${encodeURIComponent(triggerRunId)}`);
}

/**
 * Poll a job until it completes or times out
 *
 * @param jobId - The job ID to poll
 * @param options.intervalMs - Poll interval in milliseconds (default: 7000)
 * @param options.timeoutMs - Maximum wait time in milliseconds (default: 300000 = 5 min)
 * @returns The completed job status
 * @throws Error if the job fails or times out
 */
export async function pollUntilComplete(
  jobId: string,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<JobStatusResponse> {
  const intervalMs = options?.intervalMs ?? 7000;
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;

  let pollCount = 0;
  while (Date.now() < deadline) {
    const status = await getJobStatus(jobId);
    const normalizedStatus = status.status?.toLowerCase();

    pollCount++;
    if (pollCount <= 3 || pollCount % 5 === 0) {
      console.log(`[Master Marketer] Poll #${pollCount} for job ${jobId}: status=${status.status}, hasOutput=${!!status.output}`);
    }

    if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
      return status;
    }

    if (normalizedStatus === 'failed' || normalizedStatus === 'fail') {
      throw new Error(`Master Marketer job failed: ${status.error || 'unknown error'}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Master Marketer job ${jobId} timed out after ${timeoutMs / 1000}s`);
}
