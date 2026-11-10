import { useEffect, useState } from "react";
import axios from "axios";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Lock } from "lucide-react";
import { api } from "./lib/api";
import { readPagination } from "./lib/pagination";
import { ATTEMPT_STATUS_LABEL, GRADE_STATUS_LABEL, describeAnswer, formatScore, gradeActions, gradeTone, maxManualMarks, parseManualMarks, percent, sameAnswer, type GradeLite } from "./lib/grading-rules";
import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "./components/ui";

type StaffSession = { organization: { id: string; name: string }; role: string };
type SubmissionRow = { id: string; status: string; startedAt: string; submittedAt: string | null; receiptCode: string | null; candidate: { id: string; name: string }; grade: GradeLite | null };
type Summary = { assigned: number; attempts: Record<string, number>; grades: Record<string, number>; awaitingEvaluation: number };
type ReviewQuestion = { id: string; type: string; prompt: string; options: Array<{ id: string; text: string }> | null; marks: number; objective: boolean; correctAnswer: unknown; answer: unknown; position: number | null };
type Review = { attempt: { id: string; status: string; submittedAt: string | null; receiptCode: string | null; candidate: { id: string; name: string }; examTitle: string }; grade: (GradeLite & { feedback?: string | null }) | null; questions: ReviewQuestion[] };

const errorMessage = (e: unknown, fallback: string) => (axios.isAxiosError(e) ? e.response?.data?.error ?? fallback : fallback);
const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

/** Submission tracking for one exam. Filters and page live in the URL so a teacher can reload or share the view. */
export function SubmissionsPage({ session }: { session: StaffSession }) {
  const { examId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const status = params.get("status") ?? "";
  const search = params.get("search") ?? "";
  const [searchText, setSearchText] = useState(search);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
  const base = `/api/organizations/${session.organization.id}/exams/${examId}`;
  const qc = useQueryClient();
  const setParam = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); setParams(next, { replace: true }); };

  const exam = useQuery({ queryKey: ["exam", session.organization.id, examId], queryFn: async () => (await api.get<{ title: string }>(base)).data });
  const summary = useQuery({ queryKey: ["submissions-summary", examId], queryFn: async () => (await api.get<Summary>(`${base}/submissions/summary`)).data });
  const list = useQuery({
    queryKey: ["submissions", examId, page, status, search], placeholderData: (p) => p,
    queryFn: async () => { const r = await api.get<SubmissionRow[]>(`${base}/submissions`, { params: { page, pageSize: 25, ...(status ? { status } : {}), ...(search ? { search } : {}) } }); return { rows: r.data, pagination: readPagination(r) }; },
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["submissions", examId] }); void qc.invalidateQueries({ queryKey: ["submissions-summary", examId] }); };

  const rows = list.data?.rows ?? [];
  const unevaluated = rows.filter((r) => ["submitted", "expired"].includes(r.status) && !r.grade);
  const evaluateAll = async () => {
    setBulk({ done: 0, total: unevaluated.length, failed: 0 });
    let done = 0, failed = 0;
    for (const r of unevaluated) { // sequential: grading is cheap and this keeps server load predictable
      try { await api.post(`/api/organizations/${session.organization.id}/attempts/${r.id}/grade`); } catch { failed++; }
      done++; setBulk({ done, total: unevaluated.length, failed });
    }
    refresh();
  };

  const s = summary.data;
  const finished = (s?.attempts.submitted ?? 0) + (s?.attempts.expired ?? 0);
  const tiles: Array<[string, number | string]> = s ? [["Assigned", s.assigned], ["Started", Object.values(s.attempts).reduce((a, b) => a + b, 0)], ["Finished", finished], ["Awaiting evaluation", s.awaitingEvaluation], ["Needs marking", s.grades.pending_manual ?? 0], ["Ready to publish", s.grades.graded ?? 0], ["Published", s.grades.published ?? 0]] : [];

  return (
    <div className="space-y-5">
      <div><Link to="/app/exams" className="inline-flex items-center gap-1 text-sm font-medium text-stone-600 hover:text-stone-950"><ArrowLeft size={14} aria-hidden="true" /> Examinations</Link>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">Submissions{exam.data ? ` · ${exam.data.title}` : ""}</h2>
        <p className="mt-1 text-sm text-stone-500">Track who has finished, evaluate answers, mark descriptive questions, and publish results.</p></div>

      {summary.isError ? <Alert variant="destructive">Summary couldn't be loaded.</Alert> : !s ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{tiles.map(([k, v]) => <div key={k} className="rounded-xl border border-stone-200 bg-white p-3"><dt className="text-[11px] uppercase tracking-wide text-stone-500">{k}</dt><dd className="mt-1 text-2xl font-semibold">{v}</dd></div>)}</dl>
      )}

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setParam("search", searchText.trim()); }} aria-label="Filter submissions">
        <label className="text-sm">Status<Select value={status} onChange={(e) => setParam("status", e.target.value)} className="mt-1 min-w-44"><option value="">All</option>{Object.entries(ATTEMPT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label className="text-sm">Candidate<Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search by name" maxLength={100} className="mt-1 w-56" /></label>
        <Button type="submit" variant="outline">Search</Button>
        {(status || search) && <Button type="button" variant="ghost" onClick={() => { setSearchText(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear</Button>}
        {unevaluated.length > 0 && <Button type="button" className="ml-auto" disabled={!!bulk && bulk.done < bulk.total} onClick={() => void evaluateAll()}>Evaluate {unevaluated.length} on this page</Button>}
      </form>
      {bulk && <Alert variant={bulk.failed ? "warning" : "success"} role="status">{bulk.done < bulk.total ? `Evaluating ${bulk.done} of ${bulk.total}…` : `Evaluated ${bulk.total - bulk.failed} of ${bulk.total}.${bulk.failed ? ` ${bulk.failed} could not be evaluated; open them to see why.` : ""}`}</Alert>}

      {list.isError ? <Alert variant="destructive">Submissions couldn't be loaded. <Button variant="outline" size="sm" onClick={() => void list.refetch()}>Retry</Button></Alert> : !list.data ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{status || search ? "No submissions match these filters." : "Nobody has started this exam yet. Submissions appear here as candidates begin and finish."}</div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white">
          <Table><caption className="sr-only">Submissions for this examination</caption>
            <TableHeader><TableRow><TableHead scope="col">Candidate</TableHead><TableHead scope="col">Attempt</TableHead><TableHead scope="col">Submitted</TableHead><TableHead scope="col">Score</TableHead><TableHead scope="col">Result</TableHead><TableHead scope="col"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-stone-900">{r.candidate.name}</TableCell>
                <TableCell><Badge variant={r.status === "terminated" ? "danger" : r.status === "in_progress" || r.status === "paused" ? "warning" : "outline"}>{ATTEMPT_STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                <TableCell className="text-stone-500">{when(r.submittedAt)}</TableCell>
                <TableCell>{r.grade ? <>{formatScore(r.grade)} <span className="text-xs text-stone-400">({percent(r.grade.totalMarks, r.grade.maxMarks)}%)</span></> : "—"}</TableCell>
                <TableCell>{r.grade ? <Badge variant={gradeTone(r.grade.status)}>{GRADE_STATUS_LABEL[r.grade.status]}</Badge> : <span className="text-xs text-stone-400">{["submitted", "expired"].includes(r.status) ? "Not evaluated" : "—"}</span>}</TableCell>
                <TableCell className="text-right">{["submitted", "expired", "terminated"].includes(r.status) ? <Button size="sm" variant="outline" onClick={() => setReviewId(r.id)}>Review</Button> : null}</TableCell>
              </TableRow>))}</TableBody></Table>
          {list.data.pagination && list.data.pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between border-t border-stone-200 px-4 py-3 text-sm" aria-label="Pagination">
              <span className="text-stone-500">Page {list.data.pagination.page} of {list.data.pagination.totalPages} · {list.data.pagination.totalCount} submissions</span>
              <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={page >= list.data.pagination.totalPages} onClick={() => setParam("page", String(page + 1))}>Next</Button></span>
            </nav>)}
        </div>
      )}
      <AttemptReviewDialog session={session} attemptId={reviewId} onClose={() => setReviewId(null)} onChanged={refresh} />
    </div>
  );
}

/** One attempt: the candidate's answers, automatic and manual marks, re-grading and publishing. */
export function AttemptReviewDialog({ session, attemptId, onClose, onChanged }: { session: StaffSession; attemptId: string | null; onClose: () => void; onChanged: () => void }) {
  const orgBase = `/api/organizations/${session.organization.id}`;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["attempt-review", attemptId], enabled: !!attemptId, queryFn: async () => (await api.get<Review>(`${orgBase}/attempts/${attemptId}/review`)).data });
  const [marks, setMarks] = useState(""); const [feedback, setFeedback] = useState("");
  const [fieldError, setFieldError] = useState(""); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const grade = q.data?.grade ?? null;
  useEffect(() => { setMarks(grade && grade.status !== "pending_manual" ? String(grade.manualMarks) : ""); setFeedback(grade?.feedback ?? ""); setFieldError(""); setNotice(""); setError(""); setConfirmPublish(false); }, [attemptId, grade?.id, grade?.status]);

  const after = async (message: string) => { setNotice(message); setError(""); await qc.invalidateQueries({ queryKey: ["attempt-review", attemptId] }); onChanged(); };
  const evaluate = useMutation({ mutationFn: () => api.post(`${orgBase}/attempts/${attemptId}/grade`), onSuccess: () => after("Automatic grading complete."), onError: (e) => setError(errorMessage(e, "Automatic grading failed.")) });
  const saveMarks = useMutation({ mutationFn: (v: { manualMarks: number; feedback?: string }) => api.put(`${orgBase}/grades/${grade!.id}/manual`, v), onSuccess: () => after("Marks saved."), onError: (e) => setError(errorMessage(e, "Marks could not be saved.")) });
  const publish = useMutation({ mutationFn: () => api.post(`${orgBase}/grades/${grade!.id}/publish`), onSuccess: () => { setConfirmPublish(false); return after("Result published. The candidate has been notified."); }, onError: (e) => { setConfirmPublish(false); setError(errorMessage(e, "Result could not be published.")); } });

  const a = q.data ? gradeActions(q.data.attempt.status, grade) : null;
  const submitMarks = (e: React.FormEvent) => {
    e.preventDefault(); if (!grade) return;
    const parsed = parseManualMarks(marks, grade);
    if (!parsed.ok) { setFieldError(parsed.error); return; }
    setFieldError(""); saveMarks.mutate({ manualMarks: parsed.value, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) });
  };
  const busy = evaluate.isPending || saveMarks.isPending || publish.isPending;

  return (
    <Dialog open={!!attemptId} onOpenChange={(o) => { if (!o && !busy) onClose(); }} ariaLabel="Review attempt">
      <DialogContent className="w-[min(100vw-1.5rem,52rem)]">
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
        {q.isError && <Alert variant="destructive">This attempt couldn't be loaded. It may not be finished yet. <Button size="sm" variant="outline" onClick={onClose}>Close</Button></Alert>}
        {q.data && a && (<>
          <DialogHeader><div><DialogTitle>{q.data.attempt.candidate.name}</DialogTitle><DialogDescription>{q.data.attempt.examTitle} · {ATTEMPT_STATUS_LABEL[q.data.attempt.status] ?? q.data.attempt.status} · {when(q.data.attempt.submittedAt)}{q.data.attempt.receiptCode ? ` · Receipt ${q.data.attempt.receiptCode}` : ""}</DialogDescription></div><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button></DialogHeader>

          <section className="rounded-xl border border-stone-200 bg-stone-50 p-4" aria-label="Result">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>{grade ? <><p className="text-2xl font-semibold">{formatScore(grade)}</p><p className="text-xs text-stone-500">{grade.autoMarks} automatic + {grade.manualMarks} manual{percent(grade.totalMarks, grade.maxMarks) !== null ? ` · ${percent(grade.totalMarks, grade.maxMarks)}%` : ""}</p></> : <p className="text-sm text-stone-600">Not evaluated yet.</p>}</div>
              {grade && <Badge variant={gradeTone(grade.status)}>{GRADE_STATUS_LABEL[grade.status]}</Badge>}
            </div>
            {a.locked && <p className="mt-3 flex items-center gap-2 text-sm text-stone-600"><Lock size={14} aria-hidden="true" /> This result is published and can no longer be changed or re-graded.</p>}
            {a.canEvaluate && <div className="mt-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => evaluate.mutate()}>{evaluate.isPending ? "Grading…" : a.evaluateLabel}</Button>{grade && <span className="ml-3 text-xs text-stone-500">Keeps your manual marks.</span>}</div>}
          </section>

          {notice && <Alert variant="success" className="mt-3" role="status"><CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />{notice}</Alert>}
          {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}

          {a.canMark && grade && (
            <form onSubmit={submitMarks} className="mt-4 rounded-xl border border-stone-200 p-4" noValidate aria-label="Manual marking">
              <h3 className="font-semibold">{a.needsMarking ? "Mark descriptive answers" : "Marks and feedback"}</h3>
              <p className="mt-1 text-sm text-stone-500">Enter the total marks for answers that need a person. They are added to the {grade.autoMarks} automatic marks.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
                <label className="text-sm font-medium">Marks to award
                  <Input inputMode="decimal" value={marks} onChange={(e) => { setMarks(e.target.value); setFieldError(""); }} aria-invalid={!!fieldError} aria-describedby="marks-hint marks-error" className="mt-1" />
                  <span id="marks-hint" className="mt-1 block text-xs font-normal text-stone-500">0 to {maxManualMarks(grade)}</span>
                  {fieldError && <span id="marks-error" role="alert" className="mt-1 block text-xs font-normal text-red-700">{fieldError}</span>}</label>
                <label className="text-sm font-medium">Feedback to the candidate (optional)<Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={4000} rows={3} className="mt-1" /></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>{saveMarks.isPending ? "Saving…" : "Save marks"}</Button>
                {a.canPublish && !confirmPublish && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmPublish(true)}>Publish result…</Button>}
              </div>
            </form>
          )}
          {!a.canMark && a.canPublish && !confirmPublish && <div className="mt-4"><Button variant="outline" disabled={busy} onClick={() => setConfirmPublish(true)}>Publish result…</Button></div>}
          {confirmPublish && (
            <Alert variant="warning" className="mt-3" role="alertdialog" aria-label="Confirm publishing">
              <p className="font-medium">Publish this result?</p><p className="mt-1">The candidate will be notified and can see their score{grade?.feedback || feedback ? " and feedback" : ""}. A published result can't be edited or re-graded.</p>
              <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={() => publish.mutate()}>{publish.isPending ? "Publishing…" : "Publish"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmPublish(false)}>Cancel</Button></div>
            </Alert>
          )}

          <h3 className="mb-2 mt-6 font-semibold">Answers</h3>
          <ol className="space-y-3">{q.data.questions.map((qu, i) => {
            const shown = describeAnswer(qu.answer, qu.options);
            const correct = qu.objective ? sameAnswer(qu.answer, qu.correctAnswer) : null;
            return (
              <li key={qu.id} className="rounded-xl border border-stone-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{i + 1}. {qu.prompt}</p><span className="flex items-center gap-2 text-xs text-stone-500">{qu.marks} mark{qu.marks === 1 ? "" : "s"}<Badge variant="outline">{qu.type.replaceAll("_", " ")}</Badge>{correct !== null && <Badge variant={correct ? "success" : "danger"}>{correct ? "Correct" : shown ? "Incorrect" : "Not answered"}</Badge>}</span></div>
                {qu.type === "coding" ? <><p className="mt-2 text-xs text-stone-500">Submitted code. Coding answers are not run automatically and need manual marking.</p><pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-stone-950 p-3 text-xs text-stone-100">{shown || "No code submitted."}</pre></>
                  : <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800"><span className="text-xs uppercase tracking-wide text-stone-400">Candidate's answer </span><br />{shown || <i className="text-stone-400">No answer</i>}</p>}
                {qu.objective && correct === false && <p className="mt-2 text-sm text-stone-600"><span className="text-xs uppercase tracking-wide text-stone-400">Correct answer </span><br />{describeAnswer(qu.correctAnswer, qu.options)}</p>}
              </li>);
          })}</ol>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
