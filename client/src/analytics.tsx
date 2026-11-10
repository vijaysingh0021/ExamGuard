import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "./lib/api";
import { Alert, Button, Card, CardContent, CardTitle, Skeleton } from "./components/ui";

type Analytics = {
  generatedAt: string; truncated: boolean; notes: string[];
  participation: { assigned: number; started: number; notStarted: number; inProgress: number; submitted: number; closedAtDeadline: number; terminated: number; completionRate: number };
  durations: { samples: number; averageMinutes: number | null; medianMinutes: number | null; minMinutes: number | null; maxMinutes: number | null };
  scores: { graded: number; pendingManual: number; averagePercent: number | null; medianPercent: number | null; distribution: Array<{ from: number; to: number; count: number }> };
  incidents: Record<string, number>;
  questions: Array<{ questionId: string; position: number | null; type: string; prompt: string; answered: number; skipped: number; correct: number; correctRate: number | null }> | null;
  operations: { evidenceItems: number | null; jobs: Record<string, number> } | null;
};
type ExamOption = { id: string; title: string };

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const mins = (v: number | null) => (v == null ? "—" : `${v} min`);
const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-xl border border-stone-200 p-4"><dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt><dd className="mt-1 text-2xl font-semibold text-stone-950">{value}</dd>{hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}</div>
);

/** Filterable analytics for administrators and teachers. Every number comes from GET /reports/analytics. */
export function AnalyticsPanel({ organizationId }: { organizationId: string }) {
  const [examId, setExamId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const base = `/api/organizations/${organizationId}`;
  const exams = useQuery({ queryKey: ["analytics-exams", organizationId], queryFn: async () => (await api.get<ExamOption[]>(`${base}/exams`)).data });
  const rangeInvalid = !!from && !!to && from > to;
  const q = useQuery({
    queryKey: ["analytics", organizationId, examId, from, to], enabled: !rangeInvalid,
    queryFn: async () => (await api.get<Analytics>(`${base}/reports/analytics`, { params: { ...(examId ? { examId } : {}), ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) } })).data,
    placeholderData: (previous) => previous,
  });
  const d = q.data;
  return (
    <section aria-labelledby="analytics-title" className="mt-8">
      <h3 id="analytics-title" className="text-lg font-semibold">Analytics</h3>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()} aria-label="Analytics filters">
        <label className="text-sm">Examination<select value={examId} onChange={(e) => setExamId(e.target.value)} className="mt-1 block min-w-48 rounded-lg border border-stone-300 px-3 py-2 text-sm"><option value="">All examinations</option>{(exams.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
        <label className="text-sm">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-stone-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-stone-300 px-3 py-2 text-sm" /></label>
        {(examId || from || to) && <Button type="button" variant="outline" size="sm" onClick={() => { setExamId(""); setFrom(""); setTo(""); }}>Clear filters</Button>}
      </form>
      {rangeInvalid && <Alert variant="destructive" className="mt-3">“From” must not be after “To”.</Alert>}
      {q.isError && <Alert variant="destructive" className="mt-3">Analytics couldn't be loaded. <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button></Alert>}
      {!d && !q.isError && !rangeInvalid && <div className="mt-4 grid gap-3 sm:grid-cols-4" aria-busy="true" aria-label="Loading analytics">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {d && (
        <div className="mt-4 space-y-4" aria-busy={q.isFetching}>
          {d.participation.assigned === 0 && d.participation.started === 0 && <Alert>No candidates are assigned and no attempts exist for this selection yet. Assign candidates to an exam to see participation here.</Alert>}
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Completion" value={`${Math.round(d.participation.completionRate * 100)}%`} hint={`${d.participation.submitted + d.participation.closedAtDeadline} of ${d.participation.assigned} assigned finished`} />
            <Tile label="Not started" value={String(d.participation.notStarted)} hint={`${d.participation.inProgress} in progress`} />
            <Tile label="Average score" value={pct(d.scores.averagePercent)} hint={`${d.scores.graded} graded · ${d.scores.pendingManual} awaiting manual marks`} />
            <Tile label="Median time taken" value={mins(d.durations.medianMinutes)} hint={d.durations.samples ? `${d.durations.samples} finished attempts` : "No finished attempts"} />
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardContent>
              <CardTitle>Score distribution</CardTitle>
              {d.scores.graded === 0 ? <p className="mt-3 text-sm text-stone-500">No graded results yet.</p> : (
                <div className="mt-3 h-56" role="img" aria-label={`Score distribution of ${d.scores.graded} graded results`}><ResponsiveContainer width="100%" height="100%"><BarChart data={d.scores.distribution.map((b) => ({ range: `${b.from}–${b.to}`, count: b.count }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="range" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#44403c" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              )}
            </CardContent></Card>
            <Card><CardContent>
              <CardTitle>Submissions and incidents</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {[["Submitted by candidate", d.participation.submitted], ["Closed at deadline", d.participation.closedAtDeadline], ["Terminated", d.participation.terminated]].map(([k, v]) => <div key={String(k)} className="flex justify-between rounded-lg bg-stone-50 px-3 py-2"><dt>{k}</dt><dd className="font-semibold">{v}</dd></div>)}
              </dl>
              <h4 className="mt-4 text-sm font-semibold">Incident review status</h4>
              {Object.keys(d.incidents).length === 0 ? <p className="mt-1 text-sm text-stone-500">No incidents in this selection.</p> : <ul className="mt-1 text-sm">{Object.entries(d.incidents).map(([k, v]) => <li key={k} className="flex justify-between border-b border-stone-100 py-1"><span>{k.replaceAll("_", " ")}</span><b>{v}</b></li>)}</ul>}
              <p className="mt-3 text-xs text-stone-500">Incidents are review items, not findings of misconduct.</p>
            </CardContent></Card>
          </div>
          {d.questions ? (
            <Card><CardContent>
              <CardTitle>Question performance</CardTitle>
              {d.questions.length === 0 ? <p className="mt-3 text-sm text-stone-500">No auto-gradable questions with answer keys in this exam.</p> : (
                <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Correct-answer rate per question</caption><thead className="border-b text-stone-500"><tr><th scope="col" className="pb-2">#</th><th scope="col" className="pb-2">Question</th><th scope="col" className="pb-2">Answered</th><th scope="col" className="pb-2">Skipped</th><th scope="col" className="pb-2">Correct</th></tr></thead>
                  <tbody>{d.questions.map((r, i) => <tr key={r.questionId} className="border-b border-stone-100"><td className="py-2 pr-2">{r.position ?? i + 1}</td><td className="py-2 pr-2">{r.prompt}</td><td className="py-2 pr-2">{r.answered}</td><td className="py-2 pr-2">{r.skipped}</td><td className="py-2 font-medium">{r.correctRate == null ? "—" : `${Math.round(r.correctRate * 100)}%`}</td></tr>)}</tbody></table></div>
              )}
            </CardContent></Card>
          ) : <p className="text-sm text-stone-500">Select an examination to see question-level performance.</p>}
          {d.operations && <p className="text-sm text-stone-600">Evidence items stored: <b>{d.operations.evidenceItems ?? 0}</b> · Background jobs failed: <b>{d.operations.jobs.dead ?? 0}</b> (details on Operations).</p>}
          {d.truncated && <Alert>Results were capped for performance; narrow the date range for exact figures.</Alert>}
          <p className="text-xs text-stone-500">Generated {new Date(d.generatedAt).toLocaleString()}. {d.notes.join(" ")}</p>
        </div>
      )}
    </section>
  );
}
