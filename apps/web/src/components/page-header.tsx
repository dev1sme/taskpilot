import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A page's title row: title and subtitle on the left, page actions on the right. */
export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 sm:px-6", className)}>
      <div className="grid min-w-0 gap-0.5">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** What a page shows when there is nothing to list, with the way forward. */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-2 px-4 py-16 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
