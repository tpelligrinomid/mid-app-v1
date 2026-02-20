// Content module types for content_types, content_categories,
// content_attribute_definitions, content_ideas, and content_assets tables

// ============================================================================
// Enums
// ============================================================================

export type ContentIdeaStatus = 'idea' | 'approved' | 'rejected';
export type ContentAssetStatus = 'draft' | 'in_production' | 'review' | 'approved' | 'published';
export type AttributeFieldType = 'single_select' | 'multi_select' | 'boolean' | 'text';
export type AttributeAppliesTo = 'ideas' | 'assets' | 'both';
export type ContentIdeaSource = 'manual' | 'ai_generated';

export const CONTENT_IDEA_STATUS_VALUES: ContentIdeaStatus[] = [
  'idea', 'approved', 'rejected',
];
export const CONTENT_ASSET_STATUS_VALUES: ContentAssetStatus[] = [
  'draft', 'in_production', 'review', 'approved', 'published',
];
export const ATTRIBUTE_FIELD_TYPE_VALUES: AttributeFieldType[] = [
  'single_select', 'multi_select', 'boolean', 'text',
];
export const ATTRIBUTE_APPLIES_TO_VALUES: AttributeAppliesTo[] = [
  'ideas', 'assets', 'both',
];
export const CONTENT_IDEA_SOURCE_VALUES: ContentIdeaSource[] = [
  'manual', 'ai_generated',
];

// ============================================================================
// Validation helpers
// ============================================================================

export function isValidContentIdeaStatus(value: string): value is ContentIdeaStatus {
  return CONTENT_IDEA_STATUS_VALUES.includes(value as ContentIdeaStatus);
}

export function isValidContentAssetStatus(value: string): value is ContentAssetStatus {
  return CONTENT_ASSET_STATUS_VALUES.includes(value as ContentAssetStatus);
}

export function isValidAttributeFieldType(value: string): value is AttributeFieldType {
  return ATTRIBUTE_FIELD_TYPE_VALUES.includes(value as AttributeFieldType);
}

export function isValidAttributeAppliesTo(value: string): value is AttributeAppliesTo {
  return ATTRIBUTE_APPLIES_TO_VALUES.includes(value as AttributeAppliesTo);
}

export function isValidContentIdeaSource(value: string): value is ContentIdeaSource {
  return CONTENT_IDEA_SOURCE_VALUES.includes(value as ContentIdeaSource);
}

// ============================================================================
// Database records
// ============================================================================

export interface ContentType {
  type_id: string;
  contract_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContentCategory {
  category_id: string;
  contract_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContentAttributeDefinition {
  attribute_id: string;
  contract_id: string;
  name: string;
  slug: string;
  field_type: AttributeFieldType;
  options: Record<string, unknown>[] | null;
  is_required: boolean;
  applies_to: AttributeAppliesTo;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContentIdea {
  idea_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  content_type_id: string | null;
  category_id: string | null;
  source: ContentIdeaSource;
  status: ContentIdeaStatus;
  priority: number | null;
  target_date: string | null;
  custom_attributes: Record<string, unknown> | null;
  tags: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentAsset {
  asset_id: string;
  contract_id: string;
  idea_id: string | null;
  title: string;
  description: string | null;
  content_type_id: string | null;
  category_id: string | null;
  content_body: string | null;
  content_structured: Record<string, unknown> | null;
  status: ContentAssetStatus;
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  external_url: string | null;
  clickup_task_id: string | null;
  tags: string[] | null;
  custom_attributes: Record<string, unknown> | null;
  published_date: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreateContentTypeDTO {
  contract_id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdateContentTypeDTO {
  name?: string;
  slug?: string;
  description?: string;
  icon?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface CreateContentCategoryDTO {
  contract_id: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdateContentCategoryDTO {
  name?: string;
  slug?: string;
  description?: string;
  color?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface CreateAttributeDefinitionDTO {
  contract_id: string;
  name: string;
  slug: string;
  field_type: AttributeFieldType;
  options?: Record<string, unknown>[];
  is_required?: boolean;
  applies_to?: AttributeAppliesTo;
  sort_order?: number;
}

export interface UpdateAttributeDefinitionDTO {
  name?: string;
  slug?: string;
  field_type?: AttributeFieldType;
  options?: Record<string, unknown>[];
  is_required?: boolean;
  applies_to?: AttributeAppliesTo;
  sort_order?: number;
}

export interface CreateContentIdeaDTO {
  contract_id: string;
  title: string;
  description?: string;
  content_type_id?: string;
  category_id?: string;
  source?: ContentIdeaSource;
  status?: ContentIdeaStatus;
  priority?: number;
  target_date?: string;
  custom_attributes?: Record<string, unknown>;
  tags?: string[];
}

export interface UpdateContentIdeaDTO {
  title?: string;
  description?: string;
  content_type_id?: string | null;
  category_id?: string | null;
  source?: ContentIdeaSource;
  status?: ContentIdeaStatus;
  priority?: number | null;
  target_date?: string | null;
  custom_attributes?: Record<string, unknown>;
  tags?: string[];
}

export interface CreateContentAssetDTO {
  contract_id: string;
  title: string;
  idea_id?: string;
  description?: string;
  content_type_id?: string;
  category_id?: string;
  content_body?: string;
  content_structured?: Record<string, unknown>;
  status?: ContentAssetStatus;
  file_path?: string;
  file_name?: string;
  file_size_bytes?: number;
  mime_type?: string;
  external_url?: string;
  clickup_task_id?: string;
  tags?: string[];
  custom_attributes?: Record<string, unknown>;
  published_date?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContentAssetDTO {
  title?: string;
  description?: string;
  content_type_id?: string | null;
  category_id?: string | null;
  content_body?: string;
  content_structured?: Record<string, unknown>;
  status?: ContentAssetStatus;
  file_path?: string;
  file_name?: string;
  file_size_bytes?: number;
  mime_type?: string;
  external_url?: string;
  clickup_task_id?: string | null;
  tags?: string[];
  custom_attributes?: Record<string, unknown>;
  published_date?: string | null;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Validation functions
// ============================================================================

export function validateContentIdeaInput(data: Partial<CreateContentIdeaDTO> | UpdateContentIdeaDTO): string[] {
  const errors: string[] = [];

  if (data.status && !isValidContentIdeaStatus(data.status)) {
    errors.push(`Invalid status: ${data.status}. Valid values: ${CONTENT_IDEA_STATUS_VALUES.join(', ')}`);
  }

  if (data.source && !isValidContentIdeaSource(data.source)) {
    errors.push(`Invalid source: ${data.source}. Valid values: ${CONTENT_IDEA_SOURCE_VALUES.join(', ')}`);
  }

  if (data.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.target_date)) {
    errors.push('Invalid target_date format. Expected YYYY-MM-DD');
  }

  if (data.priority !== undefined && data.priority !== null) {
    if (typeof data.priority !== 'number' || data.priority < 1 || data.priority > 5) {
      errors.push('Invalid priority. Must be a number between 1 and 5');
    }
  }

  return errors;
}

export function validateContentAssetInput(data: Partial<CreateContentAssetDTO> | UpdateContentAssetDTO): string[] {
  const errors: string[] = [];

  if (data.status && !isValidContentAssetStatus(data.status)) {
    errors.push(`Invalid status: ${data.status}. Valid values: ${CONTENT_ASSET_STATUS_VALUES.join(', ')}`);
  }

  if (data.published_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.published_date)) {
    errors.push('Invalid published_date format. Expected YYYY-MM-DD');
  }

  return errors;
}

export function validateAttributeDefinitionInput(data: Partial<CreateAttributeDefinitionDTO> | UpdateAttributeDefinitionDTO): string[] {
  const errors: string[] = [];

  if (data.field_type && !isValidAttributeFieldType(data.field_type)) {
    errors.push(`Invalid field_type: ${data.field_type}. Valid values: ${ATTRIBUTE_FIELD_TYPE_VALUES.join(', ')}`);
  }

  if (data.applies_to && !isValidAttributeAppliesTo(data.applies_to)) {
    errors.push(`Invalid applies_to: ${data.applies_to}. Valid values: ${ATTRIBUTE_APPLIES_TO_VALUES.join(', ')}`);
  }

  return errors;
}
