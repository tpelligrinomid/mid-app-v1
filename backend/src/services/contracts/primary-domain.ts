/**
 * The client's main website (contracts.primary_domain, a bare host such as
 * "newnorth.com"), for SEO tools and deliverables that need it.
 */

import { select } from '../../utils/edge-functions.js';

export async function getContractPrimaryDomain(contractId: string): Promise<string | null> {
  try {
    const row = await select<{ primary_domain: string | null }>('contracts', {
      select: 'primary_domain',
      filters: { contract_id: contractId },
      single: true,
    });
    return row?.primary_domain || null;
  } catch (err) {
    // Missing column (migration 022 not applied) or no row: carry on without it.
    console.warn('[Contracts] No primary domain for contract:', err instanceof Error ? err.message : err);
    return null;
  }
}
