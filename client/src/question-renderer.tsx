import type { ChangeEvent } from "react";

export type ExamQuestionType =
  | "mcq"
  | "multiple_select"
  | "true_false"
  | "short_answer"
  | "descriptive"
  | "coding";

export type QuestionOption = { id: string; text: string };
export type QuestionRenderMode = "author" | "candidate" | "preview" | "evaluation";

type Props = {
  mode: QuestionRenderMode;
  type: ExamQuestionType;
  options?: QuestionOption[];
  value?: unknown;
  correctAnswer?: unknown;
  gradingGuide?: unknown;
  label?: string;
  groupId?: string;
  onChange?: (value: string | string[]) => void;
  onBlur?: () => void;
  onCorrectAnswerChange?: (value: string | string[] | undefined) => void;
  onOptionsChange?: (options: QuestionOption[]) => void;
};

const isChoiceType = (type: ExamQuestionType) =>
  type === "mcq" || type === "multiple_select" || type === "true_false";

const selectedValues = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function QuestionTypeRenderer({
  mode,
  type,
  options = [],
  value,
  correctAnswer,
  gradingGuide,
  label = "Answer",
  groupId = type,
  onChange,
  onBlur,
  onCorrectAnswerChange,
  onOptionsChange,
}: Props) {
  const authoring = mode === "author";
  const candidate = mode === "candidate";
  const preview = mode === "preview";
  const readOnly = preview || mode === "evaluation";
  const availableOptions = type === "true_false" && options.length === 0
    ? [{ id: "true", text: "True" }, { id: "false", text: "False" }]
    : options;

  if (isChoiceType(type)) {
    if (!availableOptions.length) {
      return <p role="status" className="text-sm text-amber-800">No answer options are configured for this question.</p>;
    }

    if (mode === "evaluation") {
      const selected = selectedValues(value);
      const answerIds = type === "multiple_select"
        ? selected
        : typeof value === "string" ? [value] : [];
      const answerText = answerIds
        .map(id => availableOptions.find(option => option.id === id)?.text)
        .filter((text): text is string => Boolean(text));
      const expected = selectedValues(correctAnswer);
      const expectedIds = type === "multiple_select"
        ? expected
        : typeof correctAnswer === "string" ? [correctAnswer] : [];
      const expectedText = expectedIds
        .map(id => availableOptions.find(option => option.id === id)?.text)
        .filter((text): text is string => Boolean(text));
      return (
        <div className="space-y-2 text-sm">
          <p><span className="text-xs uppercase tracking-wide text-stone-400">Candidate's answer</span><br />{answerText.join(", ") || <i className="text-stone-400">No answer</i>}</p>
          {correctAnswer !== undefined && correctAnswer !== null && <p><span className="text-xs uppercase tracking-wide text-stone-400">Correct answer</span><br />{expectedText.join(", ")}</p>}
        </div>
      );
    }

    const active = authoring ? correctAnswer : value;
    return (
      <fieldset className="space-y-2" aria-label={authoring ? "Answer options and key" : label}>
        {availableOptions.map((option, index) => {
          const checked = type === "multiple_select"
            ? selectedValues(active).includes(option.id)
            : active === option.id;
          const changeSelection = (event: ChangeEvent<HTMLInputElement>) => {
            if (authoring) {
              if (!onCorrectAnswerChange) return;
              if (type !== "multiple_select") return onCorrectAnswerChange(option.id);
              const previous = selectedValues(correctAnswer);
              return onCorrectAnswerChange(event.target.checked
                ? [...previous, option.id]
                : previous.filter(item => item !== option.id));
            }
            if (!onChange) return;
            if (type !== "multiple_select") return onChange(option.id);
            const previous = selectedValues(value);
            onChange(event.target.checked
              ? [...previous, option.id]
              : previous.filter(item => item !== option.id));
          };
          return (
            <label key={option.id} className={`flex items-center gap-3 rounded-xl border border-slate-200 p-3 ${authoring ? "bg-white" : "hover:border-blue-300"}`}>
              <input
                type={type === "multiple_select" ? "checkbox" : "radio"}
                name={`${groupId}-${type}`}
                checked={checked}
                disabled={readOnly}
                onChange={changeSelection}
                aria-label={authoring ? `Correct: option ${index + 1}` : undefined}
              />
              {authoring
                ? <input
                    className="input"
                    aria-label={`Option ${index + 1}`}
                    value={option.text}
                    onChange={event => onOptionsChange?.(availableOptions.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, text: event.target.value } : item,
                    ))}
                  />
                : <span>{option.text}</span>}
            </label>
          );
        })}
        {authoring && type !== "true_false" && (
          <button
            type="button"
            className="text-sm text-blue-700"
            onClick={() => onOptionsChange?.([...availableOptions, { id: crypto.randomUUID(), text: "" }])}
          >
            Add option
          </button>
        )}
        {authoring && type !== "true_false" && availableOptions.length > 2 && (
          <button
            type="button"
            className="ml-3 text-sm text-red-700"
            onClick={() => {
              const removed = availableOptions[availableOptions.length - 1];
              onOptionsChange?.(availableOptions.slice(0, -1));
              if (type === "multiple_select" && Array.isArray(correctAnswer)) {
                onCorrectAnswerChange?.(correctAnswer.filter(item => item !== removed.id));
              } else if (correctAnswer === removed.id) {
                onCorrectAnswerChange?.(undefined);
              }
            }}
          >
            Remove last option
          </button>
        )}
      </fieldset>
    );
  }

  if (type === "short_answer") {
    if (mode === "evaluation") {
      return (
        <div className="space-y-2 text-sm">
          <p><span className="text-xs uppercase tracking-wide text-stone-400">Candidate's answer</span><br />{typeof value === "string" && value ? value : <i className="text-stone-400">No answer</i>}</p>
          {typeof correctAnswer === "string" && <p><span className="text-xs uppercase tracking-wide text-stone-400">Accepted answer</span><br />{correctAnswer}</p>}
        </div>
      );
    }
    if (authoring) {
      return (
        <label className="block text-sm">
          Accepted answer
          <input className="input mt-1" value={typeof correctAnswer === "string" ? correctAnswer : ""} onChange={event => onCorrectAnswerChange?.(event.target.value || undefined)} />
        </label>
      );
    }
    return (
      <input
        className="input mt-4"
        type="text"
        value={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onChange={event => onChange?.(event.target.value)}
        onBlur={onBlur}
        placeholder={preview ? "Candidate's short answer" : "Write a short answer"}
        aria-label={label}
      />
    );
  }

  if (type === "descriptive") {
    if (mode === "evaluation") {
      return (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-sm text-stone-800"><span className="text-xs uppercase tracking-wide text-stone-400">Candidate's answer</span><br />{typeof value === "string" && value ? value : <i className="text-stone-400">No answer</i>}</p>
          {typeof gradingGuide === "string" && gradingGuide.trim() && <p className="whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm"><b className="text-xs uppercase tracking-wide text-blue-800">Marking guidance</b><br />{gradingGuide}</p>}
        </div>
      );
    }
    if (authoring) {
      return (
        <label className="block text-sm">
          Descriptive answer / marking guidance
          <textarea
            className="input mt-1 min-h-28"
            value={typeof correctAnswer === "string" ? correctAnswer : ""}
            onChange={event => onCorrectAnswerChange?.(event.target.value || undefined)}
            placeholder="Describe the expected response or rubric for the evaluator."
          />
        </label>
      );
    }
    return (
      <textarea
        className="input mt-4 min-h-40"
        value={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onChange={event => onChange?.(event.target.value)}
        onBlur={onBlur}
        placeholder={preview ? "Candidate's descriptive answer" : "Write your answer"}
        aria-label={label}
      />
    );
  }

  if (type === "coding") {
    return mode === "evaluation"
      ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-950 p-3 text-xs text-stone-100">{typeof value === "string" && value ? value : "No code submitted."}</pre>
      : <p className="text-sm text-slate-600">Candidates use the secure coding workspace, configured languages, and test cases for this question.</p>;
  }

  return <p role="status" className="text-sm text-amber-800">This question type is not supported by this version of ExamGuard.</p>;
}
