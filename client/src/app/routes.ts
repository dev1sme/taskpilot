import { z } from "zod";
import { isProviderId, type ProviderId } from "@/lib/providers";
import { stored } from "@/lib/use-media";

/** Config sections with one view per CLI; the others (workflow, formats, codegraph) are TaskPilot's own. */
export const CLI_SECTIONS = ["memory", "settings", "hooks", "agents", "commands", "skills", "mcp"] as const;
export const SHARED_SECTIONS = ["workflow", "formats", "codegraph"] as const;
export const CONFIG_SECTIONS = [...CLI_SECTIONS, ...SHARED_SECTIONS] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export const isCliSection = (section: string): section is (typeof CLI_SECTIONS)[number] => (CLI_SECTIONS as readonly string[]).includes(section);

const CLI_KEY = "taskpilot.config.cli";

/** The CLI last chosen on a config page, so links to other sections keep it. */
export const lastConfigCli = (): ProviderId => {
  const value = stored.get(CLI_KEY);
  return isProviderId(value) ? value : "claude";
};
export const rememberConfigCli = (cli: ProviderId) => stored.set(CLI_KEY, cli);

export const configSearch = z.object({
  cli: z
    .string()
    .optional()
    .transform((v) => (isProviderId(v) ? v : undefined)),
  /** workflow: the file shown and the mode viewed. */
  file: z.string().optional(),
  mode: z.string().optional(),
  /** Native sections: the read-only view or the raw file. */
  view: z.enum(["ui", "raw"]).optional(),
  scope: z.enum(["project", "local", "user"]).optional(),
  /** A library item or a hook file, for its raw file. */
  name: z.string().optional(),
});
