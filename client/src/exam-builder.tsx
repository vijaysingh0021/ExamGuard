import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";

type Session = { organization: { id: string } };
type Question = {
  _id?: string;
  type:
    "mcq" | "multiple_select" | "true_false" | "short_answer" | "descriptive";
  prompt: string;
  options: Array<{ id: string; text: string }>;
  correctAnswer?: unknown;
  marks: number;
  negativeMarks: number;
};
type QuestionBank = { _id: string; name: string };
const api = axios.create();
api.interceptors.request.use((config) => {
  const raw = localStorage.getItem("sentinel-session");
  if (raw) config.headers.Authorization = `Bearer ${JSON.parse(raw).token}`;
  return config;
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
});

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
    requireVerification: true,
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [bankId, setBankId] = useState("");
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
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
          requireVerification: e.requireVerification !== false,
        });
        setQuestions(questionList.data);
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
    api
      .get(`/api/organizations/${session.organization.id}/question-banks`)
      .then((response) => setBanks(response.data))
      .catch(() => setBanks([]));
  }, [session.organization.id]);
  useEffect(() => {
    if (!bankId) return setBankQuestions([]);
    api
      .get(
        `/api/organizations/${session.organization.id}/question-banks/${bankId}/questions`,
      )
      .then((response) => setBankQuestions(response.data))
      .catch(() => setBankQuestions([]));
  }, [bankId, session.organization.id]);
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
      const id = response.data._id ?? response.data.id;
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
      setQuestions((current) => [...current, response.data]);
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
    if (!question._id) {
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
        `/api/organizations/${session.organization.id}/exams/${examId}/questions/${question._id}`,
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
    const unsaved = questions.filter((q) => !q._id);
    for (const q of unsaved) {
      if (!q.prompt.trim() || q.marks <= 0)
        return setError("Every question needs a prompt and positive marks.");
      if (
        ["mcq", "multiple_select", "true_false"].includes(q.type) &&
        q.options.some((o) => !o.text.trim())
      )
        return setError("Complete every option before saving.");
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
          return response.data as Question;
        }),
      );
      let savedIndex = 0;
      setQuestions((current) =>
        current.map((question) =>
          question._id ? question : (saved[savedIndex++] ?? question),
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
              ["requireVerification", "Require candidate verification"],
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
                >
                  <option value="">Choose a bank</option>
                  {banks.map((bank) => (
                    <option key={bank._id} value={bank._id}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {bankId && (
              <div className="mt-4 space-y-2">
                {bankQuestions.length ? (
                  bankQuestions.map((question) => (
                    <div
                      key={question._id}
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
                        onClick={() => addFromBank(question._id!)}
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
                <button
                  onClick={() => removeQuestion(i)}
                  disabled={busy}
                  className="text-sm font-semibold text-red-600 disabled:text-slate-400"
                >
                  Remove
                </button>
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
                    })
                  }
                >
                  {[
                    "mcq",
                    "multiple_select",
                    "true_false",
                    "short_answer",
                    "descriptive",
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
              {["mcq", "multiple_select", "true_false"].includes(q.type) && (
                <div className="mt-3 space-y-2">
                  {q.options.map((o, n) => (
                    <label className="flex gap-2 text-sm" key={o.id}>
                      <input
                        type={
                          q.type === "multiple_select" ? "checkbox" : "radio"
                        }
                        name={`answer-${i}`}
                        checked={
                          q.type === "multiple_select"
                            ? Array.isArray(q.correctAnswer) &&
                              q.correctAnswer.includes(o.id)
                            : q.correctAnswer === o.id
                        }
                        onChange={(event) => {
                          if (q.type !== "multiple_select")
                            return update(i, { correctAnswer: o.id });
                          const selected = Array.isArray(q.correctAnswer)
                            ? q.correctAnswer
                            : [];
                          update(i, {
                            correctAnswer: event.target.checked
                              ? [...selected, o.id]
                              : selected.filter((answer) => answer !== o.id),
                          });
                        }}
                      />
                      <input
                        className="input"
                        value={o.text}
                        onChange={(e) =>
                          update(i, {
                            options: q.options.map((v, j) =>
                              j === n ? { ...v, text: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  {q.type !== "true_false" && (
                    <button
                      onClick={() =>
                        update(i, {
                          options: [
                            ...q.options,
                            { id: crypto.randomUUID(), text: "" },
                          ],
                        })
                      }
                      className="text-sm text-blue-700"
                    >
                      Add option
                    </button>
                  )}
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
