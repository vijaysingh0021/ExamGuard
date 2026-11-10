import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  interceptors: { request: { use: vi.fn() } }
}));

vi.mock('axios', () => ({
  default: {
    create: () => http,
    isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean })?.isAxiosError)
  }
}));

import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from '../auth-pages';
import { CandidateDashboard, Exams } from '../main';

const session = { token: 'token', user: { name: 'Candidate', email: 'candidate@example.edu' }, organization: { id: 'org-1', name: 'Example Institute' }, role: 'candidate' };
const response = <T,>(data: T, headers: Record<string, string> = {}) => Promise.resolve({ data, headers });
const apiError = (error: string) => () => Promise.reject({ isAxiosError: true, response: { data: { error } } });

function AtLocation() { return <output data-testid="location">{useLocation().pathname}</output>; }
function withQuery(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('authentication forms', () => {
  it('signs in through the API and navigates to the workspace', async () => {
    http.get.mockReturnValue(response({ providers: [] }));
    http.post.mockReturnValue(response(session));
    const saved = vi.fn();
    render(<MemoryRouter><LoginPage onSave={saved} /><AtLocation /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'candidate@example.edu');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/auth/login', { email: 'candidate@example.edu', password: 'Password123' }));
    expect(saved).toHaveBeenCalledWith(session);
    expect(screen.getByTestId('location')).toHaveTextContent('/app');
  });

  it('consumes an OAuth session from the fragment and clears it from the address bar', async () => {
    http.get.mockReturnValue(response({ providers: [] }));
    const saved = vi.fn();
    const oauth = btoa(JSON.stringify(session)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.history.replaceState(null, '', `/login#oauth=${oauth}`);
    render(<MemoryRouter><LoginPage onSave={saved} /><AtLocation /></MemoryRouter>);
    await waitFor(() => expect(saved).toHaveBeenCalledWith(session));
    expect(window.location.hash).toBe('');
    expect(screen.getByTestId('location')).toHaveTextContent('/app');
  });

  it('keeps an authentication API error visible to the user', async () => {
    http.get.mockReturnValue(response({ providers: [] }));
    http.post.mockImplementation(apiError('Invalid credentials'));
    render(<MemoryRouter><LoginPage onSave={vi.fn()} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'candidate@example.edu');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('validates reset confirmation locally before calling the API', async () => {
    render(<MemoryRouter initialEntries={['/reset-password?token=valid-token']}><ResetPasswordPage /></MemoryRouter>);
    const [password, confirmation] = screen.getAllByLabelText(/password/i);
    await userEvent.type(password, 'Password123');
    await userEvent.type(confirmation, 'Different123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('reports password-recovery API failures', async () => {
    http.post.mockImplementation(apiError('Service temporarily unavailable'));
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'candidate@example.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to request recovery.');
    expect(http.post).toHaveBeenCalledWith('/api/auth/password-reset/request', { email: 'candidate@example.edu' });
  });

  it('verifies the six-digit recovery code before opening password reset', async () => {
    http.post.mockImplementation((url: string) => url.endsWith('/request')
      ? response({ message: 'If an account exists, a verification code will be sent.' })
      : response({ resetToken: 'opaque-reset-session-token' }));
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'candidate@example.edu');
    await userEvent.click(screen.getByRole('button', { name: 'Send recovery instructions' }));
    expect(await screen.findByLabelText('Six-digit code')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Six-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => expect(http.post).toHaveBeenLastCalledWith('/api/auth/password-reset/verify', { email: 'candidate@example.edu', otp: '123456' }));
  });
});

describe('candidate and teacher workflows', () => {
  it('shows a loading state, then routes an available candidate to readiness', async () => {
    let resolveDashboard!: (value: { data: unknown }) => void;
    http.get.mockReturnValue(new Promise(resolve => { resolveDashboard = resolve; }));
    withQuery(<><CandidateDashboard session={session} /><AtLocation /></>);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    resolveDashboard({ data: { candidate: { id: 'candidate-1', name: 'Candidate' }, verification: { status: 'approved' }, assignments: [{ id: 'assignment-1', exam: { id: 'exam-1', title: 'Physics', durationMinutes: 45, status: 'published', startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z' } }] } });
    expect(await screen.findByText('Physics')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start readiness' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/app/take/exam-1');
  });

  it('surfaces candidate dashboard API errors', async () => {
    http.get.mockImplementation(apiError('Denied'));
    withQuery(<CandidateDashboard session={session} />);
    expect(await screen.findByText('Your assessments could not be loaded')).toBeInTheDocument();
  });

  it('lets a student respond to an explanation request without exposing another candidate record', async () => {
    http.get.mockImplementation((url: string) => {
      if (url === '/api/student/dashboard') return response({ candidate: { id: 'candidate-1', name: 'Candidate' }, verification: { status: 'approved' }, assignments: [] });
      if (url === '/api/student/explanation-requests') return response([{ id: 'request-1', question: 'Please explain this event.', body: '', status: 'requested', deadlineAt: '2099-01-01T00:00:00.000Z', incident: { exam: { title: 'Physics' }, type: 'looking_away', createdAt: '2026-11-10T10:00:00.000Z' } }]);
      return response({ notifications: [], emailConfigured: false, emailStatus: 'unavailable' });
    });
    http.post.mockReturnValue(response({ id: 'request-1', status: 'responded' }));
    withQuery(<CandidateDashboard session={session} />);
    expect(await screen.findByText('Explanation Requests')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your explanation'), 'I was checking the clock on the wall.');
    await userEvent.click(screen.getByRole('button', { name: 'Submit explanation' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/student/explanation-requests/request-1/response', expect.any(FormData)));
  });

  it('lets a teacher select candidates and posts each assignment to the real route contract', async () => {
    http.get.mockImplementation((url: string) => url.endsWith('/exams')
      ? response([{ id: 'exam-1', title: 'Physics', durationMinutes: 45, status: 'published' }])
      : response([{ id: 'candidate-1', name: 'Ada Candidate', email: 'ada@example.edu' }], {
        'X-Page': '1',
        'X-Page-Size': '100',
        'X-Total-Count': '1',
        'X-Total-Pages': '1',
      }));
    http.post.mockReturnValue(response({ id: 'assignment-1' }));
    withQuery(<Exams session={{ ...session, role: 'teacher' }} />);
    expect(await screen.findByText('Physics')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign candidates' }));
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign selected (1)' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/api/organizations/org-1/exams/exam-1/assignments', { candidateId: 'candidate-1' }));
    expect(screen.getByText('1 student assigned successfully.')).toBeInTheDocument();
  });
});
