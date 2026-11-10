import * as React from "react";
import { cn } from "./utils";
type BadgeVariant = "default" | "success" | "warning" | "danger" | "outline" | "muted";
const styles: Record<BadgeVariant, string> = {
 default: "bg-stone-900 text-white", success: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
 warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200", danger: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
 outline: "bg-white text-stone-700 ring-1 ring-inset ring-stone-200", muted: "bg-stone-100 text-stone-600",
};
export function Badge({ className, variant = "muted", ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
 return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none", styles[variant], className)} {...props} />;
}
