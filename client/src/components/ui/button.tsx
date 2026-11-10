import * as React from "react";
import { cn } from "./utils";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}
const variants: Record<Variant, string> = {
  default: "bg-stone-950 text-white shadow-sm hover:bg-stone-800 focus-visible:ring-stone-900",
  secondary: "bg-stone-100 text-stone-900 hover:bg-stone-200",
  outline: "border border-stone-200 bg-white text-stone-800 hover:border-stone-400 hover:bg-stone-50",
  ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-950",
  destructive: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
};
const sizes: Record<Size, string> = {
  default: "min-h-10 px-4 py-2 text-sm", sm: "min-h-8 px-3 py-1.5 text-xs",
  lg: "min-h-12 px-6 py-3 text-sm", icon: "size-10 p-0",
};
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn("inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2", variants[variant], sizes[size], className)} {...props} />
  ),
);
Button.displayName = "Button";
