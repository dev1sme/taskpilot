import { DropdownMenu as Menu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

const panel = "z-50 min-w-40 overflow-hidden rounded-md border border-line bg-raised p-1 text-ink shadow-panel";
const item = "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-4";

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content sideOffset={sideOffset} className={cn(panel, className)} {...props} />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, variant, ...props }: ComponentProps<typeof Menu.Item> & { variant?: "danger" }) {
  return <Menu.Item className={cn(item, variant === "danger" && "text-danger", className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(item, "pl-7", className)} {...props}>
      <Menu.ItemIndicator className="absolute left-2 size-2 rounded-full bg-signal" />
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5 text-xs font-medium text-faint", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />;
}
