import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { publicApi as authApi } from './lib/api';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Building2, CheckCircle2, Eye, EyeOff, FileText, Search, ShieldCheck } from 'lucide-react';

const Brand = () => <Link to="/" className="flex items-center gap-2 font-bold text-ink"><span className="rounded-lg bg-blue-600 p-2 text-white"><ShieldCheck size={18}/></span>ExamGuard</Link>;
function PasswordInput({ name, value, onChange, label }: { name: string; value: string; onChange: (value: string) => void; label: string }) { const [shown, setShown] = useState(false); return <label className="block text-sm font-medium">{label}<span className="relative mt-1 block"><input className="input pr-11" name={name} type={shown ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} required/><button type="button" aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown(!shown)} className="absolute right-3 top-2.5 text-slate-500">{shown ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>; }
function decodeOAuth(value: string) { const base64 = value.replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))); }
export function LoginPage({ onSave }: { onSave: (session: any) => void }) { const navigate = useNavigate(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => { const oauth = new URLSearchParams(window.location.hash.slice(1)).get('oauth'); if (oauth) { try { const session = decodeOAuth(oauth); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); onSave(session); navigate('/app', { replace: true }); } catch { setError('The provider sign-in response was invalid. Please try again.'); } } authApi.get('/api/auth/providers').then(r => setProviders(r.data.providers ?? [])).catch(() => undefined); }, [navigate, onSave]);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (loading) return; setLoading(true); setError(''); try { const { data } = await authApi.post('/api/auth/login', { email, password }); onSave(data); navigate('/app'); } catch (err) { setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Network error. Please try again.' : 'Unable to sign in.'); } finally { setLoading(false); } };
  return <main className="min-h-screen bg-slate-50 p-4 sm:p-6"><div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-3xl bg-white shadow-glow md:grid-cols-2"><section className="auth-art hidden p-10 text-white md:block"><Brand/><div className="mt-28"><p className="text-sm font-semibold uppercase tracking-[.2em] text-blue-300">Secure assessment operations</p><h1 className="mt-4 text-4xl font-semibold leading-tight">Clarity for every examination decision.</h1><p className="mt-5 max-w-md leading-7 text-slate-300">ExamGuard brings delivery, verification, review, and reporting into one protected workspace.</p></div></section><section className="flex items-center p-6 sm:p-10"><div className="mx-auto w-full max-w-sm"><div className="md:hidden"><Brand/></div><h2 className="mt-10 text-2xl font-semibold">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to your ExamGuard workspace.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-medium">Email<input className="input mt-1" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required/></label><PasswordInput name="password" label="Password" value={password} onChange={setPassword}/><div className="text-right"><Link className="text-sm font-medium text-blue-700 hover:underline" to="/forgot-password">Forgot password?</Link></div>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={loading} className="button w-full">{loading ? 'Signing in…' : 'Sign in'}</button></form>{providers.length > 0 && <div className="mt-6"><div className="flex items-center gap-3 text-xs text-slate-400 before:h-px before:flex-1 before:bg-slate-200 after:h-px after:flex-1 after:bg-slate-200">or</div><div className="mt-4 grid gap-2">{providers.map(p => <a key={p.id} className="button w-full !bg-slate-800 hover:!bg-slate-700" href={`/api/auth/oauth/${p.id}/start`}>Continue with {p.label}</a>)}</div><p className="mt-3 text-xs text-slate-500">Social sign-in is only for administrator-linked accounts; identities are never merged by email.</p></div>}<p className="mt-6 text-center text-sm text-slate-600">Need an institute workspace? <Link to="/register" className="font-semibold text-blue-700 hover:underline">Register</Link></p></div></section></div></main>; }

function RecoveryLayout({ children }: { children: React.ReactNode }) {
  return <main className="auth-recovery-page min-h-screen px-4 py-8 sm:px-6 lg:grid lg:place-items-center">
    <div className="auth-recovery-layout mx-auto grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white shadow-xl lg:grid-cols-[.9fr_1.1fr]">
      <aside className="auth-recovery-aside hidden flex-col justify-between p-10 text-white lg:flex xl:p-14">
        <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-amber-300">ExamGuard · Account security</p><h2 className="mt-12 max-w-sm font-serif text-4xl font-medium leading-tight tracking-tight">Your workspace is worth protecting.</h2><p className="mt-5 max-w-sm text-sm leading-7 text-stone-300">A short, verified recovery flow helps keep examination records and account access secure.</p></div>
        <div className="auth-recovery-points"><p><CheckCircle2 size={17}/> One-time verification code</p><p><CheckCircle2 size={17}/> Protected password reset</p><p><CheckCircle2 size={17}/> Your account details stay private</p></div>
      </aside>
      <section className="auth-recovery-content p-6 sm:p-10 lg:p-12 xl:p-14">
        <div className="mb-10"><Brand/></div>
        {children}
        <p className="mt-10 border-t border-stone-100 pt-5 text-xs leading-5 text-stone-500">For your security, ExamGuard never asks you to share a verification code with anyone.</p>
      </section>
    </div>
  </main>;
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const requestCode = async () => {
    setLoading(true); setError('');
    try { await authApi.post('/api/auth/password-reset/request', { email }); setOtp(''); setSent(true); }
    catch (err) { setError(axios.isAxiosError(err) && err.response?.status === 429 ? 'Too many recovery requests. Please wait a few minutes and try again.' : 'We could not process that request. Please try again later.'); }
    finally { setLoading(false); }
  };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); await requestCode(); };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('');
    try { const { data } = await authApi.post('/api/auth/password-reset/verify', { email, otp }); navigate(`/reset-password?token=${encodeURIComponent(data.resetToken)}`); }
    catch (err) { setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'The verification code is invalid or expired.' : 'Unable to verify the code.'); }
    finally { setLoading(false); }
  };
  return <RecoveryLayout>
    <div className="auth-recovery-heading"><p className="eyebrow">Account recovery</p><span className="auth-recovery-step">Step {sent ? '02' : '01'} <span>/ 02</span></span></div>
    <h1 className="mt-4 font-serif text-3xl font-medium tracking-tight text-stone-900 sm:text-4xl">{sent ? 'Check your email' : 'Reset your password'}</h1>
    {!sent ? <>
      <p className="mt-3 text-sm leading-6 text-stone-600">Enter the email address linked to your ExamGuard account. We’ll guide you through a secure reset.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <label className="block text-sm font-semibold text-stone-800">Work or school email<input className="input mt-2" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required/></label>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button disabled={loading} className="button w-full">{loading ? 'Requesting code…' : 'Continue'}<ArrowRight size={17} className="ml-2"/></button>
      </form>
    </> : <>
      <p className="mt-3 text-sm leading-6 text-stone-600">A recovery request was received for <strong className="break-all font-semibold text-stone-800">{email}</strong>.</p>
      <div role="status" className="auth-recovery-notice mt-5"><CheckCircle2 size={19}/><p>If an account matches this address and email delivery is working, a six-digit code will be sent. For privacy, we can’t confirm whether an account is registered.</p></div>
      <form onSubmit={verify} className="mt-7 space-y-5">
        <label className="block text-sm font-semibold text-stone-800">Six-digit verification code<input className="input mt-2 text-center font-mono text-lg tracking-[.35em]" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} required/></label>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button disabled={loading || otp.length !== 6} className="button w-full">{loading ? 'Verifying code…' : 'Verify code'}<ArrowRight size={17} className="ml-2"/></button>
      </form>
      <div className="auth-recovery-help mt-5"><p>Not seeing a message? Check your spam folder. Wait briefly before requesting another code; delivery is rate-limited.</p>
        <button type="button" className="button-secondary mt-4 w-full" disabled={loading} onClick={requestCode}>{loading ? 'Requesting…' : 'Request another code'}</button>
        <button type="button" className="auth-recovery-edit mt-3 w-full" onClick={() => { setSent(false); setOtp(''); setError(''); }}>Use a different email</button>
      </div>
    </>}
    <Link to="/login" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"><span aria-hidden="true">←</span> Back to sign in</Link>
  </RecoveryLayout>;
}
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const token = params.get('token') ?? '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true); setError('');
    try {
      const { data } = await authApi.post('/api/auth/password-reset/confirm', { token, password, confirmPassword });
      setMessage(data.message);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Unable to reset password.' : 'Unable to reset password.');
    } finally { setLoading(false); }
  };
  return <RecoveryLayout>
    <p className="eyebrow">Account recovery</p>
    <h1 className="mt-4 font-serif text-3xl font-medium tracking-tight text-stone-900 sm:text-4xl">Choose a new password</h1>
    <p className="mt-3 text-sm leading-6 text-stone-600">Create a strong password to secure your ExamGuard account.</p>
    <form onSubmit={submit} className="mt-8 space-y-5">
      <PasswordInput name="password" label="New password" value={password} onChange={setPassword}/>
      <PasswordInput name="confirmPassword" label="Confirm new password" value={confirmPassword} onChange={setConfirm}/>
      <p className="text-xs leading-5 text-stone-500">Use at least 10 characters, including uppercase and lowercase letters and a number.</p>
      {message && <p role="status" className="auth-recovery-notice"><CheckCircle2 size={19}/>{message}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={loading || !token} className="button w-full">{loading ? 'Updating password…' : 'Update password'}<ArrowRight size={17} className="ml-2"/></button>
    </form>
    {!token && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">This reset link is incomplete or invalid. Request a new code to continue.</p>}
    <Link to={token ? '/login' : '/forgot-password'} className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"><span aria-hidden="true">←</span> {token ? 'Back to sign in' : 'Request a new code'}</Link>
  </RecoveryLayout>;
}

type InstitutionOption = { id: string; name: string };

function SignupEmailOtp({ email, purpose, organizationId, onVerified }: { email: string; purpose: 'student' | 'coordinator' | 'institution_admin'; organizationId?: string; onVerified: (ticket: string) => void }) {
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const normalizedEmail = email.trim().toLowerCase();
  const requestCode = async () => {
    setLoading(true); setError('');
    try {
      await authApi.post('/api/public/signup-email/request', { email: normalizedEmail, purpose, ...(organizationId ? { organizationId } : {}) });
      setRequested(true); setVerified(false); onVerified('');
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Could not send the verification code.' : 'Could not send the verification code.');
    } finally { setLoading(false); }
  };
  const verifyCode = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await authApi.post('/api/public/signup-email/verify', { email: normalizedEmail, purpose, ...(organizationId ? { organizationId } : {}), code });
      setVerified(true); onVerified(data.ticket);
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'The code is invalid or expired.' : 'The code is invalid or expired.');
    } finally { setLoading(false); }
  };
  return <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
    <h2 className="font-semibold">Verify your email</h2>
    <p className="mt-1 text-sm text-slate-600">Confirm you can receive email at {normalizedEmail || 'your email address'} before submitting.</p>
    {!requested ? <button type="button" className="button-secondary mt-3" disabled={loading || !normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || (purpose !== 'institution_admin' && !organizationId)} onClick={() => void requestCode()}>{loading ? 'Sending code…' : 'Send email code'}</button> :
      <div className="mt-3 flex flex-wrap gap-2"><input className="input max-w-48" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Email verification code" placeholder="6-digit code"/><button type="button" className="button" disabled={loading || code.length !== 6 || verified} onClick={() => void verifyCode()}>{verified ? 'Email verified' : loading ? 'Verifying…' : 'Verify code'}</button><button type="button" className="button-secondary" disabled={loading} onClick={() => void requestCode()}>Resend</button></div>}
    {verified && <p role="status" className="mt-2 text-sm font-medium text-emerald-800">Email verified for this application.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}

export function CoordinatorApplicationPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState<InstitutionOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [verificationTicket, setVerificationTicket] = useState('');
  const [proofFiles, setProofFiles] = useState<Record<'governmentIdDocument' | 'institutionIdDocument' | 'authorizationDocument', File | null>>({
    governmentIdDocument: null,
    institutionIdDocument: null,
    authorizationDocument: null,
  });

  const passwordRequirements = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;
  const isPasswordValid = passwordRequirements.test(password);
  const hasAllProofs = Object.values(proofFiles).every(Boolean);

  const findInstitutions = async () => {
    if (search.trim().length < 2) return setError('Enter at least two characters to find your institution.');
    setSearching(true);
    setError('');
    try {
      const { data } = await authApi.get<InstitutionOption[]>('/api/public/organizations', { params: { search: search.trim() } });
      setInstitutions(data);
      if (!data.length) setError('No active ExamGuard institution matched. Ask your university administrator to set up its workspace first.');
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Institution search failed.' : 'Institution search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleProofChange = (field: keyof typeof proofFiles) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      event.target.value = '';
      setProofFiles(prev => ({ ...prev, [field]: null }));
      setError('Choose a PDF, JPG, PNG, or WebP file for each proof document.');
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      setProofFiles(prev => ({ ...prev, [field]: null }));
      setError('Each proof document must be 5 MB or smaller.');
      return;
    }
    setProofFiles(prev => ({ ...prev, [field]: file }));
    setError('');
  };

  const validateSubmission = () => {
    if (!name.trim() || name.trim().length < 2) return 'Enter your full name.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid work email address.';
    if (!isPasswordValid) return 'Use a password with at least 10 characters, including upper and lower case letters and a number.';
    if (!selectedInstitution) return 'Choose your university from the search results.';
    if (!hasAllProofs) return 'Upload all three required proof documents: government ID, university ID, and authorization letter.';
    if (!verificationTicket) return 'Verify your email before submitting the application.';
    return '';
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationMessage = validateSubmission();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    setError('');
    const form = new FormData();
    form.append('name', name.trim());
    form.append('email', email.trim().toLowerCase());
    form.append('password', password);
    form.append('organizationId', selectedInstitution!.id);
    form.append('verificationTicket', verificationTicket);
    Object.entries(proofFiles).forEach(([field, file]) => {
      if (file) form.append(field, file);
    });

    try {
      const { data } = await authApi.post('/api/auth/coordinator-applications', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted(data.message);
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Unable to submit your application.' : 'Unable to submit your application.');
    } finally {
      setLoading(false);
    }
  };

  return <main className="min-h-screen bg-[#f4f3ef] px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex items-center justify-between gap-4 px-1">
        <Brand />
        <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 shadow-sm"><ShieldCheck size={15} className="text-emerald-700" />Private university review</span>
      </header>

      {submitted ? <section role="status" className="overflow-hidden rounded-[28px] border border-emerald-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.08)]">
        <div className="bg-[#10251f] px-6 py-10 text-white sm:px-12 sm:py-14">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300"><CheckCircle2 size={30} /></span>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Request received</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Your access request is in the review queue.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-300">{submitted}</p>
        </div>
        <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-12">
          <div><p className="font-semibold text-stone-900">What happens next?</p><p className="mt-1 text-sm text-stone-600">Your university administrator will review your proof before enabling coordinator access.</p></div>
          <Link className="button inline-flex w-fit items-center gap-2" to="/teacher/login">Return to sign in <ArrowRight size={16} /></Link>
        </div>
      </section> : <div className="overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.08)]">
      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="px-5 py-7 sm:px-9 sm:py-10 lg:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">Coordinator access request</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-stone-950 sm:text-[2.6rem] sm:leading-tight">Join your university’s ExamGuard workspace</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">Submit your details and identity proof. Your account stays inactive until an administrator at your institution approves the request.</p>

          <div className="mt-7 grid grid-cols-3 gap-2" aria-label="Application steps">
            {[['01', 'Your details'], ['02', 'University'], ['03', 'Proof']].map(([number, label], index) => <div key={number} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5"><span className="text-[11px] font-bold tracking-wide text-blue-700">{number}</span><span className="text-xs font-medium text-stone-600">{label}</span>{index < 2 && <span className="ml-auto hidden h-px w-3 bg-stone-300 sm:block" />}</div>)}
          </div>

          <form onSubmit={submit} className="mt-7 space-y-5" encType="multipart/form-data">
            <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5" aria-labelledby="coordinator-account-heading">
              <div className="mb-4"><h2 id="coordinator-account-heading" className="text-base font-semibold text-stone-900">Your details</h2><p className="mt-1 text-sm text-stone-500">Use your university email address where possible.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-stone-700">Full name<input name="name" value={name} onChange={event => setName(event.target.value)} className="input mt-1" autoComplete="name" minLength={2} maxLength={120} required /></label>
                <label className="block text-sm font-medium text-stone-700">Email<input name="email" value={email} onChange={event => { setEmail(event.target.value); setVerificationTicket(''); }} className="input mt-1" type="email" autoComplete="email" required /></label>
                <div className="sm:col-span-2"><PasswordInput name="password" label="Password" value={password} onChange={setPassword}/></div>
              </div>
              <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${isPasswordValid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-500'}`}>{isPasswordValid ? 'Password meets the security requirement.' : 'Use at least 10 characters with uppercase, lowercase, and a number.'}</div>
            </section>

            <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5" aria-labelledby="institution-heading">
              <div className="mb-4"><h2 id="institution-heading" className="text-base font-semibold text-stone-900">Your university</h2><p className="mt-1 text-sm text-stone-500">Find the institution’s active ExamGuard workspace.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="institution-search">Institution name</label>
                <input id="institution-search" className="input flex-1" value={search} onChange={event => { setSearch(event.target.value); setSelectedInstitution(null); setInstitutions([]); setVerificationTicket(''); }} placeholder="Type an institution name" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void findInstitutions(); } }} />
                <button type="button" className="button-secondary shrink-0" onClick={() => void findInstitutions()} disabled={searching}><Search size={16} className="mr-2"/>{searching ? 'Searching…' : 'Find institution'}</button>
              </div>
              {institutions.length > 0 && <div role="radiogroup" aria-label="Search results" className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">{institutions.map(institution => <label key={institution.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm text-stone-700 hover:bg-stone-50"><input type="radio" name="institution" checked={selectedInstitution?.id === institution.id} onChange={() => { setSelectedInstitution(institution); setVerificationTicket(''); }} /><Building2 size={16} className="text-stone-500"/><span>{institution.name}</span></label>)}</div>}
              {selectedInstitution && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 size={16} />{selectedInstitution.name} selected</p>}
            </section>

            <SignupEmailOtp key={`${email}|${selectedInstitution?.id ?? ''}`} email={email} purpose="coordinator" organizationId={selectedInstitution?.id} onVerified={setVerificationTicket}/>

            <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5" aria-labelledby="proof-heading">
              <div className="mb-4"><h2 id="proof-heading" className="text-base font-semibold text-stone-900">Identity and authorization proof</h2><p className="mt-1 text-sm text-stone-500">PDF, JPG, PNG, or WebP · up to 5 MB per file</p></div>
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  ['governmentIdDocument', 'Government ID'],
                  ['institutionIdDocument', 'University ID'],
                  ['authorizationDocument', 'Authorization letter'],
                ] as const).map(([name, label]) => <label key={name} className={`block cursor-pointer rounded-xl border bg-white p-3.5 text-sm transition hover:border-blue-300 ${proofFiles[name] ? 'border-emerald-300' : 'border-stone-200'}`}><span className="flex items-center gap-2 text-sm font-medium text-stone-800">{proofFiles[name] ? <CheckCircle2 size={16} className="shrink-0 text-emerald-700" /> : <FileText size={16} className="shrink-0 text-stone-500" />}{label}</span><input className="mt-3 block w-full cursor-pointer text-xs text-stone-500 file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-stone-100 file:px-2.5 file:py-2 file:text-xs file:font-semibold file:text-stone-700 hover:file:bg-blue-50" type="file" name={name} accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={handleProofChange(name)} />{proofFiles[name] ? <span className="mt-2 block truncate text-xs text-emerald-700">{proofFiles[name]?.name}</span> : <span className="mt-2 block text-xs text-stone-400">Required · max 5 MB</span>}</label>)}
              </div>
            </section>

            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

            <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <Link className="text-sm font-medium text-stone-600 underline underline-offset-4" to="/teacher/login">Already approved? Sign in</Link>
              <button className="button inline-flex items-center gap-2 sm:min-w-56" disabled={loading || !verificationTicket || !selectedInstitution || !hasAllProofs || !isPasswordValid} type="submit">{loading ? 'Submitting securely…' : 'Submit for review'}{!loading && <ArrowRight size={16} />}</button>
            </div>
          </form>
        </div>

        <aside className="flex flex-col justify-between bg-[#14251f] p-6 text-white sm:p-8 xl:min-h-full">
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-emerald-300"><ShieldCheck size={21}/></span>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">A verified workspace</p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight">Built around trust, not guesswork.</h2>
            <p className="mt-3 text-sm leading-6 text-stone-300">Your request goes only to the institution you select. An authorized administrator checks the documents before enabling access.</p>
            <ol className="mt-7 space-y-5">
              {[['01', 'Choose your institution', 'Select its active ExamGuard workspace.'], ['02', 'Share proof securely', 'Your files are private and visible to authorized reviewers only.'], ['03', 'Wait for approval', 'You can sign in once the university activates your account.']].map(([number, title, detail]) => <li key={number} className="flex gap-3"><span className="mt-0.5 text-xs font-bold tracking-widest text-emerald-300">{number}</span><div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-stone-400">{detail}</p></div></li>)}
            </ol>
          </div>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[.06] p-4"><p className="text-xs font-semibold uppercase tracking-[.15em] text-stone-300">Privacy note</p><p className="mt-2 text-xs leading-5 text-stone-300">Only submit documents required for university identity verification. Avoid including unrelated personal information.</p></div>
        </aside>
      </div>
      </div>}
    </div>
  </main>;
}

export function StudentApplicationPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState<InstitutionOption | null>(null);
  const [verificationTicket, setVerificationTicket] = useState('');
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const idDocumentInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');

  const findInstitutions = async () => {
    if (search.trim().length < 2) return setError('Enter at least two characters to find your institution.');
    setError('');
    try {
      const { data } = await authApi.get<InstitutionOption[]>('/api/public/organizations', { params: { search: search.trim() } });
      setInstitutions(data);
      if (!data.length) setError('No active ExamGuard institution matched your search.');
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Institution search failed.' : 'Institution search failed.');
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!selectedInstitution) return setError('Choose your institution from the search results.');
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(password)) return setError('Use at least 10 characters with uppercase, lowercase, and a number.');
    if (!verificationTicket) return setError('Verify your email before submitting the application.');
    if (!idDocument) return setError('Upload a government-issued ID document before submitting.');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('email', email.trim().toLowerCase());
      form.append('password', password);
      form.append('organizationId', selectedInstitution.id);
      form.append('verificationTicket', verificationTicket);
      form.append('idDocument', idDocument);
      const { data } = await authApi.post('/api/public/student-applications', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted(data.message);
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Unable to submit your application.' : 'Unable to submit your application.');
    } finally {
      setLoading(false);
    }
  };
  const handleIdDocument = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      event.target.value = '';
      setIdDocument(null);
      setError('ID proof must be a JPEG, PNG, WebP, or PDF.');
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      setIdDocument(null);
      setError('The ID document must be 5 MB or smaller.');
      return;
    }
    setIdDocument(file);
    setError('');
  };
  const clearIdDocument = () => {
    setIdDocument(null);
    if (idDocumentInput.current) idDocumentInput.current.value = '';
  };

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6"><div className="mx-auto max-w-3xl">
    <header className="mb-6 flex items-center justify-between"><Brand/><Link to="/student/login" className="text-sm font-semibold text-blue-700 hover:underline">Student sign in</Link></header>
    <section className="card">
      {submitted ? <div role="status" className="py-4"><CheckCircle2 size={32} className="text-emerald-700"/><h1 className="mt-4 text-2xl font-semibold">Application submitted</h1><p className="mt-2 text-sm leading-6 text-slate-600">{submitted}</p><p className="mt-4 text-sm text-slate-600">You can sign in after your institution approves your application.</p></div> : <>
        <p className="eyebrow">Student access</p><h1 className="mt-2 text-3xl font-semibold">Create a student account</h1><p className="mt-2 text-sm leading-6 text-slate-600">Verify your email, then your institution administrator will approve your application.</p>
        <form onSubmit={submit} className="mt-6 space-y-5" encType="multipart/form-data">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">Full name<input className="input mt-1" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120}/></label>
            <label className="block text-sm font-medium">Email<input className="input mt-1" type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setVerificationTicket(''); clearIdDocument(); }} required/></label>
            <div className="sm:col-span-2"><PasswordInput name="password" label="Password (10+ characters, upper/lowercase and number)" value={password} onChange={setPassword}/></div>
          </div>
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="font-semibold">Select your institution</h2><p className="mt-1 text-sm text-slate-500">Applications go only to an active ExamGuard institution.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="input flex-1" value={search} onChange={event => { setSearch(event.target.value); setSelectedInstitution(null); setInstitutions([]); setVerificationTicket(''); clearIdDocument(); }} placeholder="Institution name" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void findInstitutions(); } }}/><button type="button" className="button-secondary" onClick={() => void findInstitutions()}><Search size={16} className="mr-2"/>Find</button></div>
            {institutions.length > 0 && <div role="radiogroup" aria-label="Institution search results" className="mt-3 divide-y rounded-lg border bg-white">{institutions.map(institution => <label key={institution.id} className="flex cursor-pointer items-center gap-2 p-3 text-sm"><input type="radio" name="student-institution" checked={selectedInstitution?.id === institution.id} onChange={() => { setSelectedInstitution(institution); setVerificationTicket(''); clearIdDocument(); }}/><Building2 size={16}/>{institution.name}</label>)}</div>}
            {selectedInstitution && <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{selectedInstitution.name} selected</p>}
          </section>
          <label className="block rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium">Government-issued ID proof
            <input ref={idDocumentInput} className="mt-2 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={handleIdDocument}/>
            <span className="mt-1 block text-xs text-slate-500">{idDocument?.name ?? 'PDF or image · max 5 MB'}</span>
          </label>
          <p className="text-xs leading-5 text-slate-500">Your ID is stored in private document storage and can be viewed only by your institution’s authorized administrator for application review.</p>
          <SignupEmailOtp key={`${email}|${selectedInstitution?.id ?? ''}`} email={email} purpose="student" organizationId={selectedInstitution?.id} onVerified={setVerificationTicket}/>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button type="submit" className="button w-full" disabled={loading || !selectedInstitution || !verificationTicket || !idDocument}>{loading ? 'Submitting securely…' : 'Submit for institution approval'}</button>
        </form>
      </>}
    </section>
  </div></main>;
}

export function InstitutionApplicationPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [password, setPassword] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [verificationTicket, setVerificationTicket] = useState('');
  const [files, setFiles] = useState<Record<'governmentIdDocument' | 'institutionIdDocument' | 'authorizationLetterDocument', File | null>>({
    governmentIdDocument: null,
    institutionIdDocument: null,
    authorizationLetterDocument: null,
  });
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (Object.values(files).some(file => !file)) return setError('Upload all three identity and authorization documents.');
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(password)) return setError('Use at least 10 characters with uppercase, lowercase, and a number.');
    if (!verificationTicket) return setError('Verify your email before submitting the application.');
    setLoading(true);
    setError('');
    const form = new FormData();
    Object.entries(values).forEach(([key, value]) => form.append(key, String(value)));
    Object.entries(files).forEach(([key, file]) => { if (file) form.append(key, file); });
    form.append('verificationTicket', verificationTicket);
    try {
      const { data } = await authApi.post('/api/public/institution-applications', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSubmitted(data.message);
    } catch (requestError) {
      setError(axios.isAxiosError(requestError) ? requestError.response?.data?.error ?? 'Unable to submit the institution application.' : 'Unable to submit the institution application.');
    } finally {
      setLoading(false);
    }
  };
  const changeFile = (field: keyof typeof files) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      event.target.value = '';
      setFiles(previous => ({ ...previous, [field]: null }));
      setError('Proof files must be JPEG, PNG, WebP, or PDF.');
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      event.target.value = '';
      setFiles(previous => ({ ...previous, [field]: null }));
      setError('Each proof document must be 5 MB or smaller.');
      return;
    }
    setFiles(previous => ({ ...previous, [field]: file }));
    setError('');
  };
  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6"><div className="mx-auto max-w-3xl">
    <header className="mb-6 flex items-center justify-between"><Brand/><Link to="/institute/login" className="text-sm font-semibold text-blue-700 hover:underline">Institute sign in</Link></header>
    <section className="card">
      {submitted ? <div role="status" className="py-4"><CheckCircle2 size={32} className="text-emerald-700"/><h1 className="mt-4 text-2xl font-semibold">Institution application submitted</h1><p className="mt-2 text-sm leading-6 text-slate-600">{submitted}</p><p className="mt-4 text-sm text-slate-600">Your institute administrator account will be enabled after system-administrator approval.</p></div> : <>
        <p className="eyebrow">Institution access</p><h1 className="mt-2 text-3xl font-semibold">Request an institute workspace</h1><p className="mt-2 text-sm leading-6 text-slate-600">Submit official identity and authorization proof. No workspace is created until a system administrator approves your application.</p>
        <form onSubmit={submit} className="mt-6 space-y-5" encType="multipart/form-data">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">Contact person<input className="input mt-1" name="contactName" autoComplete="name" required minLength={2}/></label>
            <label className="block text-sm font-medium">Institution name<input className="input mt-1" name="name" autoComplete="organization" required minLength={2}/></label>
            <label className="block text-sm font-medium">Institutional contact email<input className="input mt-1" name="requesterEmail" type="email" autoComplete="email" value={requesterEmail} onChange={event => { setRequesterEmail(event.target.value); setVerificationTicket(''); }} required/></label>
            <label className="block text-sm font-medium">Country code<input className="input mt-1" name="countryCode" placeholder="US" pattern="[A-Za-z]{2}" maxLength={2} required/></label>
            <label className="block text-sm font-medium">Region / state<input className="input mt-1" name="region" maxLength={120}/></label>
            <label className="block text-sm font-medium">Institution website<input className="input mt-1" name="website" type="url" placeholder="https://example.edu"/></label>
            <label className="block text-sm font-medium sm:col-span-2">Application details<textarea className="input mt-1 min-h-20" name="details" maxLength={2000}/></label>
            <div className="sm:col-span-2"><PasswordInput name="password" label="Create password (10+ characters, upper/lowercase and a number)" value={password} onChange={setPassword}/></div>
          </div>
          <SignupEmailOtp key={requesterEmail} email={requesterEmail} purpose="institution_admin" onVerified={setVerificationTicket}/>
          <div className="grid gap-3 sm:grid-cols-3">{([
            ['governmentIdDocument', 'Government ID'],
            ['institutionIdDocument', 'Institution ID'],
            ['authorizationLetterDocument', 'Authorization letter'],
          ] as const).map(([field, label]) => <label key={field} className="rounded-xl border border-slate-200 p-4 text-sm font-medium">{label}<input className="mt-2 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={changeFile(field)}/><span className="mt-1 block text-xs text-slate-500">{files[field]?.name ?? 'PDF or image · max 5 MB'}</span></label>)}</div>
          <p className="text-xs leading-5 text-slate-500">Identity documents are private and are shown only to authorized system administrators. Approval is performed by a person.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button type="submit" className="button w-full" disabled={loading || !verificationTicket || Object.values(files).some(file => !file)}>{loading ? 'Submitting securely…' : 'Submit for system-admin review'}</button>
        </form>
      </>}
    </section>
  </div></main>;
}
