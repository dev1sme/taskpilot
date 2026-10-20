import { CircleNotch, type Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./components.css";

type Variant = "default" | "primary" | "attention" | "quiet" | "danger";
type Size = "md" | "lg";

/**
 * Button with an optional leading icon. While `busy`, it is disabled, shows a spinner in place of
 * the icon and sets aria-busy, so async actions cannot be double-submitted.
 */
export function Button({
  icon: IconComponent,
  busy = false,
  variant = "default",
  size = "md",
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: Icon;
  busy?: boolean;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      type={type}
      className={["btn", `btn-${variant}`, size === "lg" && "btn-lg", className].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <CircleNotch className="btn-icon spin" aria-hidden="true" />
      ) : (
        IconComponent && <IconComponent className="btn-icon" weight="bold" aria-hidden="true" />
      )}
      <span>{children}</span>
    </button>
  );
}

/** Text for screen readers only. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
