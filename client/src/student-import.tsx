import { useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { parseStudentCsv, type StudentCsvRow } from './lib/student-import';
import { Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui';

type Props = { organizationId: string };
type PreviewRow = StudentCsvRow & { index: number; status: string; reason?: string };
type Invitation = { id: string; name: string; email: string; expiresAt: string };
type ImportResult = { email: string; status: 'invited' | 'skipped' | 'failed'; reason?: string };

const formatRequestError = (error: unknown, fallback: string) => axios.isAxiosError(error)
  ? error.response?.data?.error ?? fallback
  : error instanceof Error ? error.message : fallback;

export function StudentImport({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [students, setStudents] = useState<StudentCsvRow[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/api/organizations/${organizationId}`;
  const pending = useQuery({
    queryKey: ['student-invitations', organizationId],
    queryFn: async () => (await api.get<Invitation[]>(`${base}/student-invitations`)).data,
  });

  const previewStudents = async () => {
    setError('');
    setNotice('');
    setResults([]);
    try {
      const response = await api.post<{ rows: PreviewRow[] }>(`${base}/students/import/preview`, { students });
      setPreview(response.data.rows);
    } catch (requestError) {
      setError(formatRequestError(requestError, 'Could not preview the student CSV.'));
    }
  };

  const importStudents = useMutation({
    mutationFn: async () => (await api.post<{ invited: number; results: ImportResult[] }>(`${base}/students/import`, { students })).data,
    onSuccess: async (data) => {
      setResults(data.results);
      setNotice(`${data.invited} invitation${data.invited === 1 ? '' : 's'} sent. Invitation links are delivered by email and expire after 7 days.`);
      setPreview([]);
      setStudents([]);
      await queryClient.invalidateQueries({ queryKey: ['student-invitations', organizationId] });
    },
    onError: (requestError) => setError(formatRequestError(requestError, 'Student invitations could not be sent.')),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => api.post(`${base}/student-invitations/${id}/revoke`),
    onSuccess: async () => {
      setNotice('Invitation revoked.');
      await queryClient.invalidateQueries({ queryKey: ['student-invitations', organizationId] });
    },
    onError: (requestError) => setError(formatRequestError(requestError, 'Invitation could not be revoked.')),
  });

  const readFile = async (file?: File) => {
    setError('');
    setNotice('');
    setPreview([]);
    setResults([]);
    if (!file) {
      setStudents([]);
      return;
    }
    try {
      setStudents(parseStudentCsv(await file.text()));
    } catch (parseError) {
      setStudents([]);
      setError(formatRequestError(parseError, 'Could not read the student CSV.'));
    }
  };

  return <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5" aria-labelledby="student-import-title">
    <div>
      <h3 id="student-import-title" className="font-semibold">Invite students from CSV</h3>
      <p className="mt-1 text-sm text-stone-600">Upload a CSV with <code>name,email</code> headers. Preview skips existing accounts, existing students, and duplicate addresses. Each invitation link is one-time and expires in 7 days.</p>
    </div>
    <label className="block text-sm font-medium">Student CSV
      <input className="mt-2 block w-full text-sm" type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.currentTarget.files?.[0])} />
    </label>
    {students.length > 0 && <p className="text-sm text-stone-600" role="status">{students.length} student rows ready for preview.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => void previewStudents()} disabled={!students.length}>Preview import</Button>
      <Button onClick={() => importStudents.mutate()} disabled={!preview.some(row => row.status === 'ready') || importStudents.isPending}>{importStudents.isPending ? 'Sending invitations…' : 'Send ready invitations'}</Button>
    </div>
    {error && <Alert role="alert" variant="destructive">{error}</Alert>}
    {notice && <Alert role="status" variant="success">{notice}</Alert>}
    {preview.length > 0 && <div className="overflow-x-auto rounded-lg border border-stone-200">
      <Table><caption className="sr-only">Student CSV import preview</caption>
        <TableHeader><TableRow><TableHead scope="col">Name</TableHead><TableHead scope="col">Email</TableHead><TableHead scope="col">Status</TableHead></TableRow></TableHeader>
        <TableBody>{preview.map(row => <TableRow key={`${row.index}-${row.email}`}>
          <TableCell>{row.name}</TableCell><TableCell>{row.email}</TableCell>
          <TableCell><span className={row.status === 'ready' ? 'font-medium text-emerald-800' : 'text-amber-800'}>{row.status === 'ready' ? 'Ready' : row.reason ?? row.status}</span></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>}
    {results.length > 0 && <ul aria-label="Invitation results" className="space-y-1 text-sm">{results.map(result => <li key={result.email} className={result.status === 'invited' ? 'text-emerald-800' : 'text-amber-800'}>{result.email}: {result.status}{result.reason ? ` — ${result.reason}` : ''}</li>)}</ul>}
    <div className="border-t border-stone-100 pt-4">
      <h4 className="text-sm font-semibold">Pending invitations</h4>
      {pending.isError ? <Alert role="alert" variant="destructive">Pending invitations could not be loaded. <Button variant="outline" size="sm" onClick={() => void pending.refetch()}>Retry</Button></Alert>
        : pending.isLoading ? <p className="mt-2 text-sm text-stone-500">Loading invitations…</p>
          : pending.data?.length ? <ul className="mt-2 divide-y divide-stone-100">{pending.data.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>{invitation.name} · {invitation.email} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
            <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(invitation.id)}>Revoke</Button>
          </li>)}</ul>
          : <p className="mt-2 text-sm text-stone-500">No pending invitations.</p>}
    </div>
  </section>;
}
