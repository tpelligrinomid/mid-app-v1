/**
 * QuickBooks Memo Parser
 *
 * Parses contract numbers and points from invoice/credit memo memo fields.
 * Expected format: "ContractNumber:MID20250001;Points:600;"
 */

export interface ParsedMemo {
  contractNumber: string | null;
  points: number | null;
}

/**
 * Parse a memo field to extract contract number and points
 *
 * STRICT FORMAT ONLY: "ContractNumber:MID20250001;Points:600;"
 */
export function parseCustomerMemo(
  customerMemo: { value: string } | string | null | undefined
): ParsedMemo {
  // Extract memo text from various formats
  let memoText = '';
  if (customerMemo && typeof customerMemo === 'object' && 'value' in customerMemo) {
    memoText = customerMemo.value || '';
  } else if (typeof customerMemo === 'string') {
    memoText = customerMemo;
  }

  if (!memoText) {
    return { contractNumber: null, points: null };
  }

  // STRICT FORMAT: "ContractNumber:MID20250001;Points:600;"
  // Contract number must start with MID
  const exactPattern = memoText.match(/ContractNumber:(MID[^;]+);Points:(\d+);?/i);
  if (exactPattern) {
    const contractNumber = exactPattern[1].trim();
    const points = parseInt(exactPattern[2], 10);
    return { contractNumber, points: isNaN(points) ? null : points };
  }

  // Also try contract only (in case points is missing): "ContractNumber:MID20250001;"
  const contractOnlyPattern = memoText.match(/ContractNumber:(MID[^;]+);/i);
  if (contractOnlyPattern) {
    const contractNumber = contractOnlyPattern[1].trim();
    // Look for points separately
    const pointsMatch = memoText.match(/Points:(\d+);?/i);
    const points = pointsMatch ? parseInt(pointsMatch[1], 10) : null;
    return { contractNumber, points: (points !== null && !isNaN(points)) ? points : null };
  }

  // No match - return nulls
  return { contractNumber: null, points: null };
}

/**
 * Parse memo from an invoice (checks PrivateNote first, then CustomerMemo)
 */
export function parseInvoiceMemo(invoice: {
  PrivateNote?: string;
  CustomerMemo?: { value: string } | string;
  Memo?: string;
}): ParsedMemo {
  // Check PrivateNote first (internal notes)
  if (invoice.PrivateNote) {
    const parsed = parseCustomerMemo(invoice.PrivateNote);
    if (parsed.contractNumber) {
      return parsed;
    }
  }

  // Fall back to CustomerMemo
  if (invoice.CustomerMemo) {
    const parsed = parseCustomerMemo(invoice.CustomerMemo);
    if (parsed.contractNumber) {
      return parsed;
    }
  }

  // Fall back to Memo field
  if (invoice.Memo) {
    return parseCustomerMemo(invoice.Memo);
  }

  return { contractNumber: null, points: null };
}

/**
 * Parse memo from a credit memo (only checks CustomerMemo)
 */
export function parseCreditMemoMemo(creditMemo: {
  CustomerMemo?: { value: string } | string;
  PrivateNote?: string;
}): ParsedMemo {
  // Check CustomerMemo first for credit memos
  if (creditMemo.CustomerMemo) {
    const parsed = parseCustomerMemo(creditMemo.CustomerMemo);
    if (parsed.contractNumber) {
      return parsed;
    }
  }

  // Fall back to PrivateNote
  if (creditMemo.PrivateNote) {
    return parseCustomerMemo(creditMemo.PrivateNote);
  }

  return { contractNumber: null, points: null };
}

/**
 * Get raw memo text for storage
 */
export function getRawMemoText(item: {
  PrivateNote?: string;
  CustomerMemo?: { value: string } | string;
  Memo?: string;
}): string | null {
  const parts: string[] = [];

  if (item.PrivateNote) {
    parts.push(`PrivateNote: ${item.PrivateNote}`);
  }

  if (item.CustomerMemo) {
    const memo = typeof item.CustomerMemo === 'object'
      ? item.CustomerMemo.value
      : item.CustomerMemo;
    if (memo) {
      parts.push(`CustomerMemo: ${memo}`);
    }
  }

  if (item.Memo) {
    parts.push(`Memo: ${item.Memo}`);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

export default {
  parseCustomerMemo,
  parseInvoiceMemo,
  parseCreditMemoMemo,
  getRawMemoText,
};
