import { articles as defaultArticles, type Article } from './articles.generated.js';

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'is', 'it', 'for', 'on', 'you', 'your', 'i', 'my', 'can', 'how', 'do', 'what', 'with', 'if', 'are']);
const tokens = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !STOP.has(t));
/** Reviewers read the teacher-facing help. */
export const audienceFor = (role: string) => (role === 'reviewer' ? 'teacher' : role);

/** Only articles whose audience includes the caller's role are ever scored (no cross-role leakage). */
export function searchArticles(query: string, role: string, limit = 3, docs: Article[] = defaultArticles): Array<{ article: Article; score: number }> {
  const audience = audienceFor(role);
  const visible = docs.filter(d => d.audience.includes(audience));
  const q = [...new Set(tokens(query))];
  if (!q.length || !visible.length) return [];
  const bags = new Map(visible.map(d => [d.id, tokens(`${d.title} ${d.body}`)]));
  const df = new Map(q.map(t => [t, visible.filter(d => bags.get(d.id)!.includes(t)).length]));
  return visible.map(article => {
    const toks = bags.get(article.id)!;
    const score = toks.length ? q.reduce((s, t) => { const c = toks.filter(x => x === t).length; return c ? s + (c / toks.length) * (1 + Math.log((1 + visible.length) / (1 + df.get(t)!))) : s; }, 0) : 0;
    return { article, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
