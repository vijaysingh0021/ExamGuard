
import { describe, expect, it } from "vitest";
import {
  formatStartsIn,
  phaseOf,
  readinessItems,
  resultText,
  sections,
  submissionStatusText,
  type Assignment,
} from "../lib/candidate-rules";

const NOW = Date.parse("2026-11-07T10:00:00Z");

const at = (min: number) =>
  new Date(NOW + min * 60_000).toISOString();

/**
 * Creates a valid Assignment while allowing tests to override
 * only the exam fields they need.
 */
const a = (
  over: Omit<Partial<Assignment>, "exam"> & {
    exam?: Partial<NonNullable<Assignment["exam"]>> | null;
  } = {},
): Assignment => ({
  id: over.id ?? "a1",
  exam:
    over.exam === null
      ? null
      : {
          id: "e1",
          title: "Maths",
          status: "published",
          startsAt: at(-10),
          endsAt: at(60),
          durationMinutes: 45,
          ...(over.exam ?? {}),
        },
  attempt: over.attempt ?? null,
  grade: over.grade ?? null,
});

describe("exam phase for the candidate", () => {
  it("is available inside the window and upcoming before it", () => {
    expect(phaseOf(a(), NOW)).toBe("available");
    expect(phaseOf(a({ exam: { startsAt: at(30) } }), NOW)).toBe(
      "upcoming",
    );
  });

  it("is not taken after the window closes without an attempt", () => {
    expect(phaseOf(a({ exam: { endsAt: at(-1) } }), NOW)).toBe("missed");
    expect(phaseOf(a({ exam: { status: "completed" } }), NOW)).toBe(
      "missed",
    );
  });

  it("exact boundaries: start inclusive, end exclusive", () => {
    expect(phaseOf(a({ exam: { startsAt: at(0) } }), NOW)).toBe(
      "available",
    );
    expect(phaseOf(a({ exam: { endsAt: at(0) } }), NOW)).toBe("missed");
  });

  it("lets an in-progress attempt resume, and shows closing once the window is over", () => {
    expect(
      phaseOf(a({ attempt: { id: "t", status: "in_progress" } }), NOW),
    ).toBe("in_progress");

    expect(
      phaseOf(a({ attempt: { id: "t", status: "paused" } }), NOW),
    ).toBe("in_progress");

    expect(
      phaseOf(
        a({
          exam: { endsAt: at(-1) },
          attempt: { id: "t", status: "in_progress" },
        }),
        NOW,
      ),
    ).toBe("closing");
  });

  it("any finished attempt is completed, even if the exam is no longer open", () => {
    for (const s of ["submitted", "expired", "terminated"]) {
      expect(
        phaseOf(
          a({
            exam: { status: "completed" },
            attempt: { id: "t", status: s },
          }),
          NOW,
        ),
      ).toBe("completed");
    }
  });

  it("drafts and missing exams are unavailable, never startable", () => {
    expect(phaseOf(a({ exam: { status: "draft" } }), NOW)).toBe(
      "unavailable",
    );
    expect(phaseOf({ id: "x", exam: null }, NOW)).toBe("unavailable");
  });
});

describe("dashboard sections", () => {
  it("separates active, upcoming and history and orders each sensibly", () => {
    const list = [
      a({ id: "later", exam: { startsAt: at(300), endsAt: at(400) } }),
      a({ id: "soon", exam: { startsAt: at(30), endsAt: at(100) } }),
      a({ id: "now-late", exam: { endsAt: at(90) } }),
      a({ id: "now-early", exam: { endsAt: at(20) } }),
      a({
        id: "old",
        attempt: { id: "t", status: "submitted", submittedAt: at(-500) },
      }),
      a({
        id: "recent",
        attempt: { id: "t2", status: "submitted", submittedAt: at(-5) },
      }),
    ];

    const s = sections(list, NOW);

    expect(s.active.map((x) => x.a.id)).toEqual([
      "now-early",
      "now-late",
    ]);
    expect(s.upcoming.map((x) => x.a.id)).toEqual(["soon", "later"]);
    expect(s.history.map((x) => x.a.id)).toEqual(["recent", "old"]);
  });
});

describe("text helpers", () => {
  it("formats time until start", () => {
    expect(formatStartsIn(0)).toBe("now");
    expect(formatStartsIn(60_000)).toBe("in 1 minute");
    expect(formatStartsIn(90 * 60_000)).toBe("in 1 hour 30 min");
    expect(formatStartsIn(72 * 3_600_000)).toBe("in 3 days");
  });

  it("formats results and handles a zero maximum", () => {
    expect(resultText({ totalMarks: 7.5, maxMarks: 10 })).toBe(
      "7.5 / 10 (75%)",
    );
    expect(resultText({ totalMarks: 0, maxMarks: 0 })).toBe("0 / 0");
  });

  it("describes how an attempt ended without implying misconduct", () => {
    expect(
      submissionStatusText(a({ attempt: { id: "t", status: "expired" } })),
    ).toBe("Closed automatically at the deadline");

    expect(
      submissionStatusText(a({ attempt: { id: "t", status: "terminated" } })),
    ).toBe("Ended by your examiner");

    expect(submissionStatusText(a())).toBe("");
  });
});

describe("device readiness uses only what the browser reports and never requests access", () => {
  const ok = {
    secure: true,
    hasMediaDevices: true,
    online: true,
    camera: "granted",
    microphone: "granted",
  } as const;

  it("reports all clear", () => {
    expect(readinessItems(ok).every((i) => i.status === "ok")).toBe(true);
  });

  it("explains how to fix a blocked camera", () => {
    const cam = readinessItems({ ...ok, camera: "denied" }).find(
      (i) => i.id === "camera",
    )!;

    expect(cam.status).toBe("fail");
    expect(cam.hint).toMatch(/lock icon/);
  });

  it("treats prompt and unknown as warnings, not failures", () => {
    const items = readinessItems({
      ...ok,
      camera: "prompt",
      microphone: "unknown",
    });

    expect(items.find((i) => i.id === "camera")!.status).toBe("warn");
    expect(items.find((i) => i.id === "microphone")!.status).toBe("warn");
  });

  it("fails offline, insecure and unsupported environments", () => {
    const f = readinessItems({
      secure: false,
      hasMediaDevices: false,
      online: false,
      camera: "unknown",
      microphone: "unknown",
    })
      .filter((i) => i.status === "fail")
      .map((i) => i.id);

    expect(f).toEqual(["online", "secure", "media"]);
  });
});
