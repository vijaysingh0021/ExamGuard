// Static check: every named import from a relative module must be exported by that module (catches renamed/missing exports before a compile).
// Generated Prisma client imports are skipped. Usage: node scripts/check-imports.mjs [dir ...]  (defaults to server/src and client/src)
// Static import check: every named import from a RELATIVE module must be exported by that module; every lucide icon must be in a known list if provided.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const here = new URL('.', import.meta.url).pathname; const roots = process.argv.length > 2 ? process.argv.slice(2) : [join(here, '..', 'src'), join(here, '..', '..', 'client', 'src')]; const files = [];
for (const root of roots) (function walk(d){ for (const f of readdirSync(d)) { if (f==='node_modules'||f.startsWith('.')||f==='generated') continue; const p=join(d,f); statSync(p).isDirectory()?walk(p):/\.(ts|tsx)$/.test(f)&&files.push(p); } })(root);
const resolveMod = (from, spec) => { const base = resolve(dirname(from), spec.replace(/\.js$/, '')); for (const c of [base+'.ts', base+'.tsx', join(base,'index.ts'), join(base,'index.tsx'), base]) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
const exportsOf = (file, seen = new Set()) => {
  if (seen.has(file)) return new Set(); seen.add(file);
  const src = readFileSync(file, 'utf8'); const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+(\w+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) for (const n of m[1].split(',')) { const parts = n.trim().split(/\s+as\s+/); const nm = (parts[1] ?? parts[0]).replace(/^type\s+/, '').trim(); if (nm) out.add(nm); }
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) { const t = resolveMod(file, m[1]); if (t) for (const n of exportsOf(t, seen)) out.add(n); }
  if (/export\s+default/.test(src)) out.add('default');
  return out;
};
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](\.[^'"]*)['"]/g)) {
    const target = resolveMod(f, m[2]); if (!target && /generated\//.test(m[2])) continue; if (!target) { console.log(`UNRESOLVED ${f}: ${m[2]}`); bad++; continue; }
    if (/\.(css|json)$/.test(m[2])) continue;
    const ex = exportsOf(target);
    for (const raw of m[1].split(',')) { const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(); if (name && !ex.has(name)) { console.log(`MISSING export "${name}" in ${m[2]}  (imported by ${f})`); bad++; } }
  }
}
console.log(`checked ${files.length} files; problems: ${bad}`); process.exit(bad ? 1 : 0);
