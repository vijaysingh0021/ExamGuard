import * as React from "react";
import { cn } from "./utils";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn("flex min-h-10 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none transition focus:border-stone-500 focus:ring-2 focus:ring-stone-900/10 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>{children}</select>
));
Select.displayName = "Select";
