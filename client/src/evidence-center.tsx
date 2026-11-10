import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileSearch, Image as ImageIcon, RefreshCw, ShieldCheck, VideoOff } from 'lucide-react';
import { api } from './lib/api';
import { readPagination } from './lib/pagination';
import { Alert, Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from './components/ui';

type ReviewerSession = {
  organization: { id: string; name: string };
  role: string;
};
type ReviewExplanation = { id: string; question: string; body: string; status: string; deadlineAt?: string | null; respondedAt?: string | null; decision?: string | null; decisionReason?: string | null; decisionAt?: string | null; requestedBy?: { name: string } | null; decidedBy?: { name: string } | null };
type ReviewIncident = { id: string; status: string; decisionReason?: string | null; reviewerNotes?: string | null; explanations?: ReviewExplanation[] };
type ReviewSignal = { id: string; status: string; reviewerNotes?: string | null };
type EvidenceItem = {
  id: string;
  kind: 'image' | 'browser_event' | 'ai_signal' | 'radio_observation' | 'coding_submission';
  type: string;
  source?: string;
  occurredAt: string;
  candidate: { id: string; name: string; email: string };
  exam: { id: string; title: string };
  attempt: { id: string; status: string };
  hasBinary: boolean;
  reviewStatus: string;
  details?: Record<string, unknown>;
  incidents?: ReviewIncident[];
  signals?: ReviewSignal[];
};
type EvidenceDetail = { item: EvidenceItem & { details?: Record<string, unknown> }; reviewHistory: Array<{ id: string; action: string; metadata: unknown; createdAt: string; actor?: { name: string } | null }> };

const labelFor = (value: string) => value.replace(/_/g, ' ').replace(/:/g, ' · ');
const eventLabel = (value: string) => ({
  face_missing: 'Camera view did not show a face',
  multiple_faces: 'More than one face appeared in the camera view',
  looking_away: 'The camera suggested the student was looking away',
  phone_detected: 'The camera suggested a phone may be visible',
  visibility_hidden: 'The examination tab was not visible',
  fullscreen_exit: 'Fullscreen mode was exited',
  network_interruption: 'The connection was interrupted',
  camera_permission_lost: 'Camera access was interrupted',
}[value] ?? labelFor(value));
const kindLabel = (value: EvidenceItem['kind']) => ({
  image: 'Image evidence',
  browser_event: 'Browser activity',
  ai_signal: 'Camera review signal',
  radio_observation: 'Nearby radio activity',
  coding_submission: 'Coding submission',
}[value]);
const reviewerGuidance = (item: EvidenceItem) => item.kind === 'radio_observation'
  ? 'Check whether the observation is relevant, but do not treat it as proof of a phone, device ownership, or prohibited use.'
  : item.kind === 'ai_signal'
    ? 'Check the captured frame and surrounding context. This is a review signal, not a finding of misconduct.'
    : 'Review the event, timing, and available evidence before deciding what happened.';
const dateParam = (value: string, end = false) => value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString() : undefined;

export function EvidenceCenter({ session }: { session: ReviewerSession }) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<EvidenceItem | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [explanationQuestion, setExplanationQuestion] = useState('');
  const [explanationDeadline, setExplanationDeadline] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const page = Math.max(1, Math.min(1000, Number(params.get('page') ?? 1) || 1));
  const pageSizeValue = Number(params.get('pageSize') ?? 50);
  const pageSize = [25, 50, 100].includes(pageSizeValue) ? pageSizeValue : 50;
  const search = params.get('search') ?? '';
  const candidateId = params.get('candidateId') ?? '';
  const examId = params.get('examId') ?? '';
  const attemptId = params.get('attemptId') ?? '';
  const type = params.get('type') ?? '';
  const reviewStatus = params.get('reviewStatus') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const updateParams = (changes: Record<string, string | null>, resetPage = true) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key); else next.set(key, value);
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    return next;
  });
  const queryParams = useMemo(() => ({
    page, pageSize,
    ...(candidateId ? { candidateId } : {}),
    ...(examId ? { examId } : {}),
    ...(attemptId ? { attemptId } : {}),
    ...(type ? { type } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(search ? { search } : {}),
    ...(from ? { from: dateParam(from) } : {}),
    ...(to ? { to: dateParam(to, true) } : {}),
  }), [page, pageSize, candidateId, examId, attemptId, type, reviewStatus, search, from, to]);
  const inventory = useQuery({
    queryKey: ['evidence-center', session.organization.id, queryParams],
    queryFn: async () => {
      const response = await api.get<EvidenceItem[]>(`/api/organizations/${session.organization.id}/evidence`, { params: queryParams });
      return { items: response.data, pagination: readPagination(response) };
    },
    placeholderData: previous => previous,
  });
  const detail = useQuery({
    queryKey: ['evidence-detail', session.organization.id, selected?.kind, selected?.id],
    enabled: Boolean(selected),
    queryFn: () => api.get<EvidenceDetail>(`/api/organizations/${session.organization.id}/evidence/${selected!.kind}/${selected!.id}/details`).then(response => response.data),
  });
  // Who opened this evidence and when (separate from reviewer decisions, which are in reviewHistory).
  const accessLog = useQuery({
    queryKey: ['evidence-access-log', session.organization.id, selected?.kind, selected?.id],
    enabled: !!selected,
    queryFn: () => api.get<{ accessLog: Array<{ action: string; at: string; by: string }> }>(`/api/organizations/${session.organization.id}/evidence/${selected!.kind}/${selected!.id}/access-log`).then(response => response.data.accessLog),
  });
  const privateImage = useQuery({
    queryKey: ['evidence-private-image', session.organization.id, selected?.id],
    enabled: Boolean(selected?.kind === 'image' && selected.hasBinary),
    queryFn: () => api.get<{ url: string; contentType: string; contentLength: number; expiresIn: number; expiresAt: string }>(`/api/organizations/${session.organization.id}/evidence/${selected!.id}/access`).then(response => response.data),
    staleTime: 45_000,
    refetchInterval: 50_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const canDecideIncidents = ['institute_admin', 'proctor'].includes(session.role);
  const incidentReview = useMutation({
    mutationFn: async ({ incidentId, action }: { incidentId: string; action: 'dismissed' | 'resolved' | 'escalated' }) => {
      if (reviewReason.trim().length < 3) throw new Error('Enter a reviewer rationale of at least 3 characters.');
      return api.post(`/api/organizations/${session.organization.id}/incidents/${incidentId}/decision`, { action, reason: reviewReason.trim(), notes: reviewNotes.trim() || undefined });
    },
    onSuccess: async () => {
      setReviewReason(''); setReviewNotes(''); setReviewError('');
      await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['incidents', session.organization.id] });
    },
    onError: async (error: any) => {
      const conflict = error?.response?.status === 409;
      setReviewError(conflict ? 'Another reviewer changed this incident. The latest record has been refreshed; review it before trying again.' : (error?.response?.data?.error ?? (error instanceof Error ? error.message : 'The review decision could not be saved.')));
      if (conflict) { await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] }); await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] }); await detail.refetch(); }
    },
  });
  const radioReview = useMutation({
    mutationFn: async ({ signalId, status }: { signalId: string; status: 'reviewed_no_concern' | 'reviewed_concern_retained' | 'insufficient_evidence' }) => {
      if (reviewNotes.trim().length < 3) throw new Error('Enter reviewer notes of at least 3 characters.');
      return api.post(`/api/organizations/${session.organization.id}/radio-signals/${signalId}/review`, { status, notes: reviewNotes.trim() });
    },
    onSuccess: async () => {
      setReviewNotes(''); setReviewError('');
      await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['monitoring', session.organization.id] });
    },
    onError: async (error: any) => {
      const conflict = error?.response?.status === 409;
      setReviewError(conflict ? 'Another reviewer changed this radio signal. The latest record has been refreshed; review it before trying again.' : (error?.response?.data?.error ?? (error instanceof Error ? error.message : 'The radio observation review could not be saved.')));
      if (conflict) { await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] }); await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] }); await queryClient.invalidateQueries({ queryKey: ['monitoring', session.organization.id] }); await detail.refetch(); }
    },
  });
  const explanationRequest = useMutation({
    mutationFn: async () => {
      if (!incident?.id || explanationQuestion.trim().length < 3) throw new Error('Enter a clear question for the student.');
      return api.post(`/api/organizations/${session.organization.id}/incidents/${incident.id}/explanation-request`, { question: explanationQuestion.trim(), ...(explanationDeadline ? { deadlineAt: new Date(explanationDeadline).toISOString() } : {}) });
    },
    onSuccess: async () => {
      setExplanationQuestion(''); setExplanationDeadline(''); setExplanationOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] });
    },
    onError: (error: any) => setReviewError(error?.response?.data?.error ?? (error instanceof Error ? error.message : 'The explanation request could not be saved.')),
  });
  const explanationDecision = useMutation({
    mutationFn: async ({ requestId, action }: { requestId: string; action: 'accepted' | 'dismissed' | 'escalated' | 'follow_up' }) => {
      if (reviewReason.trim().length < 3) throw new Error('Enter a reviewer rationale of at least 3 characters.');
      return api.post(`/api/organizations/${session.organization.id}/explanation-requests/${requestId}/decision`, { action, reason: reviewReason.trim(), ...(action === 'follow_up' ? { question: explanationQuestion.trim() } : {}) });
    },
    onSuccess: async () => {
      setReviewReason(''); setExplanationQuestion('');
      await queryClient.invalidateQueries({ queryKey: ['evidence-detail', session.organization.id] });
      await queryClient.invalidateQueries({ queryKey: ['evidence-center', session.organization.id] });
    },
    onError: (error: any) => setReviewError(error?.response?.data?.error ?? (error instanceof Error ? error.message : 'The explanation decision could not be saved.')),
  });
  const items = inventory.data?.items ?? [];
  const pageInfo = inventory.data?.pagination;
  const selectedDetail = detail.data;
  const activeItem = selectedDetail?.item ?? selected;
  const incident = activeItem?.incidents?.[0];
  const signal = activeItem?.signals?.[0];

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="eyebrow">Authorized review workspace</p><h2 className="text-xl font-semibold text-stone-950">Evidence Center</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-stone-600">Review what happened during an examination, when it happened, and what supporting evidence is available. Signals are context for human review, not findings of misconduct.</p></div>
      <Badge variant="outline"><ShieldCheck size={13} className="mr-1"/> Private · reviewer access</Badge>
    </div>

    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold text-stone-600">Search candidate, exam or event<Input className="mt-1" value={search} onChange={event => updateParams({ search: event.target.value || null })} placeholder="Name, email, title or event type" /></label>
        <label className="text-xs font-semibold text-stone-600">Candidate reference<Input className="mt-1" value={candidateId} onChange={event => updateParams({ candidateId: event.target.value || null })} placeholder="Candidate reference" /></label>
        <label className="text-xs font-semibold text-stone-600">Examination reference<Input className="mt-1" value={examId} onChange={event => updateParams({ examId: event.target.value || null })} placeholder="Examination reference" /></label>
        <label className="text-xs font-semibold text-stone-600">Attempt reference<Input className="mt-1" value={attemptId} onChange={event => updateParams({ attemptId: event.target.value || null })} placeholder="Attempt reference" /></label>
        <label className="text-xs font-semibold text-stone-600">Evidence type<select className="input mt-1 w-full" value={type} onChange={event => updateParams({ type: event.target.value || null })}><option value="">All supported records</option><option value="image">Private image evidence</option><option value="browser_event">Browser events</option><option value="ai_signal">AI review signals</option><option value="radio_observation">BLE / Wi-Fi observations</option><option value="coding_submission">Coding submissions</option></select></label>
        <label className="text-xs font-semibold text-stone-600">Review status<select className="input mt-1 w-full" value={reviewStatus} onChange={event => updateParams({ reviewStatus: event.target.value || null })}><option value="">All review states</option><option value="pending_review">Pending review</option><option value="reviewed">Reviewed</option><option value="escalated">Escalated</option></select></label>
        <label className="text-xs font-semibold text-stone-600">From date<input className="input mt-1 w-full" type="date" value={from} onChange={event => updateParams({ from: event.target.value || null })}/></label>
        <label className="text-xs font-semibold text-stone-600">To date<input className="input mt-1 w-full" type="date" value={to} onChange={event => updateParams({ to: event.target.value || null })}/></label>
        <label className="text-xs font-semibold text-stone-600">Rows per page<select className="input mt-1 w-full" value={pageSize} onChange={event => updateParams({ pageSize: event.target.value, page: null }, false)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-stone-500">Search matches candidate name, email, examination title, and event type.</p><Button size="sm" variant="outline" onClick={() => setParams(new URLSearchParams())}><RefreshCw size={14}/> Clear filters</Button></div>
    </div>

    {inventory.isError && <Alert variant="destructive"><div className="flex items-center justify-between gap-3"><span>Evidence records could not be loaded. Check reviewer access and filter values.</span><Button size="sm" variant="outline" onClick={() => void inventory.refetch()}>Retry</Button></div></Alert>}
    {inventory.isLoading && <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500" role="status">Loading institution evidence…</div>}
    {!inventory.isLoading && !inventory.isError && <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3"><div><b className="text-sm text-stone-900">Evidence records</b><p className="text-xs text-stone-500">Newest first · stable timestamp and ID ordering</p></div><span className="text-xs text-stone-500">{pageInfo ? `${pageInfo.totalCount.toLocaleString()} records · page ${pageInfo.page} of ${pageInfo.totalPages}` : 'Pagination metadata unavailable'}</span></div>
      {items.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>What happened</TableHead><TableHead>Candidate / examination</TableHead><TableHead>Attempt</TableHead><TableHead>Review</TableHead><TableHead>When</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={`${item.kind}-${item.id}`}><TableCell><div className="flex items-center gap-2">{item.kind === 'image' ? <ImageIcon size={16}/> : <FileSearch size={16}/>}<div><b className="block text-sm text-stone-900">{eventLabel(item.type)}</b><span className="text-xs text-stone-500">{kindLabel(item.kind)}</span></div></div></TableCell><TableCell><b className="block text-sm">{item.candidate.name}</b><span className="text-xs text-stone-500">{item.candidate.email}</span><span className="mt-1 block text-xs text-stone-700">{item.exam.title}</span></TableCell><TableCell><span className="text-xs text-stone-600">{item.attempt.id.slice(0, 8)}…</span><span className="block text-xs capitalize text-stone-500">{labelFor(item.attempt.status)}</span></TableCell><TableCell><Badge variant={item.reviewStatus === 'escalated' ? 'warning' : item.reviewStatus === 'reviewed' ? 'success' : 'outline'}>{labelFor(item.reviewStatus)}</Badge></TableCell><TableCell><span className="text-xs text-stone-600">{new Date(item.occurredAt).toLocaleString()}</span></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { setSelected(item); setReviewReason(''); setReviewNotes(''); setReviewError(''); }}>Review</Button></TableCell></TableRow>)}</TableBody></Table></div> : <div className="px-6 py-12 text-center"><FileSearch className="mx-auto text-stone-400" size={28}/><h3 className="mt-3 font-semibold text-stone-900">No evidence matches these filters</h3><p className="mt-1 text-sm text-stone-500">Try a broader date range or clear one of the filters. No sample evidence is inserted when the database is empty.</p></div>}
      <div className="flex items-center justify-between border-t border-stone-200 px-4 py-3"><span className="text-xs text-stone-500">{inventory.isFetching ? 'Updating…' : pageInfo ? `Showing ${items.length} on this page` : 'Total count unavailable'}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!pageInfo || page <= 1 || inventory.isFetching} onClick={() => updateParams({ page: String(page - 1) }, false)}>Previous</Button><Button size="sm" variant="outline" disabled={!pageInfo || page >= pageInfo.totalPages || inventory.isFetching} onClick={() => updateParams({ page: String(page + 1) }, false)}>Next</Button></div></div>
    </div>}

    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/40" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="evidence-detail-title" className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Review record</p><h2 id="evidence-detail-title" className="mt-1 text-xl font-semibold text-stone-950">{eventLabel(selected.type)}</h2><p className="mt-1 text-sm text-stone-500">{selected.candidate.name} · {selected.exam.title}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button></div>
        {detail.isLoading && <p className="py-8 text-sm text-stone-500" role="status">Loading evidence details…</p>}
        {detail.isError && <Alert className="mt-4" variant="destructive">Evidence detail could not be loaded. It may have expired or your access may have changed.</Alert>}
        {activeItem && <>
          {activeItem.kind === 'image' && <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-3">{privateImage.data?.url ? <img src={privateImage.data.url} alt="Private examination evidence" className="max-h-[460px] w-full object-contain" referrerPolicy="no-referrer"/> : <div className="py-8 text-center text-sm text-stone-500"><ImageIcon className="mx-auto mb-2" size={24}/>{privateImage.isError ? 'Private image access expired or is unavailable.' : 'Preparing short-lived private image access…'}</div>}<div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-200 pt-3"><span className="text-xs text-stone-500">Authenticated access · expires in 60 seconds</span><Button size="sm" variant="outline" onClick={() => void privateImage.refetch()}><RefreshCw size={13}/> Refresh access</Button></div></div>}
          {activeItem.kind === 'radio_observation' && <Alert variant="warning" className="mt-5">Nearby Bluetooth or Wi-Fi activity was observed. This does not identify a phone, its owner, or prohibited device use.</Alert>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-stone-200 p-3"><span className="text-xs text-stone-500">What happened?</span><b className="mt-1 block text-sm">{eventLabel(activeItem.type)}</b><p className="mt-1 text-sm text-stone-600">{reviewerGuidance(activeItem)}</p></div><div className="rounded-xl border border-stone-200 p-3"><span className="text-xs text-stone-500">When?</span><b className="mt-1 block text-sm">{new Date(activeItem.occurredAt).toLocaleString()}</b><span className="mt-1 block text-sm text-stone-600">Recorded during {activeItem.exam.title}</span></div></div>
          <div className="mt-5"><h3 className="font-semibold text-stone-900">Access log</h3>{accessLog.isLoading && <p className="mt-2 text-sm text-stone-500" role="status">Loading access log…</p>}{accessLog.isError && <p className="mt-2 text-sm text-red-700" role="alert">Access log could not be loaded.</p>}{accessLog.data && (accessLog.data.length === 0 ? <p className="mt-2 text-sm text-stone-500">No access recorded yet.</p> : <ul className="mt-2 space-y-1 text-sm text-stone-700">{accessLog.data.slice(0, 10).map((entry, index) => <li key={`${entry.at}-${index}`}>{entry.action.replace('evidence.', '').replaceAll('_', ' ')} · {entry.by} · {new Date(entry.at).toLocaleString()}</li>)}</ul>)}</div>
          <div className="mt-5"><h3 className="font-semibold text-stone-900">Review history</h3><ol className="mt-3 border-l border-stone-200 pl-4">{(selectedDetail?.reviewHistory ?? []).map(entry => <li key={entry.id} className="relative border-t border-stone-100 py-3"><span className="absolute -left-[21px] top-4 size-2 rounded-full bg-amber-500"/><b className="text-sm">{labelFor(entry.action)}</b><p className="text-xs text-stone-500">{entry.actor?.name ?? 'Reviewer'} · {new Date(entry.createdAt).toLocaleString()}</p></li>)}{!(selectedDetail?.reviewHistory?.length) && <li className="text-sm text-stone-500">No reviewer decision has been recorded.</li>}</ol></div>
          {activeItem.details && <details className="mt-5 rounded-xl border border-stone-200 p-4"><summary className="cursor-pointer font-semibold text-stone-900">Advanced details</summary>{typeof activeItem.details.sourceCode === 'string' ? <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-stone-950 p-4 text-xs text-stone-100">{activeItem.details.sourceCode}</pre> : <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-stone-50 p-4 text-xs text-stone-700">{JSON.stringify(activeItem.details, null, 2)}</pre>}</details>}
          {(activeItem.signals?.length ?? 0) > 0 && <div className="mt-4 space-y-2"><h3 className="font-semibold text-stone-900">Existing reviewer notes</h3>{activeItem.signals?.map(existingSignal => <div key={existingSignal.id} className="rounded-lg bg-stone-50 p-3 text-sm"><b className="capitalize">{labelFor(existingSignal.status)}</b><p className="mt-1 text-stone-600">{existingSignal.reviewerNotes || 'No reviewer note recorded.'}</p></div>)}</div>}
          {(activeItem.incidents?.length ?? 0) > 0 && <div className="mt-5 rounded-xl border border-stone-200 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-stone-900">Incident review</h3><Badge variant="outline">{labelFor(incident?.status ?? 'open')}</Badge></div><p className="mt-2 text-sm text-stone-600">{incident?.decisionReason ?? 'No reviewer decision has been recorded.'}</p>{incident?.reviewerNotes && <p className="mt-2 text-sm text-stone-600">Reviewer notes: {incident.reviewerNotes}</p>}
            {(incident?.explanations ?? []).map(request => <div key={request.id} className="mt-4 rounded-lg bg-stone-50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><b>{request.status === 'requested' ? 'Awaiting student response' : request.status === 'responded' ? 'Response received' : request.status === 'follow_up' ? 'Additional information requested' : request.decision === 'accepted' ? 'Explanation accepted' : request.decision === 'dismissed' ? 'Incident dismissed' : 'Escalated for review'}</b>{request.deadlineAt && <span className="text-xs text-stone-500">Deadline: {new Date(request.deadlineAt).toLocaleString()}</span>}</div><p className="mt-1 text-stone-700">Question: {request.question}</p>{request.body && <p className="mt-1 text-stone-600">Student response: {request.body}</p>}{request.decisionReason && <p className="mt-1 text-stone-600">Decision reason: {request.decisionReason}</p>}{canDecideIncidents && request.status === 'responded' && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={explanationDecision.isPending} onClick={() => explanationDecision.mutate({ requestId: request.id, action: 'accepted' })}>Accept explanation</Button><Button size="sm" variant="ghost" disabled={explanationDecision.isPending} onClick={() => explanationDecision.mutate({ requestId: request.id, action: 'dismissed' })}>Dismiss incident</Button><Button size="sm" variant="outline" disabled={explanationDecision.isPending} onClick={() => explanationDecision.mutate({ requestId: request.id, action: 'escalated' })}>Escalate</Button></div>}{canDecideIncidents && request.status === 'responded' && <div className="mt-3 space-y-2"><label className="block text-xs font-semibold text-stone-600">Additional question<Textarea value={explanationQuestion} onChange={event => setExplanationQuestion(event.target.value)} rows={2} maxLength={2000} /></label><Button size="sm" variant="outline" disabled={explanationDecision.isPending} onClick={() => explanationDecision.mutate({ requestId: request.id, action: 'follow_up' })}>Request additional clarification</Button></div>}</div>)}
            {canDecideIncidents && incident && !['resolved', 'dismissed'].includes(incident.status) && !(incident.explanations ?? []).some(request => request.status !== 'closed') && <div className="mt-4"><Button size="sm" variant="outline" onClick={() => setExplanationOpen(value => !value)}>Ask Student for Explanation</Button>{explanationOpen && <div className="mt-3 space-y-2"><label className="block text-xs font-semibold text-stone-600">Question for the student<Textarea value={explanationQuestion} onChange={event => setExplanationQuestion(event.target.value)} rows={3} maxLength={2000} placeholder="What would you like the student to explain?" /></label><label className="block text-xs font-semibold text-stone-600">Response deadline (optional)<Input type="datetime-local" value={explanationDeadline} onChange={event => setExplanationDeadline(event.target.value)} /></label><Button size="sm" disabled={explanationRequest.isPending} onClick={() => explanationRequest.mutate()}>{explanationRequest.isPending ? 'Sending…' : 'Send explanation request'}</Button></div>}</div>}
            {canDecideIncidents && incident && !['resolved', 'dismissed'].includes(incident.status) && <div className="mt-4 space-y-2"><label className="block text-xs font-semibold text-stone-600">Reviewer rationale (required)<Textarea value={reviewReason} onChange={event => setReviewReason(event.target.value)} rows={2} maxLength={2000}/></label><label className="block text-xs font-semibold text-stone-600">Additional reviewer notes<Textarea value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} rows={2} maxLength={4000}/></label>{reviewError && <Alert variant="destructive">{reviewError}</Alert>}<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={incidentReview.isPending} onClick={() => incidentReview.mutate({ incidentId: incident.id, action: 'escalated' })}>Escalate</Button><Button size="sm" variant="secondary" disabled={incidentReview.isPending} onClick={() => incidentReview.mutate({ incidentId: incident.id, action: 'resolved' })}>Mark reviewed</Button><Button size="sm" variant="ghost" disabled={incidentReview.isPending} onClick={() => incidentReview.mutate({ incidentId: incident.id, action: 'dismissed' })}>Dismiss</Button></div></div>}
          </div>}
          {activeItem.kind === 'radio_observation' && signal && signal.status === 'pending_review' && <div className="mt-5 rounded-xl border border-stone-200 p-4"><h3 className="font-semibold text-stone-900">Radio signal review</h3><p className="mt-1 text-xs text-stone-500">This updates the existing signal review record; it does not take action against a candidate.</p><label className="mt-3 block text-xs font-semibold text-stone-600">Reviewer notes (required)<Textarea rows={3} value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} maxLength={2000}/></label>{reviewError && <Alert className="mt-2" variant="destructive">{reviewError}</Alert>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={radioReview.isPending} onClick={() => radioReview.mutate({ signalId: signal.id, status: 'reviewed_no_concern' })}>No concern</Button><Button size="sm" variant="secondary" disabled={radioReview.isPending} onClick={() => radioReview.mutate({ signalId: signal.id, status: 'reviewed_concern_retained' })}>Retain for review</Button><Button size="sm" variant="ghost" disabled={radioReview.isPending} onClick={() => radioReview.mutate({ signalId: signal.id, status: 'insufficient_evidence' })}>Insufficient evidence</Button></div></div>}
          {activeItem.kind === 'coding_submission' && <Alert className="mt-5" variant="warning">Coding submissions are shown as read-only evidence here. The current schema has no coding-submission review status or reviewer-notes workflow.</Alert>}
        </>}
        <div className="mt-6 rounded-xl bg-stone-50 p-4 text-xs leading-5 text-stone-600"><VideoOff size={16} className="mb-2"/>Screen recordings and video seeking are not available in this staged backend. Camera snapshots are not distinguishable from generic image evidence in the current event contract.</div>
      </section>
    </div>}
  </section>;
}
