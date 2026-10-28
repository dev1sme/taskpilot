import { formatDuration, useNow } from "@/lib/time";

/** Live "4m 12s" since `since`. */
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const now = useNow(1000);
  return (
    <time dateTime={new Date(since).toISOString()} className={className}>
      {formatDuration(now - since)}
    </time>
  );
}
