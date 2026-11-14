import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { BookOpen, Plus, X } from "lucide-react";
import { api } from "./lib/api";
import { Badge, Button } from "./components/ui";
import { EmailPreferences, type NotificationsPayload } from "./notifications";

const ROLE: Record<string, string> = { institute_admin: "Administrator", teacher: "Teacher", proctor: "Reviewer", student: "Candidate", platform_admin: "Platform administrator" };

function TeacherSubjects({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const endpoint = `/api/organizations/${organizationId}/teacher-profile`;
  const [subject, setSubject] = useState("");
  const [error, setError] = useState("");
  const profile = useQuery({
    queryKey: ["teacher-profile", organizationId],
    queryFn: async () => (await api.get<{ subjects: string[] }>(endpoint)).data,
  });
  const save = useMutation({
    mutationFn: async (subjects: string[]) => (await api.patch<{ subjects: string[] }>(endpoint, { subjects })).data,
    onSuccess: async () => {
      setError("");
      setSubject("");
      await queryClient.invalidateQueries({ queryKey: ["teacher-profile", organizationId] });
    },
    onError: (requestError) => setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? "Subjects could not be saved." : "Subjects could not be saved."),
  });
  const subjects = profile.data?.subjects ?? [];
  const addSubject = (event: React.FormEvent) => {
    event.preventDefault();
    const value = subject.trim();
    if (!value) return;
    if (subjects.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError("That subject is already in your profile.");
      return;
    }
    if (subjects.length >= 20) {
      setError("A profile can include up to 20 subjects.");
      return;
    }
    save.mutate([...subjects, value]);
  };
  return <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="teacher-subjects">
    <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><BookOpen size={19}/></span><div><h3 id="teacher-subjects" className="font-semibold">Teaching subjects</h3><p className="mt-1 text-sm text-stone-500">List the subjects you teach at this institution.</p></div></div>
    {profile.isError ? <p role="alert" className="mt-4 text-sm text-red-700">Your teaching profile couldn’t be loaded. <button type="button" className="underline" onClick={() => void profile.refetch()}>Retry</button></p>
      : profile.isLoading ? <p className="mt-4 text-sm text-stone-500">Loading subjects…</p>
      : <><ul className="mt-4 flex flex-wrap gap-2">{subjects.map((item) => <li key={item} className="inline-flex items-center gap-2 rounded-full bg-stone-100 py-1.5 pl-3 pr-1.5 text-sm text-stone-700">{item}<button type="button" className="grid h-6 w-6 place-items-center rounded-full text-stone-500 hover:bg-white hover:text-red-700 disabled:opacity-50" aria-label={`Remove ${item}`} disabled={save.isPending} onClick={() => save.mutate(subjects.filter((value) => value !== item))}><X size={14}/></button></li>)}</ul>
        {!subjects.length && <p className="mt-4 rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500">No subjects added yet.</p>}
        <form onSubmit={addSubject} className="mt-4 flex flex-col gap-2 sm:flex-row"><label htmlFor="teacher-subject-input" className="sr-only">Add a teaching subject</label><input id="teacher-subject-input" className="input" value={subject} maxLength={80} onChange={(event) => { setSubject(event.target.value); setError(""); }} placeholder="e.g. Mathematics" /><button type="submit" className="button inline-flex shrink-0 items-center gap-2" disabled={save.isPending || !subject.trim()}><Plus size={16}/>{save.isPending ? "Saving…" : "Add subject"}</button></form>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </>}
  </section>;
}

/** Account details and personal preferences for every role. The app has no authenticated password-change endpoint, so it says so plainly. */
export function AccountPage({ session, onSignOut }: { session: { user: { name: string; email: string }; organization: { id: string; name: string }; role: string }; onSignOut: () => void }) {
  const notes = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get<NotificationsPayload>("/api/notifications")).data });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header><h2 className="text-xl font-semibold tracking-tight">Account</h2><p className="mt-1 text-sm text-stone-500">Your details and personal preferences.</p></header>
      <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="acct-details"><h3 id="acct-details" className="font-semibold">Details</h3>
        <dl className="mt-3 divide-y divide-stone-100 text-sm">
          {[["Name", session.user.name], ["Email", session.user.email], ["Organization", session.organization.name]].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-stone-500">{k}</dt><dd className="font-medium text-stone-900">{v}</dd></div>)}
          <div className="flex justify-between gap-4 py-2"><dt className="text-stone-500">Role</dt><dd><Badge variant="outline">{ROLE[session.role] ?? session.role}</Badge></dd></div>
        </dl>
        <p className="mt-3 text-xs text-stone-500">To change your name, email or role, ask an administrator of your organization.</p></section>
      {session.role === "teacher" && <TeacherSubjects organizationId={session.organization.id} />}
      <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="acct-email"><h3 id="acct-email" className="font-semibold">Email notifications</h3>
        {notes.isError ? <p role="alert" className="mt-2 text-sm text-red-700">Your email settings couldn't be loaded. Reload the page to try again.</p> : notes.data?.emailConfigured ? <div className="mt-3 text-sm"><EmailPreferences /><p className="mt-3 text-xs text-stone-500">Security emails such as password resets are always sent.</p></div> : <p className="mt-2 text-sm text-stone-500">{notes.isLoading ? "Loading…" : "Email delivery isn't set up for this deployment, so notifications appear in the app only."}</p>}</section>
      <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="acct-pw"><h3 id="acct-pw" className="font-semibold">Password</h3>
        <p className="mt-2 text-sm text-stone-600">To change your password, sign out and choose <b>Forgot password</b> on the sign-in page. A reset link will be emailed to you.</p>
        <div className="mt-3 flex gap-3"><Button variant="outline" onClick={onSignOut}>Sign out</Button><Link to="/login" onClick={onSignOut} className="self-center text-sm font-medium text-stone-600 underline">Go to sign-in</Link></div></section>
    </div>
  );
}
