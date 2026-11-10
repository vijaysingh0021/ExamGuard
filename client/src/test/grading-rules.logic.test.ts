import { describe, expect, it } from "vitest";
import { describeAnswer, formatScore, gradeActions, maxManualMarks, parseManualMarks, percent, sameAnswer, type GradeLite } from "../lib/grading-rules";

const g = (over: Partial<GradeLite> = {}): GradeLite => ({ id: "g", status: "pending_manual", autoMarks: 6, manualMarks: 0, totalMarks: 6, maxMarks: 10, ...over });

describe("which grading actions are available", () => {
  it("lets a teacher evaluate finished attempts only", () => {
    expect(gradeActions("in_progress", null).canEvaluate).toBe(false);
    expect(gradeActions("submitted", null).canEvaluate).toBe(true);
    expect(gradeActions("expired", null).canEvaluate).toBe(true);
    expect(gradeActions("submitted", null).evaluateLabel).toBe("Evaluate automatically");
    expect(gradeActions("submitted", g()).evaluateLabel).toBe("Re-run automatic grading");
  });
  it("never offers editing or re-grading of a published result", () => {
    const a = gradeActions("submitted", g({ status: "published" }));
    expect(a.canEvaluate).toBe(false); expect(a.canMark).toBe(false); expect(a.canPublish).toBe(false); expect(a.locked).toBe(true);
  });
  it("only offers publishing once marking is complete", () => {
    expect(gradeActions("submitted", g({ status: "pending_manual" })).canPublish).toBe(false);
    expect(gradeActions("submitted", g({ status: "pending_manual" })).needsMarking).toBe(true);
    expect(gradeActions("submitted", g({ status: "graded" })).canPublish).toBe(true);
    expect(gradeActions("submitted", null).canMark).toBe(false);
  });
});

describe("manual marks validation matches the server bound", () => {
  it("allows up to what remains of the maximum", () => {
    expect(maxManualMarks(g())).toBe(4);
    expect(parseManualMarks("4", g())).toEqual({ ok: true, value: 4 });
    expect(parseManualMarks("0", g())).toEqual({ ok: true, value: 0 });
    expect(parseManualMarks(" 3.5 ", g())).toEqual({ ok: true, value: 3.5 });
  });
  it("rejects too much, negatives, junk and empty input with a helpful message", () => {
    for (const bad of ["4.5", "5", "-1", "abc", "", "1e2", "2.555", "1,5"]) expect(parseManualMarks(bad, g()).ok).toBe(false);
    const over = parseManualMarks("5", g()); if (!over.ok) expect(over.error).toMatch(/can't exceed 4/);
  });
  it("handles an exam already fully awarded automatically", () => { expect(maxManualMarks(g({ autoMarks: 10 }))).toBe(0); expect(parseManualMarks("0", g({ autoMarks: 10 })).ok).toBe(true); expect(parseManualMarks("1", g({ autoMarks: 10 })).ok).toBe(false); });
  it("avoids floating-point drift in the limit", () => { expect(maxManualMarks({ autoMarks: 0.1 + 0.2, maxMarks: 1 })).toBe(0.7); });
});

describe("score and answer display helpers", () => {
  it("formats scores and percentages", () => { expect(formatScore({ totalMarks: 7.5, maxMarks: 10 })).toBe("7.5 / 10"); expect(percent(7.5, 10)).toBe(75); expect(percent(1, 0)).toBeNull(); });
  it("compares answers like the server (multi-select is order-insensitive, blanks are wrong)", () => {
    expect(sameAnswer(["b", "a"], ["a", "b"])).toBe(true); expect(sameAnswer("a", "a")).toBe(true); expect(sameAnswer("a", "b")).toBe(false); expect(sameAnswer(null, "a")).toBe(false); expect(sameAnswer(undefined, undefined)).toBe(false);
  });
  it("maps option ids to readable text and leaves free text alone", () => {
    const options = [{ id: "o1", text: "Paris" }, { id: "o2", text: "Rome" }];
    expect(describeAnswer("o1", options)).toBe("Paris"); expect(describeAnswer(["o2", "o1"], options)).toBe("Rome, Paris");
    expect(describeAnswer("An essay", null)).toBe("An essay"); expect(describeAnswer(null, options)).toBe(""); expect(describeAnswer("", options)).toBe("");
  });
});
