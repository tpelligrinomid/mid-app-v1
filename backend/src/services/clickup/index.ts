/**
 * ClickUp API Integration Service
 *
 * This service handles synchronization with ClickUp for tasks and time tracking.
 * Uses API Token authentication (not OAuth).
 *
 * Environment variable: CLICKUP_API_TOKEN
 */

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

interface ClickUpConfig {
  apiToken: string;
}

function getConfig(): ClickUpConfig {
  const apiToken = process.env.CLICKUP_API_TOKEN;

  if (!apiToken) {
    throw new Error('CLICKUP_API_TOKEN is required');
  }

  return { apiToken };
}

/**
 * Make an authenticated request to the ClickUp API
 */
async function clickUpFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getConfig();

  const response = await fetch(`${CLICKUP_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: config.apiToken,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ClickUp API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Get tasks from a specific list
 */
export async function getTasksFromList(listId: string) {
  return clickUpFetch(`/list/${listId}/task`);
}

/**
 * Get time entries for a team
 */
export async function getTimeEntries(teamId: string, startDate: number, endDate: number) {
  return clickUpFetch(
    `/team/${teamId}/time_entries?start_date=${startDate}&end_date=${endDate}`
  );
}

/**
 * Sync tasks from ClickUp to the database
 * TODO: Implement full sync logic
 */
export async function syncTasks(): Promise<{ synced: number; errors: number }> {
  console.log('ClickUp sync not yet implemented');
  return { synced: 0, errors: 0 };
}

/**
 * Sync time entries from ClickUp to the database
 * TODO: Implement full sync logic
 */
export async function syncTimeEntries(): Promise<{ synced: number; errors: number }> {
  console.log('ClickUp time sync not yet implemented');
  return { synced: 0, errors: 0 };
}
