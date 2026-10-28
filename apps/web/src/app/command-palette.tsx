import { SidebarSimple } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fold, sortTasks, statusOf } from "@/features/tasks/status";
import { useTasks } from "@/features/workspace/queries";
import { lastConfigCli, type ConfigSection } from "./routes";

const PAGES: Array<{ nav: string; to: "/" | "/tasks" | "/backups" | "/config/$section"; section?: ConfigSection }> = [
  { nav: "overview", to: "/" },
  { nav: "tasks", to: "/tasks" },
  { nav: "workflow", to: "/config/$section", section: "workflow" },
  { nav: "formats", to: "/config/$section", section: "formats" },
  { nav: "memory", to: "/config/$section", section: "memory" },
  { nav: "settings", to: "/config/$section", section: "settings" },
  { nav: "hooks", to: "/config/$section", section: "hooks" },
  { nav: "agents", to: "/config/$section", section: "agents" },
  { nav: "commands", to: "/config/$section", section: "commands" },
  { nav: "skills", to: "/config/$section", section: "skills" },
  { nav: "mcp", to: "/config/$section", section: "mcp" },
  { nav: "codegraph", to: "/config/$section", section: "codegraph" },
  { nav: "backups", to: "/backups" },
];

/** ⌘K / Ctrl+K: jump to any task or page by typing, or run a shell command. */
export function CommandPalette({ open, onOpenChange, sidebarCommand, onSidebar }: { open: boolean; onOpenChange: (open: boolean) => void; sidebarCommand: string; onSidebar: () => void }) {
  const { t } = useTranslation("shell");
  const tasks = useTasks().data ?? [];
  const navigate = useNavigate();
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  // Matching ignores Vietnamese diacritics, so "cho duyet" finds "Chờ duyệt".
  const filter = (value: string, search: string) => (fold(value).includes(fold(search.trim())) ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 p-0 [&>button:last-child]:hidden" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("palette.label")}</DialogTitle>
        <Command filter={filter}>
          <CommandInput placeholder={t("palette.placeholder")} />
          <CommandList>
            <CommandEmpty>{t("palette.empty")}</CommandEmpty>
            {tasks.length > 0 && (
              <CommandGroup heading={t("palette.group.tasks")}>
                {sortTasks(tasks).map((task) => {
                  const status = statusOf(task);
                  return (
                    <CommandItem
                      key={task.key}
                      value={`${task.key} ${task.title} ${status.label}`}
                      onSelect={() => run(() => void navigate({ to: "/tasks/$key", params: { key: task.key } }))}
                    >
                      <span className="truncate">{task.title === task.key ? task.key : `${task.key} · ${task.title}`}</span>
                      <span className="ml-auto shrink-0 text-xs text-faint">{status.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading={t("palette.group.pages")}>
              {PAGES.map((page) => (
                <CommandItem
                  key={page.nav}
                  value={t(`nav.${page.nav}` as "nav.overview")}
                  onSelect={() =>
                    run(() =>
                      page.section
                        ? void navigate({ to: "/config/$section", params: { section: page.section }, search: { cli: lastConfigCli() } })
                        : void navigate({ to: page.to as "/" | "/tasks" | "/backups" }),
                    )
                  }
                >
                  {t(`nav.${page.nav}` as "nav.overview")}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading={t("palette.group.commands")}>
              <CommandItem value={sidebarCommand} onSelect={() => run(onSidebar)}>
                <SidebarSimple aria-hidden />
                {sidebarCommand}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
