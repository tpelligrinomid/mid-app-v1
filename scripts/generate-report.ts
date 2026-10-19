import { readFileSync, writeFileSync } from 'fs';

const raw = readFileSync('docs/classified-tasks-q1-2026-deliverables.csv', 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());

interface Row { task_name: string; contract_name: string; category: string; points: number; month: string; }

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

// Header: task_name;contract_name;category;list_type;points;time_spent_hours;date_done;month
// Indices: 0         1             2        3         4      5                6         7
// But contract_name can contain semicolons, so anchor from the end:
// month is always last (-1), date_done (-2), time_spent_hours (-3), points (-4), list_type (-5), category (-6)
const rows: Row[] = [];
for (let i = 1; i < lines.length; i++) {
  const fields = parseLine(lines[i]);
  const len = fields.length;
  // Expected 8 fields. Extra fields mean contract_name had semicolons.
  const month = fields[len - 1] || '';
  const points = parseFloat(fields[len - 4]) || 0;
  const category = fields[len - 6] || '';
  const taskName = fields[0] || '';
  const contractName = len > 8 ? fields.slice(1, 1 + (len - 7)).join('; ') : (fields[1] || '');
  rows.push({ task_name: taskName, contract_name: contractName, category, points, month });
}

const totalTasks = rows.length;
const totalPoints = rows.reduce((a, r) => a + r.points, 0);

const catCounts: Record<string, number> = {};
const catPoints: Record<string, number> = {};
const catByMonth: Record<string, Record<string, number>> = {};
const catPointsByMonth: Record<string, Record<string, number>> = {};

for (const r of rows) {
  catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  catPoints[r.category] = (catPoints[r.category] || 0) + r.points;
  if (!catByMonth[r.category]) catByMonth[r.category] = {};
  catByMonth[r.category][r.month] = (catByMonth[r.category][r.month] || 0) + 1;
  if (!catPointsByMonth[r.category]) catPointsByMonth[r.category] = {};
  catPointsByMonth[r.category][r.month] = (catPointsByMonth[r.category][r.month] || 0) + r.points;
}

const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

let report = `# Q1 2026 Deliverable Task Analysis

**Period:** January 1 — March 31, 2026
**Scope:** Parent-level Deliverables only (excludes ToDos, internal tasks)
**Total Deliverables:** ${totalTasks}
**Total Points:** ${totalPoints}

## Task Distribution by Category

| Category | Tasks | % of Total | Points | % of Points | Avg Points/Task |
|---|---|---|---|---|---|
`;
for (const [cat, count] of sortedCats) {
  const pct = ((count / totalTasks) * 100).toFixed(1);
  const pts = catPoints[cat] || 0;
  const ptsPct = totalPoints > 0 ? ((pts / totalPoints) * 100).toFixed(1) : '0.0';
  const avg = count > 0 ? (pts / count).toFixed(1) : '0.0';
  report += `| ${cat} | ${count} | ${pct}% | ${pts} | ${ptsPct}% | ${avg} |\n`;
}

report += `\n## Monthly Trends (Task Count)

| Category | Jan | Feb | Mar | Trend |
|---|---|---|---|---|
`;
for (const [cat] of sortedCats) {
  const jan = catByMonth[cat]?.['2026-01'] || 0;
  const feb = catByMonth[cat]?.['2026-02'] || 0;
  const mar = catByMonth[cat]?.['2026-03'] || 0;
  const trend = mar > jan ? '↑' : mar < jan ? '↓' : '→';
  report += `| ${cat} | ${jan} | ${feb} | ${mar} | ${trend} |\n`;
}

report += `\n## Monthly Trends (Points)

| Category | Jan | Feb | Mar | Trend |
|---|---|---|---|---|
`;
for (const [cat] of sortedCats) {
  const jan = catPointsByMonth[cat]?.['2026-01'] || 0;
  const feb = catPointsByMonth[cat]?.['2026-02'] || 0;
  const mar = catPointsByMonth[cat]?.['2026-03'] || 0;
  const trend = mar > jan ? '↑' : mar < jan ? '↓' : '→';
  report += `| ${cat} | ${jan} | ${feb} | ${mar} | ${trend} |\n`;
}

report += `\n## Top Contracts by Deliverable Volume

`;
const contractTotals: Record<string, { count: number; points: number }> = {};
for (const r of rows) {
  const name = r.contract_name || 'Unknown';
  if (!contractTotals[name]) contractTotals[name] = { count: 0, points: 0 };
  contractTotals[name].count++;
  contractTotals[name].points += r.points;
}
const topContracts = Object.entries(contractTotals).sort((a, b) => b[1].count - a[1].count).slice(0, 20);
report += `| Contract | Deliverables | Points | Top Categories |
|---|---|---|---|
`;
for (const [contract, data] of topContracts) {
  const contractCats: Record<string, number> = {};
  for (const r of rows) {
    if (r.contract_name === contract) contractCats[r.category] = (contractCats[r.category] || 0) + 1;
  }
  const top3 = Object.entries(contractCats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n})`).join(', ');
  report += `| ${contract} | ${data.count} | ${data.points} | ${top3} |\n`;
}

report += `\n## Category Details\n\n`;
for (const [cat] of sortedCats) {
  const catRows = rows.filter(r => r.category === cat);
  const pts = catPoints[cat] || 0;
  report += `### ${cat} (${catCounts[cat]} deliverables, ${pts} points)\n\n`;
  const nameFreq: Record<string, number> = {};
  for (const r of catRows) {
    const normalized = r.task_name.replace(/\s*[\[\(]?(January|February|March|Jan|Feb|Mar|Q1|Q4)[\]\)]?\s*/gi, '').replace(/\s*[\[\(]\s*[\]\)]/g, '').trim();
    nameFreq[normalized] = (nameFreq[normalized] || 0) + 1;
  }
  const topNames = Object.entries(nameFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  report += `Most common task patterns:\n`;
  for (const [name, count] of topNames) {
    report += `- ${name}${count > 1 ? ` ×${count}` : ''}\n`;
  }
  report += '\n';
}

writeFileSync('docs/task-analysis-q1-2026.md', report);
console.log(`Report: ${totalTasks} deliverables, ${totalPoints} points`);
