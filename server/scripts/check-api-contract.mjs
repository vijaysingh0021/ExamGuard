// Static client/server API contract check (no dependencies, no database).
// Every `api.<verb>(...)` call in client/src must match an Express route registered in server/src by METHOD and path shape.
// It cannot check request/response bodies, authorization or runtime behaviour. Usage: node scripts/check-api-contract.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const relativePath = (file) => relative(root, file).split(sep).join('/');
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f.startsWith('.')) continue; const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : /\.(ts|tsx)$/.test(f) && out.push(p); } return out; };
const segs = (p) => p.split('?')[0].replace(/\$\{[^}]*\}/g, ':p').split('/').filter(Boolean);

const routes = [];
for (const f of walk(join(root, 'server', 'src'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`]*)\2/g)) routes.push({ method: m[1], segs: segs(m[3]), raw: m[3], file: relativePath(f).split('/').pop() });
}
const calls = []; const unresolved = [];
for (const f of walk(join(root, 'client', 'src'))) {
  if (relativePath(f).startsWith('client/src/test/')) continue;
  const src = readFileSync(f, 'utf8');
  // Resolve `const base = \`/api/...${other}\`` style constants declared in the same file.
  const consts = {};
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")\s*;/g)) consts[m[1]] = m[2].slice(1, -1);
  const literalUnions = {};
  for (const m of src.matchAll(/\b(\w+)\s*:\s*(['"][^'"]+['"](?:\s*\|\s*['"][^'"]+['"])+)/g)) {
    literalUnions[m[1]] = [...m[2].matchAll(/(['"])(.*?)\1/g)].map(value => value[2]);
  }
  const expand = (template) => {
    let paths = [template];
    const expressions = [...new Set([...template.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1].trim()))];
    for (const expression of expressions) {
      const options = expression in consts ? [consts[expression]] : literalUnions[expression] ?? [':p'];
      paths = paths.flatMap(path => options.map(value => path.replaceAll(`\${${expression}}`, value)));
    }
    return paths.map(path => path.replace(/\$\{[^}]*\}/g, ':p'));
  };
  for (const m of src.matchAll(/\bapi\.(get|post|put|patch|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_]\w*)/g)) {
    let raw = /^[`'"]/.test(m[2]) ? m[2].slice(1, -1) : consts[m[2]];
    if (raw === undefined) { unresolved.push(`${relativePath(f).split('/').pop()}: api.${m[1]}(${m[2]})`); continue; }
    const expandedPaths = expand(raw);
    for (const path of expandedPaths) {
      if (!path.startsWith('/api')) { unresolved.push(`${relativePath(f).split('/').pop()}: api.${m[1]}(${path})`); continue; }
      calls.push({ method: m[1], segs: segs(path), raw: path, file: relativePath(f).split('/').pop() });
    }
  }
}
const matches = (c, r) => c.method === r.method && c.segs.length === r.segs.length && c.segs.every((s, i) => s === r.segs[i] || r.segs[i].startsWith(':') || (s === ':p' && r.segs[i].startsWith(':')));
const missing = calls.filter((c) => !routes.some((r) => matches(c, r)));
const byVerb = (c) => routes.filter((r) => r.segs.length === c.segs.length && c.segs.every((s, i) => s === r.segs[i] || r.segs[i].startsWith(':'))).map((r) => r.method);
console.log(`server routes: ${routes.length}, client calls checked: ${calls.length}`);
if (unresolved.length) { console.error('Not checked (URL not statically resolvable):\n' + unresolved.map((u) => ' - ' + u).join('\n')); }
if (missing.length) {
  for (const c of missing) { const alt = byVerb(c); console.error(` - ${c.file}: ${c.method.toUpperCase()} ${c.raw}${alt.length ? `  (server has this path for: ${alt.join(', ').toUpperCase()})` : '  (no such server path)'}`); }
  process.exit(1);
}
console.log('Every client API call matches a registered server route by method and path shape.');
