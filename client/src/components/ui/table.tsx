import * as React from "react";
import { cn } from "./utils";
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) { return <div className="relative w-full overflow-auto"><table className={cn("w-full caption-bottom text-sm", className)} {...props} /></div>; }
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <thead className={cn("[&_tr]:border-b [&_tr]:border-stone-200", className)} {...props} />; }
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) { return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />; }
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) { return <tr className={cn("border-b border-stone-100 transition-colors hover:bg-stone-50/80 data-[state=selected]:bg-stone-50", className)} {...props} />; }
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th className={cn("h-11 px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-stone-500", className)} {...props} />; }
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td className={cn("px-4 py-3.5 align-middle text-stone-700", className)} {...props} />; }
