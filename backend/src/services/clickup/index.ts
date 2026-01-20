/**
 * ClickUp API Integration Service
 *
 * This service handles synchronization with ClickUp for tasks and time tracking.
 * Uses API Token authentication (Personal Token - no Bearer prefix, or OAuth).
 *
 * Environment variable: CLICKUP_API_TOKEN
 */

export { ClickUpClient, fetchWithRetry } from './client.js';
export { ClickUpSyncService } from './sync.js';
