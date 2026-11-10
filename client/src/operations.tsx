import { useQuery } from "@tanstack/react-query";
import { Activity, HardDrive, LifeBuoy } from "lucide-react";
import { api } from "./lib/api";
import { Alert, Badge, Button, Card, CardContent, CardTitle, Skeleton } from "./components/ui";
import { modeLabel } from "./lib/assistant-client";

type Jobs = { counts: Record<string, number>; recentProblems: Array<{ id: string; type: string; status: string; attempts: number; maxAttempts: number; updatedAt: string; lastError: string | null }>; lastSuccess: Record<string, string>; email: { configured: boolean; counts: Record<string, number>; recentFailures: Array<{ id: string; template: string; attempts: number; updatedAt: string; lastError: string | null }> }; retentionDays: number | null };
type Storage = { storageConfigured: boolean; trackedObjects: number; bytesUsed: number; quotaBytes: number | null; quotaStatus: "unlimited" | "ok" | "warning" | "full"; percentUsed: number | null; evidenceItems: number; oldestEvidenceAt: string | null; retentionDays: number | null; itemsPastRetention: number | null; bytesNote: string; autoDeletes: boolean };
type Status = { mode: "ai_assisted" | "help_center" };

const SWEEP_LABELS: Record<string, string> = {
  "sweep.attempt_deadlines": "Close attempts at deadline", "sweep.exam_lifecycle": "Advance exam status",
  "sweep.exam_reminders": "Send exam reminders", "sweep.review_reminders": "Remind about pending reviews", "sweep.email_fanout": "Queue notification emails", "sweep.email_send": "Send queued emails", "sweep.retention": "Housekeeping and retention check",
};
const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "Never");

/** Administrator view of real operational state. Every figure comes from the API; nothing is sample data. */
export function OperationsPage({ organizationId }: { organizationId: string }) {
  const base = `/api/organizations/${organizationId}`;
  const jobs = useQuery({ queryKey: ["ops-jobs", organizationId], queryFn: async () => (await api.get<Jobs>(`${base}/operations/jobs`)).data, refetchInterval: 30_000 });
  const storage = useQuery({ queryKey: ["ops-storage", organizationId], queryFn: async () => (await api.get<Storage>(`${base}/operations/storage`)).data });
  const assistant = useQuery({ queryKey: ["ops-assistant", organizationId], queryFn: async () => (await api.get<Status>(`${base}/assistant/status`)).data });

  if (jobs.isError || storage.isError) return <Alert variant="destructive">Operational data couldn't be loaded. <Button variant="outline" size="sm" onClick={() => { void jobs.refetch(); void storage.refetch(); }}>Retry</Button></Alert>;
  if (!jobs.data || !storage.data) return <div className="space-y-4" aria-busy="true" aria-label="Loading operations"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  const j = jobs.data, s = storage.data;
  const dead = j.counts.dead ?? 0;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2"><CardContent>
        <div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><Activity size={18} aria-hidden="true" /> Automation</CardTitle><Badge variant={dead ? "danger" : "success"}>{dead ? `${dead} failed` : "Healthy"}</Badge></div>
        <p className="mt-1 text-sm text-stone-600">Durable background jobs close attempts at their deadline, advance exam status, send reminders and run retention checks. Jobs survive restarts and retry with backoff.</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{(["queued", "running", "succeeded", "dead"] as const).map((k) => <div key={k} className="rounded-lg border border-stone-200 p-3"><dt className="text-xs uppercase tracking-wide text-stone-500">{k === "dead" ? "failed" : k}</dt><dd className="text-xl font-semibold">{j.counts[k] ?? 0}</dd></div>)}</dl>
        <h3 className="mt-5 text-sm font-semibold">Last successful run</h3>
        <ul className="mt-2 divide-y divide-stone-100 text-sm">{Object.entries(SWEEP_LABELS).map(([type, label]) => <li key={type} className="flex justify-between gap-3 py-2"><span>{label}</span><span className="text-stone-500">{when(j.lastSuccess[type])}</span></li>)}</ul>
        {j.recentProblems.length > 0 && (<><h3 className="mt-5 text-sm font-semibold">Recent problems</h3>
          <ul className="mt-2 space-y-2">{j.recentProblems.map((p) => <li key={p.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><b>{SWEEP_LABELS[p.type] ?? p.type}</b> · {p.status === "dead" ? "gave up" : "retrying"} after {p.attempts}/{p.maxAttempts} attempts · {when(p.updatedAt)}{p.lastError && <p className="mt-1 text-xs text-stone-700">{p.lastError}</p>}</li>)}</ul></>)}
      </CardContent></Card>
      <Card><CardContent>
        <div className="flex items-center justify-between gap-3"><CardTitle>Email delivery</CardTitle><Badge variant={j.email.configured ? "success" : "warning"}>{j.email.configured ? "Configured" : "Not configured"}</Badge></div>
        {!j.email.configured ? <p className="mt-3 text-sm text-stone-600">No email provider is configured, so nothing is queued or sent. Set EMAIL_PROVIDER, EMAIL_URL and EMAIL_FROM on the server to enable it.</p> : (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{(["queued", "sent", "failed", "expired", "suppressed"] as const).map((k) => <div key={k} className="flex justify-between rounded-lg bg-stone-50 px-3 py-2"><dt className="capitalize">{k}</dt><dd className="font-semibold">{j.email.counts[k] ?? 0}</dd></div>)}</dl>
        )}
        {j.email.recentFailures.length > 0 && <ul className="mt-3 space-y-2">{j.email.recentFailures.map((f) => <li key={f.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"><b>{f.template.replaceAll("_", " ")}</b> failed after {f.attempts} attempts · {when(f.updatedAt)}{f.lastError && <p className="mt-1 text-stone-700">{f.lastError}</p>}</li>)}</ul>}
      </CardContent></Card>
      <Card><CardContent>
        <CardTitle className="flex items-center gap-2"><HardDrive size={18} aria-hidden="true" /> Evidence storage</CardTitle>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><dt>Private storage</dt><dd><Badge variant={s.storageConfigured ? "success" : "warning"}>{s.storageConfigured ? "Configured" : "Not configured"}</Badge></dd></div>
          <div className="flex justify-between"><dt>Evidence items</dt><dd>{s.evidenceItems}</dd></div>
          <div className="flex justify-between"><dt>Tracked storage</dt><dd>{(s.bytesUsed / 1048576).toFixed(1)} MB{s.quotaBytes ? ` of ${Math.round(s.quotaBytes / 1048576)} MB` : ""}</dd></div>
          {s.quotaBytes && <div className="flex justify-between"><dt>Capacity</dt><dd><Badge variant={s.quotaStatus === "full" ? "danger" : s.quotaStatus === "warning" ? "warning" : "success"}>{s.quotaStatus === "full" ? "Full — new evidence is rejected" : s.quotaStatus === "warning" ? `${s.percentUsed}% used` : `${s.percentUsed}% used`}</Badge></dd></div>}
          <div className="flex justify-between"><dt>Oldest item</dt><dd>{when(s.oldestEvidenceAt)}</dd></div>
          <div className="flex justify-between"><dt>Retention period</dt><dd>{s.retentionDays ? `${s.retentionDays} days` : "Not set"}</dd></div>
          {s.retentionDays && <div className="flex justify-between"><dt>Past retention</dt><dd>{s.itemsPastRetention ?? 0}</dd></div>}
        </dl>
        <p className="mt-3 text-xs text-stone-500">{s.bytesNote} Evidence is never deleted automatically; items past retention are reported to administrators for a human decision.</p>
      </CardContent></Card>
      <Card><CardContent>
        <CardTitle className="flex items-center gap-2"><LifeBuoy size={18} aria-hidden="true" /> Assistant</CardTitle>
        <p className="mt-3 text-sm">{assistant.data ? <Badge variant={assistant.data.mode === "ai_assisted" ? "default" : "outline"}>{modeLabel(assistant.data.mode)}</Badge> : <Skeleton className="h-5 w-24" />}</p>
        <p className="mt-2 text-sm text-stone-600">{assistant.data?.mode === "ai_assisted" ? "A configured model phrases answers from help articles. Prompts are redacted first and refusals are decided by server-side policy." : "No model is configured. The assistant answers from the built-in help articles."}</p>
      </CardContent></Card>
    </div>
  );
}
