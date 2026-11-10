import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "./lib/api";
import { Badge, Button, Skeleton } from "./components/ui";
import { STATUS_LABEL, attentionItems, examOverview, type ExamLite, type Stats } from "./lib/staff-overview";

type Session = { organization: { id: string; name: string }; role: string; user: { name: string } };
type Incident = { id: string; type?: string; severity?: string; status: string; createdAt: string; summary?: string; message?: string };
type Dash = { stats: Stats; incidents: Incident[] };
const when = (v?: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** Staff home: what needs a person's attention now, what's live and what's next. Every figure comes from the dashboard and exams APIs. */
export function StaffOverview({ session }: { session: Session }) {
  const org = `/api/organizations/${session.organization.id}`;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  const dash = useQuery({ queryKey: ["dashboard", session.organization.id], queryFn: async () => (await api.get<Dash>(`${org}/dashboard`)).data, refetchInterval: 60_000 });
  const exams = useQuery({ queryKey: ["exams", session.organization.id], queryFn: async () => (await api.get<ExamLite[]>(`${org}/exams`)).data });

  if (dash.isLoading) return <div className="space-y-4" aria-busy="true" aria-label="Loading overview"><Skeleton className="h-12 w-1/2" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-48" /></div>;
  if (dash.isError || !dash.data) return <div className="card text-center"><AlertTriangle className="mx-auto text-red-500" aria-hidden="true" /><h2 className="mt-3 font-semibold">We couldn’t load the workspace</h2><p className="mt-1 text-sm text-slate-500">Check your connection, then try again.</p><Button className="mt-3" variant="outline" onClick={() => void dash.refetch()}>Try again</Button></div>;

  const stats = dash.data.stats; const items = attentionItems(stats, session.role);
  const overview = exams.data ? examOverview(exams.data, now) : null;
  const isAdmin = session.role === "institute_admin";

  return (
    <div className="space-y-6">
      <header><h2 className="text-xl font-semibold tracking-tight">Good to see you, {session.user.name.split(" ")[0]}</h2><p className="mt-1 text-sm text-stone-500">{session.organization.name}</p></header>

      <section aria-labelledby="attn-title" className="rounded-xl border border-stone-200 bg-white">
        <h3 id="attn-title" className="border-b border-stone-100 px-5 py-3 font-semibold">Needs your attention</h3>
        {items.length === 0 ? <p className="px-5 py-8 text-center text-sm text-stone-500">Nothing is waiting for you. New submissions, incidents and verifications will appear here.</p> : (
          <ul className="divide-y divide-stone-100">{items.map((i) => (
            <li key={i.id}><Link to={i.path} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900"><span className="text-sm text-stone-800">{i.label}</span><span className="flex items-center gap-3"><Badge variant={i.urgent ? "warning" : "outline"}>{i.count}</Badge><ArrowRight size={14} aria-hidden="true" className="text-stone-400" /></span></Link></li>))}</ul>)}
      </section>

      <dl className="grid gap-3 sm:grid-cols-3">
        {([["Examinations", stats.exams, "/app/exams"], ["Candidates", stats.candidates, "/app/candidates"], ["In progress now", stats.activeSessions, "/app/monitoring"]] as const).map(([label, value, path]) => (
          <Link key={label} to={path} className="rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900"><dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt><dd className="mt-1 text-3xl font-semibold">{value}</dd></Link>))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="exams-title" className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between"><h3 id="exams-title" className="font-semibold">Examinations</h3><Link to="/app/exams" className="text-sm font-medium text-stone-600 underline">Manage</Link></div>
          {exams.isError ? <p className="mt-3 text-sm text-red-700" role="alert">Examinations couldn't be loaded.</p> : !overview ? <Skeleton className="mt-3 h-24" /> : exams.data!.length === 0 ? <p className="mt-3 text-sm text-stone-500">No examinations yet. Create one from the Examinations page.</p> : (<>
            <ul className="mt-3 flex flex-wrap gap-2">{Object.entries(overview.byStatus).map(([s, n]) => <li key={s}><Badge variant={s === "live" ? "success" : "outline"}>{n} {STATUS_LABEL[s] ?? s}</Badge></li>)}</ul>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-stone-500">Open right now</dt><dd className="text-right font-medium">{overview.liveNow.length ? overview.liveNow.map((e) => e.title).join(", ") : "None"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-stone-500">Next to open</dt><dd className="text-right font-medium">{overview.next ? <>{overview.next.title}<span className="block text-xs font-normal text-stone-500">{when(overview.next.startsAt)}</span></> : "Nothing scheduled"}</dd></div>
            </dl></>)}
        </section>

        <section aria-labelledby="inc-title" className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between"><h3 id="inc-title" className="font-semibold">Open incidents</h3><Link to="/app/incidents" className="text-sm font-medium text-stone-600 underline">Review</Link></div>
          {dash.data.incidents.length === 0 ? <p className="mt-3 text-sm text-stone-500">No open incidents.</p> : <ul className="mt-3 divide-y divide-stone-100">{dash.data.incidents.map((i) => <li key={i.id} className="py-2 text-sm"><p className="font-medium text-stone-900">{(i.type ?? "Incident").replaceAll("_", " ")}{i.severity ? <span className="ml-2 text-xs font-normal text-stone-500">{i.severity}</span> : null}</p><p className="text-xs text-stone-500">{when(i.createdAt)}</p></li>)}</ul>}
          <p className="mt-3 text-xs text-stone-500">Incidents are review items created from automated signals. They are not findings; a person decides.</p>
        </section>
      </div>

      {isAdmin && (
        <nav aria-label="Administration" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([["People & roles", "/app/people"], ["Audit log", "/app/audit"], ["Operations", "/app/operations"], ["Results & reports", "/app/reports"]] as const).map(([label, path]) => <Link key={path} to={path} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium hover:border-stone-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900">{label}</Link>)}
        </nav>)}
    </div>
  );
}
