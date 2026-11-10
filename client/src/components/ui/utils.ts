import { clsx, type ClassValue } from "clsx";

/** Shared class combiner used by the ExamGuard shadcn-style primitives. */
export function cn(...values: ClassValue[]) {
  return clsx(values);
}
