// Regenerates src/assistant/articles.generated.ts from the shared markdown knowledge base.
// Usage: node scripts/sync-assistant-kb.mjs [--check]   (--check exits 1 if the generated file is stale)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'ai-service', 'assistant', 'knowledge');
const target = join(here, '..', 'src', 'assistant', 'articles.generated.ts');
const docs = readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(file => {
  const [, front, ...rest] = readFileSync(join(dir, file), 'utf8').split('---');
  const meta = Object.fromEntries(front.trim().split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  return { id: meta.id, title: meta.title, audience: meta.audience.split(',').map(a => a.trim()), body: rest.join('---').trim() };
});
const out = '// GENERATED from ai-service/assistant/knowledge/*.md by `node scripts/sync-assistant-kb.mjs`. Do not edit by hand.\nexport interface Article { id: string; title: string; audience: string[]; body: string }\nexport const articles: Article[] = ' + JSON.stringify(docs, null, 2) + ';\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== out) { console.error('articles.generated.ts is stale; run node scripts/sync-assistant-kb.mjs'); process.exit(1); }
  console.log('articles.generated.ts is up to date');
} else { writeFileSync(target, out); console.log(`wrote ${docs.length} articles`); }
