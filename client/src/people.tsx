import { useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { api } from "./lib/api";
import { StudentImport } from "./student-import";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, countActiveAdmins, describeAction, filterMembers, memberErrorMessage, memberState, type Member, type MemberAction, type MemberRole } from "./lib/members-rules";
import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui";

type Props = { session: { organization: { id: string; name: string }; role: string; user: { email: string } } };
type StaffApplication = { id: string; status: string; createdAt: string; reviewReason: string | null; user: { name: string; email: string }; documents: { governmentId: boolean; institutionId: boolean; authorizationLetter: boolean } };

function StaffApplications({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const endpoint = `/api/organizations/${organizationId}/staff-applications`;
  const applications = useQuery({ queryKey: ["staff-applications", organizationId], queryFn: async () => (await api.get<StaffApplication[]>(endpoint)).data });
  const decision = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => api.post(`${endpoint}/${id}/decision`, { action, ...(action === "reject" ? { reason: "The submitted identity and university authorization proof could not be verified." } : {}) }),
    onSuccess: async () => { setError(""); await queryClient.invalidateQueries({ queryKey: ["staff-applications", organizationId] }); await queryClient.invalidateQueries({ queryKey: ["members", organizationId] }); },
    onError: (requestError) => setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? "The decision could not be saved." : "The decision could not be saved."),
  });
  const openDocument = async (id: string, kind: "governmentIdDocument" | "institutionIdDocument" | "authorizationDocument") => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setError("Allow pop-ups to view private proof documents."); return; }
    tab.opener = null;
    try {
      const { data } = await api.get<{ url: string }>(`${endpoint}/${id}/documents/${kind}`);
      tab.location.replace(data.url);
    } catch (requestError) {
      tab.close();
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? "Proof document could not be opened." : "Proof document could not be opened.");
    }
  };

  return <section className="border-y border-stone-200 py-5" aria-labelledby="staff-application-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 text-emerald-700"/><div><h3 id="staff-application-heading" className="font-semibold">Coordinator identity review</h3><p className="mt-1 text-sm text-stone-500">Review university-issued proof before activating coordinator access.</p></div></div><span className="text-xs text-stone-500">{applications.data?.length ?? 0} pending</span></div>
    {error && <p role="alert" className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {applications.isError ? <div className="mt-4 text-sm text-red-700">Coordinator applications could not be loaded. <button className="font-semibold underline" onClick={() => void applications.refetch()}>Retry</button></div> : applications.isLoading ? <p className="mt-4 text-sm text-stone-500">Loading applications…</p> : !applications.data?.length ? <p className="mt-4 border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">No coordinator applications are waiting for review.</p> : <ul className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{applications.data.map(application => <li key={application.id} className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-stone-900">{application.user.name}</p><p className="text-sm text-stone-500">{application.user.email} · Submitted {new Date(application.createdAt).toLocaleDateString()}</p></div><span className="text-xs font-semibold uppercase text-amber-800">{application.status.replaceAll("_", " ")}</span></div>
      <div className="mt-3 flex flex-wrap gap-2">{([ ["governmentIdDocument", "Government ID", application.documents.governmentId], ["institutionIdDocument", "University ID", application.documents.institutionId], ["authorizationDocument", "Authorization letter", application.documents.authorizationLetter] ] as const).map(([kind, label, present]) => <button key={kind} className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={!present || decision.isPending} onClick={() => void openDocument(application.id, kind)}><FileCheck2 size={14} className="mr-1.5"/>{present ? `View ${label}` : `${label} missing`}</button>)}</div>
      {application.reviewReason && <p className="mt-3 text-xs text-stone-600">Previous note: {application.reviewReason}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2"><button className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={decision.isPending} onClick={() => decision.mutate({ id: application.id, action: "reject" })}>Reject application</button><button className="button min-h-9 px-3 py-1.5 text-xs !bg-emerald-700 hover:!bg-emerald-800" disabled={decision.isPending || !application.documents.governmentId || !application.documents.institutionId || !application.documents.authorizationLetter} onClick={() => decision.mutate({ id: application.id, action: "approve" })}>Approve coordinator</button></div>
    </li>)}</ul>}
  </section>;
}

/** Administrators manage who can do what in their own organization. The server enforces every rule shown here. */
export function PeoplePage({ session }: Props) {
  const orgId = session.organization.id; const base = `/api/organizations/${orgId}/members`;
  const qc = useQueryClient();
  const [text, setText] = useState(""); const [role, setRole] = useState(""); const [state, setState] = useState("");
  const [pending, setPending] = useState<{ member: Member; action: MemberAction } | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const q = useQuery({ queryKey: ["members", orgId], queryFn: async () => (await api.get<Member[]>(base)).data });
  const members = q.data ?? [];
  const adminCount = countActiveAdmins(members);

  const apply = useMutation({
    mutationFn: async ({ member, action }: { member: Member; action: MemberAction }) => {
      if (action.kind === "remove") return api.delete(`${base}/${member.id}`);
      return api.patch(`${base}/${member.id}`, action.kind === "role" ? { role: action.role } : { active: action.active });
    },
    onSuccess: async (_d, v) => { setNotice(`${describeAction(v.member, v.action).title.replace(/\?$/, "")}: done.`); setPending(null); setError(""); await qc.invalidateQueries({ queryKey: ["members", orgId] }); },
    onError: async (e) => {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      setError(memberErrorMessage(status, axios.isAxiosError(e) ? e.response?.data?.error : undefined));
      if (status === 404) { setPending(null); await qc.invalidateQueries({ queryKey: ["members", orgId] }); } // the list is stale
    },
  });
  const ask = (member: Member, action: MemberAction) => { setError(""); setNotice(""); setPending({ member, action }); };
  const rows = filterMembers(members, text, role, state);
  const copy = pending ? describeAction(pending.member, pending.action) : null;

  return (
    <div className="space-y-5">
      <div><h2 className="text-xl font-semibold tracking-tight">People and roles</h2>
        <p className="mt-1 text-sm text-stone-500">Manage access and review coordinator applications for {session.organization.name}.</p></div>

      <StaffApplications organizationId={orgId} />
      <StudentImport organizationId={orgId} />

      <details className="rounded-xl border border-stone-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium">What each role can do</summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{ASSIGNABLE_ROLES.map((r) => <div key={r}><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-stone-600">{ROLE_DESCRIPTION[r]}</dd></div>)}</dl></details>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()} aria-label="Filter people">
        <label className="text-sm">Search<Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or email" className="mt-1 w-56" maxLength={100} /></label>
        <label className="text-sm">Role<Select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 min-w-40"><option value="">All roles</option>{ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></label>
        <label className="text-sm">Status<Select value={state} onChange={(e) => setState(e.target.value)} className="mt-1 min-w-36"><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></label>
        <p className="ml-auto text-sm text-stone-500" role="status">{q.data ? `${rows.length} of ${members.length} people` : ""}</p>
      </form>

      {notice && <Alert variant="success" role="status">{notice}</Alert>}
      {q.isError ? <Alert variant="destructive">People couldn't be loaded. <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button></Alert> : !q.data ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{members.length === 0 ? "No members yet." : "No one matches these filters."}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <Table><caption className="sr-only">Organization members</caption>
            <TableHeader><TableRow><TableHead scope="col">Person</TableHead><TableHead scope="col">Role</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((m) => {
              const s = memberState(session.user.email, m, adminCount);
              return (
                <TableRow key={m.id}>
                  <TableCell><p className="font-medium text-stone-900">{m.name}{s.isSelf && <span className="ml-2 text-xs font-normal text-stone-500">(you)</span>}</p><p className="text-xs text-stone-500">{m.email}</p></TableCell>
                  <TableCell>
                    {m.role === "platform_admin" ? <Badge variant="outline">{ROLE_LABEL[m.role]}</Badge> : (
                      <><label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
                        <Select id={`role-${m.id}`} value={m.role} disabled={!s.canChangeRole || apply.isPending} aria-describedby={s.roleBlockedReason ? `why-${m.id}` : undefined} onChange={(e) => { if (e.target.value !== m.role) ask(m, { kind: "role", role: e.target.value as MemberRole }); }} className="min-w-36">
                          {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
                        {s.roleBlockedReason && <p id={`why-${m.id}`} className="mt-1 max-w-xs text-xs text-stone-500">{s.roleBlockedReason}</p>}</>)}
                  </TableCell>
                  <TableCell><Badge variant={m.active ? "success" : "outline"}>{m.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={!s.canToggleActive || apply.isPending} title={s.activeBlockedReason || undefined} onClick={() => ask(m, { kind: "active", active: !m.active })}>{m.active ? "Deactivate" : "Reactivate"}</Button>
                    <Button size="sm" variant="ghost" disabled={!s.canRemove || apply.isPending} title={s.removeBlockedReason || undefined} onClick={() => ask(m, { kind: "remove" })}>Remove</Button>
                  </TableCell>
                </TableRow>);
            })}</TableBody></Table>
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o && !apply.isPending) { setPending(null); setError(""); } }} ariaLabel="Confirm member change">
        <DialogContent className="w-[min(100vw-2rem,30rem)]">
          {copy && pending && (<>
            <DialogHeader><div><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.body}</DialogDescription></div></DialogHeader>
            {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
            <DialogFooter>
              <Button variant="outline" disabled={apply.isPending} onClick={() => { setPending(null); setError(""); }}>Cancel</Button>
              <Button variant={copy.destructive ? "destructive" : "default"} disabled={apply.isPending} onClick={() => apply.mutate(pending)}>{apply.isPending ? "Saving…" : copy.confirm}</Button>
            </DialogFooter></>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
