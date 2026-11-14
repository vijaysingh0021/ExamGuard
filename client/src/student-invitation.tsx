import { useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from './lib/api';
import { Alert, Button, Input } from './components/ui';

type Session = {
  token: string;
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
  role: string;
};
type Invitation = { name: string; email: string; organizationName: string; expiresAt: string };

export function StudentInvitationPage({ onSave }: { onSave: (session: Session) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const invitation = useQuery({
    queryKey: ['student-invitation', token],
    enabled: token.length >= 32,
    queryFn: async () => (await publicApi.get<Invitation>(`/api/public/student-invitations/${encodeURIComponent(token)}`)).data,
    retry: false,
  });

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await publicApi.post<Session>('/api/auth/student-invitations/accept', { token, password });
      onSave(data);
      navigate('/app', { replace: true });
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Invitation could not be accepted.' : 'Invitation could not be accepted.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="app-surface flex min-h-screen items-center justify-center px-4 py-10">
    <section className="card w-full max-w-lg" aria-labelledby="student-invitation-title">
      <p className="eyebrow">ExamGuard student access</p>
      <h1 id="student-invitation-title" className="mt-2 text-2xl font-semibold">Accept your invitation</h1>
      {!token ? <Alert role="alert" variant="destructive" className="mt-5">This invitation link is missing its one-time token.</Alert>
        : invitation.isLoading ? <p className="mt-5 text-sm text-stone-600">Checking invitation…</p>
          : invitation.isError || !invitation.data ? <Alert role="alert" variant="destructive" className="mt-5">This invitation could not be found or has expired. Ask your institution to send a new one.</Alert>
            : <>
              <p className="mt-3 text-sm text-stone-600">{invitation.data.organizationName} invited <b>{invitation.data.name}</b> ({invitation.data.email}) to join as a student. The link expires {new Date(invitation.data.expiresAt).toLocaleString()}.</p>
              <form className="mt-6 space-y-4" onSubmit={(event) => void accept(event)}>
                <label className="block text-sm font-medium">Create password
                  <Input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required className="mt-1" />
                </label>
                <label className="block text-sm font-medium">Confirm password
                  <Input type="password" autoComplete="new-password" minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required className="mt-1" />
                </label>
                <p className="text-xs text-stone-500">Use at least 10 characters, including uppercase, lowercase, and a number.</p>
                {error && <Alert role="alert" variant="destructive">{error}</Alert>}
                <Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create student account'}</Button>
              </form>
            </>}
    </section>
  </main>;
}
