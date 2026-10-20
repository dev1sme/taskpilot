import { Eye, Plus, Trash, X } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { ScopeTag } from "../shared/parts";
import { useSaveFlow } from "../shared/useSaveFlow";
import { mcpApi } from "./api";
import type { McpEntryForm, McpEntryInput } from "./types";
import type { Scope } from "../shared/types";
import "../shared/library-view.css";
import "./mcp.css";

interface Row {
  key: string;
  value: string;
  /** Already configured: an empty value means "keep it". */
  existing: boolean;
  masked: string;
  secret: boolean;
}

/** Example arguments, one per line (not translated: it is a command line). */
const ARGS_EXAMPLE = "-y\n@modelcontextprotocol/server-github";

const toRows = (values: McpEntryForm["env"]): Row[] =>
  values.map((v) => ({ key: v.key, value: "", existing: true, masked: v.value, secret: !v.reference }));

/**
 * Add or edit one MCP server. Configured values are never sent to the browser: an untouched
 * value field keeps what is configured. For project servers, values marked secret go to
 * TaskPilot's env store and .mcp.json gets `${VAR}`.
 */
export function McpForm(props: {
  scope: Scope;
  base: McpEntryForm | null;
  baseHash: string;
  /** Prefilled values for a new server (ignored once `base` is set, i.e. when editing). */
  initial?: { name: string; command: string; args: string[] };
  onDone: (name: string | null) => void;
  /** Where to render cancel / review & save, e.g. the page toolbar; inline at the end of the form when absent. */
  actionsSlot?: HTMLElement | null;
}) {
  const { t } = useTranslation("config");
  const { scope, base } = props;
  const [name, setName] = useState(base?.name ?? props.initial?.name ?? "");
  const [type, setType] = useState<McpEntryInput["type"]>(base?.type ?? "stdio");
  const [command, setCommand] = useState(base?.command ?? props.initial?.command ?? "");
  const [args, setArgs] = useState((base?.args ?? props.initial?.args ?? []).join("\n"));
  const [url, setUrl] = useState(base?.url ?? "");
  const [env, setEnv] = useState<Row[]>(toRows(base?.env ?? []));
  const [headers, setHeaders] = useState<Row[]>(toRows(base?.headers ?? []));
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { name: useId(), type: useId(), command: useId(), args: useId(), url: useId() };

  const build = (): McpEntryInput => {
    const rows = (list: Row[]) =>
      list
        .filter((r) => r.key.trim())
        .map((r) => {
          if (!r.value && !r.existing) throw new Error(t("mcpForm.needsValue", { key: r.key }));
          return { key: r.key.trim(), value: r.value || null, secret: r.secret };
        });
    return {
      name: name.trim(),
      ...(base ? { originalName: base.name } : {}),
      type,
      command: type === "stdio" ? command.trim() : undefined,
      args: type === "stdio" ? args.split("\n").map((a) => a.trim()).filter(Boolean) : [],
      url: type === "stdio" ? undefined : url.trim(),
      env: type === "stdio" ? rows(env) : [],
      headers: type === "stdio" ? [] : rows(headers),
    };
  };

  const [secrets, setSecrets] = useState<string[]>([]);
  const flow = useSaveFlow({
    title: t(base ? "mcpForm.saveTitle" : "mcpForm.addTitle", { name }),
    preview: async () => {
      const p = await mcpApi.mcpPreview(scope, build(), props.baseHash);
      setSecrets(p.secrets);
      return p;
    },
    save: () => mcpApi.mcpSave(scope, build(), props.baseHash),
    onSaved: () => {
      toast(secrets.length ? t("mcpForm.savedWithSecrets", { name, secrets: secrets.join(", ") }) : t("mcpForm.saved", { name }));
      props.onDone(name);
    },
  });

  const review = () => {
    try {
      build();
      setFormError(null);
      void flow.review();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const actions = (
    <>
      <Button icon={X} variant="quiet" onClick={() => props.onDone(null)}>
        {t("mcpForm.cancel")}
      </Button>
      <Button icon={Eye} variant="primary" onClick={review} disabled={!name.trim()}>
        {t("action.review")}
      </Button>
    </>
  );

  return (
    <article className="card library-detail mcp-form" aria-label={base ? t("mcpForm.edit", { name: base.name }) : t("mcpForm.add")}>
      <header className="lib-head">
        <h2>{base ? t("mcpForm.edit", { name: base.name }) : t("mcpForm.add")}</h2>
        <ScopeTag scope={scope} />
      </header>
      <div className="form-grid">
        <label htmlFor={ids.name}>{t("mcpForm.name")}</label>
        <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="github" spellCheck={false} />
        <label htmlFor={ids.type}>{t("mcpForm.type")}</label>
        <select id={ids.type} value={type} onChange={(e) => setType(e.target.value as McpEntryInput["type"])}>
          <option value="stdio">{t("mcpForm.types.stdio")}</option>
          <option value="http">{t("mcpForm.types.http")}</option>
          <option value="sse">{t("mcpForm.types.sse")}</option>
          <option value="ws">{t("mcpForm.types.ws")}</option>
          {type === "streamable-http" && <option value="streamable-http">{t("mcpForm.types.streamable-http")}</option>}
        </select>
        {type === "stdio" ? (
          <>
            <label htmlFor={ids.command}>{t("mcpForm.command")}</label>
            <input id={ids.command} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" spellCheck={false} />
            <label htmlFor={ids.args}>{t("mcpForm.args")}</label>
            <textarea id={ids.args} value={args} onChange={(e) => setArgs(e.target.value)} rows={3} placeholder={ARGS_EXAMPLE} spellCheck={false} />
            <span className="field-help">{t("mcpForm.argsHelp")}</span>
          </>
        ) : (
          <>
            <label htmlFor={ids.url}>{t("mcpForm.url")}</label>
            <input
              id={ids.url}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={type === "ws" ? "wss://mcp.example.com/socket" : "https://api.example.com/mcp"}
              spellCheck={false}
            />
          </>
        )}
      </div>

      {type === "stdio" ? (
        <ValueRows title={t("mcpForm.env")} rows={env} onChange={setEnv} scope={scope} keyPlaceholder="API_TOKEN" />
      ) : (
        <ValueRows title={t("mcpForm.headers")} rows={headers} onChange={setHeaders} scope={scope} keyPlaceholder="Authorization" />
      )}

      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      {props.actionsSlot ? createPortal(actions, props.actionsSlot) : <div className="perm-actions">{actions}</div>}
      <DiffDialog {...flow.dialog} confirmLabel={base ? t("action.save") : t("mcpForm.confirmAdd")} />
    </article>
  );
}

function ValueRows(props: { title: string; rows: Row[]; onChange: (rows: Row[]) => void; scope: Scope; keyPlaceholder: string }) {
  const { t } = useTranslation("config");
  const update = (i: number, patch: Partial<Row>) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="value-rows">
      <legend>{props.title}</legend>
      {props.scope === "project" && (
        <p className="field-help">
          <Trans t={t} i18nKey="mcpForm.secretHelp" components={{ code: <code /> }} />
        </p>
      )}
      {props.rows.map((r, i) => (
        <div key={i} className="value-row">
          <input aria-label={t("mcpForm.keyLabel")} value={r.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={props.keyPlaceholder} spellCheck={false} disabled={r.existing} />
          <input
            aria-label={t("mcpForm.valueLabel", { key: r.key })}
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={r.existing ? t("mcpForm.keep", { masked: r.masked }) : t("mcpForm.value")}
            type={r.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
          />
          {props.scope === "project" && (
            <label className="secret-toggle">
              <input type="checkbox" checked={r.secret} onChange={(e) => update(i, { secret: e.target.checked })} /> {t("mcpForm.secret")}
            </label>
          )}
          <button type="button" className="rule-remove" aria-label={t("mcpForm.remove", { key: r.key || t("mcpForm.thisRow") })} onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}>
            <Trash weight="bold" />
          </button>
        </div>
      ))}
      <Button icon={Plus} variant="quiet" onClick={() => props.onChange([...props.rows, { key: "", value: "", existing: false, masked: "", secret: true }])}>
        {t("mcpForm.addRow")}
      </Button>
    </fieldset>
  );
}
