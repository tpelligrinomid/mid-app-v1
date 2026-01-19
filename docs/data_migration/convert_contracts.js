const fs = require('fs');
const path = require('path');

// Read the old JSON data from both files
const oldData1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts_rows_old.json'), 'utf8'));
const oldData2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts_rows_old_2.json'), 'utf8'));
const oldData = [...oldData1, ...oldData2];

console.log(`Loaded ${oldData1.length} contracts from file 1`);
console.log(`Loaded ${oldData2.length} contracts from file 2`);

// CSV template columns in order
const columns = [
  'contract_name',
  'contract_status',
  'contract_type',
  'contract_start_date',
  'contract_end_date',
  'contract_renewal_date',
  'contract_description',
  'amount',
  'quickbooks_customer_id',
  'quickbooks_business_unit_id',
  'external_id',
  'deal_id',
  'engagement_type',
  'payment_type',
  'monthly_points_allotment',
  'priority',
  'customer_display_type',
  'hosting',
  'account_manager',
  'team_manager',
  'clickup_folder_id',
  'slack_channel_internal',
  'slack_channel_external',
  'dollar_per_hour',
  'autorenewal',
  'initial_term_length',
  'subsequent_term_length',
  'notice_period',
  'next_invoice_date'
];

// Helper to normalize special characters to ASCII
function normalizeText(str) {
  if (!str) return str;
  return str
    // Smart quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // Double quotes
    // Dashes
    .replace(/[\u2013\u2014]/g, '-')  // En-dash, em-dash
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Other common replacements
    .replace(/\u00A0/g, ' ')  // Non-breaking space
    .replace(/[\u00B4\u0060]/g, "'")  // Acute accent, grave accent
    // Remove any remaining non-ASCII
    .replace(/[^\x00-\x7F]/g, '');
}

// Helper to escape CSV values
function escapeCSV(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  let str = String(value);
  // Normalize special characters to ASCII
  str = normalizeText(str);
  // Replace newlines with spaces to avoid multiline CSV issues
  str = str.replace(/[\r\n]+/g, ' ').trim();
  // Replace commas with semicolons to avoid quoting (Lovable parser doesn't handle quotes)
  str = str.replace(/,/g, ';');
  // Remove any remaining double quotes
  str = str.replace(/"/g, "'");
  return str;
}

// Helper to format date (extract just YYYY-MM-DD from ISO timestamp)
function formatDate(dateStr) {
  if (!dateStr) return '';
  // Handle ISO format like "2026-01-16 17:05:58.760796+00"
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

// Helper to clean numeric values (remove quotes, handle null)
function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = parseFloat(value);
  return isNaN(num) ? '' : num;
}

// Map old status values to valid enum values
// Valid: 'pending', 'active', 'canceled', 'inactive'
function mapContractStatus(status) {
  const statusMap = {
    'completed': 'inactive',  // Map completed to inactive
  };
  return statusMap[status] || status;
}

// Transform each contract
const rows = oldData.map(contract => {
  const row = {
    contract_name: contract.contract_name || '',
    contract_status: mapContractStatus(contract.contract_status) || '',
    contract_type: contract.contract_type || '',
    contract_start_date: formatDate(contract.contract_start_date),
    contract_end_date: formatDate(contract.contract_end_date),
    contract_renewal_date: formatDate(contract.contract_renewal_date),
    contract_description: contract.contract_description || '',
    amount: cleanNumber(contract.amount),
    quickbooks_customer_id: contract.quickbooks_customer_id || '',
    quickbooks_business_unit_id: contract.quickbooks_business_unit_id || '',
    external_id: contract.external_id || '',
    deal_id: contract.deal_id || '',
    engagement_type: contract.engagement_type || '',
    payment_type: contract.payment_type || '',
    monthly_points_allotment: cleanNumber(contract.monthly_points_allotment),
    priority: contract.priority || '',
    customer_display_type: contract.customer_display_type || '',
    hosting: contract.hosting === true ? 'true' : contract.hosting === false ? 'false' : '',
    account_manager: contract.account_manager || '',
    team_manager: contract.team_manager || '',
    clickup_folder_id: contract.clickup_folder_id || '',
    slack_channel_internal: contract.link_to_slack_channel || '',  // Map old field
    slack_channel_external: '',  // Not in old data
    dollar_per_hour: cleanNumber(contract.dollar_per_hour),
    autorenewal: contract.autorenewal === true ? 'true' : contract.autorenewal === false ? 'false' : '',
    initial_term_length: cleanNumber(contract.initial_term_length),
    subsequent_term_length: cleanNumber(contract.subsequent_term_length),
    notice_period: cleanNumber(contract.notice_period),
    next_invoice_date: formatDate(contract.next_invoice_date)
  };

  return columns.map(col => escapeCSV(row[col])).join(',');
});

// Create CSV content
const header = columns.join(',');
const csvContent = [header, ...rows].join('\n');

// Generate filename with date
const today = new Date().toISOString().split('T')[0];
const outputFilename = `contracts_import_${today}.csv`;

// Write the CSV file
fs.writeFileSync(path.join(__dirname, outputFilename), csvContent, 'utf8');

console.log(`Converted ${oldData.length} contracts`);
console.log(`Output file: ${outputFilename}`);

// Print summary of contract statuses
const statusCounts = {};
oldData.forEach(c => {
  statusCounts[c.contract_status] = (statusCounts[c.contract_status] || 0) + 1;
});
console.log('\nContract status summary:');
Object.entries(statusCounts).forEach(([status, count]) => {
  console.log(`  ${status}: ${count}`);
});
