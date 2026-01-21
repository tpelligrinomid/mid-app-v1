/**
 * QuickBooks Cron Sync Service
 *
 * Syncs invoices, credit memos, and payments from QuickBooks for active contracts.
 * Uses the backend-proxy Edge Function for database operations.
 */

import { v4 as uuidv4 } from 'uuid';
import OAuthClient from 'intuit-oauth';
import { QuickBooksClient, fetchWithRetry, QuickBooksInvoice, QuickBooksCreditMemo, QuickBooksPayment } from './client.js';
import { parseInvoiceMemo, parseCreditMemoMemo, getRawMemoText } from './memo-parser.js';
import { dbProxy } from '../../utils/db-proxy.js';

// QuickBooks OAuth client for token refresh
const oauthClient = new OAuthClient({
  clientId: process.env.QUICKBOOKS_CLIENT_ID!,
  clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
  environment: (process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production') || 'production',
  redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
});

interface ContractToSync {
  contract_id: string;
  external_id: string;
  quickbooks_business_unit_id: string;
  quickbooks_customer_id: string;
}

// Map of external_id (MID number) -> contract_id (UUID)
type ContractLookupMap = Map<string, string>;

interface OrganizationWithRealm {
  organization_id: string;
  quickbooks_realm_id: string;
}

interface StoredToken {
  id: string;
  service: string;
  identifier: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  is_active: boolean;
}

interface SyncResults {
  syncId: string;
  mode: 'incremental' | 'full';
  status: 'started' | 'running' | 'completed' | 'failed';
  contractsProcessed: number;
  contractsSkipped: number;
  contractsFailed: number;
  invoicesProcessed: number;
  creditMemosProcessed: number;
  paymentsProcessed: number;
  realmsProcessed: number;
  errors: Array<{ context: string; error: string }>;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
}

/**
 * QuickBooks Cron Sync Service
 */
export class QuickBooksCronSyncService {
  /**
   * Run the QuickBooks sync process
   */
  async runSync(options: {
    mode?: 'incremental' | 'full';
    syncInvoices?: boolean;
    syncCreditMemos?: boolean;
    syncPayments?: boolean;
  } = {}): Promise<SyncResults> {
    const {
      mode = 'incremental',
      syncInvoices = true,
      syncCreditMemos = true,
      syncPayments = true,
    } = options;

    const syncId = uuidv4();
    const startedAt = new Date();

    const results: SyncResults = {
      syncId,
      mode,
      status: 'running',
      contractsProcessed: 0,
      contractsSkipped: 0,
      contractsFailed: 0,
      invoicesProcessed: 0,
      creditMemosProcessed: 0,
      paymentsProcessed: 0,
      realmsProcessed: 0,
      errors: [],
      startedAt,
    };

    try {
      // Check if a sync is already running
      const existingSync = await this.checkForRunningSync();
      if (existingSync.isRunning) {
        console.log(`[QuickBooks Cron Sync] Skipping - sync already in progress (started ${existingSync.startedAt})`);
        results.status = 'completed';
        results.errors.push({
          context: 'startup',
          error: `Sync skipped - another sync already in progress since ${existingSync.startedAt}`,
        });
        return results;
      }

      await this.logSyncStart(syncId, mode);

      // 1. Get all active contracts with QuickBooks info
      console.log('[QuickBooks Cron Sync] Getting contracts to sync...');
      const contracts = await this.getContractsToSync();
      console.log(`[QuickBooks Cron Sync] Found ${contracts.length} contracts with QuickBooks info`);

      // 1b. Build lookup map: external_id (MID number) -> contract_id (UUID)
      // This is used to correctly link invoices/credit memos to contracts based on parsed memo
      const contractLookupMap = this.buildContractLookupMap(contracts);
      console.log(`[QuickBooks Cron Sync] Built contract lookup map with ${contractLookupMap.size} entries`);

      // 2. Group contracts by realm (business unit)
      const contractsByRealm = this.groupContractsByRealm(contracts);
      console.log(`[QuickBooks Cron Sync] Contracts span ${Object.keys(contractsByRealm).length} QuickBooks realms`);

      // 3. For incremental mode, calculate cutoff date (30 minutes ago)
      let updatedSince: Date | undefined;
      if (mode === 'incremental') {
        updatedSince = new Date(Date.now() - 30 * 60 * 1000);
        console.log(`[QuickBooks Cron Sync] Incremental mode: only fetching items updated since ${updatedSince.toISOString()}`);
      }

      // 4. Process each realm
      for (const [realmId, realmContracts] of Object.entries(contractsByRealm)) {
        try {
          console.log(`[QuickBooks Cron Sync] Processing realm ${realmId} with ${realmContracts.length} contracts`);

          // Get OAuth tokens directly by realm ID from pulse_sync_tokens
          const tokens = await this.getTokensForRealm(realmId);
          if (!tokens) {
            console.error(`[QuickBooks Cron Sync] No valid tokens for realm ${realmId}`);
            results.contractsFailed += realmContracts.length;
            results.errors.push({
              context: `realm:${realmId}`,
              error: 'No valid OAuth tokens - reauthorization required',
            });
            continue;
          }

          // Create client for this realm
          const client = new QuickBooksClient(tokens.access_token, realmId);
          console.log(`[QuickBooks Cron Sync] Token found, expires at ${tokens.expires_at}`);

          // Process each contract in this realm
          for (const contract of realmContracts) {
            try {
              const contractResults = await this.syncContractData(
                client,
                contract,
                realmId,
                contractLookupMap,
                { syncInvoices, syncCreditMemos, syncPayments, updatedSince }
              );

              results.invoicesProcessed += contractResults.invoices;
              results.creditMemosProcessed += contractResults.creditMemos;
              results.paymentsProcessed += contractResults.payments;
              results.contractsProcessed++;

            } catch (error) {
              results.contractsFailed++;
              const message = error instanceof Error ? error.message : 'Unknown error';
              results.errors.push({
                context: `contract:${contract.external_id}`,
                error: message,
              });
              console.error(`[QuickBooks Cron Sync] Failed to sync contract ${contract.external_id}:`, message);
            }
          }

          results.realmsProcessed++;

        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({ context: `realm:${realmId}`, error: message });
          console.error(`[QuickBooks Cron Sync] Failed to process realm ${realmId}:`, message);
        }
      }

      // 5. Link payments to invoices
      console.log('[QuickBooks Cron Sync] Linking payments to invoices...');
      await this.linkPaymentsToInvoices();

      results.status = 'completed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      await this.logSyncComplete(syncId, 'success', results);

      // Refresh contract views
      console.log('[QuickBooks Cron Sync] Refreshing contract views...');
      try {
        await dbProxy.rpc('refresh_contract_views');
        console.log('[QuickBooks Cron Sync] Contract views refreshed');
      } catch (error) {
        console.error('[QuickBooks Cron Sync] Failed to refresh contract views:', error);
      }

      console.log(`[QuickBooks Cron Sync] Completed in ${results.durationMs}ms`);

    } catch (error) {
      results.status = 'failed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({ context: 'sync', error: message });

      await this.logSyncComplete(syncId, 'failed', results, message);

      console.error('[QuickBooks Cron Sync] Fatal error:', message);
    }

    return results;
  }

  /**
   * Get active contracts that have QuickBooks customer IDs
   */
  private async getContractsToSync(): Promise<ContractToSync[]> {
    const { data, error } = await dbProxy.select<ContractToSync[]>('contracts', {
      columns: 'contract_id, external_id, quickbooks_business_unit_id, quickbooks_customer_id',
      filters: { contract_status: 'active' },
    });

    if (error) {
      console.error('[QuickBooks Cron Sync] Error fetching contracts:', error);
      throw new Error(error.message);
    }

    // Filter out contracts without QuickBooks info
    const validContracts = (data || []).filter(contract => {
      if (!contract.quickbooks_business_unit_id || !contract.quickbooks_customer_id) {
        console.warn(`[QuickBooks Cron Sync] Skipping contract ${contract.external_id} - missing QuickBooks info`);
        return false;
      }
      return true;
    });

    return validContracts;
  }

  /**
   * Group contracts by QuickBooks realm ID
   */
  private groupContractsByRealm(contracts: ContractToSync[]): Record<string, ContractToSync[]> {
    const grouped: Record<string, ContractToSync[]> = {};

    for (const contract of contracts) {
      const realmId = contract.quickbooks_business_unit_id;
      if (!grouped[realmId]) {
        grouped[realmId] = [];
      }
      grouped[realmId].push(contract);
    }

    return grouped;
  }

  /**
   * Build a lookup map from external_id (MID number) to contract_id (UUID)
   * This is used to correctly link invoices/credit memos to contracts
   * based on the contract number parsed from the memo field.
   */
  private buildContractLookupMap(contracts: ContractToSync[]): ContractLookupMap {
    const map = new Map<string, string>();

    for (const contract of contracts) {
      if (contract.external_id) {
        map.set(contract.external_id, contract.contract_id);
      }
    }

    return map;
  }

  /**
   * Get OAuth tokens for a realm from pulse_sync_tokens table
   * Tokens are stored with service='quickbooks' and identifier=realmId
   * Will refresh the token if expired
   */
  private async getTokensForRealm(realmId: string): Promise<StoredToken | null> {
    const { data, error } = await dbProxy.select<StoredToken[]>('pulse_sync_tokens', {
      columns: 'id, service, identifier, access_token, refresh_token, expires_at, is_active',
      filters: { service: 'quickbooks', identifier: realmId, is_active: true },
    });

    if (error) {
      console.error(`[QuickBooks Cron Sync] Error fetching tokens for realm ${realmId}:`, error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    let token = data[0];

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = new Date(token.expires_at);
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (expiresAt.getTime() - bufferTime <= Date.now()) {
      console.log(`[QuickBooks Cron Sync] Token expired for realm ${realmId}, refreshing...`);

      const refreshedToken = await this.refreshToken(token, realmId);
      if (refreshedToken) {
        token = refreshedToken;
      } else {
        console.error(`[QuickBooks Cron Sync] Failed to refresh token for realm ${realmId}`);
        return null;
      }
    }

    return token;
  }

  /**
   * Refresh an expired OAuth token
   */
  private async refreshToken(token: StoredToken, realmId: string): Promise<StoredToken | null> {
    try {
      // Set the current token on the OAuth client
      oauthClient.setToken({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: 'Bearer',
        expires_in: 3600, // Not used for refresh, but required
        x_refresh_token_expires_in: 0,
        realmId: realmId,
      });

      // Refresh the token
      const refreshResponse = await oauthClient.refresh();
      const newTokens = refreshResponse.getJson();

      // Calculate new expiry time (typically 1 hour from now)
      const expiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));

      // Update token in database
      const { error } = await dbProxy.update('pulse_sync_tokens', {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { id: token.id });

      if (error) {
        console.error(`[QuickBooks Cron Sync] Error updating refreshed token:`, error);
        return null;
      }

      console.log(`[QuickBooks Cron Sync] Token refreshed successfully for realm ${realmId}`);

      // Return updated token
      return {
        ...token,
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: expiresAt.toISOString(),
      };
    } catch (error) {
      console.error(`[QuickBooks Cron Sync] Token refresh failed for realm ${realmId}:`, error);
      return null;
    }
  }

  /**
   * Sync data for a single contract's QuickBooks customer
   * Note: One customer may have multiple contracts, so we use contractLookupMap
   * to correctly link each invoice/credit memo to the right contract based on
   * the contract_external_id parsed from the memo field.
   */
  private async syncContractData(
    client: QuickBooksClient,
    contract: ContractToSync,
    realmId: string,
    contractLookupMap: ContractLookupMap,
    options: {
      syncInvoices: boolean;
      syncCreditMemos: boolean;
      syncPayments: boolean;
      updatedSince?: Date;
    }
  ): Promise<{ invoices: number; creditMemos: number; payments: number }> {
    const results = { invoices: 0, creditMemos: 0, payments: 0 };
    const customerId = contract.quickbooks_customer_id;

    // Sync invoices
    if (options.syncInvoices) {
      const invoices = await fetchWithRetry(() =>
        client.getAllInvoicesForCustomer(customerId, { updatedSince: options.updatedSince })
      );

      if (invoices.length > 0) {
        console.log(`[QuickBooks Cron Sync] Processing ${invoices.length} invoices for customer ${customerId}`);
        await this.storeInvoices(invoices, realmId, contractLookupMap);
        results.invoices = invoices.length;
      }
    }

    // Sync credit memos
    if (options.syncCreditMemos) {
      const creditMemos = await fetchWithRetry(() =>
        client.getAllCreditMemosForCustomer(customerId, { updatedSince: options.updatedSince })
      );

      if (creditMemos.length > 0) {
        console.log(`[QuickBooks Cron Sync] Processing ${creditMemos.length} credit memos for customer ${customerId}`);
        await this.storeCreditMemos(creditMemos, realmId, contractLookupMap);
        results.creditMemos = creditMemos.length;
      }
    }

    // Sync payments
    if (options.syncPayments) {
      const payments = await fetchWithRetry(() =>
        client.getAllPaymentsForCustomer(customerId, { updatedSince: options.updatedSince })
      );

      if (payments.length > 0) {
        console.log(`[QuickBooks Cron Sync] Processing ${payments.length} payments for customer ${customerId}`);
        await this.storePayments(payments, realmId, contractLookupMap);
        results.payments = payments.length;
      }
    }

    return results;
  }

  /**
   * Store invoices in database
   * Uses contractLookupMap to link invoices to the CORRECT contract
   * based on the contract_external_id parsed from the memo field.
   */
  private async storeInvoices(
    invoices: QuickBooksInvoice[],
    realmId: string,
    contractLookupMap: ContractLookupMap
  ): Promise<void> {
    const batch = invoices.map(invoice => {
      const parsed = parseInvoiceMemo(invoice);

      // Look up the correct contract_id using the parsed contract number
      // If no match found, contract_id will be null (unlinked invoice)
      const contractId = parsed.contractNumber
        ? contractLookupMap.get(parsed.contractNumber) || null
        : null;

      if (parsed.contractNumber && !contractId) {
        console.warn(`[QuickBooks Cron Sync] Invoice ${invoice.DocNumber}: contract ${parsed.contractNumber} not found in lookup map`);
      }

      return {
        quickbooks_id: invoice.Id,
        quickbooks_realm_id: realmId,
        quickbooks_customer_id: invoice.CustomerRef?.value,
        contract_id: contractId,
        doc_number: invoice.DocNumber || null,
        customer_name: invoice.CustomerRef?.name || null,
        transaction_date: invoice.TxnDate,
        due_date: invoice.DueDate || null,
        amount: invoice.TotalAmt,
        balance: invoice.Balance,
        contract_external_id: parsed.contractNumber,
        points: parsed.points,
        memo_raw: getRawMemoText(invoice),
        status: invoice.Balance === 0 ? 'paid' : 'open',
        raw_data: JSON.stringify(invoice),
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Batch upsert
    const batchSize = 50;
    for (let i = 0; i < batch.length; i += batchSize) {
      const batchSlice = batch.slice(i, i + batchSize);
      const { error } = await dbProxy.upsert('pulse_invoices', batchSlice, {
        onConflict: 'quickbooks_id,quickbooks_realm_id',
      });

      if (error) {
        console.error('[QuickBooks Cron Sync] Error storing invoices:', error);
      }
    }
  }

  /**
   * Store credit memos in database
   * Uses contractLookupMap to link credit memos to the CORRECT contract
   * based on the contract_external_id parsed from the memo field.
   */
  private async storeCreditMemos(
    creditMemos: QuickBooksCreditMemo[],
    realmId: string,
    contractLookupMap: ContractLookupMap
  ): Promise<void> {
    const batch = creditMemos.map(creditMemo => {
      const parsed = parseCreditMemoMemo(creditMemo);

      // Look up the correct contract_id using the parsed contract number
      const contractId = parsed.contractNumber
        ? contractLookupMap.get(parsed.contractNumber) || null
        : null;

      if (parsed.contractNumber && !contractId) {
        console.warn(`[QuickBooks Cron Sync] Credit memo ${creditMemo.DocNumber}: contract ${parsed.contractNumber} not found in lookup map`);
      }

      return {
        quickbooks_id: creditMemo.Id,
        quickbooks_realm_id: realmId,
        quickbooks_customer_id: creditMemo.CustomerRef?.value,
        contract_id: contractId,
        doc_number: creditMemo.DocNumber || null,
        customer_name: creditMemo.CustomerRef?.name || null,
        transaction_date: creditMemo.TxnDate,
        amount: creditMemo.TotalAmt,
        balance: creditMemo.Balance || 0,
        contract_external_id: parsed.contractNumber,
        points: parsed.points,
        memo_raw: getRawMemoText(creditMemo),
        raw_data: JSON.stringify(creditMemo),
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Batch upsert
    const batchSize = 50;
    for (let i = 0; i < batch.length; i += batchSize) {
      const batchSlice = batch.slice(i, i + batchSize);
      const { error } = await dbProxy.upsert('pulse_credit_memos', batchSlice, {
        onConflict: 'quickbooks_id,quickbooks_realm_id',
      });

      if (error) {
        console.error('[QuickBooks Cron Sync] Error storing credit memos:', error);
      }
    }
  }

  /**
   * Store payments in database
   * Payments are linked to invoices via the linked_invoices field.
   * The contract linkage is determined at query time via the linked invoices,
   * since a single payment may span multiple invoices/contracts.
   */
  private async storePayments(
    payments: QuickBooksPayment[],
    realmId: string,
    _contractLookupMap: ContractLookupMap
  ): Promise<void> {
    const batch = payments.map(payment => {
      const linkedInvoices = this.extractLinkedInvoices(payment);

      // Payments don't have their own contract linkage - they link to invoices.
      // The contract_id can be determined at query time by joining through linked_invoices.
      // Set to null for now to avoid incorrect linkage.
      return {
        quickbooks_id: payment.Id,
        quickbooks_realm_id: realmId,
        quickbooks_customer_id: payment.CustomerRef?.value,
        contract_id: null,
        customer_name: payment.CustomerRef?.name || null,
        payment_date: payment.TxnDate,
        payment_method: payment.PaymentMethodRef?.name || null,
        amount: payment.TotalAmt,
        reference_number: payment.PaymentRefNum || null,
        linked_invoices: JSON.stringify(linkedInvoices),
        raw_data: JSON.stringify(payment),
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Batch upsert
    const batchSize = 50;
    for (let i = 0; i < batch.length; i += batchSize) {
      const batchSlice = batch.slice(i, i + batchSize);
      const { error } = await dbProxy.upsert('pulse_payments', batchSlice, {
        onConflict: 'quickbooks_id,quickbooks_realm_id',
      });

      if (error) {
        console.error('[QuickBooks Cron Sync] Error storing payments:', error);
      }
    }
  }

  /**
   * Extract linked invoice IDs from a payment
   */
  private extractLinkedInvoices(payment: QuickBooksPayment): Array<{ id: string; amount: number }> {
    const linkedInvoices: Array<{ id: string; amount: number }> = [];
    const processedIds = new Set<string>();

    // Check top-level LinkedTxn
    if (payment.LinkedTxn && Array.isArray(payment.LinkedTxn)) {
      for (const txn of payment.LinkedTxn) {
        if (txn.TxnType === 'Invoice' && txn.TxnId && !processedIds.has(txn.TxnId)) {
          linkedInvoices.push({
            id: txn.TxnId,
            amount: txn.Amount || payment.TotalAmt,
          });
          processedIds.add(txn.TxnId);
        }
      }
    }

    // Check Line items
    if (payment.Line && Array.isArray(payment.Line)) {
      for (const line of payment.Line) {
        // Check LinkedTxn in line items
        if (line.LinkedTxn && Array.isArray(line.LinkedTxn)) {
          for (const txn of line.LinkedTxn) {
            if (txn.TxnType === 'Invoice' && txn.TxnId && !processedIds.has(txn.TxnId)) {
              linkedInvoices.push({
                id: txn.TxnId,
                amount: line.Amount || txn.Amount || 0,
              });
              processedIds.add(txn.TxnId);
            }
          }
        }

        // Check LineEx.any array for txnId
        if (line.LineEx?.any && Array.isArray(line.LineEx.any)) {
          const txnIdObj = line.LineEx.any.find(
            item => item.value?.Name === 'txnId' && item.value?.Value
          );

          if (txnIdObj && !processedIds.has(txnIdObj.value!.Value)) {
            linkedInvoices.push({
              id: txnIdObj.value!.Value,
              amount: line.Amount || 0,
            });
            processedIds.add(txnIdObj.value!.Value);
          }
        }
      }
    }

    return linkedInvoices;
  }

  /**
   * Link payments to invoices in the database (update invoice payment status)
   * This is a simplified version - could be enhanced to track partial payments
   */
  private async linkPaymentsToInvoices(): Promise<void> {
    // Note: The invoice balance field from QuickBooks already reflects payments
    // This method could be used for additional payment tracking if needed
    console.log('[QuickBooks Cron Sync] Payment-invoice linking handled by QB balance field');
  }

  /**
   * Check if a sync is already running
   */
  private async checkForRunningSync(): Promise<{ isRunning: boolean; startedAt?: string }> {
    const { data, error } = await dbProxy.select<Array<{ status: string; updated_at: string }>>('pulse_sync_state', {
      columns: 'status, updated_at',
      filters: { service: 'quickbooks', entity_type: 'invoices' },
      single: true,
    });

    if (error || !data || data.length === 0) {
      return { isRunning: false };
    }

    const state = data[0];
    if (state.status !== 'running') {
      return { isRunning: false };
    }

    // Check if the sync has been running for more than 1 hour (likely crashed)
    const updatedAt = new Date(state.updated_at);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    if (updatedAt < oneHourAgo) {
      console.log('[QuickBooks Cron Sync] Previous sync appears stale (>1 hour), allowing new sync');
      return { isRunning: false };
    }

    return { isRunning: true, startedAt: state.updated_at };
  }

  /**
   * Log sync start
   */
  private async logSyncStart(syncId: string, mode: string): Promise<void> {
    await dbProxy.insert('pulse_sync_logs', {
      id: syncId,
      service: 'quickbooks',
      entity_type: 'invoices',
      sync_mode: mode,
      status: 'started',
      started_at: new Date().toISOString(),
    });

    await dbProxy.upsert('pulse_sync_state', {
      service: 'quickbooks',
      entity_type: 'invoices',
      status: 'running',
      sync_mode: mode,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'service,entity_type' });
  }

  /**
   * Log sync complete
   */
  private async logSyncComplete(
    syncId: string,
    status: 'success' | 'failed',
    results: SyncResults,
    errorMessage?: string
  ): Promise<void> {
    const recordsProcessed = results.invoicesProcessed + results.creditMemosProcessed + results.paymentsProcessed;

    await dbProxy.update('pulse_sync_logs', {
      status,
      records_processed: recordsProcessed,
      error_message: errorMessage || null,
      completed_at: new Date().toISOString(),
    }, { id: syncId });

    const stateUpdate: Record<string, unknown> = {
      service: 'quickbooks',
      entity_type: 'invoices',
      status: status === 'success' ? 'completed' : 'failed',
      last_sync_at: new Date().toISOString(),
      records_processed: recordsProcessed,
      error_message: errorMessage || null,
      updated_at: new Date().toISOString(),
    };

    if (status === 'success') {
      stateUpdate.last_successful_sync_at = new Date().toISOString();
      if (results.mode === 'full') {
        stateUpdate.last_full_sync_at = new Date().toISOString();
      }
    }

    await dbProxy.upsert('pulse_sync_state', stateUpdate, { onConflict: 'service,entity_type' });
  }
}

export default QuickBooksCronSyncService;
