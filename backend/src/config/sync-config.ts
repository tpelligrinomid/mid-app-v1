/**
 * Sync Configuration
 * Contains settings for ClickUp, QuickBooks, and HubSpot integrations
 */

export const syncConfig = {
  clickup: {
    // Team ID from environment
    teamId: process.env.CLICKUP_TEAM_ID || '14292505',

    // API token from environment
    apiToken: process.env.CLICKUP_API_TOKEN,

    // Auto-sync all active contract folders
    includeContractFolders: true,

    // Special lists to sync (not linked to contracts)
    specialLists: {
      invoices: process.env.CLICKUP_INVOICE_LIST_ID || '901704589698',
      operations: process.env.CLICKUP_OPERATIONS_LIST_ID
    },

    // Lists to never sync (blacklisted by ID)
    blacklistedLists: {
      byId: ['90030224427', '115210586', '90171958783'],
      byName: ['Financials', 'Legal', 'Finance', 'Confidential', 'Hidden', 'Private']
    },

    // Folder names to skip (partial match, case-insensitive)
    blacklistedFolders: {
      byName: ['Archive', 'Internal', 'Draft', 'Test', 'Template']
    },

    // Custom field IDs
    customFields: {
      internalOnly: 'ab7c8ff1-5dde-44e0-ba5c-5ad5fb1afb23',
      growthTask: '14bc55b9-f6df-4159-bd4a-0a2c3ed29b38',
      points: 'b61c1316-669d-4ee9-86c6-620025d61946', // Custom field version (backup)
      invoiceAmount: '0490b964-beb3-404f-b9a3-3e0a89281ad5',
      invoiceDate: '191653b3-7956-40ca-b806-d0c009d22be8',
      contractId: '208569a0-15e3-430b-b0f4-94209533d2a4'
    },

    // Performance settings
    batchSize: 50,
    concurrency: 5,
    requestTimeout: 30000,  // 30 seconds per request
    syncTimeout: 300000,    // 5 minutes total

    // Incremental sync lookback
    incrementalLookbackMinutes: 30,

    // Time entry sync lookback
    timeEntryLookbackDays: {
      incremental: 7,
      full: 90
    },

    // Deleted task detection threshold
    deletedTaskThresholdDays: 7
  },

  processLibrary: {
    spaceId: '61333242',
    customFields: {
      midPointsMenu: '9ef19ee7-6946-4a35-9dd1-3c564cee36b4',
      externalDescription: '5512c5bd-a982-4b55-8e1a-303343c673d0',
      points: 'b61c1316-669d-4ee9-86c6-620025d61946',
    }
  },

  hubspot: {
    apiKey: process.env.HUBSPOT_API_KEY
  },

  quickbooks: {
    // OAuth-based, tokens stored in database
    clientId: process.env.QUICKBOOKS_CLIENT_ID,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET
  }
};

/**
 * Status mappings per list type
 */
export const STATUS_MAPPINGS: Record<string, Record<string, string>> = {
  Deliverables: {
    'planned': 'not_started',
    'not started': 'not_started',
    'working': 'working',
    'in progress': 'working',
    'waiting on client': 'blocked',
    'on hold': 'blocked',
    'delivered': 'delivered',
    'complete': 'delivered',
    'closed': 'delivered',
    'archived': 'archived'
  },
  ToDos: {
    'to do': 'not_started',
    'open': 'not_started',
    'in progress': 'working',
    'working': 'working',
    'review': 'working',
    'done': 'delivered',
    'complete': 'delivered',
    'closed': 'delivered'
  },
  Goals: {
    'proposed': 'not_started',
    'on track': 'working',
    'needs attention': 'at_risk',
    'off track': 'blocked',
    'closed': 'delivered',
    'achieved': 'delivered'
  }
};

/**
 * Detect list type from list name
 */
export function detectListType(listName: string): string {
  const name = listName.toLowerCase();
  if (name.includes('deliverable')) return 'Deliverables';
  if (name.includes('todo') || name.includes('to-do') || name.includes('to do')) return 'ToDos';
  if (name.includes('goal')) return 'Goals';
  return 'ToDos'; // Default
}

/**
 * Map ClickUp status to normalized status
 */
export function mapStatus(rawStatus: string | undefined, listType: string): string {
  if (!rawStatus) return 'not_started';
  const mapping = STATUS_MAPPINGS[listType] || STATUS_MAPPINGS.ToDos;
  const normalized = rawStatus.toLowerCase().trim();
  return mapping[normalized] || 'not_started';
}

/**
 * Check if a list should be skipped based on name
 */
export function shouldSkipList(listName: string): boolean {
  const name = listName.toLowerCase();
  return syncConfig.clickup.blacklistedLists.byName.some(
    b => name.includes(b.toLowerCase())
  );
}

/**
 * Check if a folder should be skipped based on name
 */
export function shouldSkipFolder(folderName: string): boolean {
  const name = folderName.toLowerCase();
  return syncConfig.clickup.blacklistedFolders.byName.some(
    b => name.includes(b.toLowerCase())
  );
}

export default syncConfig;
