// Static drift check: do the SQL migrations (applied in order, textually) create every table and column the Prisma schema declares?
// This is NOT a substitute for `prisma migrate diff` against a real, isolated database; it needs no database or dependencies.
// Usage: node scripts/check-migrations.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma');
const schema = readFileSync(join(root, 'schema.prisma'), 'utf8');
const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map(m => m[1]));
const modelNames = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map(m => m[1]));
const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);

const expected = new Map(); // table -> Set(columns)
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  const body = m[2]; const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1]; const cols = new Set();
  for (const line of body.split('\n')) {
    const f = line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/); if (!f || line.trim().startsWith('@@') || line.trim().startsWith('//')) continue;
    const [, name, type, list, , rest] = f;
    if (modelNames.has(type)) continue; // relation field (no column)
    if (list && !SCALARS.has(type) && !enums.has(type)) continue;
    cols.add(rest.match(/@map\("([^"]+)"\)/)?.[1] ?? name);
  }
  expected.set(table, cols);
}

const actual = new Map();
const dirs = readdirSync(join(root, 'migrations'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
for (const d of dirs) {
  const sql = readFileSync(join(root, 'migrations', d, 'migration.sql'), 'utf8');
  for (const m of sql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
    const cols = new Set(); for (const line of m[2].split('\n')) { const c = line.match(/^\s*"(\w+)"\s+"?[A-Za-z]/); if (c) cols.add(c[1]); } actual.set(m[1], cols);
  }
  for (const m of sql.matchAll(/ALTER TABLE "(\w+)"([\s\S]*?);/g)) {
    for (const a of m[2].matchAll(/ADD COLUMN\s+"(\w+)"/g)) actual.get(m[1])?.add(a[1]);
    for (const a of m[2].matchAll(/DROP COLUMN\s+"(\w+)"/g)) actual.get(m[1])?.delete(a[1]);
    for (const a of m[2].matchAll(/RENAME COLUMN\s+"(\w+)"\s+TO\s+"(\w+)"/g)) { actual.get(m[1])?.delete(a[1]); actual.get(m[1])?.add(a[2]); }
  }
  for (const m of sql.matchAll(/DROP TABLE (?:IF EXISTS )?"(\w+)"/g)) actual.delete(m[1]);
  for (const m of sql.matchAll(/ALTER TABLE "(\w+)" RENAME TO "(\w+)"/g)) { actual.set(m[2], actual.get(m[1]) ?? new Set()); actual.delete(m[1]); }
}

const problems = [];
for (const [t, cols] of expected) {
  if (!actual.has(t)) { problems.push(`schema table "${t}" is not created by any migration`); continue; }
  for (const c of cols) if (!actual.get(t).has(c)) problems.push(`"${t}"."${c}" is in the schema but no migration creates it`);
}
for (const t of actual.keys()) if (!expected.has(t) && !t.startsWith('_')) problems.push(`migrations create table "${t}" that the schema no longer declares`);
for (const [t, cols] of actual) for (const c of cols) if (expected.get(t) && !expected.get(t).has(c)) problems.push(`"${t}"."${c}" exists in migrations but not in the schema`);
console.log(`models: ${expected.size}, migrated tables: ${actual.size}, migrations: ${dirs.length}`);
if (problems.length) { console.error(problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('Schema and migrations agree on tables and columns (static check only).');
