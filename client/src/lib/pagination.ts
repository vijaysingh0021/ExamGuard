export type PaginationMetadata = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

/** Parse only the four pagination headers returned by the organization list APIs. */
export function readPagination(response: { headers?: Record<string, unknown> }): PaginationMetadata | null {
  const headers = response.headers ?? {};
  const read = (name: string) => {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
    const raw = entry?.[1];
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const page = read("x-page");
  const pageSize = read("x-page-size");
  const totalCount = read("x-total-count");
  const totalPages = read("x-total-pages");
  return page !== null && pageSize !== null && totalCount !== null && totalPages !== null
    ? { page, pageSize, totalCount, totalPages }
    : null;
}

export function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
