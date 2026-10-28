import { cn } from "@/lib/utils";

/** A unified diff with added and removed lines marked by sign and color. */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.split("\n").filter((line) => !line.startsWith("===") && !line.startsWith("Index:"));
  return (
    <pre className={cn("max-h-[55vh] overflow-auto rounded-sm border border-line bg-sunken py-2 font-mono text-xs leading-relaxed", className)}>
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-3 whitespace-pre-wrap",
            line.startsWith("+") && !line.startsWith("+++") && "bg-done-soft text-done",
            line.startsWith("-") && !line.startsWith("---") && "bg-danger-soft text-danger",
            line.startsWith("@@") && "text-faint",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
