/**
 * One-off script: Classify Q1 2026 completed tasks by taxonomy
 *
 * Reads CSV, sends task names in batches to Claude for classification,
 * outputs a classified CSV + summary report.
 */

import { readFileSync, writeFileSync } from 'fs';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const CSV_PATH = process.argv[2] || 'docs/query-results-export-2026-04-14_10-39-27.csv';
const OUTPUT_CSV = 'docs/classified-tasks-q1-2026.csv';
const OUTPUT_REPORT = 'docs/task-analysis-q1-2026.md';

const TAXONOMY = [
  'Account Management',
  'ABM',
  'Paid Media',
  'SEO/AEO',
  'Content Creation',
  'Web Development',
  'Design/Creative',
  'Tech Stack/Ops',
  'Performance/Reporting',
  'Strategy/Research',
  'Podcast',
  'Video',
  'Other',
];

interface TaskRow {
  task_name: string;
  contract_name: string;
  list_type: string;
  points: string;
  time_spent: string;
  date_done: string;
  status: string;
  tags: string;
}

function parseSemicolonCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '"') {
      if (inQuotes && j + 1 < line.length && line[j + 1] === '"') {
        current += '"';
        j++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(raw: string): TaskRow[] {
  const lines = raw.split('\n').filter(l => l.trim());
  // Header: assignee_email;assignee_username;contract_id;contract_name;date_created;date_done;list_type;points;status;status_raw;tags;task_id;task_name;time_spent
  // Indices:  0               1                2            3             4             5         6         7      8       9          10   11      12        13
  const rows: TaskRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseSemicolonCSVLine(lines[i]);

    // Validate: we expect exactly 14 fields. If we have more, the contract_name had unquoted semicolons.
    // Use the last fields to anchor task_name (index -2) and time_spent (index -1)
    const taskName = fields.length >= 14 ? fields[fields.length - 2] : (fields[12] || '');
    const timeSpent = fields.length >= 14 ? fields[fields.length - 1] : (fields[13] || '');
    // contract_name may span multiple fields if semicolons weren't properly quoted
    const contractName = fields.length > 14
      ? fields.slice(3, 3 + (fields.length - 13)).join('; ')
      : (fields[3] || '');
    // Adjust indices for fields after contract_name
    const offset = fields.length - 14;

    rows.push({
      task_name: taskName,
      contract_name: contractName,
      list_type: fields[6 + offset] || '',
      points: fields[7 + offset] || '',
      time_spent: timeSpent,
      date_done: fields[5 + offset] || '',
      status: fields[8 + offset] || '',
      tags: fields[10 + offset] || '',
    });
  }
  return rows;
}

async function classifyBatch(tasks: { index: number; name: string }[]): Promise<Record<number, string>> {
  const taskList = tasks.map(t => `${t.index}: ${t.name}`).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0,
      system: `You classify marketing agency tasks into exactly one of these categories:

${TAXONOMY.map(t => `- ${t}`).join('\n')}

Category definitions:
- Account Management: Client meetings, client communication, support requests, onboarding
- ABM: Account-based marketing campaigns, contact lists, ABM playbooks, ABM setup
- Paid Media: Google Ads, LinkedIn Ads, paid campaigns, ad management, retargeting
- SEO/AEO: Search engine optimization, keyword research, AEO/GEO optimization, organic search
- Content Creation: Blog posts, ebooks, case studies, whitepapers, social media posts, newsletters, email sequences, content writing
- Web Development: Website updates, landing pages, web management, HubSpot/CMS work, forms
- Design/Creative: Brand guidelines, graphic design, thumbnails, visual assets, video editing
- Tech Stack/Ops: Marketing automation, CRM setup, integrations, lead scoring, workflow setup, data/analytics tools, reporting dashboards
- Performance/Reporting: Performance reports, analytics, monthly reporting, metrics
- Strategy/Research: Marketing research, roadmaps, strategic plans, competitive analysis, audits
- Podcast: Podcast episodes, show notes, guest booking, episode distribution, podcast show setup, anything with "episode" in the name
- Video: Video production, animated videos, video ads, video editing, thumbnails for video, non-podcast video content
- Other: Anything that doesn't clearly fit

Respond with ONLY a JSON object mapping the task index to the category. No explanation.
Example: {"0":"ABM","1":"Content Creation","2":"Paid Media"}`,
      messages: [{ role: 'user', content: taskList }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${err}`);
  }

  const result = await response.json() as { content: { text: string }[] };
  const text = result.content[0].text.trim();

  // Extract JSON from response (might have markdown code fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.substring(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log(`Reading CSV from ${CSV_PATH}...`);
  const raw = readFileSync(CSV_PATH, 'utf-8');
  const tasks = parseCSV(raw);
  console.log(`Parsed ${tasks.length} tasks`);

  // Classify in batches of 100
  const BATCH_SIZE = 100;
  const classifications: string[] = new Array(tasks.length).fill('Other');

  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE).map((t, j) => ({
      index: i + j,
      name: t.task_name,
    }));

    console.log(`Classifying batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tasks.length / BATCH_SIZE)} (${batch.length} tasks)...`);

    try {
      const result = await classifyBatch(batch);
      for (const [idx, category] of Object.entries(result)) {
        classifications[parseInt(idx)] = category;
      }
    } catch (err) {
      console.error(`Batch failed:`, err);
    }

    // Rate limit buffer
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Write classified CSV
  const csvHeader = 'task_name;contract_name;category;list_type;points;time_spent_hours;date_done;month';
  const csvRows = tasks.map((t, i) => {
    const timeHours = t.time_spent ? (parseInt(t.time_spent) / 3600000).toFixed(1) : '';
    const month = t.date_done ? t.date_done.substring(0, 7) : '';
    return `${t.task_name};${t.contract_name};${classifications[i]};${t.list_type};${t.points};${timeHours};${t.date_done};${month}`;
  });
  writeFileSync(OUTPUT_CSV, [csvHeader, ...csvRows].join('\n'));
  console.log(`\nClassified CSV written to ${OUTPUT_CSV}`);

  // Generate summary report
  const catCounts: Record<string, number> = {};
  const catPoints: Record<string, number> = {};
  const catByMonth: Record<string, Record<string, number>> = {};
  const catByContract: Record<string, Record<string, number>> = {};

  for (let i = 0; i < tasks.length; i++) {
    const cat = classifications[i];
    const points = parseFloat(tasks[i].points) || 0;
    const month = tasks[i].date_done ? tasks[i].date_done.substring(0, 7) : 'unknown';
    const contract = tasks[i].contract_name || 'Unknown';

    catCounts[cat] = (catCounts[cat] || 0) + 1;
    catPoints[cat] = (catPoints[cat] || 0) + points;

    if (!catByMonth[cat]) catByMonth[cat] = {};
    catByMonth[cat][month] = (catByMonth[cat][month] || 0) + 1;

    if (!catByContract[cat]) catByContract[cat] = {};
    catByContract[cat][contract] = (catByContract[cat][contract] || 0) + 1;
  }

  const totalTasks = tasks.length;
  const totalPoints = Object.values(catPoints).reduce((a, b) => a + b, 0);

  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);

  let report = `# Q1 2026 Task Analysis Report\n\n`;
  report += `**Period:** January 1 — March 31, 2026\n`;
  report += `**Total Tasks:** ${totalTasks}\n`;
  report += `**Total Points:** ${totalPoints}\n\n`;

  report += `## Task Distribution by Category\n\n`;
  report += `| Category | Tasks | % of Total | Points | % of Points |\n`;
  report += `|---|---|---|---|---|\n`;
  for (const [cat, count] of sortedCats) {
    const pct = ((count / totalTasks) * 100).toFixed(1);
    const pts = catPoints[cat] || 0;
    const ptsPct = totalPoints > 0 ? ((pts / totalPoints) * 100).toFixed(1) : '0.0';
    report += `| ${cat} | ${count} | ${pct}% | ${pts} | ${ptsPct}% |\n`;
  }

  report += `\n## Monthly Trends\n\n`;
  const months = ['2026-01', '2026-02', '2026-03'];
  report += `| Category | Jan | Feb | Mar | Trend |\n`;
  report += `|---|---|---|---|---|\n`;
  for (const [cat] of sortedCats) {
    const jan = catByMonth[cat]?.['2026-01'] || 0;
    const feb = catByMonth[cat]?.['2026-02'] || 0;
    const mar = catByMonth[cat]?.['2026-03'] || 0;
    const trend = mar > jan ? '↑' : mar < jan ? '↓' : '→';
    report += `| ${cat} | ${jan} | ${feb} | ${mar} | ${trend} |\n`;
  }

  report += `\n## Top Contracts by Task Volume\n\n`;
  const contractTotals: Record<string, number> = {};
  for (const t of tasks) {
    const name = t.contract_name || 'Unknown';
    contractTotals[name] = (contractTotals[name] || 0) + 1;
  }
  const topContracts = Object.entries(contractTotals).sort((a, b) => b[1] - a[1]).slice(0, 15);
  report += `| Contract | Tasks | Top Categories |\n`;
  report += `|---|---|---|\n`;
  for (const [contract, count] of topContracts) {
    // Find top 3 categories for this contract
    const contractCats: Record<string, number> = {};
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].contract_name === contract) {
        contractCats[classifications[i]] = (contractCats[classifications[i]] || 0) + 1;
      }
    }
    const top3 = Object.entries(contractCats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n})`).join(', ');
    report += `| ${contract} | ${count} | ${top3} |\n`;
  }

  report += `\n## Category Details\n\n`;
  for (const [cat] of sortedCats) {
    report += `### ${cat} (${catCounts[cat]} tasks, ${catPoints[cat] || 0} points)\n\n`;
    // Sample task names
    const sampleTasks = tasks
      .map((t, i) => ({ name: t.task_name, cat: classifications[i] }))
      .filter(t => t.cat === cat)
      .slice(0, 10);
    report += `Sample tasks:\n`;
    for (const t of sampleTasks) {
      report += `- ${t.name}\n`;
    }
    report += `\n`;
  }

  writeFileSync(OUTPUT_REPORT, report);
  console.log(`Report written to ${OUTPUT_REPORT}`);
}

main().catch(console.error);
