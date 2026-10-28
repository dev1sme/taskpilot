import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";

/** Toasts in the app's palette; call `toast()` from "sonner" anywhere. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner theme={resolved} position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-md !border-line !bg-raised !text-ink !shadow-panel", description: "!text-muted" } }} />
  );
}
