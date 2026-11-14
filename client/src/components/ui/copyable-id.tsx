import { useState } from "react";
import { Copy, CopyCheck } from "lucide-react";
import { Button } from "./button";

type CopyableIdProps = {
  id: string;
  label: string;
  compact?: boolean;
};

export function CopyableId({ id, label, compact = false }: CopyableIdProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copyId = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }
      await navigator.clipboard.writeText(id);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className={compact ? "flex min-w-0 flex-wrap items-center gap-x-1.5" : "min-w-0"}>
      <span className={compact ? "text-[10px] font-medium text-stone-500" : "block text-xs text-stone-500"}>
        {label}
      </span>
      <code className={`font-mono text-xs text-stone-700 ${compact ? "break-all" : "mt-1 block break-all"}`} title={id}>
        {id}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-6 px-1.5 py-0 text-[10px]"
        onClick={() => void copyId()}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {copyState === "copied" ? <CopyCheck size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        {copyState === "copied" ? "Copied" : "Copy"}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === "copied" ? `${label} copied to clipboard.` : copyState === "failed" ? `Could not copy ${label}. Select and copy the displayed value.` : ""}
      </span>
      {copyState === "failed" && (
        <span className="text-[10px] text-amber-700" role="status">
          Copy unavailable; select the ID.
        </span>
      )}
    </div>
  );
}
