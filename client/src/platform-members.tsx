import { useDeferredValue, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck, UserRoundCog } from 'lucide-react';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';

type Role = 'platform_admin' | 'institute_admin' | 'teacher' | 'proctor' | 'student';
type Member = {
  userId: string;
  organizationId: string;
  role: Role;
  active: boolean;
  createdAt: string;
  isPlatformAdmin: boolean;
  name: string;
  email: string;
  organizationName: string;
};
type PageData = { rows: Member[]; total: number };
const roleLabels: Record<Role, string> = {
  platform_admin: 'System administrator',
  institute_admin: 'Institution administrator',
  teacher: 'Teacher',
  proctor: 'Proctor',
  student: 'Student',
};
const editableRoles: Exclude<Role, 'platform_admin'>[] = ['institute_admin', 'teacher', 'proctor', 'student'];

export function PlatformMembers() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Member | null>(null);
  const [nextRole, setNextRole] = useState<Exclude<Role, 'platform_admin'>>('student');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());
  const pageSize = 25;
  const members = useQuery({
    queryKey: ['platform-members', page, pageSize, deferredSearch, role, status],
    queryFn: async (): Promise<PageData> => {
      const response = await api.get<Member[]>('/api/platform/members', {
        params: { page, pageSize, search: deferredSearch || undefined, role: role || undefined, status: status || undefined },
      });
      return { rows: response.data, total: Number(response.headers['x-total-count'] ?? 0) };
    },
  });
  const beginEdit = (member: Member) => {
    setEditing(member);
    setNextRole(member.role === 'platform_admin' ? 'student' : member.role);
    setActive(member.active);
    setReason('');
    setSaveError('');
  };
  const save = async () => {
    if (!editing || reason.trim().length < 3) return;
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`/api/platform/members/${editing.organizationId}/${editing.userId}`, {
        role: nextRole,
        active,
        reason: reason.trim(),
      });
      setEditing(null);
      await members.refetch();
    } catch (error) {
      setSaveError(axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Account changes could not be saved.') : 'Account changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  const totalPages = Math.max(1, Math.ceil((members.data?.total ?? 0) / pageSize));

  return <section className="space-y-5">
    <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-blue-50 p-3 text-blue-700"><UserRoundCog size={22} aria-hidden="true" /></span>
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Access management</p><h3 className="mt-1 text-xl font-semibold text-slate-900">Platform memberships</h3><p className="mt-1 text-sm leading-6 text-slate-600">Search institution accounts, change organization roles, or suspend a membership. Every change requires a reason and is written to the audit log.</p></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_160px]">
        <label className="relative block"><span className="sr-only">Search accounts</span><Search size={16} aria-hidden="true" className="absolute left-3 top-3 text-slate-400" /><input value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, or institution" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="text-xs font-semibold text-slate-600">Role<select value={role} onChange={event => { setRole(event.target.value); setPage(1); }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">All roles</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Membership<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="">All states</option><option value="active">Active</option><option value="inactive">Suspended</option></select></label>
      </div>
    </header>

    {members.isError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Platform accounts could not be loaded. <button type="button" onClick={() => void members.refetch()} className="font-semibold underline">Retry</button></div>
      : members.isPending ? <div className="space-y-3" aria-busy="true" aria-label="Loading platform accounts">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><p className="text-sm font-semibold text-slate-800">{new Intl.NumberFormat().format(members.data.total)} memberships</p><p className="text-xs text-slate-500">System administrator accounts cannot be changed here.</p></div>
        {members.data.rows.length ? <div className="divide-y divide-slate-100">{members.data.rows.map(member => <article key={`${member.organizationId}:${member.userId}`} className="p-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{member.name}</p><p className="mt-0.5 truncate text-sm text-slate-600">{member.email}</p><p className="mt-1 truncate text-xs text-slate-500">{member.organizationName} · {roleLabels[member.role]}</p></div>
            <div className="flex items-center gap-3"><Badge variant={member.active ? 'success' : 'danger'}>{member.active ? 'Active' : 'Suspended'}</Badge><button type="button" className="button-secondary min-h-9" disabled={member.isPlatformAdmin} onClick={() => beginEdit(member)}>{member.isPlatformAdmin ? <><ShieldCheck size={14} className="mr-1 inline" />Protected</> : 'Manage'}</button></div>
          </div>
          {editing?.userId === member.userId && editing.organizationId === member.organizationId && <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
              <label className="text-xs font-semibold text-slate-700">Organization role<select value={nextRole} onChange={event => { const selected = editableRoles.find(value => value === event.target.value); if (selected) setNextRole(selected); }} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal">{editableRoles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-700">Membership state<select value={active ? 'active' : 'inactive'} onChange={event => setActive(event.target.value === 'active')} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"><option value="active">Active</option><option value="inactive">Suspended</option></select></label>
              <label className="text-xs font-semibold text-slate-700">Audit reason<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} placeholder="Why is this access change needed?" className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal" /></label>
            </div>
            {saveError && <p role="alert" className="mt-3 text-sm text-red-700">{saveError}</p>}
            <div className="mt-3 flex justify-end gap-2"><button type="button" className="button-secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="button" className="button" disabled={saving || reason.trim().length < 3} onClick={() => void save()}>{saving ? 'Saving…' : 'Save access change'}</button></div>
          </div>}
        </article>)}</div> : <p className="p-8 text-center text-sm text-slate-500">{deferredSearch || role || status ? 'No memberships match these filters.' : 'No platform memberships have been created.'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-sm"><span className="text-slate-500">Page {page} of {totalPages}</span><div className="flex gap-2"><button type="button" className="button-secondary min-h-9" disabled={page <= 1 || members.isFetching} onClick={() => setPage(current => current - 1)}>Previous</button><button type="button" className="button-secondary min-h-9" disabled={page >= totalPages || members.isFetching} onClick={() => setPage(current => current + 1)}>Next</button></div></div>
      </div>}
  </section>;
}
