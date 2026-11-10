import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { LifeBuoy, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { api } from "./lib/api";
import { Alert, Badge, Button } from "./components/ui";
import { canSend, errorText, MAX_MESSAGE_CHARS, modeLabel, suggestionsFor, trimHistory, type AssistantReply, type ChatTurn } from "./lib/assistant-client";

type Props = { organizationId: string; role: string };
type Entry = { id: number; turn: ChatTurn; reply?: AssistantReply; rated?: boolean };

/** Role-aware help assistant. Role, tenant and active-exam state are decided by the server; nothing here grants access. */
export function AssistantPanel({ organizationId, role }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"ai_assisted" | "help_center" | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const base = `/api/organizations/${organizationId}/assistant`;

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    let cancelled = false;
    api.get(`${base}/status`).then((r) => { if (!cancelled) setMode(r.data.mode); }).catch(() => { if (!cancelled) setMode(null); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); launcher.current?.focus(); };
  }, [open, base]);
  useEffect(() => {
    const element = log.current;
    if (element && typeof element.scrollTo === 'function') element.scrollTo({ top: element.scrollHeight });
  }, [entries, busy]);
  useEffect(() => { setEntries([]); setError(""); }, [organizationId]);

  async function send(message: string) {
    if (!canSend(message, busy)) return;
    const history = trimHistory(entries.flatMap((e) => [e.turn, ...(e.reply ? [{ role: "assistant" as const, content: e.reply.answer }] : [])]));
    setBusy(true); setError(""); setText("");
    const id = ++seq.current;
    setEntries((prev) => [...prev, { id, turn: { role: "user", content: message.trim() } }]);
    try {
      const { data } = await api.post<AssistantReply>(`${base}/chat`, { message: message.trim(), history });
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, reply: data } : e)));
    } catch (e) {
      setError(errorText(axios.isAxiosError(e) ? e.response?.status : undefined));
    } finally { setBusy(false); input.current?.focus(); }
  }

  async function rate(entry: Entry, helpful: boolean) {
    if (!entry.reply || entry.rated) return;
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, rated: true } : e)));
    try { await api.post(`${base}/feedback`, { helpful, intent: entry.reply.intent, mode: entry.reply.mode }); } catch { /* feedback is optional; ignore failures */ }
  }

  return (
    <>
      <button ref={launcher} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="eg-assistant-panel"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-stone-950 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900">
        <LifeBuoy size={18} aria-hidden="true" /> Help
      </button>
      {open && (
        <section id="eg-assistant-panel" role="dialog" aria-label="ExamGuard assistant"
          className="fixed bottom-20 right-5 z-40 flex max-h-[min(36rem,calc(100vh-7rem))] w-[calc(100vw-2.5rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
            <div className="min-w-0"><h2 className="text-sm font-semibold text-stone-950">Assistant</h2><p className="text-xs text-stone-500">Help with ExamGuard. Conversations are not stored.</p></div>
            <div className="flex items-center gap-2">
              {entries.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setEntries([]); setError(""); }}>Clear</Button>}
              {mode && <Badge variant={mode === "ai_assisted" ? "default" : "outline"}>{modeLabel(mode)}</Badge>}
              <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={16} /></Button>
            </div>
          </header>
          <div ref={log} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Conversation">
            {entries.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-stone-600">Ask about devices, the Companion, deadlines, submissions or how ExamGuard works. I can't answer exam questions or look up individual records.</p>
                <div className="flex flex-wrap gap-2">{suggestionsFor(role).map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-700 hover:border-stone-400 hover:bg-stone-50">{s}</button>)}</div>
              </div>
            )}
            {entries.map((e) => (
              <div key={e.id} className="space-y-2">
                <p className="ml-8 whitespace-pre-wrap rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-900"><span className="sr-only">You: </span>{e.turn.content}</p>
                {e.reply && (
                  <div className={`mr-8 rounded-xl border px-3 py-2 text-sm ${e.reply.mode === "refused" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-stone-200 bg-white text-stone-900"}`}>
                    <span className="sr-only">Assistant: </span><p className="whitespace-pre-wrap">{e.reply.answer}</p>
                    {e.reply.sources.length > 0 && <p className="mt-2 text-xs text-stone-500">Sources: {e.reply.sources.map((s) => s.title).join(" · ")}</p>}
                    {e.reply.escalateToHuman && <p className="mt-2 text-xs font-medium text-stone-700">Please contact your exam organizer or ExamGuard support for this.</p>}
                    {e.reply.aiGenerated && <p className="mt-2 text-xs text-stone-500">{e.reply.disclaimer}</p>}
                    {(e.reply.mode === "knowledge" || e.reply.mode === "model") && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-stone-500">
                        {e.rated ? <span role="status">Thanks for the feedback.</span> : (<><span>Was this helpful?</span>
                          <Button variant="ghost" size="icon" aria-label="Helpful" onClick={() => void rate(e, true)}><ThumbsUp size={14} /></Button>
                          <Button variant="ghost" size="icon" aria-label="Not helpful" onClick={() => void rate(e, false)}><ThumbsDown size={14} /></Button></>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="text-xs text-stone-500" role="status">Thinking…</p>}
            {error && <Alert variant="destructive">{error}</Alert>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-end gap-2 border-t border-stone-200 p-3">
            <label htmlFor="eg-assistant-input" className="sr-only">Message the assistant</label>
            <textarea id="eg-assistant-input" ref={input} value={text} maxLength={MAX_MESSAGE_CHARS} rows={2} placeholder="Type your question"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
              className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900" />
            <Button type="submit" size="icon" aria-label="Send message" disabled={!canSend(text, busy)}><Send size={16} /></Button>
          </form>
        </section>
      )}
    </>
  );
}
