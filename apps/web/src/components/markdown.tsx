import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Task files are written by people and by agents; always sanitized before rendering. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false })), [source]);
  return <div className={cn("prose prose-sm prose-tp max-w-[78ch] [overflow-wrap:anywhere]", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Agents write `code` in their messages; show it as code instead of raw backticks. */
export function InlineCode({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part))}</>;
}
