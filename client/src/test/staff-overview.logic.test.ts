import { describe, expect, it } from "vitest";
import { attentionItems, examOverview, type Stats } from "../lib/staff-overview";

const base: Stats = { exams: 3, candidates: 20, verificationPending: 0, openIncidents: 0, activeSessions: 0, pendingExplanations: 0, awaitingEvaluation: 0, pendingManual: 0, readyToPublish: 0 };
const ids = (s: Partial<Stats>, role: string) => attentionItems({ ...base, ...s }, role).map((i) => i.id);

describe("attention items", () => {
  it("shows nothing when there is nothing to do (no placeholder rows)", () => { expect(attentionItems(base, "institute_admin")).toEqual([]); });
  it("shows grading work to teachers and administrators only", () => {
    const s = { awaitingEvaluation: 4, pendingManual: 2, readyToPublish: 1 };
    expect(ids(s, "teacher")).toEqual(["evaluate", "mark", "publish"]); expect(ids(s, "institute_admin")).toEqual(["evaluate", "mark", "publish"]); expect(ids(s, "proctor")).toEqual([]);
  });
  it("shows verification to administrators and reviewers, not teachers", () => {
    expect(ids({ verificationPending: 2 }, "proctor")).toEqual(["verification"]); expect(ids({ verificationPending: 2 }, "institute_admin")).toEqual(["verification"]); expect(ids({ verificationPending: 2 }, "teacher")).toEqual([]);
  });
  it("shows incidents to every staff role and flags them urgent", () => {
    for (const role of ["institute_admin", "teacher", "proctor"]) expect(ids({ openIncidents: 3 }, role)).toEqual(["incidents"]);
    expect(attentionItems({ ...base, openIncidents: 3 }, "teacher")[0].urgent).toBe(true);
  });
  it("tolerates an older API response without the grading counts", () => {
    const { awaitingEvaluation, pendingManual, readyToPublish, ...legacy } = base; expect(attentionItems(legacy as Stats, "teacher")).toEqual([]);
  });
  it("never invents counts: values come straight from stats", () => { expect(attentionItems({ ...base, openIncidents: 7 }, "proctor")[0].count).toBe(7); });
});

describe("exam overview", () => {
  const NOW = Date.parse("2026-11-07T10:00:00Z"); const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const exams = [
    { id: "a", title: "A", status: "live", startsAt: at(-30), endsAt: at(30) }, { id: "b", title: "B", status: "scheduled", startsAt: at(120), endsAt: at(200) },
    { id: "c", title: "C", status: "published", startsAt: at(60), endsAt: at(100) }, { id: "d", title: "D", status: "draft" }, { id: "e", title: "E", status: "completed", startsAt: at(-500), endsAt: at(-400) },
  ];
  it("counts by status and finds what is live and next", () => {
    const o = examOverview(exams, NOW);
    expect(o.byStatus).toEqual({ live: 1, scheduled: 1, published: 1, draft: 1, completed: 1 }); expect(o.liveNow.map((e) => e.id)).toEqual(["a"]); expect(o.next?.id).toBe("c"); expect(o.upcomingCount).toBe(2);
  });
  it("handles no exams", () => { const o = examOverview([], NOW); expect(o.next).toBeNull(); expect(o.liveNow).toEqual([]); expect(o.byStatus).toEqual({}); });
  it("an ended window is not live; drafts are never live or upcoming", () => {
    expect(examOverview([{ id: "x", title: "X", status: "published", startsAt: at(-60), endsAt: at(-1) }], NOW).liveNow).toEqual([]);
    expect(examOverview([{ id: "y", title: "Y", status: "draft", startsAt: at(60) }], NOW).next).toBeNull();
  });
});
