// Copies storage files from the old Lovable Cloud project to the new Supabase
// project. Object names come from storage.objects in the pg_dump export; files
// are downloaded from the old public URLs (all buckets are public) and uploaded
// to the new project with the service-role key. Creates missing buckets.
// Safe to re-run: uploads use upsert, so a second run copies the delta.
//
// Usage:
//   OLD_URL=https://<old-ref>.supabase.co NEW_URL=https://<new-ref>.supabase.co \
//   NEW_SERVICE_KEY=... PG_RESTORE=<path to pg_restore> \
//   node scripts/migration/copy-storage.mjs <export.backup>

import { spawn } from "node:child_process";
import readline from "node:readline";

const BUCKETS = {
  "content-assets": { public: true },
  "deliverable-uploads": { public: true, file_size_limit: 20 * 1024 * 1024 },
  "deliverable-images": { public: true },
};

const { OLD_URL, NEW_URL, NEW_SERVICE_KEY, PG_RESTORE = "pg_restore" } = process.env;
const dump = process.argv[2];
if (!OLD_URL || !NEW_URL || !NEW_SERVICE_KEY || !dump) {
  console.error("Set OLD_URL, NEW_URL, NEW_SERVICE_KEY and pass the export path.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${NEW_SERVICE_KEY}`, apikey: NEW_SERVICE_KEY };

// COPY text format escapes backslash, tab, newline and carriage return.
function unescapeCopy(value) {
  if (value === "\\N") return null;
  return value.replace(/\\(.)/g, (_, c) => ({ t: "\t", n: "\n", r: "\r", "\\": "\\" })[c] ?? c);
}

async function readObjects() {
  const proc = spawn(PG_RESTORE, ["-a", "-n", "storage", "-t", "objects", "-f", "-", dump]);
  proc.stderr.pipe(process.stderr);
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  const objects = [];
  let columns = null;
  for await (const line of rl) {
    if (!columns) {
      const m = line.match(/^COPY storage\.objects \((.+)\) FROM stdin;$/);
      if (m) columns = m[1].split(", ").map((c) => c.replace(/"/g, ""));
      continue;
    }
    if (line === "\\.") break;
    const fields = line.split("\t").map(unescapeCopy);
    const row = Object.fromEntries(columns.map((c, i) => [c, fields[i]]));
    if (!BUCKETS[row.bucket_id] || !row.name) continue;
    let mimetype = null;
    try {
      mimetype = row.metadata ? JSON.parse(row.metadata).mimetype ?? null : null;
    } catch {
      // leave mimetype unset
    }
    objects.push({ bucket: row.bucket_id, name: row.name, mimetype });
  }
  if (!columns) throw new Error("storage.objects not found in the export");
  return objects;
}

async function ensureBuckets() {
  const res = await fetch(`${NEW_URL}/storage/v1/bucket`, { headers: auth });
  if (!res.ok) throw new Error(`list buckets: ${res.status} ${await res.text()}`);
  const existing = new Set((await res.json()).map((b) => b.id));
  for (const [id, opts] of Object.entries(BUCKETS)) {
    if (existing.has(id)) continue;
    const create = await fetch(`${NEW_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: id, ...opts }),
    });
    if (!create.ok) throw new Error(`create bucket ${id}: ${create.status} ${await create.text()}`);
    console.log(`created bucket ${id}`);
  }
}

const encodePath = (name) => name.split("/").map(encodeURIComponent).join("/");

async function copy({ bucket, name, mimetype }) {
  const path = `${bucket}/${encodePath(name)}`;
  const src = await fetch(`${OLD_URL}/storage/v1/object/public/${path}`);
  if (!src.ok) return `download ${src.status}`;
  const body = Buffer.from(await src.arrayBuffer());
  const dst = await fetch(`${NEW_URL}/storage/v1/object/${path}`, {
    method: "POST",
    headers: {
      ...auth,
      "x-upsert": "true",
      "Content-Type": mimetype || src.headers.get("content-type") || "application/octet-stream",
    },
    body,
  });
  if (!dst.ok) return `upload ${dst.status} ${await dst.text()}`;
  return null;
}

const objects = await readObjects();
console.log(`${objects.length} objects in the export`);
await ensureBuckets();

const failures = [];
let done = 0;
const queue = [...objects];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let obj = queue.shift(); obj; obj = queue.shift()) {
      const err = await copy(obj).catch((e) => String(e));
      if (err) failures.push({ ...obj, err });
      if (++done % 25 === 0) console.log(`${done}/${objects.length}`);
    }
  }),
);

console.log(`copied ${objects.length - failures.length}/${objects.length}`);
for (const f of failures) console.log(`FAILED ${f.bucket}/${f.name}: ${f.err}`);
process.exit(failures.length ? 1 : 0);
