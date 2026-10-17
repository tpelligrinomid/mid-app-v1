/**
 * Per-contract data-tool connections (public.contract_integrations): which
 * external account/project a contract uses for each provider. Agency-level
 * credentials stay in the backend env; this only resolves the contract's pick.
 * See docs/data-tools-architecture.md.
 */
import { select } from '../utils/edge-functions.js';

export type IntegrationProvider = 'databox' | 'nightwatch' | 'google_ads' | 'meta_ads' | 'linkedin_ads';

/** The contract's external id for a provider, or null when not connected. */
export async function getContractIntegration(contractId: string, provider: IntegrationProvider): Promise<string | null> {
  try {
    const rows = await select<{ external_id: string }[]>('contract_integrations', {
      select: 'external_id',
      filters: { contract_id: contractId, provider },
      limit: 1,
    });
    return rows?.[0]?.external_id || null;
  } catch (err) {
    console.warn(`[Integrations] Lookup failed for ${provider}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
