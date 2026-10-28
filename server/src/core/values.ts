/** A plain object (not null, not an array), as parsed JSON, YAML or TOML gives it. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An environment variable that is set to something: an empty string means "not set". */
export function envPath(name: string): string | undefined {
  return process.env[name] || undefined;
}
