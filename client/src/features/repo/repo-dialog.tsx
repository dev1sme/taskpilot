import type { RepoInfo } from "@server/api-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderOpen } from "@phosphor-icons/react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOpenRepo } from "@/features/workspace/queries";

const schema = z.object({ path: z.string().trim().min(1) });

/** Switch repo: the server checks the path and remembers it for next time. */
export function RepoDialog({ open, onOpenChange, repo }: { open: boolean; onOpenChange: (open: boolean) => void; repo: RepoInfo | undefined }) {
  const { t } = useTranslation("repo");
  const id = useId();
  const openRepo = useOpenRepo();
  const form = useForm({ resolver: zodResolver(schema), values: { path: repo?.path ?? "" } });
  const error = form.formState.errors.root?.message;
  const path = useWatch({ control: form.control, name: "path" });

  const submit = form.handleSubmit(async ({ path }) => {
    try {
      await openRepo.mutateAsync(path);
      onOpenChange(false);
    } catch (e) {
      form.setError("root", { message: (e as Error).message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-2" noValidate>
          <Label htmlFor={`${id}-path`}>{t("path")}</Label>
          <div className="flex gap-2">
            <Input
              id={`${id}-path`}
              placeholder="/home/ban/projects/my-app"
              spellCheck={false}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              {...form.register("path")}
            />
            <Button type="submit" busy={form.formState.isSubmitting} disabled={!path.trim() || path === repo?.path}>
              <FolderOpen aria-hidden />
              {t("open")}
            </Button>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
