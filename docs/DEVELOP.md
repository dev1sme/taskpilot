# Developing TaskPilot

```bash
npm run dev:server   # API on 127.0.0.1:8791, token "dev" (tsx watch); the service keeps :8790
npm run dev:client   # UI on :5173, open http://127.0.0.1:5173/?token=dev
                     # (or log in, when .env sets TASKPILOT_AUTH_*)
npm test
npm run typecheck
npm run i18n:lint    # flags JSX text/attributes that should come from a resource instead
```

Layout (import rules are checked by `server/test/architecture.test.ts`, part of `npm test`):

- `server/src/`
  - `index.ts` (CLI), `app.ts` (builds Fastify, creates the services, wires their events, registers
    every module's routes)
  - `core/`: infrastructure with no feature logic: `errors`, `events` (SSE hub), `dotenv`, `state`
    (`~/.taskpilot/state.json`), `markdown`, `i18n` + `locales/` (strings the server itself sends
    to the UI), `claude/` (launching and calling the `claude` binary), `copilot/` (launching `copilot`, its version and
    account quota)
  - `modules/<name>/`: one folder per feature, each with `routes.ts`
    (`register<Name>Routes(app, deps)`) and an `index.ts` that is its only entry for other modules:
    `auth`, `repo` (selected repo, inventory), `tasks` (scanning `.claude/tasks`, watcher),
    `sessions` (node-pty, hooks), `hooks` (callbacks from sessions), `env` (env store), `usage`,
    `activity` (hook events → feed), `workflow` (engine, workflow files, decision log), `events`,
    `config` (sub-folders `memory`, `settings`, `hooks`, `library`, `mcp`, `backups`, `codegraph`,
    `shared`)
- `server/test/`: mirrors `server/src` (`core/…`, `modules/<name>/…`), helpers in `helpers/`
- `client/src/`
  - `app/`: `App.tsx` and `layout/` (sidebar, status bar, command palette)
  - `features/<name>/`: components, hooks, `api.ts`, `types.ts` and stylesheets of one feature;
    `index.ts` is its only entry for app and other features: `workspace` (repo, tasks, inventory),
    `auth`, `repo`, `tasks`, `task`, `workflow`, `activity`, `docs`, `sessions`, `usage`,
    `overview`, `config` (one sub-folder per page, plus `shared/`)
  - `shared/`: `api/` (HTTP client, server events, query client), `ui/` (components used by
    several features: button, dialogs, page header, toolbar…), `router.ts`
  - `styles/` (tokens, base), `i18n/` (i18next resources, one JSON file per feature)
- `workflows/default/`: built-in workflow and prompts

Import rules: `core/` never uses module code (types only); `shared/` never uses `features/` or
`app/`; features never use `app/`; a module or feature reaches another only through its
`index.ts`; stylesheets are imported only inside their own feature (or from `app/`, `shared/`);
no import cycles between client features (type-only imports included) or runtime cycles between
server modules.

## i18n

UI strings live in i18next resources: one JSON file per feature namespace under
`client/src/i18n/locales/vi/`, and `server/src/core/locales/vi.ts` for the strings the server
itself sends to the UI (toasts, errors, backup reasons, …). Only `vi` exists today; adding a
language means a sibling resource file per namespace, and `i18next.d.ts` types every `t()` key so a
wrong key or namespace fails `npm run typecheck`.

`npm run i18n:lint` (`i18next-cli`) checks JSX text and attributes; `npm test` also fails on
Vietnamese characters anywhere in `client/src` or `server/src` outside those resources and
`modules/workflow/history.ts` — the task decision log is a document Claude reads back, not UI, so
it keeps its own Vietnamese wording regardless of the UI language.

Design notes: [SPEC.md](SPEC.md).
