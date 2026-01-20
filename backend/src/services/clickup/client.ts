import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * ClickUp API Client
 * Handles authentication and API calls to ClickUp
 *
 * Authentication:
 * - Personal tokens (pk_...): NO Bearer prefix
 * - OAuth tokens: WITH Bearer prefix
 */
export class ClickUpClient {
  private client: AxiosInstance;
  private isPersonalToken: boolean;

  constructor(accessToken: string) {
    this.isPersonalToken = accessToken?.startsWith('pk_');

    this.client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      timeout: 30000,
      headers: {
        // Personal tokens: NO Bearer prefix
        // OAuth tokens: WITH Bearer prefix
        'Authorization': this.isPersonalToken
          ? accessToken
          : `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          console.error('ClickUp authentication error - token may be invalid or expired');
        }
        throw error;
      }
    );
  }

  /**
   * Get all teams the token has access to
   */
  async getTeams() {
    const response = await this.client.get('/team');
    return response.data.teams || [];
  }

  /**
   * Get all members of a team
   */
  async getTeamMembers(teamId: string) {
    const teams = await this.getTeams();
    const team = teams.find((t: { id: string }) => t.id.toString() === teamId);
    return team?.members || [];
  }

  /**
   * Get all spaces in a team
   */
  async getSpaces(teamId: string) {
    const response = await this.client.get(`/team/${teamId}/space`);
    return response.data.spaces || [];
  }

  /**
   * Get all folders in a space
   */
  async getFolders(spaceId: string) {
    const response = await this.client.get(`/space/${spaceId}/folder`);
    return response.data.folders || [];
  }

  /**
   * Get all lists in a folder
   */
  async getListsInFolder(folderId: string) {
    const response = await this.client.get(`/folder/${folderId}/list`);
    return response.data.lists || [];
  }

  /**
   * Get tasks from a list
   */
  async getTasksFromList(listId: string, options: {
    archived?: boolean;
    includeClosed?: boolean;
    subtasks?: boolean;
    page?: number;
  } = {}) {
    const params: Record<string, string | boolean> = {
      archived: options.archived ?? false,
      include_closed: options.includeClosed ?? true,
      subtasks: options.subtasks ?? true,
      page: (options.page ?? 0).toString()
    };

    const response = await this.client.get(`/list/${listId}/task`, { params });
    return response.data.tasks || [];
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string) {
    const response = await this.client.get(`/task/${taskId}`);
    return response.data;
  }

  /**
   * Get time entries for a team within a date range
   */
  async getTeamTimeEntries(teamId: string, startDate: Date, endDate: Date) {
    const params = {
      start_date: startDate.getTime().toString(),
      end_date: endDate.getTime().toString()
    };

    const response = await this.client.get(`/team/${teamId}/time_entries`, { params });
    return response.data.data || [];
  }

  /**
   * Get time entries for a specific task
   */
  async getTaskTimeEntries(taskId: string) {
    const response = await this.client.get(`/task/${taskId}/time`);
    return response.data.data || [];
  }

  /**
   * Check if an error is a permission error (should skip, not fail)
   */
  static isPermissionError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      const data = error.response?.data as { err?: string; ECODE?: string } | undefined;
      return (
        data?.err === 'Team not authorized' ||
        data?.ECODE === 'OAUTH_027' ||
        error.response?.status === 403
      );
    }
    return false;
  }

  /**
   * Check if an error is retryable (rate limit, network issues)
   */
  static isRetryableError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      return (
        error.response?.status === 429 ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT'
      );
    }
    return false;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = ClickUpClient.isRetryableError(error);

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`ClickUp API retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}

export default ClickUpClient;
