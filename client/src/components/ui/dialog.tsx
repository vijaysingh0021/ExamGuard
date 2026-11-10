import * as React from "react";
import { cn } from "./utils";

export interface DialogProps extends Omit<React.DialogHTMLAttributes<HTMLDialogElement>, "open" | "onChange"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
}

/**
 * Native modal dialog primitive. The browser provides focus containment,
 * Escape handling and focus restoration; callers control its open state.
 */
export function Dialog({ open, onOpenChange, ariaLabel, className, children, ...props }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    } else if (!open && node.open && typeof node.close === "function") {
      node.close();
    } else if (!open) {
      node.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={ariaLabel}
      className={cn("overflow-visible border-0 bg-transparent p-0 text-stone-900 backdrop:bg-stone-950/45", className)}
      onCancel={(event) => { event.preventDefault(); onOpenChange(false); }}
      onClick={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}
      onClose={() => { if (open) onOpenChange(false); }}
      {...props}
    >
      {children}
    </dialog>
  );
}

export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-h-[90dvh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl", className)} {...props} />;
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-5 flex items-start justify-between gap-4", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold tracking-tight text-stone-950", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm leading-6 text-stone-500", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex flex-wrap justify-end gap-2", className)} {...props} />;
}
