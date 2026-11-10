import * as React from "react";
import { cn } from "./utils";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("flex min-h-24 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-stone-500 focus:ring-2 focus:ring-stone-900/10 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />
));
Textarea.displayName = "Textarea";
