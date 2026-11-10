import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import { api } from "./lib/api";
import { Alert, Badge, Button, Skeleton, Textarea } from "./components/ui";
import { PHASE_LABEL, formatStartsIn, readinessItems, resultText, sections, submissionStatusText, type Assignment, type Perm, type ReadinessEnv } from "./lib/candidate-rules";
import type { NotificationsPayload } from "./notifications";

type Session = { user: { name: string; email: string }; organization: { id: string; name: string } };
type Verification = { status: string; rejectionReason?: string | null; profilePhoto?: string | null; idDocument?: string | null };
type Payload = { candidate: { id: string; name: string }; verification: Verification; assignments: Assignment[] };
type ExplanationRequest = { id: string; question: string; body: string; evidenceKey?: string | null; status: string; deadlineAt?: string | null; respondedAt?: string | null; decision?: string | null; decisionReason?: string | null; decisionAt?: string | null; incident: { exam?: { title: string } | null; type: string; createdAt: string } };
const when = (v?: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const windowText = (a: Assignment) => (a.exam?.startsAt || a.exam?.endsAt ? `${a.exam?.startsAt ? when(a.exam.startsAt) : "Any time"} – ${a.exam?.endsAt ? when(a.exam.endsAt) : "no end"}` : "No fixed window");

async function readPermission(name: "camera" | "microphone"): Promise<Perm> {
  try { const s = await navigator.permissions.query({ name: name as PermissionName }); return s.state as Perm; } catch { return "unknown"; }
}

/** Checks only what the browser already knows. It never calls getUserMedia, so no permission prompt is triggered. */
function DeviceReadiness() {
  const [env, setEnv] = useState<ReadinessEnv | null>(null);
  const check = useCallback(async () => {
    setEnv({ secure: window.isSecureContext, hasMediaDevices: !!navigator.mediaDevices?.getUserMedia, online: navigator.onLine !== false, camera: await readPermission("camera"), microphone: await readPermission("microphone") });
  }, []);
  useEffect(() => { void check(); window.addEventListener("online", check); window.addEventListener("offline", check); return () => { window.removeEventListener("online", check); window.removeEventListener("offline", check); }; }, [check]);
  const items = env ? readinessItems(env) : [];
  const Icon = { ok: CheckCircle2, warn: CircleHelp, fail: CircleAlert } as const;
  const tone = { ok: "text-emerald-700", warn: "text-amber-700", fail: "text-red-700" } as const;
  return (
    <section aria-labelledby="readiness-title" className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3"><h3 id="readiness-title" className="font-semibold">Device readiness</h3><Button size="sm" variant="outline" onClick={() => void check()}>Check again</Button></div>
      <p className="mt-1 text-sm text-stone-500">Your browser only reports what it already allows. Checking never turns on your camera or microphone.</p>
      {!env ? <Skeleton className="mt-3 h-24" /> : <ul className="mt-3 divide-y divide-stone-100">{items.map((i) => { const I = Icon[i.status]; return <li key={i.id} className="flex gap-3 py-2 text-sm"><I size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${tone[i.status]}`} /><div><p className="font-medium text-stone-900">{i.label}<span className="sr-only">: {i.status === "ok" ? "ready" : i.status === "warn" ? "needs attention" : "problem"}</span></p><p className="text-stone-600">{i.hint}</p></div></li>; })}</ul>}
      <p className="mt-3 text-xs text-stone-500">If your organization requires the Windows Companion, you'll pair it from the exam page after you start. Its status appears there.</p>
    </section>
  );
}

/** Candidate home: what to do now, what's coming, and what happened. Everything comes from /api/student/dashboard and /api/notifications. */
export function CandidateDashboard({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["candidate-dashboard", session.user.email], queryFn: async () => (await api.get<Payload>("/api/student/dashboard")).data });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get<NotificationsPayload>("/api/notifications")).data, refetchInterval: 60_000 });
  const explanations = useQuery({ queryKey: ["explanation-requests"], queryFn: async () => (await api.get<ExplanationRequest[]>("/api/student/explanation-requests")).data, refetchInterval: 60_000 });
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [responseFiles, setResponseFiles] = useState<Record<string, File | undefined>>({});
  const [verificationFiles, setVerificationFiles] = useState<{ photo?: File; idDocument?: File }>({});
  const responseMutation = useMutation({
    mutationFn: async ({ requestId, body, file }: { requestId: string; body: string; file?: File }) => {
      const form = new FormData();
      form.append("body", body);
      if (file) form.append("file", file);
      return api.post(`/api/student/explanation-requests/${requestId}/response`, form);
    },
    onSuccess: () => { setResponses({}); void explanations.refetch(); },
  });

  if (isLoading) return <div className="mx-auto max-w-5xl space-y-4" aria-busy="true" aria-label="Loading your assessments"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (isError || !data) return <div className="mx-auto max-w-xl rounded-xl border border-stone-200 bg-white p-8 text-center"><AlertTriangle className="mx-auto text-red-500" aria-hidden="true" /><h2 className="mt-3 font-semibold">Your assessments could not be loaded</h2><p className="mt-1 text-sm text-stone-500">Check your connection and try again. If this keeps happening, contact your examination administrator.</p><Button className="mt-4" variant="outline" onClick={() => void refetch()}>Try again</Button></div>;

  const assignments = data.assignments ?? [];
  const verification = data.verification ?? { status: "not_submitted" };
  const verificationRequired = assignments.some((a) => a.exam?.requireVerification);
  const sec = sections(assignments, now);
  const submitVerification = async () => {
    setSubmitting(true); setError(""); setNotice("");
    try {
      if (!verificationFiles.photo || !verificationFiles.idDocument) throw new Error("Add both a selfie and an identity document before submitting.");
      for (const [kind, file] of [["photo", verificationFiles.photo], ["idDocument", verificationFiles.idDocument] as const]) {
        const form = new FormData();
        form.append("file", file);
        await api.post(`/api/organizations/${session.organization.id}/candidates/${data.candidate.id}/documents/${kind}`, form);
      }
      await api.post(`/api/organizations/${session.organization.id}/candidates/${data.candidate.id}/verification`);
      setNotice("Identity verification submitted. Your institute must approve it before you can start this assessment.");
      await refetch();
    }
    catch (e) { setError(axios.isAxiosError(e) ? (e.response?.data?.error ?? "Could not submit identity verification.") : "Could not submit identity verification."); }
    finally { setSubmitting(false); }
  };
  const unread = (notes.data?.notifications ?? []).filter((n) => !n.readAt).slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header><h2 className="text-2xl font-semibold tracking-tight">Hello, {(data.candidate.name || "candidate").split(" ")[0]}</h2><p className="mt-1 text-sm text-stone-500">Start an assessment only during its published window. Your answers save automatically.</p></header>

      {explanations.data && explanations.data.length > 0 && <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-5" aria-labelledby="explanation-requests-title">
        <h3 id="explanation-requests-title" className="font-semibold">Explanation Requests</h3>
        <p className="mt-1 text-sm text-stone-600">These requests ask for context about an examination event. Your explanation is reviewed by a person and is not treated as an admission.</p>
        <div className="mt-4 space-y-3">{explanations.data.map(request => {
          const canRespond = request.status === "requested" || request.status === "follow_up";
          const status = canRespond ? (request.status === "follow_up" ? "Additional information requested" : "Action required") : request.status === "responded" ? "Response submitted" : request.decision === "accepted" ? "Reviewed: explanation accepted" : request.decision === "dismissed" ? "Reviewed: incident dismissed" : request.decision === "escalated" ? "Escalated for review" : "Reviewed";
          return <article key={request.id} className="rounded-lg border border-blue-100 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-sm">{request.incident.exam?.title ?? "Examination"}</b><p className="text-xs text-stone-500">{request.incident.type.replaceAll("_", " ")} · {new Date(request.incident.createdAt).toLocaleString()}</p></div><Badge variant={canRespond ? "warning" : "outline"}>{status}</Badge></div>
            <p className="mt-3 text-sm text-stone-700"><b>Reviewer question:</b> {request.question}</p>
            {request.deadlineAt && <p className="mt-1 text-xs text-stone-500">Response deadline: {new Date(request.deadlineAt).toLocaleString()}</p>}
            {request.decisionReason && <p className="mt-2 text-sm text-stone-600"><b>Reviewer note:</b> {request.decisionReason}</p>}
            {canRespond && <div className="mt-3 space-y-2"><label className="block text-xs font-semibold text-stone-600">Your explanation<Textarea value={responses[request.id] ?? ""} onChange={event => setResponses(existing => ({ ...existing, [request.id]: event.target.value }))} rows={4} maxLength={5000} placeholder="Explain what happened in your own words." /></label><label className="block text-xs font-semibold text-stone-600">Supporting document (optional)<input className="input mt-1 w-full" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setResponseFiles(existing => ({ ...existing, [request.id]: event.target.files?.[0] }))} /></label>{responseMutation.isError && <p role="alert" className="text-sm text-red-700">{axios.isAxiosError(responseMutation.error) ? responseMutation.error.response?.data?.error ?? "Could not submit your explanation." : "Could not submit your explanation."}</p>}<Button disabled={responseMutation.isPending || (responses[request.id] ?? "").trim().length < 3} onClick={() => responseMutation.mutate({ requestId: request.id, body: responses[request.id] ?? "", file: responseFiles[request.id] })}>{responseMutation.isPending ? "Submitting…" : "Submit explanation"}</Button></div>}
            {request.body && !canRespond && <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-700"><p><b>Your submitted explanation:</b> {request.body}</p>{request.evidenceKey && <Button className="mt-2" size="sm" variant="outline" onClick={async () => { const response = await api.get(`/api/student/explanation-requests/${request.id}/attachment`, { responseType: "blob" }); const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = "explanation-attachment"; link.click(); URL.revokeObjectURL(url); }}>Download attachment</Button>}</div>}
          </article>;
        })}</div>
      </section>}

      {verificationRequired && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-5" aria-labelledby="verify-title"><h3 id="verify-title" className="font-semibold">Identity verification</h3>
          <p className="mt-1 text-sm text-stone-600">Status: <b className="capitalize">{String(verification.status).replaceAll("_", " ")}</b>{verification.rejectionReason ? ` — ${verification.rejectionReason}` : ""}</p>
          {verification.status === "approved" ? <p className="mt-3 text-sm text-emerald-700">Approved. You can start protected assessments during their availability window.</p>
            : verification.status === "submitted" ? <p className="mt-3 text-sm text-amber-800">Your request is awaiting review by your institute.</p>
            : <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-stone-700">Live selfie<input className="input mt-1 w-full" type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={event => setVerificationFiles(existing => ({ ...existing, photo: event.target.files?.[0] }))} /></label>
              <label className="block text-sm font-medium text-stone-700">Identity document<input className="input mt-1 w-full" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setVerificationFiles(existing => ({ ...existing, idDocument: event.target.files?.[0] }))} /></label>
              <Button disabled={submitting || !verificationFiles.photo || !verificationFiles.idDocument} onClick={() => void submitVerification()}>{submitting ? "Submitting…" : verification.status === "resubmission_required" ? "Resubmit identity verification" : "Submit identity verification"}</Button>
            </div>}
          {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </section>)}

      <section aria-labelledby="now-title"><h3 id="now-title" className="mb-3 font-semibold">Available now</h3>
        {sec.active.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{assignments.length === 0 ? "No assessments have been assigned to you yet. Your organizer will assign them." : "Nothing to take right now."}</p> : (
          <div className="space-y-3">{sec.active.map(({ a, phase }) => (
            <article key={a.id} className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-lg font-medium">{a.exam?.title}</p><p className="mt-1 text-sm text-stone-500">{a.exam?.durationMinutes ?? "—"} minutes · {windowText(a)}</p></div>
                <div className="flex items-center gap-3"><Badge variant={phase === "closing" ? "warning" : "success"}>{PHASE_LABEL[phase]}</Badge>
                  {phase === "closing" ? <span className="max-w-56 text-xs text-stone-500">This exam's window has ended. Your saved answers are being submitted automatically.</span> : <Button onClick={() => navigate(`/app/take/${a.exam!.id}`)}>{phase === "in_progress" ? "Resume assessment" : "Start readiness"}</Button>}</div>
              </div>
              {a.exam?.instructions && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-stone-700">Instructions</summary><p className="mt-2 whitespace-pre-wrap text-stone-600">{a.exam.instructions}</p></details>}
            </article>))}</div>)}
      </section>

      {sec.upcoming.length > 0 && (
        <section aria-labelledby="up-title"><h3 id="up-title" className="mb-3 font-semibold">Upcoming</h3>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">{sec.upcoming.map(({ a }) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4"><div><p className="font-medium">{a.exam?.title}</p><p className="text-sm text-stone-500">{windowText(a)} · {a.exam?.durationMinutes ?? "—"} minutes</p></div><Badge variant="outline">Starts {formatStartsIn(new Date(a.exam!.startsAt!).getTime() - now)}</Badge></li>))}</ul></section>)}

      <div className="grid gap-5 lg:grid-cols-2">
        <DeviceReadiness />
        <section aria-labelledby="notes-title" className="rounded-xl border border-stone-200 bg-white p-5"><h3 id="notes-title" className="font-semibold">Notifications</h3>
          {notes.isError ? <p className="mt-2 text-sm text-red-700" role="alert">Notifications couldn't be loaded.</p> : unread.length === 0 ? <p className="mt-2 text-sm text-stone-500">You're all caught up. Reminders and results appear here and in the bell above.</p> : <ul className="mt-3 space-y-3">{unread.map((n) => <li key={n.id}><p className="text-sm font-medium">{n.title}</p><p className="text-sm text-stone-600">{n.body}</p><p className="text-[11px] text-stone-400">{when(n.createdAt)}</p></li>)}</ul>}
          <p className="mt-4 border-t border-stone-100 pt-3 text-sm text-stone-500">Need help? Use the <b>Help</b> button at the bottom right for device, connection and exam-logistics questions.</p>
        </section>
      </div>

      <section aria-labelledby="hist-title"><h3 id="hist-title" className="mb-3 font-semibold">History and results</h3>
        {sec.history.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">Completed assessments and released results will appear here.</p> : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">{sec.history.map(({ a, phase }) => (
            <li key={a.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium">{a.exam?.title ?? "Assessment unavailable"}</p>
                  <p className="text-sm text-stone-500">{phase === "completed" ? `${submissionStatusText(a)}${a.attempt?.submittedAt ? ` · ${when(a.attempt.submittedAt)}` : ""}` : PHASE_LABEL[phase]}{a.attempt?.receiptCode ? ` · Receipt ${a.attempt.receiptCode}` : ""}</p></div>
                {phase === "completed" && (a.grade ? <div className="text-right"><p className="text-lg font-semibold">{resultText(a.grade)}</p><p className="text-xs text-stone-500">Released {when(a.grade.publishedAt)}</p></div> : <Badge variant="outline">Result not released yet</Badge>)}
              </div>
              {a.grade?.feedback && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm text-stone-700"><span className="block text-xs font-medium uppercase tracking-wide text-stone-400">Feedback from your examiner</span>{a.grade.feedback}</p>}
            </li>))}</ul>)}
      </section>
    </div>
  );
}
