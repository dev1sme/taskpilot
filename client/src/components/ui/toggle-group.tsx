import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root className={cn("flex flex-wrap items-center gap-1", className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-sm border border-transparent px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-ink data-[state=on]:border-line data-[state=on]:bg-surface data-[state=on]:font-medium data-[state=on]:text-ink",
        className,
      )}
      {...props}
    />
  );
}
