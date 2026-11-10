import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { Badge, Button } from "./components/ui";
import { EmailPreferences, type NotificationsPayload } from "./notifications";

const ROLE: Record<string, string> = { institute_admin: "Administrator", teacher: "Teacher", proctor: "Reviewer", student: "Candidate", platform_admin: "Platform administrator" };

/** Account details and personal preferences for every role. The app has no authenticated password-change endpoint, so it says so plainly. */
export function AccountPage({ session, onSignOut }: { session: { user: { name: string; email: string }; organization: { name: string }; role: string }; onSignOut: () => void }) {
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
      <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="acct-email"><h3 id="acct-email" className="font-semibold">Email notifications</h3>
        {notes.isError ? <p role="alert" className="mt-2 text-sm text-red-700">Your email settings couldn't be loaded. Reload the page to try again.</p> : notes.data?.emailConfigured ? <div className="mt-3 text-sm"><EmailPreferences /><p className="mt-3 text-xs text-stone-500">Security emails such as password resets are always sent.</p></div> : <p className="mt-2 text-sm text-stone-500">{notes.isLoading ? "Loading…" : "Email delivery isn't set up for this deployment, so notifications appear in the app only."}</p>}</section>
      <section className="rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="acct-pw"><h3 id="acct-pw" className="font-semibold">Password</h3>
        <p className="mt-2 text-sm text-stone-600">To change your password, sign out and choose <b>Forgot password</b> on the sign-in page. A reset link will be emailed to you.</p>
        <div className="mt-3 flex gap-3"><Button variant="outline" onClick={onSignOut}>Sign out</Button><Link to="/login" onClick={onSignOut} className="self-center text-sm font-medium text-stone-600 underline">Go to sign-in</Link></div></section>
    </div>
  );
}
