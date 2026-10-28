/**
 * The types the browser client reads from the HTTP API. The client imports them type-only
 * (`@server/api-types`), so a server change that breaks the UI fails the client's typecheck.
 */
export type { AuthStatus } from "./modules/auth/routes.js";
