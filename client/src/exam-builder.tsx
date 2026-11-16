import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { api } from "./lib/api";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CopyableId } from "./components/ui";
import { QuestionTypeRenderer, type ExamQuestionType } from "./question-renderer";

type Session = { organization: { id: string } };
type Question = {
  id?: string;
  type: ExamQuestionType;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctAnswer?: unknown;
  marks: number;
  negativeMarks: number;
  coding?: {
    title: string;
    description: string;
    difficulty: "easy" | "medium" | "hard";
    mode: "function" | "stdin_stdout";
    inputFormat: string;
    outputFormat: string;
    constraints: string;
    explanation: string;
    languageIds: string[];
    starterCode: Record<string, string>;
    timeLimitMs: number;
    memoryLimitKb: number;
    comparisonMode: "exact" | "whitespace_normalized";
  };
  codingTestCases?: Array<{ input: string; expectedOutput: string; visibility: "sample" | "private"; position: number }>;
};
type QuestionBank = { id: string; name: string };
type ExamTemplateSummary = { id: string; name: string; description?: string | null };
const CODING_LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
] as const;
const DEFAULT_CODING_LANGUAGE_IDS = CODING_LANGUAGES.map(({ id }) => id);
const defaultInterventionPolicy = () => ({
  windowSeconds: 300,
  warningAt: 1,
  pauseAt: 3,
  terminateAt: 5,
  automaticTerminationEnabled: false,
  fullscreenRequired: true,
});
const blankQuestion = (): Question => ({
  type: "mcq",
  prompt: "",
  options: [
    { id: crypto.randomUUID(), text: "" },
    { id: crypto.randomUUID(), text: "" },
  ],
  correctAnswer: undefined,
  marks: 1,
  negativeMarks: 0,
  codingTestCases: [],
});
const blankCoding = (): NonNullable<Question["coding"]> => ({
  title: "",
  description: "",
  difficulty: "medium",
  mode: "stdin_stdout",
  inputFormat: "",
  outputFormat: "",
  constraints: "",
  explanation: "",
  languageIds: [...DEFAULT_CODING_LANGUAGE_IDS],
  starterCode: Object.fromEntries(DEFAULT_CODING_LANGUAGE_IDS.map((id) => [id, ""])),
  timeLimitMs: 2000,
  memoryLimitKb: 262144,
  comparisonMode: "exact",
});
type ApiQuestion = Question & {
  codingQuestion?: NonNullable<Question["coding"]> & {
    testCases?: NonNullable<Question["codingTestCases"]>;
  };
};
const questionForEditor = (question: ApiQuestion): Question => {
  const { codingQuestion, ...base } = question;
  return {
    ...base,
    coding: base.coding ?? (codingQuestion ? {
      title: codingQuestion.title,
      description: codingQuestion.description,
      difficulty: codingQuestion.difficulty,
      mode: codingQuestion.mode,
      inputFormat: codingQuestion.inputFormat,
      outputFormat: codingQuestion.outputFormat,
      constraints: codingQuestion.constraints,
      explanation: codingQuestion.explanation,
      languageIds: codingQuestion.languageIds,
      starterCode: codingQuestion.starterCode,
      timeLimitMs: codingQuestion.timeLimitMs,
      memoryLimitKb: codingQuestion.memoryLimitKb,
      comparisonMode: codingQuestion.comparisonMode,
    } : undefined),
    codingTestCases: base.codingTestCases ?? codingQuestion?.testCases?.map(({ input, expectedOutput, visibility, position }) => ({ input, expectedOutput, visibility, position })),
  };
};

export function ExamBuilder({ session }: { session: Session }) {
  const navigate = useNavigate();
  const { examId: routeExamId } = useParams();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [examId, setExamId] = useState<string | undefined>(routeExamId);
  const [details, setDetails] = useState({
    title: "",
    instructions: "",
    durationMinutes: 60,
    startsAt: "",
    endsAt: "",
    randomizeQuestions: false,
    randomizeOptions: false,
    isPractice: false,
    interventionPolicy: defaultInterventionPolicy(),
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [bankId, setBankId] = useState("");
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankName, setBankName] = useState("");
  const [banksLoading, setBanksLoading] = useState(true);
  const [bankQuestionsLoading, setBankQuestionsLoading] = useState(false);
  const [banksError, setBanksError] = useState("");
  const [bankQuestionsError, setBankQuestionsError] = useState("");
  const [templates, setTemplates] = useState<ExamTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState("");
  const total = useMemo(
    () => questions.reduce((n, q) => n + (Number(q.marks) || 0), 0),
    [questions],
  );
  useEffect(() => {
    if (!routeExamId) return;
    Promise.all([
      api.get(
        `/api/organizations/${session.organization.id}/exams/${routeExamId}`,
      ),
      api.get(
        `/api/organizations/${session.organization.id}/exams/${routeExamId}/questions`,
      ),
    ])
      .then(([exam, questionList]) => {
        const e = exam.data;
        setDetails({
          title: e.title,
          instructions: e.instructions ?? "",
          durationMinutes: e.durationMinutes,
          startsAt: e.startsAt
            ? new Date(e.startsAt).toISOString().slice(0, 16)
            : "",
          endsAt: e.endsAt ? new Date(e.endsAt).toISOString().slice(0, 16) : "",
          randomizeQuestions: !!e.randomizeQuestions,
          randomizeOptions: !!e.randomizeOptions,
          isPractice: e.isPractice === true,
          interventionPolicy: { ...defaultInterventionPolicy(), ...e.interventionPolicy },
        });
        setQuestions(questionList.data.map(questionForEditor));
      })
      .catch((err) =>
        setError(
          axios.isAxiosError(err)
            ? (err.response?.data?.error ?? "Could not load the draft.")
            : "Could not load the draft.",
        ),
      );
  }, [routeExamId, session.organization.id]);
  useEffect(() => {
    setBanksLoading(true);
    setBanksError("");
    api
      .get(`/api/organizations/${session.organization.id}/question-banks`)
      .then((response) => setBanks(response.data))
      .catch((error) => {
        setBanksError(
          axios.isAxiosError(error)
            ? (error.response?.data?.error ?? "Could not load question banks.")
            : "Could not load question banks.",
        );
      })
      .finally(() => setBanksLoading(false));
  }, [session.organization.id]);
  useEffect(() => {
    setTemplatesLoading(true);
    setTemplatesError("");
    api.get(`/api/organizations/${session.organization.id}/exam-templates`)
      .then(({ data }) => setTemplates(data))
      .catch((requestError) => {
        setTemplatesError(
          axios.isAxiosError(requestError)
            ? (requestError.response?.data?.error ?? "Could not load exam templates.")
            : "Could not load exam templates.",
        );
      })
      .finally(() => setTemplatesLoading(false));
  }, [session.organization.id]);
  useEffect(() => {
    if (!bankId) {
      setBankQuestions([]);
      setBankQuestionsError("");
      return;
    }
    setBankQuestionsLoading(true);
    setBankQuestionsError("");
    api
      .get(
        `/api/organizations/${session.organization.id}/question-banks/${bankId}/questions`,
      )
      .then((response) => setBankQuestions(response.data))
      .catch((error) => {
        setBankQuestionsError(
          axios.isAxiosError(error)
            ? (error.response?.data?.error ?? "Could not load bank questions.")
            : "Could not load bank questions.",
        );
        setBankQuestions([]);
      })
      .finally(() => setBankQuestionsLoading(false));
  }, [bankId, session.organization.id]);
  const createBank = async () => {
    if (bankName.trim().length < 2) {
      setError("Enter a question bank name with at least two characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        `/api/organizations/${session.organization.id}/question-banks`,
        { name: bankName.trim() },
      );
      setBanks((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBankId(data.id);
      setBankName("");
      setNotice("Question bank created. Add questions from this draft to make them reusable.");
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? "Could not create the question bank.")
          : "Could not create the question bank.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveQuestionToBank = async (index: number) => {
    const question = questions[index];
    if (!bankId || !question) return;
    if (!question.prompt.trim() || question.marks <= 0) {
      setError("Add a question prompt and positive marks before saving it to the bank.");
      return;
    }
    if (
      ["mcq", "multiple_select", "true_false"].includes(question.type) &&
      question.options.some((option) => !option.text.trim())
    ) {
      setError("Complete every answer option before saving this question to the bank.");
      return;
    }
    if (question.type === "coding" && (!question.coding?.title.trim() || !question.coding.description.trim() || !question.codingTestCases?.length)) {
      setError("Complete the coding question details and add at least one test case before saving it to the bank.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        `/api/organizations/${session.organization.id}/question-banks/${bankId}/questions`,
        question,
      );
      setBankQuestions((current) => [data, ...current]);
      setNotice("Question saved to the selected bank; the draft question remains unchanged.");
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? "Could not save this question to the bank.")
          : "Could not save this question to the bank.",
      );
    } finally {
      setBusy(false);
    }
  };
  const applyTemplate = async () => {
    if (!templateId) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.get(
        `/api/organizations/${session.organization.id}/exam-templates/${templateId}`,
      );
      const settings = data.settings;
      setExamId(undefined);
      setDetails({
        title: settings.title,
        instructions: settings.instructions ?? "",
        durationMinutes: settings.durationMinutes,
        startsAt: "",
        endsAt: "",
        randomizeQuestions: settings.randomizeQuestions,
        randomizeOptions: settings.randomizeOptions,
        isPractice: settings.isPractice === true,
        interventionPolicy: { ...defaultInterventionPolicy(), ...settings.interventionPolicy },
      });
      setQuestions((data.questions as ApiQuestion[]).map(questionForEditor));
      setStep(2);
      setNotice(`Loaded “${data.name}”. Review the copied questions and settings before saving the new draft.`);
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? "Could not load this exam template.")
          : "Could not load this exam template.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveAsTemplate = async () => {
    if (!examId) {
      setError("Save the draft and its questions before creating a reusable template.");
      return;
    }
    if (templateName.trim().length < 2) {
      setError("Enter a template name with at least two characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        `/api/organizations/${session.organization.id}/exam-templates`,
        { name: templateName.trim(), sourceExamId: examId },
      );
      setTemplates((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateName("");
      setNotice(`“${data.name}” is ready to reuse for future exams.`);
    } catch (requestError) {
      setError(
        axios.isAxiosError(requestError)
          ? (requestError.response?.data?.error ?? "Could not save this exam as a template.")
          : "Could not save this exam as a template.",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async () => {
    if (details.title.trim().length < 3)
      return setError(
        "Enter an examination title of at least three characters.",
      );
    if (
      details.startsAt &&
      details.endsAt &&
      new Date(details.endsAt) <= new Date(details.startsAt)
    )
      return setError("End time must be after start time.");
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...details,
        startsAt: details.startsAt
          ? new Date(details.startsAt).toISOString()
          : undefined,
        endsAt: details.endsAt
          ? new Date(details.endsAt).toISOString()
          : undefined,
      };
      const response = examId
        ? await api.put(
            `/api/organizations/${session.organization.id}/exams/${examId}`,
            payload,
          )
        : await api.post(
            `/api/organizations/${session.organization.id}/exams`,
            payload,
          );
      const id = response.data.id ?? response.data.id;
      setExamId(id);
      setNotice("Draft saved.");
      return id as string;
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Could not save draft.")
          : "Could not save draft.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addQuestion = () => setQuestions((q) => [...q, blankQuestion()]);
  const addFromBank = async (questionId: string) => {
    const id = examId ?? (await saveDraft());
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(
        `/api/organizations/${session.organization.id}/exams/${id}/questions/from-bank/${questionId}`,
      );
      setQuestions((current) => [...current, questionForEditor(response.data)]);
      setNotice(
        "Question copied to this draft. The bank entry was not changed.",
      );
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Could not add this question.")
          : "Could not add this question.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeQuestion = async (index: number) => {
    const question = questions[index];
    if (!question) return;
    if (!question.id) {
      setQuestions((current) =>
        current.filter((_, itemIndex) => itemIndex !== index),
      );
      return;
    }
    if (!examId) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(
        `/api/organizations/${session.organization.id}/exams/${examId}/questions/${question.id}`,
      );
      setQuestions((current) =>
        current.filter((_, itemIndex) => itemIndex !== index),
      );
      setNotice("Question removed from this draft.");
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Could not remove this question.")
          : "Could not remove this question.",
      );
    } finally {
      setBusy(false);
    }
  };
  const update = (index: number, patch: Partial<Question>) =>
    setQuestions((q) =>
      q.map((x, i) => (i === index ? { ...x, ...patch } : x)),
    );
  const saveQuestions = async () => {
    const id = examId ?? (await saveDraft());
    if (!id) return;
    const unsaved = questions.filter((q) => !q.id);
    for (const q of unsaved) {
      if (!q.prompt.trim() || q.marks <= 0)
        return setError("Every question needs a prompt and positive marks.");
      if (
        ["mcq", "multiple_select", "true_false"].includes(q.type) &&
        q.options.some((o) => !o.text.trim())
      )
        return setError("Complete every option before saving.");
      if (q.type === "coding" && (!q.coding?.title.trim() || !q.coding.description.trim() || !q.coding.languageIds.length || !q.codingTestCases?.length))
        return setError("Coding questions need a title, problem description, and at least one language.");
    }
    setBusy(true);
    setError("");
    try {
      const saved = await Promise.all(
        unsaved.map(async (question) => {
          const response = await api.post(
            `/api/organizations/${session.organization.id}/exams/${id}/questions`,
            question,
          );
          return questionForEditor(response.data);
        }),
      );
      let savedIndex = 0;
      setQuestions((current) =>
        current.map((question) =>
          question.id ? question : (saved[savedIndex++] ?? question),
        ),
      );
      setNotice(
        unsaved.length
          ? "Questions saved to the draft."
          : "No new questions to save.",
      );
      setStep(3);
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Could not save the questions.")
          : "Could not save the questions.",
      );
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    const id = examId ?? (await saveDraft());
    if (!id) return;
    setBusy(true);
    try {
      await api.post(
        `/api/organizations/${session.organization.id}/exams/${id}/publish`,
      );
      setNotice("Exam published or scheduled.");
      navigate("/app/exams");
    } catch (e) {
      setError(
        axios.isAxiosError(e)
          ? (e.response?.data?.error ?? "Could not publish.")
          : "Could not publish.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl">
      <div className="card mb-6 flex flex-col gap-5 bg-gradient-to-br from-white via-blue-50/60 to-indigo-50/70 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Assessment workspace</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            {routeExamId ? "Edit examination" : "New examination"}
          </h2>
          <p className="text-sm text-slate-500">
            Step {step} of 4 · total new-question marks: {total}
          </p>
          {routeExamId && <CopyableId id={routeExamId} label="Examination UUID" />}
        </div>
        <Link
          to="/app/exams"
          className="text-sm font-semibold text-blue-700 hover:text-blue-800"
        >
          Back to examinations
        </Link>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["Details", "Questions", "Review", "Publish"].map((name, i) => (
          <button
            type="button"
            key={name}
            onClick={() => setStep(i + 1)}
            aria-current={step === i + 1 ? "step" : undefined}
            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${step === i + 1 ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"}`}
          >
            {i + 1}. {name}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"
        >
          {notice}
        </p>
      )}
      {step === 1 && (
        <section className="card grid gap-4 sm:grid-cols-2">
          {!routeExamId && !examId && <div className="sm:col-span-2 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="text-sm font-semibold text-slate-800">Start from an exam template</p>
            <p className="mt-1 text-xs text-slate-600">Templates copy settings and questions into a new draft. Review them before publishing.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select aria-label="Exam template" className="input min-w-0 flex-1" value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={templatesLoading}>
                <option value="">{templatesLoading ? "Loading templates…" : "Choose a template"}</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <button type="button" className="button" onClick={() => void applyTemplate()} disabled={busy || !templateId}>Use template</button>
            </div>
            {templatesError && <p role="alert" className="mt-2 text-sm text-red-700">{templatesError}</p>}
            {!templatesLoading && !templatesError && templates.length === 0 && <p className="mt-2 text-xs text-slate-500">No templates yet. Build and save an exam, then save it as a template from the review step.</p>}
          </div>}
          <label className="sm:col-span-2 text-sm font-medium">
            Title
            <input
              className="input mt-1"
              value={details.title}
              onChange={(e) =>
                setDetails({ ...details, title: e.target.value })
              }
            />
          </label>
          <label className="sm:col-span-2 text-sm font-medium">
            Instructions
            <textarea
              className="input mt-1 min-h-24"
              value={details.instructions}
              onChange={(e) =>
                setDetails({ ...details, instructions: e.target.value })
              }
            />
          </label>
          <label className="text-sm font-medium">
            Duration (minutes)
            <input
              type="number"
              min="1"
              className="input mt-1"
              value={details.durationMinutes}
              onChange={(e) =>
                setDetails({
                  ...details,
                  durationMinutes: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-sm font-medium">
            Start date/time
            <input
              type="datetime-local"
              className="input mt-1"
              value={details.startsAt}
              onChange={(e) =>
                setDetails({ ...details, startsAt: e.target.value })
              }
            />
          </label>
          <label className="text-sm font-medium">
            End date/time (optional)
            <input
              type="datetime-local"
              className="input mt-1"
              value={details.endsAt}
              onChange={(e) =>
                setDetails({ ...details, endsAt: e.target.value })
              }
            />
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
            {[
              ["randomizeQuestions", "Randomize questions"],
              ["randomizeOptions", "Randomize options"],
              ["isPractice", "Practice exam (ungraded; excluded from official results)"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(details[key as keyof typeof details])}
                  onChange={(e) =>
                    setDetails({ ...details, [key]: e.target.checked })
                  }
                />{" "}
                <span className="ml-2">{label}</span>
              </label>
            ))}
          </div>
          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
            <input
              type="checkbox"
              checked={details.interventionPolicy.fullscreenRequired}
              onChange={(event) => setDetails({
                ...details,
                interventionPolicy: { ...details.interventionPolicy, fullscreenRequired: event.target.checked },
              })}
            />
            <span><b>Require fullscreen during this exam</b><span className="mt-1 block text-xs leading-5 text-slate-600">Candidates must enter fullscreen before starting and return to it if they exit. A normal browser cannot prevent switching to other apps; use institution-managed kiosk devices for enforced lockdown.</span></span>
          </label>
          <div className="sm:col-span-2 flex justify-end gap-3">
            <button onClick={saveDraft} disabled={busy} className="button">
              Save draft
            </button>
            <button onClick={() => setStep(2)} className="button">
              Continue
            </button>
          </div>
        </section>
      )}
      {step === 2 && (
        <section className="space-y-4">
          <div className="card border-blue-100 bg-blue-50/40">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Question bank</p>
                <h3 className="mt-1 font-semibold">
                  Reuse an approved question
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  A copy is added to this draft; the original bank record
                  remains unchanged.
                </p>
              </div>
              <label className="w-full text-sm font-medium sm:max-w-xs">
                Source bank
                <select
                  className="input mt-1"
                  value={bankId}
                  onChange={(event) => setBankId(event.target.value)}
                  disabled={banksLoading}
                >
                  <option value="">{banksLoading ? "Loading banks…" : "Choose a bank"}</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <form
              className="mt-4 flex flex-col gap-2 rounded-xl border border-blue-100 bg-white p-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void createBank();
              }}
            >
              <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
                Create a bank
                <input
                  className="input mt-1"
                  aria-label="New question bank name"
                  placeholder="e.g. Biology · Cell structure"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                  maxLength={160}
                />
              </label>
              <button type="submit" className="button self-end" disabled={busy || bankName.trim().length < 2}>
                Create bank
              </button>
            </form>
            {banksError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{banksError}</p>}
            {bankId && (
              <div className="mt-4 space-y-2">
                {bankQuestionsLoading ? (
                  <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-500">Loading questions…</p>
                ) : bankQuestionsError ? (
                  <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{bankQuestionsError}</p>
                ) : bankQuestions.length ? (
                  bankQuestions.map((question) => (
                    <div
                      key={question.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-slate-800">
                          {question.prompt}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {question.type.replace("_", " ")} · {question.marks}{" "}
                          marks
                        </p>
                      </div>
                      <button
                        type="button"
                        className="button shrink-0"
                        disabled={busy}
                        onClick={() => addFromBank(question.id!)}
                      >
                        Add to draft
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                    This question bank has no reusable questions yet.
                  </p>
                )}
              </div>
            )}
          </div>
          {questions.map((q, i) => (
            <article className="card" key={i}>
              <div className="flex justify-between">
                <b>Question {i + 1}</b>
              <div className="flex items-center gap-3">
                {bankId && <button type="button" onClick={() => void saveQuestionToBank(i)} disabled={busy} className="text-sm font-semibold text-blue-700 disabled:text-slate-400">Save to selected bank</button>}
                <button
                  onClick={() => removeQuestion(i)}
                  disabled={busy}
                  className="text-sm font-semibold text-red-600 disabled:text-slate-400"
                >
                  Remove
                </button>
              </div>
              </div>
              <label className="mt-3 block text-sm">
                Type
                <select
                  className="input mt-1"
                  value={q.type}
                  onChange={(e) =>
                    update(i, {
                      type: e.target.value as Question["type"],
                      options:
                        e.target.value === "true_false"
                          ? [
                              { id: "true", text: "True" },
                              { id: "false", text: "False" },
                            ]
                          : q.options,
                      coding: e.target.value === "coding" ? (q.coding ?? blankCoding()) : q.coding,
                      codingTestCases: e.target.value === "coding" && !q.codingTestCases?.length
                        ? [{ input: "", expectedOutput: "", visibility: "sample", position: 0 }]
                        : q.codingTestCases,
                    })
                  }
                >
                  {[
                    "mcq",
                    "multiple_select",
                    "true_false",
                    "short_answer",
                    "descriptive",
                    "coding",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-sm">
                Question text
                <textarea
                  className="input mt-1"
                  value={q.prompt}
                  onChange={(e) => update(i, { prompt: e.target.value })}
                />
              </label>
              {q.type !== "coding" && (
                <div className="mt-3">
                  <QuestionTypeRenderer
                    mode="author"
                    type={q.type}
                    groupId={q.id ?? `draft-${i}`}
                    options={q.options}
                    correctAnswer={q.correctAnswer}
                    label={`Question ${i + 1}`}
                    onCorrectAnswerChange={correctAnswer => update(i, { correctAnswer })}
                    onOptionsChange={options => update(i, { options })}
                  />
                </div>
              )}
              {q.type === "coding" && (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div><h4 className="font-semibold text-slate-900">Coding problem</h4><p className="mt-1 text-xs leading-5 text-slate-500">Candidates will solve this in the secure coding workspace. Add clear input, output, and constraints.</p></div>
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">Code runner</span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium sm:col-span-2">Problem title<input className="input mt-1" value={q.coding?.title ?? ""} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, title: e.target.value } })} placeholder="Two Sum" /></label>
                        <label className="text-sm font-medium sm:col-span-2">Problem description<textarea className="input mt-1 min-h-28" value={q.coding?.description ?? ""} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, description: e.target.value } })} placeholder="Describe the task and expected behavior." /></label>
                        <label className="text-sm font-medium">Difficulty<select className="input mt-1" value={q.coding?.difficulty ?? "medium"} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, difficulty: e.target.value as "easy" | "medium" | "hard" } })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
                        <label className="text-sm font-medium">Execution mode<select className="input mt-1" value={q.coding?.mode ?? "stdin_stdout"} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, mode: e.target.value as "function" | "stdin_stdout" } })}><option value="stdin_stdout">Standard input / output</option><option value="function">Function</option></select></label>
                        <fieldset className="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2">
                          <legend className="px-1 text-sm font-medium">Candidate programming languages</legend>
                          <p className="mb-3 text-xs text-slate-500">All supported languages are selected by default. Candidates may choose any selected language during the exam.</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {CODING_LANGUAGES.map(({ id, label }) => (
                              <label key={id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-normal text-slate-700 hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={(q.coding?.languageIds ?? DEFAULT_CODING_LANGUAGE_IDS).includes(id)}
                                  onChange={(event) => {
                                    const current = q.coding?.languageIds ?? [...DEFAULT_CODING_LANGUAGE_IDS];
                                    const languageIds = event.target.checked
                                      ? [...current, id]
                                      : current.filter((languageId) => languageId !== id);
                                    update(i, {
                                      coding: {
                                        ...blankCoding(),
                                        ...q.coding,
                                        languageIds,
                                        starterCode: q.coding?.starterCode ?? blankCoding().starterCode,
                                      },
                                    });
                                  }}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <label className="text-sm font-medium">Input format<textarea className="input mt-1 min-h-20" value={q.coding?.inputFormat ?? ""} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, inputFormat: e.target.value } })} /></label>
                        <label className="text-sm font-medium">Output format<textarea className="input mt-1 min-h-20" value={q.coding?.outputFormat ?? ""} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, outputFormat: e.target.value } })} /></label>
                        <label className="text-sm font-medium sm:col-span-2">Constraints<textarea className="input mt-1 min-h-20" value={q.coding?.constraints ?? ""} onChange={(e) => update(i, { coding: { ...blankCoding(), ...q.coding, constraints: e.target.value } })} /></label>
                      </div>
                      <div className="mt-4 border-t border-blue-100 pt-4">
                        <div className="flex items-center justify-between gap-3"><div><h5 className="text-sm font-semibold">Test cases</h5><p className="mt-1 text-xs text-slate-500">Sample cases are visible to candidates; private cases are used for validation.</p></div><button type="button" className="text-sm font-semibold text-blue-700" onClick={() => update(i, { codingTestCases: [...(q.codingTestCases ?? []), { input: "", expectedOutput: "", visibility: "private", position: q.codingTestCases?.length ?? 0 }] })}>Add test case</button></div>
                        <div className="mt-3 space-y-3">{(q.codingTestCases ?? []).map((testCase, testIndex) => <div key={testIndex} className="grid gap-2 rounded-xl border border-blue-100 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold text-slate-600">Input<textarea className="input mt-1 min-h-16 text-sm font-normal" value={testCase.input} onChange={(e) => update(i, { codingTestCases: q.codingTestCases?.map((item, index) => index === testIndex ? { ...item, input: e.target.value } : item) })} /></label><label className="text-xs font-semibold text-slate-600">Expected output<textarea className="input mt-1 min-h-16 text-sm font-normal" value={testCase.expectedOutput} onChange={(e) => update(i, { codingTestCases: q.codingTestCases?.map((item, index) => index === testIndex ? { ...item, expectedOutput: e.target.value } : item) })} /></label><div className="flex items-end gap-2 sm:flex-col sm:items-stretch"><select className="input text-sm" value={testCase.visibility} onChange={(e) => update(i, { codingTestCases: q.codingTestCases?.map((item, index) => index === testIndex ? { ...item, visibility: e.target.value as "sample" | "private" } : item) })}><option value="sample">Sample</option><option value="private">Private</option></select>{(q.codingTestCases?.length ?? 0) > 1 && <button type="button" className="text-xs font-semibold text-red-600" onClick={() => update(i, { codingTestCases: q.codingTestCases?.filter((_, index) => index !== testIndex).map((item, index) => ({ ...item, position: index })) })}>Remove</button>}</div></div>)}</div>
                      </div>
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Marks
                  <input
                    className="input mt-1"
                    type="number"
                    min="0.1"
                    value={q.marks}
                    onChange={(e) =>
                      update(i, { marks: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="text-sm">
                  Negative marks
                  <input
                    className="input mt-1"
                    type="number"
                    min="0"
                    value={q.negativeMarks}
                    onChange={(e) =>
                      update(i, { negativeMarks: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </article>
          ))}
          <button onClick={addQuestion} className="button">
            Add question
          </button>
          <button
            onClick={saveQuestions}
            disabled={busy || !questions.length}
            className="button ml-3"
          >
            Save questions
          </button>
        </section>
      )}
      {step === 3 && (
        <section className="card">
          <h3 className="font-semibold">Review</h3>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Title</dt>
              <dd>{details.title || "Missing"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Duration</dt>
              <dd>{details.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt className="text-slate-500">Start</dt>
              <dd>{details.startsAt || "Available immediately"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">New questions</dt>
              <dd>
                {questions.length} · {total} marks
              </dd>
            </div>
          </dl>
          <section className="mt-5 space-y-3" aria-label="Question preview">
            <h4 className="font-semibold text-slate-800">Question preview</h4>
            {questions.map((question, index) => (
              <article key={question.id ?? `preview-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-medium">{index + 1}. {question.prompt || "Question prompt"}</p>
                <QuestionTypeRenderer
                  mode="preview"
                  type={question.type}
                  groupId={`preview-${question.id ?? index}`}
                  options={question.options}
                  label={`Preview answer ${index + 1}`}
                />
                {question.type === "coding" && <p className="mt-2 text-xs text-slate-500">
                  {question.coding?.languageIds.length ?? 0} supported language(s) · {question.codingTestCases?.length ?? 0} test case(s)
                </p>}
                <p className="mt-2 text-xs text-slate-500">{question.marks} marks · {question.negativeMarks} negative marks</p>
              </article>
            ))}
          </section>
          {examId && <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <h4 className="text-sm font-semibold text-slate-800">Save this draft as a reusable template</h4>
            <p className="mt-1 text-xs text-slate-600">The template stores exam settings, answer keys, and coding test cases for reuse by authorized staff in this institution.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input aria-label="Template name" className="input min-w-0 flex-1" value={templateName} maxLength={160} onChange={(event) => setTemplateName(event.target.value)} placeholder="e.g. Biology midterm" />
              <button type="button" className="button" disabled={busy || templateName.trim().length < 2} onClick={() => void saveAsTemplate()}>Save template</button>
            </div>
          </div>}
          <button onClick={() => setStep(4)} className="button mt-6">
            Continue to publish
          </button>
        </section>
      )}
      {step === 4 && (
        <section className="card">
          <h3 className="font-semibold">Save or publish</h3>
          <p className="mt-2 text-sm text-slate-500">
            Publishing requires at least one persisted question. Scheduled exams
            remain unavailable until their start time.
          </p>
          <div className="mt-5 flex gap-3">
            <button onClick={saveDraft} disabled={busy} className="button">
              Save draft
            </button>
            <button onClick={publish} disabled={busy} className="button">
              Publish / schedule
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
