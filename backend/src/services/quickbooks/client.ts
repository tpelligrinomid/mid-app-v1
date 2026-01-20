/**
 * QuickBooks API Client
 *
 * Handles API calls to QuickBooks Online for invoices, credit memos, and payments.
 * Uses OAuth tokens managed by the main quickbooks service.
 */

import OAuthClient from 'intuit-oauth';

const QUICKBOOKS_BASE_URL = process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export interface QuickBooksInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  CustomerRef?: { value: string; name: string };
  PrivateNote?: string;
  CustomerMemo?: { value: string } | string;
  Memo?: string;
  MetaData?: { LastUpdatedTime: string };
}

export interface QuickBooksCreditMemo {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  TotalAmt: number;
  Balance?: number;
  CustomerRef?: { value: string; name: string };
  CustomerMemo?: { value: string } | string;
  PrivateNote?: string;
  MetaData?: { LastUpdatedTime: string };
}

export interface QuickBooksPayment {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  CustomerRef?: { value: string; name: string };
  PaymentMethodRef?: { name: string };
  PaymentRefNum?: string;
  LinkedTxn?: Array<{ TxnId: string; TxnType: string; Amount?: number }>;
  Line?: Array<{
    Amount: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string; Amount?: number }>;
    LineEx?: { any?: Array<{ value?: { Name: string; Value: string } }> };
  }>;
  MetaData?: { LastUpdatedTime: string };
}

interface QueryResponseMeta {
  startPosition?: number;
  maxResults?: number;
  totalCount?: number;
}

interface QueryResponse<T> {
  QueryResponse: QueryResponseMeta & {
    [key: string]: T[] | number | undefined;
  };
}

/**
 * QuickBooks API Client
 */
export class QuickBooksClient {
  private accessToken: string;
  private realmId: string;
  private baseUrl: string;

  constructor(accessToken: string, realmId: string) {
    this.accessToken = accessToken;
    this.realmId = realmId;
    this.baseUrl = `${QUICKBOOKS_BASE_URL}/v3/company/${realmId}`;
  }

  /**
   * Make an authenticated request to QuickBooks API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Run a QuickBooks query
   */
  async query<T>(queryString: string): Promise<T[]> {
    const encodedQuery = encodeURIComponent(queryString);
    const response = await this.request<QueryResponse<T>>(`/query?query=${encodedQuery}`);

    // Extract the entity array from the response
    const keys = Object.keys(response.QueryResponse).filter(
      k => !['startPosition', 'maxResults', 'totalCount'].includes(k)
    );

    if (keys.length > 0) {
      return (response.QueryResponse[keys[0]] as T[]) || [];
    }

    return [];
  }

  /**
   * Get invoices for a specific customer
   */
  async getInvoicesForCustomer(
    customerId: string,
    options: { updatedSince?: Date; limit?: number; offset?: number } = {}
  ): Promise<QuickBooksInvoice[]> {
    let query = `SELECT * FROM Invoice WHERE CustomerRef = '${customerId}'`;

    if (options.updatedSince) {
      const isoDate = options.updatedSince.toISOString();
      query += ` AND MetaData.LastUpdatedTime >= '${isoDate}'`;
    }

    query += ` ORDERBY MetaData.LastUpdatedTime DESC`;

    if (options.limit) {
      query += ` MAXRESULTS ${options.limit}`;
    }

    if (options.offset) {
      query += ` STARTPOSITION ${options.offset + 1}`;
    }

    return this.query<QuickBooksInvoice>(query);
  }

  /**
   * Get all invoices for a customer (with pagination)
   */
  async getAllInvoicesForCustomer(
    customerId: string,
    options: { updatedSince?: Date } = {}
  ): Promise<QuickBooksInvoice[]> {
    const allInvoices: QuickBooksInvoice[] = [];
    const pageSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const invoices = await this.getInvoicesForCustomer(customerId, {
        ...options,
        limit: pageSize,
        offset,
      });

      allInvoices.push(...invoices);

      if (invoices.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return allInvoices;
  }

  /**
   * Get credit memos for a specific customer
   */
  async getCreditMemosForCustomer(
    customerId: string,
    options: { updatedSince?: Date; limit?: number; offset?: number } = {}
  ): Promise<QuickBooksCreditMemo[]> {
    let query = `SELECT * FROM CreditMemo WHERE CustomerRef = '${customerId}'`;

    if (options.updatedSince) {
      const isoDate = options.updatedSince.toISOString();
      query += ` AND MetaData.LastUpdatedTime >= '${isoDate}'`;
    }

    query += ` ORDERBY MetaData.LastUpdatedTime DESC`;

    if (options.limit) {
      query += ` MAXRESULTS ${options.limit}`;
    }

    if (options.offset) {
      query += ` STARTPOSITION ${options.offset + 1}`;
    }

    return this.query<QuickBooksCreditMemo>(query);
  }

  /**
   * Get all credit memos for a customer (with pagination)
   */
  async getAllCreditMemosForCustomer(
    customerId: string,
    options: { updatedSince?: Date } = {}
  ): Promise<QuickBooksCreditMemo[]> {
    const allCreditMemos: QuickBooksCreditMemo[] = [];
    const pageSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const creditMemos = await this.getCreditMemosForCustomer(customerId, {
        ...options,
        limit: pageSize,
        offset,
      });

      allCreditMemos.push(...creditMemos);

      if (creditMemos.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return allCreditMemos;
  }

  /**
   * Get payments for a specific customer
   */
  async getPaymentsForCustomer(
    customerId: string,
    options: { updatedSince?: Date; limit?: number; offset?: number } = {}
  ): Promise<QuickBooksPayment[]> {
    let query = `SELECT * FROM Payment WHERE CustomerRef = '${customerId}'`;

    if (options.updatedSince) {
      const isoDate = options.updatedSince.toISOString();
      query += ` AND MetaData.LastUpdatedTime >= '${isoDate}'`;
    }

    query += ` ORDERBY MetaData.LastUpdatedTime DESC`;

    if (options.limit) {
      query += ` MAXRESULTS ${options.limit}`;
    }

    if (options.offset) {
      query += ` STARTPOSITION ${options.offset + 1}`;
    }

    return this.query<QuickBooksPayment>(query);
  }

  /**
   * Get all payments for a customer (with pagination)
   */
  async getAllPaymentsForCustomer(
    customerId: string,
    options: { updatedSince?: Date } = {}
  ): Promise<QuickBooksPayment[]> {
    const allPayments: QuickBooksPayment[] = [];
    const pageSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const payments = await this.getPaymentsForCustomer(customerId, {
        ...options,
        limit: pageSize,
        offset,
      });

      allPayments.push(...payments);

      if (payments.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return allPayments;
  }

  /**
   * Check if error is retryable (rate limit, network issues)
   */
  static isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('econnreset') ||
        message.includes('etimedout')
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
      const isRetryable = QuickBooksClient.isRetryableError(error);

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000;
      console.log(`QuickBooks API retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}

export default QuickBooksClient;
