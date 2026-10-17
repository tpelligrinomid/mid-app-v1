/**
 * Service Category extraction.
 *
 * The category lives in the ClickUp "Service Line" / "Service Category" dropdown
 * custom field, which the sync stores inside `pulse_tasks.custom_fields`. Each
 * task carries the full dropdown definition (option ids, names, colors and
 * orderindex) alongside the selected value, so labels are resolved dynamically
 * at read time — there is no hardcoded mapping to maintain and renamed or new
 * options flow through automatically.
 *
 * This is a read-only derivation. We never write to sync-owned columns.
 */

export const SERVICE_CATEGORY_FIELD_ID = '5f781152-a09d-43b5-bd59-2bea2d6100ae';
export const UNCATEGORIZED = 'Uncategorized';

interface DropdownOption {
  id?: string;
  name?: string;
  color?: string | null;
  orderindex?: number | string;
}

interface CustomField {
  id?: string;
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: DropdownOption[] };
}

function parseFields(customFields: unknown): CustomField[] {
  try {
    let raw: unknown = customFields;
    // The column is often a JSON-encoded string (sometimes double encoded).
    for (let i = 0; i < 2 && typeof raw === 'string'; i++) {
      raw = JSON.parse(raw);
    }
    return Array.isArray(raw) ? (raw as CustomField[]) : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the selected service category label for a task.
 * Returns `UNCATEGORIZED` when the field is missing, empty or unresolvable.
 */
export function getServiceCategory(customFields: unknown): string {
  const field = parseFields(customFields).find((f) => f.id === SERVICE_CATEGORY_FIELD_ID);
  if (!field || field.value === null || field.value === undefined || field.value === '') {
    return UNCATEGORIZED;
  }

  const options = field.type_config?.options || [];
  const value = field.value;

  // ClickUp dropdowns store either the option's orderindex (number) or its id.
  const match = options.find((o) => {
    if (typeof value === 'number') return Number(o.orderindex) === value;
    const s = String(value);
    return o.id === s || String(o.orderindex) === s;
  });

  const label = match?.name?.trim();
  return label ? label : UNCATEGORIZED;
}

/** Chart color for a category, stable across every view. */
const PALETTE = [
  'hsl(263 70% 60%)',
  'hsl(190 80% 50%)',
  'hsl(150 60% 45%)',
  'hsl(40 90% 55%)',
  'hsl(0 75% 60%)',
  'hsl(210 80% 60%)',
  'hsl(300 60% 60%)',
  'hsl(90 55% 45%)',
  'hsl(20 80% 55%)',
  'hsl(330 70% 60%)',
  'hsl(240 50% 65%)',
  'hsl(170 60% 40%)',
];

export function categoryColor(category: string, index: number): string {
  if (category === UNCATEGORIZED) return 'hsl(var(--muted-foreground))';
  return PALETTE[index % PALETTE.length];
}

/** Deterministic color for a category without needing an index (chips, badges). */
export function categoryColorFor(category: string): string {
  if (category === UNCATEGORIZED) return 'hsl(var(--muted-foreground))';
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/** Alphabetical ordering with Uncategorized always last. */
export function sortCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });
}
