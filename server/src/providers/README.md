# Provider integrations

`core/` contains shared foundations: environment, process launch contracts, events,
state, safe text and provider identifiers. It must not depend on provider or module
runtime code. The existing state schema still references workflow/usage and provider quota types only;
those legacy type references are explicitly allowed by architecture tests.

`providers/<id>/` implements each CLI's native protocol, configuration lookup and
account data. Providers depend on core, never on modules. Different native
protocols require different files; matching directory shapes are not a goal.

`modules/` owns application use cases, stores and HTTP APIs. Session backends in
`modules/sessions/backends/` adapt provider primitives to `ProviderBackend`; workflow
uses the sessions public entry point rather than importing provider internals.

Naming:

- `cli-launcher.ts`: builds the provider command and flags.
- `account-usage.ts` / `quota.ts`: reads native account limits; not polling or persistence.
- `modules/usage/*-poller.ts`: schedules reads and applies them to the usage store.
- `version.ts`: provider-specific parsing through core's shared CLI version reader.
- `app-server.ts` / `acp.ts`: native protocol clients, not session orchestration.

Tests mirror providers under `server/test/providers/`. Architecture tests enforce
layer boundaries; keep public module exports as the route between use cases.

## Launch option boundary

`core/launch.ts` defines only common `LaunchOptions` and a generic `Launcher`.
Claude's `settings` belongs to `ClaudeCliOptions`; Codex's hook settings, native
thread id and approval/network overrides belong to `CodexCliOptions`. Copilot
uses common options directly and installs hooks on disk.

Each session backend maps persisted session metadata through `launchOptions`.
PTY and preflight pass common options to that mapping, rather than building
provider-specific payloads themselves. `SessionLauncher` is the session injection
boundary (including optional provider extensions); public API/state fields stay
unchanged. Custom session launcher injections should use this type instead of
core's common-only `Launcher` when they need provider fields.

## Internal event contract (migration preparation)

`modules/sessions/events.ts` defines TaskPilot's discriminated `SessionEvent` union:
`session.started`, `prompt.submitted`, `tool.started`, `permission.requested`,
`tool.completed`, `tool.failed`, `turn.completed`, `turn.interrupted`, and
`turn.failed`.

The compatibility bridge `sessionEventFromHook` receives an already normalized
hook and trusted TaskPilot session/provider identity. Native session ids do not
override that identity. Backend normalization still owns suppressed events, tool
correlation and Codex interruption detection. Never map a suppressed null hook.
Tool names currently retain adapter-normalized names; tool vocabulary and raw
result/error schemas are not standardized in this step. Output, input and errors
remain unknown rather than asserting an unverified common schema.

SessionManager emits the neutral `event` stream after identity validation, backend
normalization and permission gating. ActivityStore, the Copilot quota refresh and
the workflow engine consume only that stream. No production code subscribes to
the legacy `hook` stream any more; tests still observe it. Resume, transcript
provenance, tool duration and failed turns (`turn.failed`) are carried
explicitly to preserve their previous behavior. HTTP hook names, state and API
formats remain unchanged. Never subscribe a consumer to both streams or
normalize twice.
