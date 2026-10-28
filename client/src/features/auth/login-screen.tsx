import { zodResolver } from "@hookform/resolvers/zod";
import { SignIn } from "@phosphor-icons/react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "./api";

const schema = z.object({ user: z.string().trim().min(1), password: z.string().min(1) });
type Login = z.infer<typeof schema>;

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation(["auth", "common"]);
  const id = useId();
  const form = useForm<Login>({ resolver: zodResolver(schema), defaultValues: { user: "", password: "" } });
  const { errors, isSubmitting, isValid } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await authApi.login(values);
      onLoggedIn();
    } catch (error) {
      form.resetField("password");
      form.setError("root", { message: (error as Error).message });
    }
  });

  return (
    <main className="grid min-h-full place-items-center px-4 py-6">
      <form onSubmit={submit} aria-labelledby={`${id}-title`} className="grid w-full max-w-90 gap-2 rounded-lg border border-line bg-surface px-6 pt-7 pb-6 shadow-panel" noValidate>
        <div className="mb-3 flex items-center gap-2.5">
          <BrandMark />
          <h1 id={`${id}-title`} className="text-lg font-semibold">
            {t("common:appName")}
          </h1>
        </div>
        <Label htmlFor={`${id}-user`} className="mt-2 text-[13px] font-normal text-muted">
          {t("user")}
        </Label>
        <Input id={`${id}-user`} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus aria-invalid={errors.user ? true : undefined} {...form.register("user")} />
        <Label htmlFor={`${id}-password`} className="mt-2 text-[13px] font-normal text-muted">
          {t("password")}
        </Label>
        <Input
          id={`${id}-password`}
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.root ? true : undefined}
          aria-describedby={errors.root ? `${id}-error` : undefined}
          {...form.register("password")}
        />
        {errors.root && (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger">
            {errors.root.message}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="mt-4" busy={isSubmitting} disabled={!isValid}>
          <SignIn aria-hidden />
          {t("login")}
        </Button>
      </form>
    </main>
  );
}
