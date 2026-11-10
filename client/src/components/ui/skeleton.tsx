import * as React from "react";
import { cn } from "./utils";
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-stone-200/80", className)} {...props} />; }
