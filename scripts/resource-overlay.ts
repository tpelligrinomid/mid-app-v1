import { readFileSync, writeFileSync } from 'fs';

// =============================================================================
// Employee → Category mapping (based on title, skillsets, technologies)
// =============================================================================

interface Employee {
  name: string;
  title: string;
  department: string;
  status: string;
  clientFacing: boolean;
  monthlyCost: number;
  primaryCategory: string;
  secondaryCategories: string[];
}

const employees: Employee[] = [
  { name: 'Alberto Gomes', title: 'Senior WordPress Developer', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 3500, primaryCategory: 'Web Development', secondaryCategories: ['Tech Stack/Ops', 'SEO/AEO'] },
  { name: 'Aleksandar Vukajlovic', title: 'Motion Graphics Designer', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 3000, primaryCategory: 'Video', secondaryCategories: ['Podcast'] },
  { name: 'Aleksandra', title: 'Strategist', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 4650, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'ABM'] },
  { name: 'Baylee Gunnell', title: 'Accounts Director', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 9075, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'Podcast', 'SEO/AEO', 'ABM'] },
  { name: 'Bruna Braune', title: 'Marketing Operations', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 6000, primaryCategory: 'Marketing Operations', secondaryCategories: ['Tech Stack/Ops', 'Performance/Reporting'] },
  { name: 'Colin Costigan', title: 'Head of Accounts', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 11596, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'ABM', 'Paid Media', 'Content Creation', 'Tech Stack/Ops'] },
  { name: 'Damir Karamustafic', title: 'Development Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 4356, primaryCategory: 'Web Development', secondaryCategories: ['Tech Stack/Ops', 'Performance/Reporting'] },
  { name: 'Dhax Daryl Reyes', title: 'Graphic Design Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 1200, primaryCategory: 'Design/Creative', secondaryCategories: [] },
  { name: 'Djordje Vucicevic', title: 'Creative & Art Director', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 3600, primaryCategory: 'Design/Creative', secondaryCategories: ['Video'] },
  { name: 'Gary Butalid', title: 'Graphic Design Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 1200, primaryCategory: 'Design/Creative', secondaryCategories: ['Web Development'] },
  { name: 'Guille Santana', title: 'Strategist', department: 'Accounts', status: 'Active', clientFacing: false, monthlyCost: 5500, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'ABM'] },
  { name: 'Maria Buzzi', title: 'Paid Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 4000, primaryCategory: 'Paid Media', secondaryCategories: [] },
  { name: 'Matija Butric', title: 'Animator', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 3200, primaryCategory: 'Video', secondaryCategories: ['Podcast'] },
  { name: 'Milena Gajovic', title: 'Graphic Designer', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 1700, primaryCategory: 'Design/Creative', secondaryCategories: [] },
  { name: 'Nathalia Braga', title: 'Strategist', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 6500, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'ABM'] },
  { name: 'Nathalie Mintjens', title: 'Growth Strategist', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 7562.5, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'ABM'] },
  { name: 'Nick Bennett', title: 'Account Director', department: 'Delivery', status: 'Active', clientFacing: true, monthlyCost: 6000, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research'] },
  { name: 'Nina Belina', title: 'Strategist', department: 'Accounts', status: 'Active', clientFacing: true, monthlyCost: 4500, primaryCategory: 'Account Management', secondaryCategories: ['Strategy/Research', 'Content Creation', 'ABM'] },
  { name: 'Paula Ocampo', title: 'Marketing Manager', department: 'Accounts', status: 'Active', clientFacing: false, monthlyCost: 3500, primaryCategory: 'Account Management', secondaryCategories: ['Paid Media', 'Performance/Reporting', 'Tech Stack/Ops'] },
  { name: 'Ronwell Cani', title: 'Development Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 800, primaryCategory: 'Web Development', secondaryCategories: ['SEO/AEO'] },
  { name: 'Santiago Serrano', title: 'Marketing Manager', department: 'Accounts', status: 'Active', clientFacing: false, monthlyCost: 4500, primaryCategory: 'Account Management', secondaryCategories: ['Paid Media', 'Design/Creative', 'Performance/Reporting', 'Video'] },
  { name: 'Stefan Kerkez', title: 'Graphic and Web Designer', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 2000, primaryCategory: 'Design/Creative', secondaryCategories: ['Web Development'] },
  { name: 'Thiago Araujo', title: 'Graphic Design Specialist', department: 'Delivery', status: 'Active', clientFacing: false, monthlyCost: 1800, primaryCategory: 'Design/Creative', secondaryCategories: ['Web Development', 'Video'] },
];

// =============================================================================
// Load task data
// =============================================================================

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = ''; let inQ = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '"') {
      if (inQ && j + 1 < line.length && line[j + 1] === '"') { current += '"'; j++; }
      else { inQ = !inQ; }
    } else if (ch === ';' && !inQ) { fields.push(current); current = ''; }
    else { current += ch; }
  }
  fields.push(current);
  return fields;
}

const raw = readFileSync('docs/classified-tasks-q1-2026-deliverables.csv', 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());

interface TaskRow { category: string; points: number; }
const tasks: TaskRow[] = [];
for (let i = 1; i < lines.length; i++) {
  const fields = parseLine(lines[i]);
  const len = fields.length;
  const category = fields[len - 6] || '';
  const points = parseFloat(fields[len - 4]) || 0;
  tasks.push({ category, points });
}

// =============================================================================
// Build analysis
// =============================================================================

const CATEGORIES = [
  'Web Development', 'Tech Stack/Ops', 'Account Management', 'Marketing Operations',
  'Content Creation', 'Podcast', 'Design/Creative', 'Paid Media', 'ABM', 'SEO/AEO',
  'Performance/Reporting', 'Strategy/Research', 'Video', 'Other'
];

// Demand side
const demandTasks: Record<string, number> = {};
const demandPoints: Record<string, number> = {};
for (const t of tasks) {
  demandTasks[t.category] = (demandTasks[t.category] || 0) + 1;
  demandPoints[t.category] = (demandPoints[t.category] || 0) + t.points;
}

// Supply side
const primaryHeadcount: Record<string, number> = {};
const primaryCost: Record<string, number> = {};
const totalCapable: Record<string, string[]> = {};

for (const e of employees) {
  primaryHeadcount[e.primaryCategory] = (primaryHeadcount[e.primaryCategory] || 0) + 1;
  primaryCost[e.primaryCategory] = (primaryCost[e.primaryCategory] || 0) + e.monthlyCost;

  // Track all who can do this work
  if (!totalCapable[e.primaryCategory]) totalCapable[e.primaryCategory] = [];
  totalCapable[e.primaryCategory].push(e.name);
  for (const sec of e.secondaryCategories) {
    if (!totalCapable[sec]) totalCapable[sec] = [];
    totalCapable[sec].push(e.name);
  }
}

const totalMonthlyLabor = employees.reduce((a, e) => a + e.monthlyCost, 0);
const totalQ1Labor = totalMonthlyLabor * 3;
const totalQ1Revenue = Object.values(demandPoints).reduce((a, b) => a + b, 0) * 100;

// =============================================================================
// Generate report
// =============================================================================

let report = `# Q1 2026 Resource Allocation Analysis

**Team Size:** ${employees.length} active employees
**Total Monthly Labor Cost:** $${totalMonthlyLabor.toLocaleString()}
**Total Q1 Labor Cost:** $${totalQ1Labor.toLocaleString()}
**Total Q1 Deliverable Revenue (points × $100):** $${totalQ1Revenue.toLocaleString()}
**Gross Margin (Revenue - Labor):** $${(totalQ1Revenue - totalQ1Labor).toLocaleString()} (${((1 - totalQ1Labor / totalQ1Revenue) * 100).toFixed(1)}%)

---

## Supply vs. Demand by Category

| Category | Q1 Tasks | Q1 Points | Q1 Revenue | Dedicated HC | Dedicated Monthly Cost | Q1 Labor Cost | Total Capable | Demand vs Supply |
|---|---|---|---|---|---|---|---|---|
`;

for (const cat of CATEGORIES) {
  const taskCount = demandTasks[cat] || 0;
  const points = demandPoints[cat] || 0;
  const revenue = points * 100;
  const hc = primaryHeadcount[cat] || 0;
  const cost = primaryCost[cat] || 0;
  const q1Cost = cost * 3;
  const capable = totalCapable[cat] || [];

  let assessment = '';
  if (hc === 0 && taskCount > 0) assessment = '🔴 No dedicated resource';
  else if (hc === 1 && taskCount > 20) assessment = '🟡 Single point of failure';
  else if (revenue > 0 && q1Cost > revenue) assessment = '🟡 Labor > Revenue';
  else if (hc >= 2 && taskCount < 10) assessment = '🔵 Potential excess capacity';
  else assessment = '🟢 Balanced';

  report += `| ${cat} | ${taskCount} | ${points} | $${revenue.toLocaleString()} | ${hc} | $${cost.toLocaleString()} | $${q1Cost.toLocaleString()} | ${capable.length} | ${assessment} |\n`;
}

report += `
## Team Roster by Primary Category

`;

for (const cat of CATEGORIES) {
  const primary = employees.filter(e => e.primaryCategory === cat);
  if (primary.length === 0) continue;

  report += `### ${cat} (${primary.length} dedicated)\n\n`;
  for (const e of primary) {
    const secondaries = e.secondaryCategories.length > 0 ? ` — also: ${e.secondaryCategories.join(', ')}` : '';
    report += `- **${e.name}** — ${e.title} ($${e.monthlyCost.toLocaleString()}/mo, ${e.department}${e.clientFacing ? ', client-facing' : ''})${secondaries}\n`;
  }
  report += '\n';
}

report += `## Bench Depth: Who Can Cover Each Category

`;

for (const cat of CATEGORIES) {
  const capable = totalCapable[cat] || [];
  const primary = employees.filter(e => e.primaryCategory === cat).map(e => e.name);
  const secondary = capable.filter(n => !primary.includes(n));

  if (capable.length === 0) {
    report += `### ${cat} — ⚠️ NO COVERAGE\n\n`;
    continue;
  }

  report += `### ${cat} (${primary.length} dedicated + ${secondary.length} backup)\n\n`;
  if (primary.length > 0) report += `Dedicated: ${primary.join(', ')}\n`;
  if (secondary.length > 0) report += `Backup: ${secondary.join(', ')}\n`;
  report += '\n';
}

report += `## Key Findings

### Critical Gaps
`;

for (const cat of CATEGORIES) {
  const taskCount = demandTasks[cat] || 0;
  const hc = primaryHeadcount[cat] || 0;
  if (hc === 0 && taskCount > 0) {
    const capable = totalCapable[cat] || [];
    report += `- **${cat}** — ${taskCount} deliverables in Q1 with NO dedicated resource. ${capable.length > 0 ? `Covered by: ${capable.join(', ')}` : 'No one on the team covers this.'}\n`;
  }
}

report += `
### Single Points of Failure
`;

for (const cat of CATEGORIES) {
  const taskCount = demandTasks[cat] || 0;
  const hc = primaryHeadcount[cat] || 0;
  if (hc === 1 && taskCount > 15) {
    const person = employees.find(e => e.primaryCategory === cat);
    const capable = totalCapable[cat] || [];
    report += `- **${cat}** — ${taskCount} deliverables rely primarily on **${person?.name}**. ${capable.length > 1 ? `${capable.length - 1} backup(s) available.` : 'No backup.'}\n`;
  }
}

report += `
### Accounts Team Overlay

The Accounts team (${employees.filter(e => e.department === 'Accounts').length} people, $${employees.filter(e => e.department === 'Accounts').reduce((a, e) => a + e.monthlyCost, 0).toLocaleString()}/mo) serves as a management and strategy layer across multiple categories:

`;

for (const e of employees.filter(e => e.department === 'Accounts')) {
  report += `- **${e.name}** (${e.title}, $${e.monthlyCost.toLocaleString()}/mo) — Primary: ${e.primaryCategory}, Also: ${e.secondaryCategories.join(', ') || 'none'}\n`;
}

const accountsCost = employees.filter(e => e.department === 'Accounts').reduce((a, e) => a + e.monthlyCost, 0);
const deliveryCost = employees.filter(e => e.department === 'Delivery').reduce((a, e) => a + e.monthlyCost, 0);

report += `
**Cost Split:** Accounts $${accountsCost.toLocaleString()}/mo (${((accountsCost / totalMonthlyLabor) * 100).toFixed(0)}%) vs Delivery $${deliveryCost.toLocaleString()}/mo (${((deliveryCost / totalMonthlyLabor) * 100).toFixed(0)}%)
`;

writeFileSync('docs/resource-overlay-q1-2026.md', report);
console.log(`Report written. Team: ${employees.length}, Monthly labor: $${totalMonthlyLabor.toLocaleString()}, Q1 revenue: $${totalQ1Revenue.toLocaleString()}`);
