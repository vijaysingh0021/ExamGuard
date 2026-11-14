import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, BadgeCheck, BookOpen, Building2, ChevronRight, CircleCheck, Database, Download, FileSearch, HardDrive, LayoutDashboard, RefreshCw, Server, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { PlatformMembers } from './platform-members';

type RequestRow = {
  id: string;
  name: string;
  requesterEmail: string;
  status: string;
  createdAt: string;
  documents: { governmentId: boolean; institutionId: boolean; authorizationLetter: boolean };
};
type StaffRow = {
  id: string;
  status: string;
  user: { name: string; email: string };
  organization: { name: string };
  documents: { governmentId: boolean; institutionId: boolean; authorizationLetter: boolean };
};
type PlatformOverview = {
  generatedAt: string;
  range: { days: number; from: string };
  health: {
    api: 'operational' | 'degraded';
    database: 'connected' | 'unavailable';
    storage: 'configured_not_verified' | 'unconfigured';
    aiService: 'configured_not_verified' | 'unconfigured';
    email: 'configured_not_verified' | 'unconfigured';
  };
  comparisons: { currentRegistrations: number; previousRegistrations: number; currentParticipation: number; previousParticipation: number; currentExams: number; previousExams: number };
  runtime: { uptimeSeconds: number; snapshotQueryMs: number; memory: { rss: number; heapUsed: number; heapTotal: number } };
  organizations: { total: number; active: number };
  users: { total: number; memberships: number; activeMemberships: number; inactiveMemberships: number; byRole: Record<string, number> };
  exams: { total: number; byStatus: Record<string, number> };
  activeExams: number;
  liveExamDetails: Array<{ id: string; title: string; startsAt: string | null; endsAt: string | null; organization: { name: string }; _count: { attempts: number } }>;
  attempts: { total: number; byStatus: Record<string, number> };
  institutionRequests: Record<string, number>;
  staffVerifications: Record<string, number>;
  activity: Array<{ day: string; count: number }>;
  registrations: Array<{ day: string; count: number }>;
  participation: Array<{ day: string; count: number }>;
  examCreations: Array<{ day: string; count: number }>;
  detections: {
    byType: Record<string, number>;
    ai: Array<{ key: string; series: Array<{ day: string; count: number }> }>;
    phone: Array<{ day: string; count: number }>;
  };
  incidents: {
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    trend: Array<{ key: string; series: Array<{ day: string; count: number }> }>;
  };
  evidence: { items: number; bytes: number; byType: Array<{ type: string; count: number; bytes: number }> };
  emailOutbox: Record<string, number>;
  performance: { publishedGrades: number; averagePercent: number | null; distribution: Array<{ range: string; count: number }> };
  recentAudit: Array<{ id: string; action: string; targetType: string | null; createdAt: string; actor: { name: string } | null }>;
};
type ActivityMetric = 'activity' | 'registrations' | 'participation' | 'examCreations';
type DashboardView = 'overview' | 'users' | 'exams' | 'ai' | 'evidence' | 'security' | 'health' | 'analytics' | 'support' | 'reviews' | 'members';
const isActivityMetric = (value: string): value is ActivityMetric =>
  value === 'activity' || value === 'registrations' || value === 'participation' || value === 'examCreations';

const ready = (documents: Record<string, boolean>) => Object.values(documents).every(Boolean);
const pendingCount = (counts: Record<string, number>) => (counts.submitted ?? 0) + (counts.under_review ?? 0) + (counts.resubmission_required ?? 0);
const number = (value: number) => new Intl.NumberFormat().format(value);
const bytes = (value: number) => value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const uptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
};
const chartColors = ['#b58a50', '#557c72', '#7484b5', '#d2a84f', '#9c6d69', '#5a7892', '#8e8d72'];
const roleLabels: Record<string, string> = {
  platform_admin: 'System administrators',
  institute_admin: 'Institution admins',
  teacher: 'Teachers',
  proctor: 'Proctors',
  student: 'Students',
};
const examLabels: Record<string, string> = { draft: 'Draft', published: 'Published', scheduled: 'Scheduled', live: 'Ongoing', completed: 'Completed' };

function exportOverview(data: PlatformOverview) {
  const rows = [
    ['Metric', 'Value'],
    ['Institutions', data.organizations.total],
    ['Active institutions', data.organizations.active],
    ['Accounts', data.users.total],
    ['Active memberships', data.users.activeMemberships],
    ['Inactive memberships', data.users.inactiveMemberships],
    ['Exams', data.exams.total],
    ['Attempts', data.attempts.total],
    ['Published grades', data.performance.publishedGrades],
    ['Average published score', data.performance.averagePercent === null ? 'Unavailable' : `${data.performance.averagePercent}%`],
    ...Object.entries(data.users.byRole).map(([role, count]) => [roleLabels[role] ?? role, count]),
    ...Object.entries(data.exams.byStatus).map(([status, count]) => [`Exams: ${examLabels[status] ?? status}`, count]),
    ...Object.entries(data.attempts.byStatus).map(([status, count]) => [`Attempts: ${status.replaceAll('_', ' ')}`, count]),
    ...data.activity.map(({ day, count }) => [`Audit activity ${day}`, count]),
    ...data.registrations.map(({ day, count }) => [`Registrations ${day}`, count]),
    ...data.participation.map(({ day, count }) => [`Exam participation ${day}`, count]),
  ];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'examguard-platform-overview.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function SystemAdminPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [view, setView] = useState<DashboardView>('overview');
  const [activityMetric, setActivityMetric] = useState<ActivityMetric>('activity');
  const [dateRange, setDateRange] = useState<7 | 30 | 90>(30);
  const [selectedDay, setSelectedDay] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewResponse, institutionResponse, staffResponse] = await Promise.all([
        api.get<PlatformOverview>('/api/platform/overview', { params: { days: dateRange } }),
        api.get<RequestRow[]>('/api/platform/institution-requests'),
        api.get<StaffRow[]>('/api/platform/staff-verifications'),
      ]);
      setOverview(overviewResponse.data);
      setRequests(institutionResponse.data);
      setStaff(staffResponse.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'System administration data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);
  const decide = async (path: string, action: string, id: string) => {
    setSavingId(id);
    setError('');
    try {
      await api.post(`/api/platform/${path}/${id}/decision`, {
        action,
        reason: action === 'request_more_information' ? 'Please provide the missing verification documents.' : 'Reviewed by system administration.',
      });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The review decision could not be saved.');
    } finally {
      setSavingId('');
    }
  };
  const openDocument = async (path: string) => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setError('Allow pop-ups to view private proof documents.'); return; }
    tab.opener = null;
    try {
      const { data } = await api.get<{ url: string }>(path);
      tab.location.replace(data.url);
    } catch (requestError) {
      tab.close();
      setError(requestError instanceof Error ? requestError.message : 'The proof document could not be opened.');
    }
  };
  const liveAttempts = (overview?.attempts.byStatus.in_progress ?? 0) + (overview?.attempts.byStatus.paused ?? 0);
  const pendingInstitutions = pendingCount(overview?.institutionRequests ?? {});
  const pendingStaff = pendingCount(overview?.staffVerifications ?? {});
  const roleData = useMemo(() => Object.entries(overview?.users.byRole ?? {}).map(([role, count]) => ({ name: roleLabels[role] ?? role, count })), [overview]);
  const examData = useMemo(() => Object.entries(overview?.exams.byStatus ?? {}).map(([status, count]) => ({ name: examLabels[status] ?? status, count })), [overview]);
  const activitySeries = overview?.[activityMetric] ?? [];
  const detectionSeries = useMemo(() => {
    const daily = new Map<string, Record<string, number>>();
    for (const detection of overview?.detections.ai ?? []) {
      for (const { day, count } of detection.series) {
        daily.set(day, { ...(daily.get(day) ?? {}), [detection.key]: count });
      }
    }
    return [...daily.entries()].map(([day, counts]) => ({ day, ...counts }));
  }, [overview]);
  const incidentSeries = useMemo(() => {
    const daily = new Map<string, Record<string, number>>();
    for (const incident of overview?.incidents.trend ?? []) {
      for (const { day, count } of incident.series) {
        daily.set(day, { ...(daily.get(day) ?? {}), [incident.key]: count });
      }
    }
    return [...daily.entries()].map(([day, counts]) => ({ day, ...counts }));
  }, [overview]);
  const activityTitle = {
    activity: 'Audited platform activity',
    registrations: 'New account registrations',
    participation: 'Exam participation',
    examCreations: 'New exams created',
  }[activityMetric];
  const severityTotal = Object.values(overview?.incidents.bySeverity ?? {}).reduce((total, count) => total + count, 0);
  const rangeLabel = overview ? `${new Date(`${overview.range.from}T00:00:00`).toLocaleDateString()} – ${new Date(`${overview.activity.at(-1)?.day ?? overview.range.from}T00:00:00`).toLocaleDateString()}` : '';
  const comparisonData = overview ? [
    { metric: 'Registrations', current: overview.comparisons.currentRegistrations, previous: overview.comparisons.previousRegistrations },
    { metric: 'Participation', current: overview.comparisons.currentParticipation, previous: overview.comparisons.previousParticipation },
    { metric: 'Exams created', current: overview.comparisons.currentExams, previous: overview.comparisons.previousExams },
  ] : [];
  const selectedDayMetrics = overview && selectedDay ? {
    audit: overview.activity.find(item => item.day === selectedDay)?.count ?? 0,
    registrations: overview.registrations.find(item => item.day === selectedDay)?.count ?? 0,
    participation: overview.participation.find(item => item.day === selectedDay)?.count ?? 0,
    exams: overview.examCreations.find(item => item.day === selectedDay)?.count ?? 0,
    phone: overview.detections.phone.find(item => item.day === selectedDay)?.count ?? 0,
    incidents: overview.incidents.trend.reduce((total, item) => total + (item.series.find(day => day.day === selectedDay)?.count ?? 0), 0),
  } : null;
  const navigateView = (target: DashboardView) => {
    setView(target);
    if (target === 'members' || target === 'reviews') return;
    requestAnimationFrame(() => document.getElementById(`admin-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const sections: Array<{ id: DashboardView; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'exams', label: 'Exams', icon: BookOpen },
    { id: 'ai', label: 'AI monitoring', icon: Activity },
    { id: 'evidence', label: 'Evidence', icon: FileSearch },
    { id: 'security', label: 'Security', icon: ShieldAlert },
    { id: 'health', label: 'System health', icon: Server },
    { id: 'analytics', label: 'Analytics', icon: Activity },
    { id: 'support', label: 'Support & settings', icon: ShieldCheck },
  ];

  return <div className="system-admin-control space-y-5">
    <section className="system-admin-hero overflow-hidden rounded-[1.65rem] text-white">
      <div className="system-admin-hero-glow" aria-hidden="true"/>
      <div className="relative grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-9">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">ExamGuard · global operations</p>
          <h2 className="mt-3 font-serif text-3xl font-medium tracking-tight md:text-4xl">Platform control center</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Institution-independent oversight for identity, examinations, integrity signals, and platform health.</p>
          {overview && <p className="mt-4 text-xs text-slate-400">Updated {new Date(overview.generatedAt).toLocaleString()} · refreshed every 30 seconds · {rangeLabel}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-300">Time range<select value={dateRange} onChange={event => { setSelectedDay(''); setDateRange(Number(event.target.value) as 7 | 30 | 90); }} className="mt-1 block h-10 rounded-xl border border-white/15 bg-slate-900/60 px-3 text-sm text-white"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
          <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-100 disabled:opacity-60" onClick={() => overview && exportOverview(overview)} disabled={!overview}>
            <Download size={16} aria-hidden="true" /> Export data
          </button>
        </div>
      </div>
      <div className="relative grid border-t border-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Building2, label: 'Institutions', value: overview?.organizations.total, detail: `${number(overview?.organizations.active ?? 0)} active` },
          { icon: Users, label: 'Platform accounts', value: overview?.users.total, detail: `${number(overview?.users.activeMemberships ?? 0)} active memberships` },
          { icon: BadgeCheck, label: 'Exams created', value: overview?.exams.total, detail: `${number(overview?.exams.byStatus.live ?? 0)} ongoing` },
          { icon: Activity, label: 'Active attempts', value: liveAttempts, detail: `${number(overview?.attempts.byStatus.in_progress ?? 0)} in progress · ${number(overview?.attempts.byStatus.paused ?? 0)} paused` },
        ].map(({ icon: Icon, label, value, detail }) => <div key={label} className="border-white/10 px-6 py-5 sm:border-l first-of-type:border-l-0">
          <div className="flex items-center gap-2 text-sm text-slate-300"><Icon size={16} aria-hidden="true" />{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{loading && value === undefined ? '—' : number(value ?? 0)}</div>
          <p className="mt-1 text-xs text-slate-400">{detail}</p>
        </div>)}
      </div>
    </section>

    <nav className="system-admin-nav" aria-label="System administration modules">
      {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => navigateView(id)} className={view === id ? 'system-admin-nav-active' : ''}><Icon size={16}/><span>{label}</span></button>)}
      <button type="button" aria-current={view === 'members' ? 'page' : undefined} onClick={() => navigateView('members')} className={view === 'members' ? 'system-admin-nav-active' : ''}><Users size={16}/><span>Manage accounts</span></button>
      <button type="button" aria-current={view === 'reviews' ? 'page' : undefined} onClick={() => navigateView('reviews')} className={view === 'reviews' ? 'system-admin-nav-active' : ''}><BadgeCheck size={16}/><span>Trust reviews</span><i>{pendingInstitutions + pendingStaff}</i></button>
    </nav>

    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {view === 'members' ? <PlatformMembers /> : view !== 'reviews' ? <>
      {loading && !overview ? <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading platform overview"><div className="h-72 animate-pulse rounded-2xl bg-slate-100" /><div className="h-72 animate-pulse rounded-2xl bg-slate-100" /></div> : overview && <>
        <div className="grid gap-4 xl:grid-cols-3">
          <section id="admin-overview" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Platform activity · {dateRange} days</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{activityTitle}</h3></div><label className="text-xs font-semibold text-slate-600">Explore metric<select value={activityMetric} onChange={event => { if (isActivityMetric(event.target.value)) setActivityMetric(event.target.value); }} className="mt-1 block h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="activity">Audit events</option><option value="registrations">Registrations</option><option value="participation">Exam participation</option><option value="examCreations">Exams created</option></select></label></div>
            <div className="mt-5 h-64" role="img" aria-label={`Daily ${activityTitle.toLowerCase()} over ${dateRange} days`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activitySeries} onClick={state => { if (state?.activeLabel) setSelectedDay(String(state.activeLabel)); }} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0891b2" stopOpacity={0.25} /><stop offset="95%" stopColor="#0891b2" stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString()} />
                  <Area type="monotone" dataKey="count" name={activityTitle} stroke="#0891b2" strokeWidth={2.5} fill="url(#activityFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {selectedDayMetrics && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-cyan-950"><b>{new Date(`${selectedDay}T00:00:00`).toLocaleDateString()} drill-down</b><span>{number(selectedDayMetrics.audit)} audits</span><span>{number(selectedDayMetrics.registrations)} registrations</span><span>{number(selectedDayMetrics.participation)} exam starts</span><span>{number(selectedDayMetrics.exams)} exams created</span><span>{number(selectedDayMetrics.phone)} phone signals</span><span>{number(selectedDayMetrics.incidents)} incidents</span><button type="button" className="ml-auto font-semibold underline" onClick={() => setSelectedDay('')}>Clear</button></div>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Service status</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Platform health</h3></div>
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="flex items-center gap-2 text-sm font-medium"><Activity size={17} className="text-slate-500" />API</span><Badge variant={overview.health.api === 'operational' ? 'success' : 'danger'}>{overview.health.api === 'operational' && <CircleCheck size={13} className="mr-1" />}{overview.health.api === 'operational' ? 'Operational' : 'Degraded'}</Badge></div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="flex items-center gap-2 text-sm font-medium"><Database size={17} className="text-slate-500" />Database</span><Badge variant={overview.health.database === 'connected' ? 'success' : 'danger'}>{overview.health.database === 'connected' && <CircleCheck size={13} className="mr-1" />}{overview.health.database === 'connected' ? 'Connected' : 'Unavailable'}</Badge></div>
            </div>
            <div className="mt-5 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Published exam results</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{overview.performance.averagePercent === null ? '—' : `${overview.performance.averagePercent.toFixed(1)}%`}</p>
              <p className="mt-1 text-xs text-slate-500">Average score across {number(overview.performance.publishedGrades)} published grades</p>
            </div>
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-950">Trust reviews</p>
              <p className="mt-1 text-xs leading-5 text-amber-900">{number(pendingInstitutions)} institution applications and {number(pendingStaff)} staff reviews need attention.</p>
              <button type="button" onClick={() => setView('reviews')} className="mt-3 text-xs font-bold text-amber-950 underline underline-offset-2">Open review queue</button>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Health reflects successful authenticated API and database queries; external services are not probed by this view.</p>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section id="admin-users" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Global membership mix</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Users by role</h3></div><button type="button" onClick={() => navigateView('members')} className="text-xs font-semibold text-blue-700 hover:underline">Manage accounts →</button></div>
            {roleData.every(item => item.count === 0) ? <p className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No memberships have been recorded.</p> : <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,.8fr)]">
              <div className="relative h-56" role="img" aria-label="Donut chart showing global membership by role"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={roleData.filter(item => item.count > 0)} dataKey="count" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} stroke="none">{roleData.filter(item => item.count > 0).map((item, index) => <Cell key={item.name} fill={chartColors[index % chartColors.length]}/>)}</Pie><Tooltip formatter={(value: number) => number(value)}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><b className="text-2xl text-slate-900">{number(overview.users.memberships)}</b><span className="text-[10px] text-slate-500">memberships</span></div></div>
              <div className="space-y-2">{roleData.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 text-slate-600"><i className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }}/><span className="truncate">{item.name}</span></span><b className="text-slate-900">{number(item.count)}</b></div>)}</div>
            </div>}
            <p className="mt-2 text-[11px] text-slate-500">{number(overview.users.activeMemberships)} active · {number(overview.users.inactiveMemberships)} inactive membership records</p>
          </section>
          <section id="admin-exams" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">All institutions</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Examination lifecycle</h3></div><Badge variant="outline">{number(overview.activeExams)} live now</Badge></div>
            {examData.every(item => item.count === 0) ? <p className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No examinations have been created.</p> : <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,.8fr)]">
              <div className="relative h-56" role="img" aria-label="Donut chart showing examinations by lifecycle status"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={examData.filter(item => item.count > 0)} dataKey="count" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} stroke="none">{examData.filter(item => item.count > 0).map((item, index) => <Cell key={item.name} fill={chartColors[(index + 2) % chartColors.length]}/>)}</Pie><Tooltip formatter={(value: number) => number(value)}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><b className="text-2xl text-slate-900">{number(overview.exams.total)}</b><span className="text-[10px] text-slate-500">exams</span></div></div>
              <div className="space-y-2">{examData.map((item, index) => <div key={item.name} className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-slate-600"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors[(index + 2) % chartColors.length] }}/>{item.name}</span><b className="text-slate-900">{number(item.count)}</b></div>)}</div>
            </div>}
            <p className="mt-2 text-[11px] text-slate-500">{number(overview.attempts.byStatus.in_progress ?? 0)} candidates currently in progress across {number(overview.organizations.active)} active institutions</p>
          </section>
        </div>

        <section className="system-admin-panel overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cross-institution snapshot</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Live examinations</h3></div><Badge variant={overview.liveExamDetails.length ? 'success' : 'muted'}>{number(overview.activeExams)} active</Badge></div>
          {overview.liveExamDetails.length === 0 ? <p className="p-5 text-sm text-slate-500">No live examinations are recorded right now.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Examination</th><th className="px-5 py-3 font-semibold">Institution</th><th className="px-5 py-3 font-semibold">Attempts</th><th className="px-5 py-3 font-semibold">Scheduled window</th></tr></thead><tbody className="divide-y divide-slate-100">{overview.liveExamDetails.map(exam => <tr key={exam.id}><td className="px-5 py-3 font-medium text-slate-900">{exam.title}</td><td className="px-5 py-3 text-slate-600">{exam.organization.name}</td><td className="px-5 py-3 tabular-nums text-slate-700">{number(exam._count.attempts)}</td><td className="px-5 py-3 text-xs text-slate-600">{exam.startsAt ? new Date(exam.startsAt).toLocaleString() : 'Start time not set'}{exam.endsAt ? ` – ${new Date(exam.endsAt).toLocaleString()}` : ''}</td></tr>)}</tbody></table></div>}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <section id="admin-ai" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Recorded AI-service signals</p><h3 className="mt-1 text-lg font-semibold text-slate-900">AI detection trends</h3></div><Badge variant="muted">{dateRange} days</Badge></div>
            {detectionSeries.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No AI-service detection events were recorded in this period.</p> : <div className="mt-3 h-56" role="img" aria-label="Recorded AI-service detection events by type over time"><ResponsiveContainer width="100%" height="100%"><LineChart data={detectionSeries} onClick={state => { if (state?.activeLabel) setSelectedDay(String(state.activeLabel)); }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false}/><XAxis dataKey="day" tickFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fontSize: 10 }} minTickGap={20}/><YAxis allowDecimals={false} tick={{ fontSize: 10 }}/><Tooltip labelFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString()}/>{(overview.detections.ai).map((series, index) => <Line key={series.key} type="monotone" dataKey={series.key} name={series.key.replaceAll('_', ' ')} stroke={chartColors[index % chartColors.length]} strokeWidth={2} dot={false} connectNulls/> )}</LineChart></ResponsiveContainer></div>}
            <p className="mt-2 text-[11px] leading-5 text-slate-500">Signals are advisory review evidence, not findings of misconduct. Only persisted proctoring events are charted.</p>
          </section>
          <section className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Phone signal events</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Phone detection analytics</h3></div><Badge variant="outline">{number(overview.detections.byType.phone_detected ?? 0)} in range</Badge></div>
            {overview.detections.phone.every(item => item.count === 0) ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No phone-detection events were recorded in this period.</p> : <div className="mt-3 h-56" role="img" aria-label="Persisted phone detection signals by day"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.detections.phone} onClick={state => { if (state?.activeLabel) setSelectedDay(String(state.activeLabel)); }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false}/><XAxis dataKey="day" tickFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fontSize: 10 }} minTickGap={20}/><YAxis allowDecimals={false} tick={{ fontSize: 10 }}/><Tooltip labelFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString()}/><Bar dataKey="count" name="Phone signals" fill="#b58a50" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div>}
            <p className="mt-2 text-[11px] leading-5 text-slate-500">Counts represent recorded signals, including repeated events, not unique candidates or confirmed violations.</p>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section id="admin-security" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Human-reviewed incident queue</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Security incidents</h3></div><Badge variant={number(overview.incidents.byStatus.open ?? 0) ? 'warning' : 'success'}>{number(overview.incidents.byStatus.open ?? 0)} open</Badge></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{['critical','high','medium','low'].map((severity, index) => <div key={severity} className="rounded-xl bg-slate-50 p-3"><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{severity}</span><b className="mt-1 block text-2xl text-slate-900">{number(overview.incidents.bySeverity[severity] ?? 0)}</b><i className="mt-2 block h-1 rounded-full" style={{ backgroundColor: chartColors[index + 1] }}/></div>)}</div>
            {incidentSeries.length ? <div className="mt-4 h-48" role="img" aria-label="Incidents created per day by severity"><ResponsiveContainer width="100%" height="100%"><AreaChart data={incidentSeries} onClick={state => { if (state?.activeLabel) setSelectedDay(String(state.activeLabel)); }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false}/><XAxis dataKey="day" tickFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fontSize: 10 }} minTickGap={20}/><YAxis allowDecimals={false} tick={{ fontSize: 10 }}/><Tooltip labelFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString()}/>{overview.incidents.trend.map((series,index) => <Area key={series.key} type="monotone" dataKey={series.key} name={`${series.key} incidents`} stroke={chartColors[index + 1]} fill={chartColors[index + 1]} fillOpacity={.12} stackId="incidents"/> )}</AreaChart></ResponsiveContainer></div> : <p className="mt-4 text-sm text-slate-500">No incidents recorded during this date range.</p>}
            <p className="mt-2 text-[11px] text-slate-500">{number(severityTotal)} incident records across all organizations. Severity supports prioritization and does not imply a determination.</p>
          </section>
          <section id="admin-evidence" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tracked private evidence</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Evidence storage</h3></div><HardDrive size={19} className="text-stone-500"/></div>
            <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-stone-50 p-4"><span className="text-xs text-stone-500">Indexed objects</span><b className="mt-1 block text-2xl text-stone-900">{number(overview.evidence.items)}</b></div><div className="rounded-xl bg-stone-50 p-4"><span className="text-xs text-stone-500">Tracked size</span><b className="mt-1 block text-2xl text-stone-900">{bytes(overview.evidence.bytes)}</b></div></div>
            {overview.evidence.byType.length ? <div className="mt-4 h-48" role="img" aria-label="Tracked evidence objects by MIME type"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.evidence.byType} layout="vertical" margin={{ left: 12, right: 12 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" horizontal={false}/><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }}/><YAxis type="category" dataKey="type" width={95} tick={{ fontSize: 10 }}/><Tooltip formatter={(value: number) => number(value)}/><Bar dataKey="count" name="Objects" fill="#557c72" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div> : <p className="mt-5 text-sm text-slate-500">No evidence objects are tracked in the database.</p>}
            <p className="text-[11px] text-slate-500">Database-tracked evidence only; unindexed legacy objects and provider capacity are not included.</p>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section id="admin-health" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Live process snapshot</p><h3 className="mt-1 text-lg font-semibold text-slate-900">System health & performance</h3></div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50 p-4"><span className="flex items-center gap-2 text-xs text-emerald-800"><Activity size={14}/> API</span><b className="mt-1 block text-lg text-emerald-950">{overview.health.api}</b><small className="text-emerald-800">Process uptime {uptime(overview.runtime.uptimeSeconds)}</small></div>
              <div className="rounded-xl bg-emerald-50 p-4"><span className="flex items-center gap-2 text-xs text-emerald-800"><Database size={14}/> Database</span><b className="mt-1 block text-lg text-emerald-950">{overview.health.database}</b><small className="text-emerald-800">Snapshot query {number(overview.runtime.snapshotQueryMs)} ms</small></div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-100 p-4"><div className="flex justify-between text-xs"><span className="text-slate-600">Node process memory (RSS)</span><b>{bytes(overview.runtime.memory.rss)}</b></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.min(100, overview.runtime.memory.heapUsed / Math.max(1, overview.runtime.memory.heapTotal) * 100)}%` }}/></div><p className="mt-2 text-[11px] text-slate-500">Heap {bytes(overview.runtime.memory.heapUsed)} used of {bytes(overview.runtime.memory.heapTotal)} allocated · current sample only</p></div>
            <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Historical uptime, API latency percentiles, host CPU, and provider-level capacity are not stored by this application; no synthetic history is shown.</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">{[['Private storage', overview.health.storage], ['AI service', overview.health.aiService], ['Email provider', overview.health.email]].map(([label, status]) => <div key={label} className="rounded-lg border border-slate-100 p-3"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span><b className="mt-1 block text-xs text-slate-800">{status === 'configured_not_verified' ? 'Configured · unverified' : 'Not configured'}</b></div>)}</div>
          </section>
          <section id="admin-support" className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Operations queue</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Support & platform settings</h3></div>
            <div className="mt-4 space-y-3">
              <button type="button" onClick={() => navigateView('reviews')} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-4 text-left transition hover:border-amber-300 hover:bg-amber-50"><span><b className="block text-sm text-slate-800">Institution and staff reviews</b><small className="text-xs text-slate-500">Pending verification workflow</small></span><span className="flex items-center gap-2 text-sm font-bold">{number(pendingInstitutions + pendingStaff)}<ChevronRight size={16}/></span></button>
              <div className="rounded-xl border border-slate-200 p-4"><b className="text-sm text-slate-800">Outbound notification queue</b><div className="mt-2 flex flex-wrap gap-2">{Object.entries(overview.emailOutbox).length ? Object.entries(overview.emailOutbox).map(([status,count]) => <Badge key={status} variant={status === 'failed' ? 'danger' : status === 'queued' ? 'warning' : 'muted'}>{status}: {number(count)}</Badge>) : <span className="text-xs text-slate-500">No queued email records.</span>}</div></div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">Support tickets and editable platform-wide settings are not modeled in this deployment. Configure secrets through the server environment and use the Account workspace for personal profile and password settings.</div>
            </div>
          </section>
        </div>

        <section className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Platform-wide daily record</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Activity heatmap</h3><p className="mt-1 text-xs text-slate-500">Each cell is one UTC day; intensity represents persisted audit records.</p></div><Badge variant="outline">{dateRange} days</Badge></div>
          <div className="mt-5 grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2" role="img" aria-label={`${dateRange}-day heatmap of audit records`} style={{ gridAutoColumns: 'minmax(14px, 1fr)' }}>{overview.activity.map(item => { const max = Math.max(1, ...overview.activity.map(day => day.count)); const intensity = item.count / max; return <button type="button" key={item.day} title={`${item.day}: ${number(item.count)} audit records`} onClick={() => setSelectedDay(item.day)} className="h-4 min-w-4 rounded-[4px] transition hover:ring-2 hover:ring-amber-500" style={{ backgroundColor: item.count ? `rgba(181, 138, 80, ${.18 + intensity * .82})` : '#f1f0ec' }} aria-label={`${item.day}: ${number(item.count)} audit records`}/>; })}</div>
        </section>

        <div id="admin-analytics" className="grid gap-4 xl:grid-cols-2">
          <section className="system-admin-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Period comparison · database totals</p><h3 className="mt-1 text-lg font-semibold text-slate-900">This period vs previous</h3><p className="mt-1 text-xs text-slate-500">{dateRange}-day periods, measured from persisted records</p></div>
            <div className="mt-3 h-56" role="img" aria-label="Comparison of registrations, participation, and exams created between current and previous equal periods"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparisonData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false}/><XAxis dataKey="metric" tick={{ fontSize: 10 }}/><YAxis allowDecimals={false} tick={{ fontSize: 10 }}/><Tooltip/><Bar dataKey="previous" name="Previous period" fill="#cbd5e1" radius={[4,4,0,0]}/><Bar dataKey="current" name="Selected period" fill="#b58a50" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
            <div className="grid grid-cols-3 gap-2">{comparisonData.map(item => { const delta = item.current - item.previous; const DeltaIcon = delta < 0 ? ArrowDownRight : ArrowUpRight; return <div key={item.metric} className="rounded-lg bg-stone-50 p-3"><span className="block truncate text-[10px] text-stone-500">{item.metric}</span><b className="mt-1 block text-lg text-stone-900">{number(item.current)}</b><span className={`mt-1 inline-flex items-center gap-1 text-[10px] ${delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-stone-500'}`}><DeltaIcon size={12}/>{delta > 0 ? '+' : ''}{number(delta)} vs prior</span></div>; })}</div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Published results</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Exam performance distribution</h3></div><Badge variant="outline">{number(overview.performance.publishedGrades)} grades</Badge></div>
            {overview.performance.publishedGrades === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No published grades are available to chart yet.</p> : <div className="mt-4 h-56" role="img" aria-label="Distribution of published exam scores by percentage range"><ResponsiveContainer width="100%" height="100%"><BarChart data={overview.performance.distribution} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="range" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="count" name="Published grades" fill="#0891b2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
          </section>
        </div>

        <section className="system-admin-panel overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Security and operations</p><h3 className="mt-1 text-lg font-semibold text-slate-900">Recent audit activity</h3></div><span className="text-xs text-slate-500">Latest {overview.recentAudit.length} events</span></div>
          {overview.recentAudit.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Event</th><th className="px-5 py-3 font-semibold">Actor</th><th className="px-5 py-3 font-semibold">Target</th><th className="px-5 py-3 font-semibold">Time</th></tr></thead><tbody className="divide-y divide-slate-100">{overview.recentAudit.map(event => <tr key={event.id} className="hover:bg-slate-50/70"><td className="px-5 py-3 font-medium text-slate-800">{event.action.replaceAll('.', ' ').replaceAll('_', ' ')}</td><td className="px-5 py-3 text-slate-600">{event.actor?.name ?? 'System'}</td><td className="px-5 py-3 text-slate-600">{event.targetType ?? '—'}</td><td className="whitespace-nowrap px-5 py-3 text-slate-500">{new Date(event.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="p-6 text-sm text-slate-500">No audit activity has been recorded yet.</p>}
        </section>
      </>}
    </> : loading && !overview ? <p className="text-sm text-slate-500">Loading trust review queues…</p> : <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Institution management</p><h3 className="mt-1 text-lg font-semibold">Institution applications</h3></div><Badge variant="outline">{requests.length} records</Badge></div>
        <div className="mt-4 space-y-3">{requests.length ? requests.map(request => <article key={request.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><b className="text-slate-900">{request.name}</b><p className="mt-1 text-sm text-slate-500">{request.requesterEmail} · {request.status}</p></div><div className="flex flex-wrap gap-2">{request.status === 'submitted' || request.status === 'under_review' ? <>{request.status === 'submitted' && <button type="button" className="button-secondary" disabled={savingId === request.id} onClick={() => void decide('institution-requests', 'under_review', request.id)}>Begin review</button>}<button type="button" className="button !bg-emerald-600" disabled={!ready(request.documents) || savingId === request.id} onClick={() => void decide('institution-requests', 'approve', request.id)}>Approve</button><button type="button" className="button !bg-red-600" disabled={savingId === request.id} onClick={() => void decide('institution-requests', 'reject', request.id)}>Reject</button></> : <Badge variant={request.status === 'approved' ? 'success' : 'muted'}>{request.status}</Badge>}</div></div><div className="mt-3 flex flex-wrap gap-2">{([['governmentIdDocument', 'Government ID', request.documents.governmentId], ['institutionIdDocument', 'Institution ID', request.documents.institutionId], ['authorizationLetterDocument', 'Authorization letter', request.documents.authorizationLetter]] as const).map(([kind, label, present]) => <button type="button" key={kind} className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={!present} onClick={() => void openDocument(`/api/platform/institution-requests/${request.id}/documents/${kind}`)}>{present ? `View ${label}` : `${label} missing`}</button>)}</div></article>) : <p className="py-6 text-sm text-slate-500">No institution applications are available.</p>}</div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Identity and access</p><h3 className="mt-1 text-lg font-semibold">Staff verification reviews</h3></div><Badge variant="outline">{staff.length} records</Badge></div>
        <div className="mt-4 space-y-3">{staff.length ? staff.map(request => <article key={request.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><b className="text-slate-900">{request.user.name}</b><p className="mt-1 text-sm text-slate-500">{request.user.email} · {request.organization.name} · {request.status}</p></div><div className="flex flex-wrap gap-2">{request.status === 'submitted' || request.status === 'resubmission_required' ? <><button type="button" className="button !bg-emerald-600" disabled={!ready(request.documents) || savingId === request.id} onClick={() => void decide('staff-verifications', 'approve', request.id)}>Approve</button><button type="button" className="button-secondary" disabled={savingId === request.id} onClick={() => void decide('staff-verifications', 'request_more_information', request.id)}>Request documents</button><button type="button" className="button !bg-red-600" disabled={savingId === request.id} onClick={() => void decide('staff-verifications', 'reject', request.id)}>Reject</button></> : <Badge variant={request.status === 'approved' ? 'success' : 'muted'}>{request.status}</Badge>}</div></div><p className="mt-3 text-xs text-slate-500">Required documents: government ID {request.documents.governmentId ? 'present' : 'missing'} · institution ID {request.documents.institutionId ? 'present' : 'missing'} · authorization letter {request.documents.authorizationLetter ? 'present' : 'missing'}</p><div className="mt-3 flex flex-wrap gap-2">{([['governmentIdDocument', 'Government ID', request.documents.governmentId], ['institutionIdDocument', 'Institution ID', request.documents.institutionId], ['authorizationDocument', 'Authorization letter', request.documents.authorizationLetter]] as const).map(([kind, label, present]) => <button type="button" key={kind} className="button-secondary min-h-9 px-3 py-1.5 text-xs" disabled={!present} onClick={() => void openDocument(`/api/platform/staff-verifications/${request.id}/documents/${kind}`)}>{present ? `View ${label}` : `${label} missing`}</button>)}</div></article>) : <p className="py-6 text-sm text-slate-500">No staff verification requests are available.</p>}</div>
      </section>
    </>}
  </div>;
}
