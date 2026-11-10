import * as React from "react";
import { cn } from "./utils";
export function Separator({ className, orientation = "horizontal", ...props }: React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
 return <div role="separator" aria-orientation={orientation} className={cn("shrink-0 bg-stone-200", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...props} />;
}
