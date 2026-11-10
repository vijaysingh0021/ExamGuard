import { describe, expect, it } from "vitest";
import { clockOffsetMs, formatClock, isAnswered, loadMarks, progress, questionState, remainingMs, saveMarks, timerAnnouncement, timerTone } from "../lib/exam-state";

describe("server-aligned timer and deadline boundaries", () => {
  const deadline = "2026-11-07T10:00:00.000Z"; const at = (iso: string) => Date.parse(iso);
  it("reaches exactly zero at the deadline and never goes negative", () => {
    expect(remainingMs(deadline, at("2026-11-07T09:59:59.999Z"))).toBe(1);
    expect(remainingMs(deadline, at("2026-11-07T10:00:00.000Z"))).toBe(0);
    expect(remainingMs(deadline, at("2026-11-07T10:00:05.000Z"))).toBe(0);
  });
  it("corrects for a device clock that is wrong, using the server Date header", () => {
    const deviceNow = at("2026-11-07T09:50:00.000Z"); // device is 5 minutes slow
    const offset = clockOffsetMs("Sat, 07 Nov 2026 09:55:00 GMT", deviceNow);
    expect(offset).toBe(5 * 60_000);
    expect(remainingMs(deadline, deviceNow, offset)).toBe(5 * 60_000);
    expect(remainingMs(deadline, deviceNow, 0)).toBe(10 * 60_000); // without correction the candidate would believe they have 5 extra minutes
  });
  it("ignores unusable headers", () => {
    expect(clockOffsetMs(undefined, 1)).toBe(0); expect(clockOffsetMs("garbage", 1)).toBe(0);
    expect(clockOffsetMs("Sat, 07 Nov 2030 09:55:00 GMT", at("2026-11-07T09:50:00.000Z"))).toBe(0);
  });
  it("formats and classifies the countdown", () => {
    expect(formatClock(0)).toBe("00:00"); expect(formatClock(59_001)).toBe("01:00"); expect(formatClock(61 * 60_000)).toBe("1:01:00"); expect(formatClock(-5)).toBe("00:00");
    expect(timerTone(11 * 60_000)).toBe("normal"); expect(timerTone(10 * 60_000)).toBe("warning"); expect(timerTone(60_000)).toBe("critical"); expect(timerTone(0)).toBe("expired");
  });
  it("announces only meaningful moments to screen readers", () => {
    expect(timerAnnouncement(300_000)).toBe("Five minutes remaining."); expect(timerAnnouncement(299_000)).toBeNull(); expect(timerAnnouncement(0)).toBe("Time is up.");
  });
});

describe("answer status and progress", () => {
  it("treats empty and whitespace answers as unanswered", () => {
    expect(isAnswered("")).toBe(false); expect(isAnswered("   ")).toBe(false); expect(isAnswered([])).toBe(false); expect(isAnswered(undefined)).toBe(false); expect(isAnswered(null)).toBe(false);
    expect(isAnswered("x")).toBe(true); expect(isAnswered(["a"])).toBe(true); expect(isAnswered(0)).toBe(true);
  });
  it("summarises progress and keeps question states distinct", () => {
    const p = progress([{ id: "a" }, { id: "b" }, { id: "c" }], { a: "x", b: "" }, { b: true });
    expect(p).toEqual({ total: 3, answered: 1, unanswered: [1, 2], marked: [1] });
    expect(questionState(true, true, true)).toBe("current"); expect(questionState(false, true, true)).toBe("marked");
    expect(questionState(false, false, true)).toBe("answered"); expect(questionState(false, false, false)).toBe("unanswered");
  });
});

describe("review marks survive reloads", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it("round-trips per attempt and drops false/invalid entries", () => {
    const store = mem(); saveMarks(store, "att1", { q1: true, q2: false });
    expect(loadMarks(store, "att1")).toEqual({ q1: true }); expect(loadMarks(store, "att2")).toEqual({});
    store.setItem("eg-review-marks:bad", "[1,2]"); expect(loadMarks(store, "bad")).toEqual({});
    store.setItem("eg-review-marks:junk", "{not json"); expect(loadMarks(store, "junk")).toEqual({});
  });
  it("never throws when storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadMarks(broken, "a")).toEqual({}); saveMarks(broken, "a", { q: true }); expect(loadMarks(undefined, "a")).toEqual({});
  });
});
