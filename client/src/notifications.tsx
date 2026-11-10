import { useState } from "react";
import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { Badge } from "./components/ui";

type Prefs = { examEmails: boolean; adminEmails: boolean };

export type Notification = { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string };
export type NotificationsPayload = { emailConfigured: boolean; emailStatus: string; notifications: Notification[] };

/** In-app notification center. Reminders, auto-submission notices, result releases and review reminders land here. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data, isError } = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get<NotificationsPayload>("/api/notifications")).data, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = data?.notifications ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900">
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div role="region" aria-label="Notifications" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3"><b className="text-sm">Notifications</b>{data && !data.emailConfigured && <Badge variant="outline">In-app only</Badge>}</div>
          <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto">
            {isError && <li className="px-4 py-6 text-sm text-red-700" role="alert">Notifications couldn't be loaded.</li>}
            {!isError && items.length === 0 && <li className="px-4 py-6 text-sm text-stone-500">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-stone-50"}`}>
                <div className="flex items-start justify-between gap-2"><b className="text-sm text-stone-900">{n.title}</b>{!n.readAt && <button type="button" onClick={() => read.mutate(n.id)} className="shrink-0 text-xs font-medium text-stone-600 underline hover:text-stone-950">Mark read</button>}</div>
                <p className="mt-1 text-sm text-stone-600">{n.body}</p>
                <p className="mt-1 text-[11px] text-stone-400">{new Date(n.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-stone-200 px-4 py-3 text-xs text-stone-600">
            {data?.emailConfigured ? <EmailPreferences /> : <p>Email delivery isn't set up for this deployment, so notifications appear here only.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-user email preferences. Used by the notification menu and the account page; security email can't be turned off. */
export function EmailPreferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["email-prefs"], queryFn: async () => (await api.get<Prefs>("/api/email/preferences")).data });
  const setPref = useMutation({ mutationFn: (patch: Partial<Prefs>) => api.put("/api/email/preferences", patch), onSuccess: () => qc.invalidateQueries({ queryKey: ["email-prefs"] }) });
  return (
    <fieldset disabled={!prefs.data || setPref.isPending} className="text-xs text-stone-600">
      <legend className="font-semibold text-stone-800">Email me about</legend>
      <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={prefs.data?.examEmails ?? true} onChange={(e) => setPref.mutate({ examEmails: e.target.checked })} /> Exam reminders, submissions and results</label>
      <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={prefs.data?.adminEmails ?? true} onChange={(e) => setPref.mutate({ adminEmails: e.target.checked })} /> Administrative notices</label>
      {prefs.isError && <p role="alert" className="mt-1 text-red-700">Preferences couldn't be loaded.</p>}
      {setPref.isError && <p role="alert" className="mt-1 text-red-700">Couldn't save your preference.</p>}
    </fieldset>
  );
}
