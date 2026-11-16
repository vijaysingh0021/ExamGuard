import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionTypeRenderer, type ExamQuestionType } from "../question-renderer";

const choices = [{ id: "a", text: "Choice A" }, { id: "b", text: "Choice B" }];

describe("shared question type renderer", () => {
  it.each(["mcq", "multiple_select", "true_false"] as const)(
    "renders %s choices for candidates and the author answer key",
    type => {
      const onChange = vi.fn();
      const { rerender } = render(
        <QuestionTypeRenderer mode="candidate" type={type} groupId="q-candidate" options={choices} onChange={onChange} />,
      );
      expect(screen.getByText("Choice A")).toBeInTheDocument();
      const inputs = screen.queryAllByRole("checkbox");
      if (type === "multiple_select") {
        expect(inputs).toHaveLength(2);
        fireEvent.click(inputs[0]);
        expect(onChange).toHaveBeenCalledWith(["a"]);
      } else {
        expect(screen.getAllByRole("radio")).toHaveLength(2);
        fireEvent.click(screen.getAllByRole("radio")[0]);
        expect(onChange).toHaveBeenCalledWith("a");
      }

      const updateOptions = vi.fn();
      rerender(
        <QuestionTypeRenderer mode="author" type={type} groupId={`q-author-${type}`} options={type === "true_false" ? [{ id: "true", text: "True" }, { id: "false", text: "False" }] : choices} onOptionsChange={updateOptions} onCorrectAnswerChange={vi.fn()} />,
      );
      expect(screen.queryAllByRole("radio").length + screen.queryAllByRole("checkbox").length).toBe(2);
      expect(screen.getByRole("textbox", { name: "Option 1" })).toBeInTheDocument();
    },
  );

  it.each([
    ["short_answer", "input"],
    ["descriptive", "textarea"],
  ] as const)("renders and saves %s candidate responses", (type, control) => {
    const onChange = vi.fn();
    render(<QuestionTypeRenderer mode="candidate" type={type} options={[]} onChange={onChange} />);
    const answer = screen.getByRole(control === "input" ? "textbox" : "textbox");
    fireEvent.change(answer, { target: { value: "candidate response" } });
    expect(onChange).toHaveBeenCalledWith("candidate response");
    if (type === "descriptive") expect(answer.tagName).toBe("TEXTAREA");
    else expect(answer.tagName).toBe("INPUT");
  });

  it("keeps descriptive answer guidance visible to authors and evaluators", () => {
    const update = vi.fn();
    const { rerender } = render(
      <QuestionTypeRenderer mode="author" type="descriptive" correctAnswer="Mention the central idea" onCorrectAnswerChange={update} />,
    );
    expect(screen.getByLabelText("Descriptive answer / marking guidance")).toHaveValue("Mention the central idea");
    fireEvent.change(screen.getByLabelText("Descriptive answer / marking guidance"), { target: { value: "Updated rubric" } });
    expect(update).toHaveBeenCalledWith("Updated rubric");

    rerender(<QuestionTypeRenderer mode="evaluation" type="descriptive" value="Candidate's essay" gradingGuide="Mention the central idea" />);
    expect(screen.getByText("Candidate's essay")).toBeInTheDocument();
    expect(screen.getByText("Mention the central idea")).toBeInTheDocument();
  });

  it("renders a non-interactive preview for every question type, including coding", () => {
    const questionTypes: ExamQuestionType[] = ["mcq", "multiple_select", "true_false", "short_answer", "descriptive", "coding"];
    const { unmount } = render(
      <>
        {questionTypes.map(type => <div key={type} aria-label={`${type} preview`}>
          <QuestionTypeRenderer mode="preview" type={type} groupId={`preview-${type}`} options={choices} />
        </div>)}
      </>,
    );
    expect(screen.getByLabelText("mcq preview")).toBeInTheDocument();
    expect(screen.getByLabelText("multiple_select preview")).toBeInTheDocument();
    expect(screen.getByLabelText("true_false preview")).toBeInTheDocument();
    expect(screen.getByLabelText("short_answer preview")).toBeInTheDocument();
    expect(screen.getByLabelText("descriptive preview")).toBeInTheDocument();
    expect(screen.getByLabelText("coding preview")).toHaveTextContent("secure coding workspace");
    expect(screen.getAllByRole("radio").every(input => (input as HTMLInputElement).disabled)).toBe(true);
    unmount();
  });
});
