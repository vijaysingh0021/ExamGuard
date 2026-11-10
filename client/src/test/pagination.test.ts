import { describe, expect, it } from "vitest";
import { dateTimeLocalValue, readPagination } from "../lib/pagination";

describe("organization API pagination metadata", () => {
  it("reads the exact exposed pagination headers", () => {
    expect(readPagination({ headers: {
      "x-page": "2",
      "x-page-size": "25",
      "x-total-count": "51",
      "x-total-pages": "3",
    } })).toEqual({ page: 2, pageSize: 25, totalCount: 51, totalPages: 3 });
  });

  it("accepts normalized header casing and numeric values", () => {
    expect(readPagination({ headers: {
      "X-Page": 1,
      "X-Page-Size": 50,
      "X-Total-Count": 0,
      "X-Total-Pages": 0,
    } })).toEqual({ page: 1, pageSize: 50, totalCount: 0, totalPages: 0 });
  });

  it("does not invent totals when a header is absent or malformed", () => {
    expect(readPagination({ headers: { "x-page": "1", "x-page-size": "50", "x-total-count": "50" } })).toBeNull();
    expect(readPagination({ headers: { "x-page": "1", "x-page-size": "50", "x-total-count": "NaN", "x-total-pages": "1" } })).toBeNull();
  });

  it("formats valid ISO timestamps for datetime-local controls", () => {
    expect(dateTimeLocalValue("not-a-date")).toBe("");
    expect(dateTimeLocalValue("2026-11-06T10:30:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
