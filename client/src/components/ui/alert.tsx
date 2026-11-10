import * as React from "react";
import { cn } from "./utils";
type AlertVariant = "default" | "success" | "warning" | "destructive";
const variants: Record<AlertVariant, string> = {
  default: "border-stone-200 bg-stone-50 text-stone-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  destructive: "border-red-200 bg-red-50 text-red-900",
};
export function Alert({ className, variant = "default", role, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  return <div role={role ?? (variant === "destructive" ? "alert" : "status")} className={cn("rounded-xl border px-4 py-3 text-sm leading-6", variants[variant], className)} {...props} />;
}
