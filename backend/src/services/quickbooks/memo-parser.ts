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
 * Memo field formats supported:
 * - "ContractNumber:MID20250001;Points:600;"
 * - "Contract Number: MID20250001"
 * - "MID20250001" (standalone)
 * - "Contract: MID20250001"
 * - "Points: 100" or "100 Points"
 */
export function parseCustomerMemo(
  customerMemo: { value: string } | string | null | undefined
): ParsedMemo {
  let contractNumber: string | null = null;
  let points: number | null = null;

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

  // CONTRACT NUMBER PATTERNS (in order of priority)

  // Pattern 0: Exact format "ContractNumber:MID20250001;Points:600;"
  const exactPattern = memoText.match(/ContractNumber:([^;]+);Points:(\d+);?/i);
  if (exactPattern) {
    contractNumber = exactPattern[1].trim();
    points = parseInt(exactPattern[2], 10);
    return { contractNumber, points };
  }

  // Pattern 0b: Contract only "ContractNumber:MID20250001;"
  const contractOnlyPattern = memoText.match(/ContractNumber:([^;]+);/i);
  if (contractOnlyPattern) {
    contractNumber = contractOnlyPattern[1].trim();
    // Look for points separately
    const pointsMatch = memoText.match(/Points:(\d+);?/i);
    if (pointsMatch) {
      points = parseInt(pointsMatch[1], 10);
    }
    return { contractNumber, points };
  }

  // Pattern 1: Standard format "Contract Number: ABC123"
  let contractMatch = memoText.match(/Contract\s*(?:Number|#)?:\s*([A-Za-z0-9-_]+)/i);

  // Pattern 2: Just the ID with MID prefix "MID12345" or "MID20250001"
  if (!contractMatch) {
    contractMatch = memoText.match(/\b(MID[A-Za-z0-9-_]+)\b/i);
  }

  // Pattern 3: Reference to contract "Contract: ABC123"
  if (!contractMatch) {
    contractMatch = memoText.match(/Contract(?:\s+|:\s*)([A-Za-z0-9-_]+)/i);
  }

  // Pattern 4: Client contract format "Client Contract: ABC123"
  if (!contractMatch) {
    contractMatch = memoText.match(/Client\s+Contract(?:\s+|:\s*)([A-Za-z0-9-_]+)/i);
  }

  // Pattern 5: SOW format "SOW #12345"
  if (!contractMatch) {
    contractMatch = memoText.match(/SOW\s*#?\s*(\w+)/i);
  }

  if (contractMatch && contractMatch[1]) {
    contractNumber = contractMatch[1].trim();
    // Validate minimum length (avoid matching single characters)
    if (contractNumber.length < 3) {
      contractNumber = null;
    }
    // Don't accept pure numeric strings as contract numbers (could be customer IDs)
    if (contractNumber && /^\d+$/.test(contractNumber)) {
      contractNumber = null;
    }
  }

  // POINTS PATTERNS
  const pointsPatterns = [
    /Points?:\s*(\d+)/i,                                    // "Points: 100"
    /(\d+)\s+Points?/i,                                     // "100 Points"
    /Points\s+Gifted.*?(\d+)/i,                             // "Points Gifted: 100"
    /Contract\s+Value:\s*\$?[\d,]+\s*(?:\(|\/)?\s*(\d+)\s*Points?/i  // "Contract Value: $10,000 / 100 Points"
  ];

  for (const pattern of pointsPatterns) {
    const pointsMatch = memoText.match(pattern);
    if (pointsMatch && pointsMatch[1]) {
      const parsedPoints = parseInt(pointsMatch[1].replace(/,/g, ''), 10);
      // Sanity check: points shouldn't exceed 1,000,000 (likely a customer ID if larger)
      if (!isNaN(parsedPoints) && parsedPoints <= 1000000) {
        points = parsedPoints;
        break;
      }
    }
  }

  return { contractNumber, points };
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
