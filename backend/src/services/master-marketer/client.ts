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
      Authorization: `Bearer ${config.apiKey}`,
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
 * Check the status of a processing job
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return masterMarketerFetch<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
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

  while (Date.now() < deadline) {
    const status = await getJobStatus(jobId);

    if (status.status === 'completed') {
      return status;
    }

    if (status.status === 'failed') {
      throw new Error(`Master Marketer job failed: ${status.error || 'unknown error'}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Master Marketer job ${jobId} timed out after ${timeoutMs / 1000}s`);
}
