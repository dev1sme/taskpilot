/** A skill: `<folder>/SKILL.md`. */
export const SKILL_REL = /^[A-Za-z0-9][\w-]*\/SKILL\.md$/;
/** One file directly in its folder: hook sets, Codex agents. */
export const PLAIN_JSON = /^[A-Za-z0-9][\w.-]*\.json$/;
export const PLAIN_TOML = /^[A-Za-z0-9][\w.-]*\.toml$/;
export const AGENT_MD = /^[A-Za-z0-9][\w.-]*\.agent\.md$/;
export const AGENT_OR_MD = /^[A-Za-z0-9][\w.-]*\.(?:agent\.)?md$/;

/** Agents and commands: any depth, any characters in a segment except the ones that escape the folder. */
export function isMarkdownRel(rel: string): boolean {
  const segments = rel.split("/");
  const ok = segments.every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\u0000-\u001f\u007f]/.test(s));
  const last = segments[segments.length - 1];
  return ok && last.endsWith(".md") && last.length > ".md".length;
}
