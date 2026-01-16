/**
 * HubSpot API Integration Service
 *
 * This service handles synchronization with HubSpot for account/company data.
 * Uses API Key authentication.
 *
 * Environment variable: HUBSPOT_API_KEY
 */

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

interface HubSpotConfig {
  apiKey: string;
}

function getConfig(): HubSpotConfig {
  const apiKey = process.env.HUBSPOT_API_KEY;

  if (!apiKey) {
    throw new Error('HUBSPOT_API_KEY is required');
  }

  return { apiKey };
}

/**
 * Make an authenticated request to the HubSpot API
 */
async function hubSpotFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getConfig();

  const response = await fetch(`${HUBSPOT_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Get a company by ID
 */
export async function getCompany(companyId: string) {
  return hubSpotFetch(`/crm/v3/objects/companies/${companyId}`);
}

/**
 * Get all companies with pagination
 */
export async function getCompanies(limit = 100, after?: string) {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (after) {
    params.append('after', after);
  }
  return hubSpotFetch(`/crm/v3/objects/companies?${params}`);
}

/**
 * Get deals associated with a company
 */
export async function getCompanyDeals(companyId: string) {
  return hubSpotFetch(
    `/crm/v3/objects/companies/${companyId}/associations/deals`
  );
}

/**
 * Sync companies from HubSpot to accounts table
 * TODO: Implement full sync logic
 */
export async function syncCompanies(): Promise<{ synced: number; errors: number }> {
  console.log('HubSpot sync not yet implemented');
  return { synced: 0, errors: 0 };
}
