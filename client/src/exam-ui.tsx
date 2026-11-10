import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock, Flag, Loader2, WifiOff } from "lucide-react";
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from "./components/ui";
import type { SyncSnapshot } from "./lib/answer-sync";
import { formatClock, questionState, timerAnnouncement, timerTone, type QuestionState } from "./lib/exam-state";

const TONE: Record<ReturnType<typeof timerTone>, string> = {
  normal: "border-stone-200 bg-white text-stone-900", warning: "border-amber-300 bg-amber-50 text-amber-900",
  critical: "border-red-300 bg-red-50 text-red-800", expired: "border-red-300 bg-red-50 text-red-800",
};

/** Countdown driven by the server deadline. The visible clock updates every second; screen readers hear only key moments. */
export function ExamTimer({ ms }: { ms: number }) {
  const [spoken, setSpoken] = useState("");
  const last = useRef("");
  useEffect(() => { const a = timerAnnouncement(ms); if (a && a !== last.current) { last.current = a; setSpoken(a); } }, [ms]);
  const tone = timerTone(ms);
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-lg font-semibold tabular-nums", TONE[tone])}>
      <Clock size={16} aria-hidden="true" />
      <span role="timer" aria-label="Time remaining">{formatClock(ms)}</span>
      {tone === "critical" && <span className="text-xs font-sans font-medium">Final minute</span>}
      <span className="sr-only" role="status" aria-live="polite">{spoken}</span>
    </div>
  );
}

/** Autosave and connectivity in one place: what is happening to the candidate's answers right now. */
export function SyncIndicator({ online, sync }: { online: boolean; sync: SyncSnapshot }) {
  let tone = "text-emerald-700", Icon = CheckCircle2, text = sync.lastSavedAt ? `All changes saved · ${new Date(sync.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "All changes saved";
  if (sync.phase === "closed") { tone = "text-red-700"; Icon = AlertTriangle; text = "This attempt is closed. No further changes can be saved."; }
  else if (!online) { tone = "text-amber-800"; Icon = WifiOff; text = sync.pending ? `Offline. ${sync.pending} answer${sync.pending > 1 ? "s" : ""} kept on this page and will save when you reconnect.` : "Offline. Your saved answers are safe; new changes will save when you reconnect."; }
  else if (sync.phase === "retrying") { tone = "text-amber-800"; Icon = Loader2; text = `Can't reach the server. Retrying. ${sync.pending} answer${sync.pending > 1 ? "s" : ""} waiting.`; }
  else if (sync.phase === "saving") { tone = "text-stone-600"; Icon = Loader2; text = "Saving…"; }
  else if (sync.phase === "waiting") { tone = "text-stone-600"; Icon = Loader2; text = "Unsaved changes"; }
  return <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}><Icon size={14} aria-hidden="true" className={sync.phase === "saving" || sync.phase === "retrying" ? "animate-spin motion-reduce:animate-none" : ""} />{text}</p>;
}

const PALETTE: Record<QuestionState, string> = {
  current: "border-stone-900 bg-stone-900 text-white",
  marked: "border-amber-400 bg-amber-50 text-amber-900",
  answered: "border-emerald-300 bg-emerald-50 text-emerald-900",
  unanswered: "border-stone-300 bg-white text-stone-700 hover:border-stone-500",
};
const STATE_LABEL: Record<QuestionState, string> = { current: "current question", marked: "marked for review", answered: "answered", unanswered: "not answered" };

export function QuestionPalette({ questions, current, isAnswered, isMarked, onSelect }: { questions: Array<{ id: string }>; current: number; isAnswered: (id: string) => boolean; isMarked: (id: string) => boolean; onSelect: (index: number) => void }) {
  return (
    <div>
      <ol className="grid grid-cols-5 gap-2" aria-label="Question navigator">
        {questions.map((q, i) => {
          const state = questionState(i === current, isMarked(q.id), isAnswered(q.id));
          return (
            <li key={q.id}>
              <button type="button" onClick={() => onSelect(i)} aria-current={i === current ? "step" : undefined}
                aria-label={`Question ${i + 1}, ${STATE_LABEL[state]}${isMarked(q.id) && state !== "marked" ? ", marked for review" : ""}${isAnswered(q.id) && state !== "answered" ? ", answered" : ""}`}
                className={cn("relative flex h-10 w-full items-center justify-center rounded-lg border text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900", PALETTE[state])}>
                {i + 1}
                {isMarked(q.id) && <Flag size={10} aria-hidden="true" className="absolute right-1 top-1" />}
                {isAnswered(q.id) && state !== "current" && <Check size={10} aria-hidden="true" className="absolute bottom-1 right-1" />}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-5 text-stone-500">Dark: current · check: answered · flag: marked for review</p>
    </div>
  );
}

export interface SubmitReviewProps { open: boolean; onOpenChange: (open: boolean) => void; total: number; answered: number; unanswered: number[]; marked: number[]; sync: SyncSnapshot; online: boolean; busy: boolean; error: string; onJump: (index: number) => void; onConfirm: () => void }
export function SubmitReviewDialog(p: SubmitReviewProps) {
  const unsaved = p.sync.pending > 0 || !p.online;
  const chips = (idx: number[]) => idx.map((i) => <button key={i} type="button" onClick={() => { p.onOpenChange(false); p.onJump(i); }} className="rounded-md border border-stone-300 px-2 py-0.5 text-sm font-semibold hover:border-stone-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900" aria-label={`Go to question ${i + 1}`}>{i + 1}</button>);
  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!p.busy) p.onOpenChange(o); }} ariaLabel="Review and submit">
      <DialogContent className="w-[min(100vw-2rem,32rem)]">
        <DialogHeader><div><DialogTitle>Submit your exam?</DialogTitle><DialogDescription>You can't change answers after submitting.</DialogDescription></div></DialogHeader>
        <p className="text-sm text-stone-700"><b>{p.answered}</b> of <b>{p.total}</b> questions answered.</p>
        {p.unanswered.length > 0 && <div className="mt-3"><p className="text-sm font-medium text-amber-900">Not answered</p><div className="mt-1 flex flex-wrap gap-1.5">{chips(p.unanswered)}</div></div>}
        {p.marked.length > 0 && <div className="mt-3"><p className="text-sm font-medium text-stone-800">Marked for review</p><div className="mt-1 flex flex-wrap gap-1.5">{chips(p.marked)}</div></div>}
        {unsaved && <Alert variant="warning" className="mt-4">{p.online ? `${p.sync.pending} answer${p.sync.pending > 1 ? "s are" : " is"} still being saved. Stay on this page; submitting will save them first.` : "You're offline. Reconnect before submitting so your latest answers are saved."}</Alert>}
        {p.error && <Alert variant="destructive" className="mt-4">{p.error}</Alert>}
        <DialogFooter><Button variant="outline" disabled={p.busy} onClick={() => p.onOpenChange(false)}>Keep working</Button><Button disabled={p.busy} onClick={p.onConfirm}>{p.busy ? "Submitting…" : "Submit exam"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
