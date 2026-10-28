import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTitle = SheetPrimitive.Title;

const SIDES = {
  left: "inset-y-0 left-0 w-72 max-w-[85vw] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  right: "inset-y-0 right-0 w-[min(56rem,100vw)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
};

/** A panel sliding over the page: navigation from the left on a narrow screen, documents from the right. */
export function SheetContent({ className, children, side = "left", ...props }: ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        aria-describedby={undefined}
        className={cn("fixed z-50 flex flex-col bg-sidebar shadow-panel outline-none data-[state=closed]:animate-out data-[state=open]:animate-in", SIDES[side], className)}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
