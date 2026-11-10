import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";

type Status = { state: "not_connected" | "connected" | "quiet" | "stopped_by_candidate" | "scanner_problem"; lastReportAt: string | null; message: string };
const LABEL: Record<Status["state"], { text: string; dot: string }> = {
  not_connected: { text: "Companion not connected", dot: "bg-stone-400" },
  connected: { text: "Companion connected", dot: "bg-emerald-500" },
  quiet: { text: "Companion quiet", dot: "bg-amber-500" },
  stopped_by_candidate: { text: "Companion stopped", dot: "bg-stone-500" },
  scanner_problem: { text: "Companion scanner issue", dot: "bg-amber-500" },
};

/** Technical status for the candidate only. It is informational and never changes the exam or raises an incident. */
export function CompanionStatus({ attemptId }: { attemptId: string }) {
  const { data, isError } = useQuery({ queryKey: ["companion-status", attemptId], queryFn: async () => (await api.get<Status>(`/api/student/attempts/${attemptId}/companion-status`)).data, refetchInterval: 20_000, refetchIntervalInBackground: false });
  if (isError || !data) return null;
  const l = LABEL[data.state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600" role="status" title={data.message}>
      <span className={`size-2 rounded-full ${l.dot}`} aria-hidden="true" />{l.text}
      <span className="sr-only">. {data.message}</span>
    </span>
  );
}
