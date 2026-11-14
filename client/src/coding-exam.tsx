import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Select } from "./components/ui/select";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui";
import { formatClock, remainingMs, timerTone } from "./lib/exam-state";
import { ChevronLeft, ChevronRight, Clock3, Code2, Expand, Play, Save, Send, TerminalSquare } from "lucide-react";

export type CodingQuestion = {
  id: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  explanation?: string;
  marks: number;
  languageIds: string[];
  starterCode: Record<string, string>;
  samples: Array<{ id: string; input: string; output: string; explanation?: string }>;
};

export type CodingExecutionResult = {
  status: string;
  submissionId?: string;
  createdAt?: string;
  stdout?: string;
  stderr?: string;
  compileOutput?: string;
  executionTimeMs?: number;
  memoryKb?: number;
  message?: string;
  cases?: Array<{ id: string; status: string; passed: boolean; actualOutput?: string; stderr?: string; compileOutput?: string; executionTimeMs?: number; memoryKb?: number }>;
  privateTests?: { passed: number; total: number };
};

type WorkspaceProps = {
  assessment: { title: string; instructions?: string; deadlineAt: string };
  attemptId: string;
  questions: CodingQuestion[];
  initialCodes?: Record<string, { languageId: string; sourceCode: string }>;
  persistence?: { available: boolean; save: (input: { questionId: string; languageId: string; sourceCode: string }) => Promise<void> };
  execution?: { available: boolean; unavailableReason?: string; run: (input: { questionId: string; languageId: string; sourceCode: string }) => Promise<CodingExecutionResult>; submit: (input: { questionId: string; languageId: string; sourceCode: string }) => Promise<CodingExecutionResult>; history: Array<{ id: string; kind: "run" | "submit"; status: string; createdAt: string }> };
  onFinishAssessment?: (automatic?: boolean) => void | Promise<void>;
  submissionError?: string;
  /** Milliseconds to add to the device clock to get server time (from the Date header at start). */
  clockOffsetMs?: number;
};

const languageName: Record<string, string> = { c: "C", cpp: "C++", java: "Java", python: "Python", javascript: "JavaScript" };
const monacoLanguage: Record<string, string> = { c: "c", cpp: "cpp", java: "java", python: "python", javascript: "javascript" };

export function CodingExamWorkspace({ assessment, attemptId, questions, initialCodes = {}, persistence, execution, onFinishAssessment, submissionError = "", clockOffsetMs = 0 }: WorkspaceProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [leftWidth, setLeftWidth] = useState(46);
  const [codes, setCodes] = useState(initialCodes);
  const [saveStatus, setSaveStatus] = useState(persistence?.available ? "All changes saved" : "Server-side code persistence is not configured");
  const [result, setResult] = useState<CodingExecutionResult | null>(null);
  const [localHistory, setLocalHistory] = useState<Array<{ id: string; kind: "run" | "submit"; status: string; createdAt: string }>>([]);
  const [working, setWorking] = useState<"run" | "submit" | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const lastSave = useRef("");
  const saveQueues = useRef(new Map<string, Promise<void>>());
  const persistCode = useCallback(async (input: { questionId: string; languageId: string; sourceCode: string }) => {
    const save = persistence?.save;
    if (!persistence?.available || !save) return;
    const previous = saveQueues.current.get(input.questionId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => save(input));
    saveQueues.current.set(input.questionId, pending);
    try {
      await pending;
    } finally {
      if (saveQueues.current.get(input.questionId) === pending) saveQueues.current.delete(input.questionId);
    }
  }, [persistence]);
  const finishStarted = useRef(false);
  const autoFinishStarted = useRef(false);
  const question = questions[activeIndex];
  const activeCode = codes[question?.id];
  const languageId = activeCode?.languageId ?? question?.languageIds[0] ?? "";
  const sourceCode = activeCode?.sourceCode ?? question?.starterCode[languageId] ?? "";
  // A real ticking clock aligned to the server: without the interval the countdown (and the automatic finish at 0:00)
  // only updated when something else happened to re-render the page.
  const remaining = remainingMs(assessment.deadlineAt, now, clockOffsetMs);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    const up = () => { setOnline(true); setRetryTick((t) => t + 1); }; const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  const hasCode = (id: string, starter: Record<string, string>, langs: string[]) => { const c = codes[id]; if (!c || !c.sourceCode.trim()) return false; return c.sourceCode !== (starter[c.languageId] ?? starter[langs[0]] ?? ""); };

  useEffect(() => {
    if (!question || !persistence?.available) return;
    const key = `${question.id}:${languageId}:${sourceCode}`;
    if (key === lastSave.current) return;
    setSaveStatus("Saving code…");
    const timer = window.setTimeout(() => {
      persistCode({ questionId: question.id, languageId, sourceCode })
        .then(() => { lastSave.current = key; setSaveStatus("All changes saved"); })
        .catch(() => { setSaveStatus("Couldn't save your code. Retrying automatically. Keep this tab open."); retryTimer = window.setTimeout(() => setRetryTick((t) => t + 1), 4000); });
    }, 900);
    let retryTimer: number | undefined;
    return () => { window.clearTimeout(timer); if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [question?.id, languageId, sourceCode, persistence, persistCode, retryTick]);

  const updateCode = (next: string) => {
    if (!question) return;
    setCodes((current) => ({ ...current, [question.id]: { languageId, sourceCode: next } }));
  };
  const changeLanguage = (nextLanguage: string) => {
    if (!question) return;
    setCodes((current) => ({ ...current, [question.id]: { languageId: nextLanguage, sourceCode: current[question.id]?.languageId === nextLanguage ? current[question.id].sourceCode : question.starterCode[nextLanguage] ?? "" } }));
    setResult(null);
  };
  const execute = async (kind: "run" | "submit") => {
    if (!question || !execution?.available) return;
    setWorking(kind); setResult(null);
    try {
      const nextResult = await execution[kind]({ questionId: question.id, languageId, sourceCode });
      setResult(nextResult);
      const { submissionId, createdAt } = nextResult;
      if (submissionId && createdAt) {
        setLocalHistory((current) => [{ id: submissionId, kind, status: nextResult.status, createdAt }, ...current]);
      }
    } catch (error) {
      setResult({ status: "service_error", message: error instanceof Error ? error.message : "The secure execution service could not process this request." });
    } finally { setWorking(null); }
  };
  const saveCurrentCode = async () => {
    if (!question || !persistence?.available) return;
    const key = `${question.id}:${languageId}:${sourceCode}`;
    if (lastSave.current === key) return;
    setSaveStatus("Saving code…");
    await persistCode({ questionId: question.id, languageId, sourceCode });
    lastSave.current = key;
    setSaveStatus("All changes saved");
  };
  const navigateQuestion = async (nextIndex: number) => {
    try {
      await saveCurrentCode();
      setActiveIndex(nextIndex);
      setResult(null);
    } catch {
      setSaveStatus("Autosave failed — retry before leaving this question.");
    }
  };
  const finishAssessment = async (automatic = false) => {
    if (!onFinishAssessment || finishing || finishStarted.current) return;
    finishStarted.current = true;
    setFinishing(true);
    setFinishError("");
    try {
      if (persistence?.available) {
        const pendingCodes = new Map(Object.entries(codes));
        if (question) pendingCodes.set(question.id, { languageId, sourceCode });
        await Promise.all(Array.from(pendingCodes.entries()).map(([questionId, code]) =>
          persistCode({ questionId, languageId: code.languageId, sourceCode: code.sourceCode }),
        ));
        lastSave.current = question ? `${question.id}:${languageId}:${sourceCode}` : lastSave.current;
        setSaveStatus("All changes saved");
      }
      await onFinishAssessment(automatic);
    } catch {
      setFinishError("Code saving or final submission could not be confirmed. Check your connection and retry.");
    } finally {
      setFinishing(false);
      finishStarted.current = false;
    }
  };
  useEffect(() => {
    if (remaining <= 0 && onFinishAssessment && !autoFinishStarted.current) {
      autoFinishStarted.current = true;
      void finishAssessment(true);
    }
  }, [remaining <= 0]);
  const statusClass = result?.status === "accepted" ? "text-emerald-300" : result ? "text-amber-300" : "text-slate-400";
  const statusText = execution?.available ? "Secure runner available" : execution?.unavailableReason ?? "Secure runner is not configured";
  const executionHistory = [...localHistory, ...(execution?.history ?? []).filter((entry) => !localHistory.some((local) => local.id === entry.id))];

  if (!question) return <section className="coding-workspace-empty"><Code2 size={28} /><h2>No coding questions are available</h2><p>This assessment cannot open a coding workspace until the server supplies an authorized coding question.</p></section>;
  return <main className={`coding-workspace coding-workspace-${theme}`} aria-label="Coding examination workspace">
    <header className="coding-toolbar">
      <div><p className="coding-kicker">Coding assessment</p><h1>{assessment.title}</h1><p className="coding-save"><Save size={14} /> {saveStatus}</p></div>
      <div className="coding-toolbar-actions"><span className="coding-runner-status"><span /> {statusText}</span><span className={`coding-clock ${timerTone(remaining) === "critical" || timerTone(remaining) === "expired" ? "text-red-300" : timerTone(remaining) === "warning" ? "text-amber-300" : ""}`}><Clock3 size={16} /> <span role="timer" aria-label="Time remaining">{formatClock(remaining)}</span></span>{!online && <span className="coding-runner-status" role="status">Offline: your code is kept here and will save when you reconnect</span>}<button type="button" className="coding-icon-button" aria-label="Toggle editor theme" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light" : "Dark"}</button><button type="button" className="coding-icon-button" aria-label="Open coding workspace full screen" onClick={() => void document.documentElement.requestFullscreen?.()}><Expand size={17} /></button></div>
    </header>
    <div className="coding-question-strip" aria-label="Coding question navigation">{questions.map((item, index) => <button type="button" key={item.id} onClick={() => void navigateQuestion(index)} className={index === activeIndex ? "coding-question-tab coding-question-tab-active" : "coding-question-tab"} aria-current={index === activeIndex ? "step" : undefined}>Q{index + 1}<span>{item.title}</span>{hasCode(item.id, item.starterCode, item.languageIds) && <i><span className="sr-only"> (code written)</span><span aria-hidden="true"> ●</span></i>}</button>)}</div>
    <div className="coding-resize-control"><label htmlFor="problem-pane-width">Problem panel width</label><input id="problem-pane-width" type="range" min="32" max="62" value={leftWidth} onChange={(event) => setLeftWidth(Number(event.target.value))} /></div>
    <div className="coding-split" style={{ gridTemplateColumns: `${leftWidth}% 1fr` }}>
      <article className="coding-problem-panel">
        <div className="coding-problem-meta"><span className={`coding-difficulty coding-difficulty-${question.difficulty}`}>{question.difficulty}</span><span>{question.marks} marks</span></div>
        <h2>{activeIndex + 1}. {question.title}</h2><div className="coding-description whitespace-pre-wrap">{question.description}</div>
        {question.inputFormat && <section><h3>Input format</h3><p className="whitespace-pre-wrap">{question.inputFormat}</p></section>}
        {question.outputFormat && <section><h3>Output format</h3><p className="whitespace-pre-wrap">{question.outputFormat}</p></section>}
        {question.constraints && <section><h3>Constraints</h3><p className="whitespace-pre-wrap">{question.constraints}</p></section>}
        <section><h3>Examples</h3>{question.samples.map((sample, index) => <div className="coding-sample" key={sample.id}><b>Sample {index + 1}</b><div><span>Input</span><pre>{sample.input}</pre></div><div><span>Output</span><pre>{sample.output}</pre></div>{sample.explanation && <p>{sample.explanation}</p>}</div>)}</section>
      </article>
      <section className="coding-editor-panel">
        <div className="coding-editor-bar"><label>Language<Select className="w-auto min-w-32" value={languageId} disabled={!question.languageIds.length} onChange={(event) => changeLanguage(event.target.value)} aria-label="Programming language">{question.languageIds.length ? question.languageIds.map((id) => <option key={id} value={id}>{languageName[id] ?? id}</option>) : <option value="">Not configured</option>}</Select></label><span>Attempt {attemptId.slice(0, 8)}</span></div>
        <div className="coding-editor"><Editor height="100%" language={monacoLanguage[languageId] ?? "plaintext"} theme={theme === "dark" ? "vs-dark" : "light"} value={sourceCode} onChange={(value) => updateCode(value ?? "")} options={{ minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", wordWrap: "on", automaticLayout: true, tabSize: 2, accessibilitySupport: "on" }} /></div>
        <div className="coding-actions"><button type="button" className="coding-run-button" disabled={!execution?.available || !!working} onClick={() => void execute("run")}><Play size={16} /> {working === "run" ? "Running…" : "Run samples"}</button><button type="button" className="coding-submit-button" disabled={!execution?.available || !!working} onClick={() => void execute("submit")}><Send size={16} /> {working === "submit" ? "Submitting…" : "Submit solution"}</button></div>
        {!question.languageIds.length && <p className="coding-unavailable" role="alert"><Code2 size={16} /> No programming language is configured for this question. Contact the exam organizer before continuing.</p>}
        {!execution?.available && <p className="coding-unavailable" role="status"><TerminalSquare size={16} /> {execution?.unavailableReason ?? "Run and Submit are disabled until ExamGuard is connected to an approved isolated code-execution service."} Your code is not stored in localStorage.</p>}
        <section className="coding-console" aria-live="polite"><div className="coding-console-heading"><TerminalSquare size={16} /><b>Execution</b><span className={statusClass}>{result?.status ?? "No execution yet"}</span></div>{result ? <div className="coding-console-content">{result.message && <p>{result.message}</p>}{result.compileOutput && <pre>{result.compileOutput}</pre>}{result.stderr && <pre>{result.stderr}</pre>}{result.stdout && <pre>{result.stdout}</pre>}{result.cases?.map((item) => <div key={item.id} className="border-t border-slate-700 py-2"><b>{item.passed ? "Passed" : item.status}</b>{item.actualOutput && <pre>{item.actualOutput}</pre>}{item.compileOutput && <pre>{item.compileOutput}</pre>}{item.stderr && <pre>{item.stderr}</pre>}</div>)}{result.privateTests && <p>Private tests passed: {result.privateTests.passed} / {result.privateTests.total}. Private inputs and expected outputs are not shown.</p>}{(result.executionTimeMs != null || result.memoryKb != null) && <p>Time: {result.executionTimeMs ?? "—"} ms · Memory: {result.memoryKb ?? "—"} KB</p>}</div> : <p className="coding-console-content">Use Run samples for visible cases once a secure runner is available. Private test cases are never displayed here.</p>}</section>
        {(submissionError || finishError) && <p className="coding-unavailable" role="alert">{submissionError || finishError}</p>}
        <section className="coding-history" aria-label="Submission history"><div><b>Server-side submission history</b><span>{executionHistory.length} records</span></div>{executionHistory.length ? <ol>{executionHistory.map((entry) => <li key={entry.id}><span>{entry.kind === "run" ? "Run" : "Submit"}</span><b>{entry.status}</b><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></li>)}</ol> : <p>No server-side execution history is available until secure persistence is configured.</p>}</section>
      </section>
    </div>
    <footer className="coding-footer"><button type="button" className="coding-nav-button" disabled={activeIndex === 0} onClick={() => void navigateQuestion(activeIndex - 1)}><ChevronLeft size={17} /> Previous</button><div><b>{activeIndex + 1} / {questions.length}</b><span>{executionHistory.length} server-side execution records</span></div>{activeIndex < questions.length - 1 ? <button type="button" className="coding-nav-button" onClick={() => void navigateQuestion(activeIndex + 1)}>Next <ChevronRight size={17} /></button> : onFinishAssessment ? <button type="button" className="coding-finish-button" disabled={finishing} onClick={() => setConfirmFinish(true)}>{finishing ? "Saving & submitting…" : "Finish assessment"}</button> : <span className="coding-unavailable">Final submission requires the assessment submit action.</span>}</footer>
    <Dialog open={confirmFinish} onOpenChange={setConfirmFinish} ariaLabel="Finish assessment">
      <DialogContent className="w-[min(100vw-2rem,30rem)]">
        <DialogHeader><div><DialogTitle>Finish and submit?</DialogTitle><DialogDescription>Your code is saved first, then the assessment is submitted. You can't change it afterwards.</DialogDescription></div></DialogHeader>
        <ul className="space-y-1 text-sm text-stone-700">{questions.map((item, index) => <li key={item.id} className="flex justify-between gap-3"><span>Q{index + 1}. {item.title}</span><b className={hasCode(item.id, item.starterCode, item.languageIds) ? "text-emerald-700" : "text-amber-800"}>{hasCode(item.id, item.starterCode, item.languageIds) ? "Code written" : "Starter code only"}</b></li>)}</ul>
        <DialogFooter><Button variant="outline" onClick={() => setConfirmFinish(false)}>Keep working</Button><Button disabled={finishing} onClick={() => { setConfirmFinish(false); void finishAssessment(false); }}>Submit assessment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </main>;
}
