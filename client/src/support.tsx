import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { Alert, Badge, Button, Input, Select, Textarea } from './components/ui';

type Session = { organization: { id: string; name: string }; role: string; user: { name: string; email: string } };
type Ticket = { id: string; subject: string; status: string; createdAt: string; updatedAt: string; _count?: { messages: number }; requester?: { name: string; email: string } };
type Message = { id: string; body: string; createdAt: string; author: { id: string; name: string; email: string } };
type TicketDetail = Ticket & { requester: { id: string; name: string; email: string }; messages: Message[] };
const statuses = ['open', 'in_progress', 'awaiting_requester', 'resolved', 'closed'];
const label = (status: string) => status.replaceAll('_', ' ');
const errorText = (error: unknown) => axios.isAxiosError(error)
  ? error.response?.data?.error ?? 'The support request could not be completed.'
  : 'The support request could not be completed.';

export function SupportPage({ session }: { session: Session }) {
  const organizationId = session.organization.id;
  const isStaff = session.role !== 'student';
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [subject, setSubject] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/api/organizations/${organizationId}/support/tickets`;
  const tickets = useQuery({
    queryKey: ['support-tickets', organizationId],
    queryFn: async () => (await api.get<Ticket[]>(base)).data,
  });
  useEffect(() => {
    if (!selectedId && tickets.data?.length) setSelectedId(tickets.data[0].id);
  }, [selectedId, tickets.data]);
  const detail = useQuery({
    queryKey: ['support-ticket', organizationId, selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await api.get<TicketDetail>(`${base}/${selectedId}`)).data,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['support-tickets', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['support-ticket', organizationId, selectedId] }),
    ]);
  };
  const create = useMutation({
    mutationFn: async () => (await api.post<Ticket>(base, { subject, body: initialMessage })).data,
    onSuccess: async (created) => {
      setError('');
      setNotice('Support ticket created.');
      setSubject('');
      setInitialMessage('');
      setSelectedId(created.id);
      await queryClient.invalidateQueries({ queryKey: ['support-tickets', organizationId] });
    },
    onError: (requestError) => setError(errorText(requestError)),
  });
  const sendReply = useMutation({
    mutationFn: async () => api.post(`${base}/${selectedId}/messages`, { body: reply }),
    onSuccess: async () => { setError(''); setNotice('Reply sent.'); setReply(''); await refresh(); },
    onError: (requestError) => setError(errorText(requestError)),
  });
  const changeStatus = useMutation({
    mutationFn: async (status: string) => api.patch(`${base}/${selectedId}/status`, { status }),
    onSuccess: async () => { setError(''); setNotice('Ticket status updated.'); await refresh(); },
    onError: (requestError) => setError(errorText(requestError)),
  });
  const submitTicket = (event: FormEvent) => { event.preventDefault(); setError(''); create.mutate(); };
  const submitReply = (event: FormEvent) => { event.preventDefault(); setError(''); sendReply.mutate(); };

  return <div className="space-y-5">
    <header>
      <h2 className="text-xl font-semibold tracking-tight">Help & support</h2>
      <p className="mt-1 text-sm text-stone-600">Send a request to your institution’s support team and follow the conversation here. Messages are visible only to you and authorized staff in {session.organization.name}.</p>
    </header>
    {error && <Alert role="alert" variant="destructive">{error}</Alert>}
    {notice && <Alert role="status" variant="success">{notice}</Alert>}
    <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
      <div className="space-y-5">
        <form className="card space-y-3" onSubmit={submitTicket}>
          <h3 className="font-semibold">Create a support ticket</h3>
          <label className="block text-sm font-medium">Subject
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={4} maxLength={160} required className="mt-1" />
          </label>
          <label className="block text-sm font-medium">What do you need help with?
            <Textarea value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} minLength={2} maxLength={5000} required rows={4} className="mt-1" />
          </label>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Submit ticket'}</Button>
        </form>

        <section className="card" aria-labelledby="ticket-list-title">
          <h3 id="ticket-list-title" className="font-semibold">{isStaff ? 'Institution tickets' : 'Your tickets'}</h3>
          {tickets.isError ? <Alert role="alert" variant="destructive" className="mt-3">Tickets could not be loaded. <Button variant="outline" size="sm" onClick={() => void tickets.refetch()}>Retry</Button></Alert>
            : tickets.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading tickets…</p>
              : tickets.data?.length ? <ul className="mt-3 divide-y divide-stone-100">{tickets.data.map(ticket => <li key={ticket.id}>
                <button type="button" aria-current={selectedId === ticket.id ? 'true' : undefined} onClick={() => { setSelectedId(ticket.id); setError(''); setNotice(''); }} className={`w-full rounded-lg px-2 py-3 text-left ${selectedId === ticket.id ? 'bg-blue-50' : 'hover:bg-stone-50'}`}>
                  <span className="flex items-start justify-between gap-2"><b className="text-sm">{ticket.subject}</b><Badge variant={['closed', 'resolved'].includes(ticket.status) ? 'muted' : 'outline'}>{label(ticket.status)}</Badge></span>
                  {isStaff && ticket.requester && <span className="mt-1 block text-xs text-stone-500">{ticket.requester.name} · {ticket.requester.email}</span>}
                  <span className="mt-1 block text-xs text-stone-500">Updated {new Date(ticket.updatedAt).toLocaleString()}</span>
                </button>
              </li>)}</ul>
              : <p className="mt-3 text-sm text-stone-500">No support tickets yet.</p>}
        </section>
      </div>

      <section className="card min-h-96" aria-labelledby="ticket-detail-title">
        {!selectedId ? <div className="flex min-h-80 items-center justify-center text-center text-sm text-stone-500">Choose a ticket or create one to start a conversation.</div>
          : detail.isError ? <Alert role="alert" variant="destructive">This ticket could not be loaded. <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>Retry</Button></Alert>
            : detail.isLoading || !detail.data ? <p className="text-sm text-stone-500">Loading conversation…</p>
              : <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
                  <div><h3 id="ticket-detail-title" className="font-semibold">{detail.data.subject}</h3><p className="mt-1 text-xs text-stone-500">Opened {new Date(detail.data.createdAt).toLocaleString()}</p></div>
                  <Badge variant={['closed', 'resolved'].includes(detail.data.status) ? 'muted' : 'outline'}>{label(detail.data.status)}</Badge>
                  {isStaff && <label className="sr-only" htmlFor="support-ticket-status">Ticket status</label>}
                  {isStaff && <Select id="support-ticket-status" aria-label="Ticket status" value={detail.data.status} disabled={changeStatus.isPending} onChange={(event) => changeStatus.mutate(event.target.value)} className="w-44">
                    {statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}
                  </Select>}
                </div>
                <ol aria-label="Support conversation" className="my-4 space-y-3">
                  {detail.data.messages.map(message => <li key={message.id} className="rounded-lg border border-stone-100 bg-stone-50 p-3">
                    <div className="flex flex-wrap justify-between gap-2"><b className="text-sm">{message.author.name}{message.author.id === detail.data.requester.id ? ' · requester' : ' · support'}</b><time className="text-xs text-stone-500" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{message.body}</p>
                  </li>)}
                </ol>
                {(!['resolved', 'closed'].includes(detail.data.status) || isStaff) ? <form className="border-t border-stone-100 pt-4" onSubmit={submitReply}>
                  <label htmlFor="support-reply" className="text-sm font-medium">Reply</label>
                  <Textarea id="support-reply" value={reply} onChange={(event) => setReply(event.target.value)} minLength={2} maxLength={5000} required rows={3} className="mt-1" />
                  <Button type="submit" className="mt-3" disabled={sendReply.isPending}>{sendReply.isPending ? 'Sending…' : 'Send reply'}</Button>
                </form> : <p className="border-t border-stone-100 pt-4 text-sm text-stone-500">This ticket is resolved. Create a new ticket if you still need help.</p>}
              </>}
      </section>
    </div>
  </div>;
}
