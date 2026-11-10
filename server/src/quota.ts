/** Storage capacity protection. When full, new evidence is REJECTED; existing evidence is never deleted to make room. */
export type QuotaStatus = 'unlimited' | 'ok' | 'warning' | 'full';
export const parseQuotaBytes = (raw: string | undefined) => { const mb = Number(raw); return Number.isFinite(mb) && mb > 0 && mb <= 10_000_000 ? Math.floor(mb * 1024 * 1024) : undefined; };

export function evaluateQuota(o: { usedBytes: number; incomingBytes?: number; quotaBytes?: number; warnRatio?: number }) {
  const incoming = o.incomingBytes ?? 0;
  if (!o.quotaBytes) return { status: 'unlimited' as QuotaStatus, allowed: true, percentUsed: null as number | null };
  const percentUsed = Math.round((o.usedBytes / o.quotaBytes) * 1000) / 10;
  if (o.usedBytes + incoming > o.quotaBytes) return { status: 'full' as QuotaStatus, allowed: false, percentUsed };
  return { status: (o.usedBytes + incoming >= o.quotaBytes * (o.warnRatio ?? 0.8) ? 'warning' : 'ok') as QuotaStatus, allowed: true, percentUsed };
}
