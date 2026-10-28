import { CircleNotch } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-signal text-on-signal hover:bg-signal/90",
        secondary: "border border-line bg-raised text-ink hover:bg-hover",
        ghost: "text-muted hover:bg-hover hover:text-ink",
        danger: "border border-danger/40 bg-danger-soft text-danger hover:bg-danger/15",
        attention: "bg-attention text-on-attention hover:bg-attention/90",
        link: "h-auto px-0 text-signal-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Renders the child element (a link…) with the button's look. */
  asChild?: boolean;
  /** Shows a spinner and disables the button while an action runs. */
  busy?: boolean;
}

export function Button({ className, variant, size, asChild = false, busy = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {busy && !asChild ? <CircleNotch className="animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  );
}
