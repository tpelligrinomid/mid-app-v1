// Compares per-table row counts in the pg_dump export with exact counts in the
// new database (public schema plus auth.users / auth.identities).
//
// Usage:
//   NEW_DB=postgresql://... PGBIN=<postgres bin dir> \
//   node scripts/migration/row-counts.mjs <export.backup>

import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

const { NEW_DB, PGBIN = "" } = process.env;
const dump = process.argv[2];
if (!NEW_DB || !dump) {
  console.error("Set NEW_DB and pass the export path.");
  process.exit(1);
}
const bin = (name) => (PGBIN ? path.join(PGBIN, name) : name);

async function exportCounts() {
  const proc = spawn(bin("pg_restore"), ["-a", "-n", "public", "-n", "auth", "-f", "-", dump]);
  proc.stderr.pipe(process.stderr);
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const counts = new Map();
  let table = null;
  for await (const line of rl) {
    if (!table) {
      const m = line.match(/^COPY ([\w."]+) /);
      if (m) {
        table = m[1].replace(/"/g, "");
        counts.set(table, 0);
      }
      continue;
    }
    if (line === "\\.") table = null;
    else counts.set(table, counts.get(table) + 1);
  }
  return counts;
}

const counts = await exportCounts();
const wanted = [...counts.keys()].filter(
  (t) => t.startsWith("public.") || t === "auth.users" || t === "auth.identities",
);

const sql = wanted.map((t) => `select '${t}', count(*) from ${t}`).join("\nunion all\n");
const out = execFileSync(bin("psql"), [NEW_DB, "-At", "-F", "\t", "-c", sql], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const actual = new Map(out.trim().split("\n").map((l) => {
  const [t, n] = l.split("\t");
  return [t, Number(n)];
}));

let mismatches = 0;
for (const t of wanted.sort()) {
  const expected = counts.get(t);
  const got = actual.get(t);
  const ok = expected === got;
  if (!ok) mismatches++;
  console.log(`${ok ? "ok  " : "DIFF"}  ${t.padEnd(50)} export=${expected}  new=${got}`);
}
console.log(mismatches ? `\n${mismatches} table(s) differ` : `\nAll ${wanted.length} tables match`);
process.exit(mismatches ? 1 : 0);
