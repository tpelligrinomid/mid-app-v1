// Contract Enum Types - Match PostgreSQL enum types exactly

export type ContractStatus = 'pending' | 'active' | 'canceled' | 'inactive';
export type ContractType = 'recurring' | 'project';
export type PaymentType = 'invoice' | 'credit_card';
export type EngagementType = 'strategic' | 'tactical';
export type CustomerDisplayType = 'points' | 'hours' | 'none';
export type PriorityTier = 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';

// Enum value arrays for validation
export const CONTRACT_STATUS_VALUES: ContractStatus[] = ['pending', 'active', 'canceled', 'inactive'];
export const CONTRACT_TYPE_VALUES: ContractType[] = ['recurring', 'project'];
export const PAYMENT_TYPE_VALUES: PaymentType[] = ['invoice', 'credit_card'];
export const ENGAGEMENT_TYPE_VALUES: EngagementType[] = ['strategic', 'tactical'];
export const CUSTOMER_DISPLAY_TYPE_VALUES: CustomerDisplayType[] = ['points', 'hours', 'none'];
export const PRIORITY_TIER_VALUES: PriorityTier[] = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'];

// Type guards for enum validation
export function isValidContractStatus(value: string): value is ContractStatus {
  return CONTRACT_STATUS_VALUES.includes(value as ContractStatus);
}

export function isValidContractType(value: string): value is ContractType {
  return CONTRACT_TYPE_VALUES.includes(value as ContractType);
}

export function isValidPaymentType(value: string): value is PaymentType {
  return PAYMENT_TYPE_VALUES.includes(value as PaymentType);
}

export function isValidEngagementType(value: string): value is EngagementType {
  return ENGAGEMENT_TYPE_VALUES.includes(value as EngagementType);
}

export function isValidCustomerDisplayType(value: string): value is CustomerDisplayType {
  return CUSTOMER_DISPLAY_TYPE_VALUES.includes(value as CustomerDisplayType);
}

export function isValidPriorityTier(value: string): value is PriorityTier {
  return PRIORITY_TIER_VALUES.includes(value as PriorityTier);
}

// Contract interface matching the database schema
export interface Contract {
  contract_id: string;
  account_id: string | null;
  external_id: string | null;
  contract_name: string;
  contract_status: ContractStatus;
  contract_type: ContractType;
  engagement_type: EngagementType | null;
  // Financial fields
  amount: number | null;
  payment_type: PaymentType | null;
  monthly_points_allotment: number | null;
  dollar_per_hour: number | null;
  // Date fields
  contract_start_date: string;
  contract_end_date: string | null;
  contract_renewal_date: string | null;
  next_invoice_date: string | null;
  // Term fields
  initial_term_length: number | null;
  subsequent_term_length: number | null;
  notice_period: number | null;
  autorenewal: boolean;
  // Assignment fields
  account_manager: string | null;
  team_manager: string | null;
  // Integration fields
  clickup_folder_id: string | null;
  quickbooks_customer_id: string | null;
  quickbooks_business_unit_id: string | null;
  deal_id: string | null;
  slack_channel_internal: string | null;
  slack_channel_external: string | null;
  // Display settings
  customer_display_type: CustomerDisplayType | null;
  hosting: boolean;
  priority: PriorityTier | null;
  // Description
  contract_description: string | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

// Contract with related account data
export interface ContractWithAccount extends Contract {
  account: {
    account_id: string;
    name: string;
    hubspot_account_id?: string;
  } | null;
}

// Contract list item (minimal fields for listing)
export interface ContractListItem {
  contract_id: string;
  contract_name: string;
  contract_status: ContractStatus;
  contract_type: ContractType;
  engagement_type: EngagementType | null;
  priority: PriorityTier | null;
  amount: number | null;
  contract_start_date: string;
  contract_end_date: string | null;
  account: {
    account_id: string;
    name: string;
  } | null;
  created_at: string;
  updated_at: string;
}

// Contract create/update DTOs
export interface CreateContractDTO {
  account_id?: string;
  external_id?: string;
  contract_name: string;
  contract_status: ContractStatus;
  contract_type: ContractType;
  engagement_type?: EngagementType;
  amount?: number;
  payment_type?: PaymentType;
  monthly_points_allotment?: number;
  dollar_per_hour?: number;
  contract_start_date: string;
  contract_end_date?: string;
  contract_renewal_date?: string;
  next_invoice_date?: string;
  initial_term_length?: number;
  subsequent_term_length?: number;
  notice_period?: number;
  autorenewal?: boolean;
  account_manager?: string;
  team_manager?: string;
  clickup_folder_id?: string;
  quickbooks_customer_id?: string;
  quickbooks_business_unit_id?: string;
  deal_id?: string;
  slack_channel_internal?: string;
  slack_channel_external?: string;
  customer_display_type?: CustomerDisplayType;
  hosting?: boolean;
  priority?: PriorityTier;
  contract_description?: string;
}

export interface UpdateContractDTO extends Partial<CreateContractDTO> {
  contract_id: string;
}

// Validation helper for create/update operations
export function validateContractEnums(data: Partial<CreateContractDTO>): string[] {
  const errors: string[] = [];

  if (data.contract_status && !isValidContractStatus(data.contract_status)) {
    errors.push(`Invalid contract_status: ${data.contract_status}. Valid values: ${CONTRACT_STATUS_VALUES.join(', ')}`);
  }

  if (data.contract_type && !isValidContractType(data.contract_type)) {
    errors.push(`Invalid contract_type: ${data.contract_type}. Valid values: ${CONTRACT_TYPE_VALUES.join(', ')}`);
  }

  if (data.payment_type && !isValidPaymentType(data.payment_type)) {
    errors.push(`Invalid payment_type: ${data.payment_type}. Valid values: ${PAYMENT_TYPE_VALUES.join(', ')}`);
  }

  if (data.engagement_type && !isValidEngagementType(data.engagement_type)) {
    errors.push(`Invalid engagement_type: ${data.engagement_type}. Valid values: ${ENGAGEMENT_TYPE_VALUES.join(', ')}`);
  }

  if (data.customer_display_type && !isValidCustomerDisplayType(data.customer_display_type)) {
    errors.push(`Invalid customer_display_type: ${data.customer_display_type}. Valid values: ${CUSTOMER_DISPLAY_TYPE_VALUES.join(', ')}`);
  }

  if (data.priority && !isValidPriorityTier(data.priority)) {
    errors.push(`Invalid priority: ${data.priority}. Valid values: ${PRIORITY_TIER_VALUES.join(', ')}`);
  }

  return errors;
}
