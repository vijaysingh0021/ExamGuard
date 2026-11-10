import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "./lib/api";
import { readPagination } from "./lib/pagination";
import { Alert, Button, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui";

type Entry = { id: string; action: string; targetType: string; at: string; by: string };
const PREFIXES = ["attempt.", "exam.", "grade.", "reports.", "organization.", "evidence.", "assistant.", "companion.", "job."];
const readable = (a: string) => a.replaceAll(".", " · ").replaceAll("_", " ");

/** Organization audit trail for administrators. Who did what and when; free-form details are deliberately not shown. */
export function AuditPage({ organizationId }: { organizationId: string }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const action = params.get("action") ?? ""; const from = params.get("from") ?? ""; const to = params.get("to") ?? "";
  const [actionText, setActionText] = useState(action);
  const rangeInvalid = !!from && !!to && from > to;
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); setParams(n, { replace: true }); };
  const q = useQuery({
    queryKey: ["audit", organizationId, page, action, from, to], enabled: !rangeInvalid, placeholderData: (p) => p,
    queryFn: async () => { const r = await api.get<Entry[]>(`/api/organizations/${organizationId}/audit-logs`, { params: { page, pageSize: 50, ...(action ? { action } : {}), ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) } }); return { rows: r.data, pagination: readPagination(r) }; },
  });
  return (
    <div className="space-y-5">
      <div><h2 className="text-xl font-semibold tracking-tight">Audit log</h2><p className="mt-1 text-sm text-stone-500">A record of administrative, grading and review actions in this organization. Entries can't be edited from the app.</p></div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); set("action", actionText.trim()); }} aria-label="Filter audit log">
        <label className="text-sm">Action starts with<Input list="audit-prefixes" value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder="e.g. grade." maxLength={60} className="mt-1 w-48" /><datalist id="audit-prefixes">{PREFIXES.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label className="text-sm">From<Input type="date" value={from} onChange={(e) => set("from", e.target.value)} className="mt-1" /></label>
        <label className="text-sm">To<Input type="date" value={to} onChange={(e) => set("to", e.target.value)} className="mt-1" /></label>
        <Button type="submit" variant="outline">Apply</Button>
        {(action || from || to) && <Button type="button" variant="ghost" onClick={() => { setActionText(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear</Button>}
      </form>
      {rangeInvalid && <Alert variant="destructive">“From” must not be after “To”.</Alert>}
      {q.isError ? <Alert variant="destructive">The audit log couldn't be loaded. <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button></Alert> : !q.data ? (rangeInvalid ? null : <Skeleton className="h-48" />) : q.data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{action || from || to ? "No entries match these filters." : "No audit entries yet."}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white" aria-busy={q.isFetching}>
          <Table><caption className="sr-only">Audit log entries</caption>
            <TableHeader><TableRow><TableHead scope="col">When</TableHead><TableHead scope="col">Who</TableHead><TableHead scope="col">Action</TableHead><TableHead scope="col">Target</TableHead></TableRow></TableHeader>
            <TableBody>{q.data.rows.map((r) => <TableRow key={r.id}><TableCell className="whitespace-nowrap text-stone-500">{new Date(r.at).toLocaleString()}</TableCell><TableCell>{r.by}</TableCell><TableCell className="font-medium">{readable(r.action)}</TableCell><TableCell className="text-stone-500">{r.targetType}</TableCell></TableRow>)}</TableBody></Table>
          {q.data.pagination && q.data.pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between border-t border-stone-200 px-4 py-3 text-sm" aria-label="Pagination"><span className="text-stone-500">Page {q.data.pagination.page} of {q.data.pagination.totalPages}</span>
              <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={page >= q.data.pagination.totalPages} onClick={() => set("page", String(page + 1))}>Next</Button></span></nav>)}
        </div>)}
    </div>
  );
}
