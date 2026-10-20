import { Eye, Plus, Trash, X } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import type { McpEntryForm, McpEntryInput, Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { toast } from "../../components/Toast";
import { ScopeTag } from "./parts";
import { useSaveFlow } from "./useSaveFlow";

interface Row {
  key: string;
  value: string;
  /** Already configured: an empty value means "keep it". */
  existing: boolean;
  masked: string;
  secret: boolean;
}

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
          if (!r.value && !r.existing) throw new Error(`${r.key}: cần giá trị`);
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
    title: `${base ? "Lưu" : "Thêm"} MCP server ${name || ""}`,
    preview: async () => {
      const p = await api.mcpPreview(scope, build(), props.baseHash);
      setSecrets(p.secrets);
      return p;
    },
    save: () => api.mcpSave(scope, build(), props.baseHash),
    onSaved: () => {
      toast(`Đã lưu ${name}${secrets.length ? `; ${secrets.join(", ")} lưu trong kho env của TaskPilot` : ""}.`);
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
        Huỷ
      </Button>
      <Button icon={Eye} variant="primary" onClick={review} disabled={!name.trim()}>
        Xem thay đổi &amp; lưu
      </Button>
    </>
  );

  return (
    <article className="card library-detail mcp-form" aria-label={base ? `Sửa ${base.name}` : "Thêm MCP server"}>
      <header className="lib-head">
        <h2>{base ? `Sửa ${base.name}` : "Thêm MCP server"}</h2>
        <ScopeTag scope={scope} />
      </header>
      <div className="form-grid">
        <label htmlFor={ids.name}>Tên</label>
        <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="github" spellCheck={false} />
        <label htmlFor={ids.type}>Kiểu</label>
        <select id={ids.type} value={type} onChange={(e) => setType(e.target.value as McpEntryInput["type"])}>
          <option value="stdio">stdio · chạy một lệnh trên máy</option>
          <option value="http">http · server từ xa</option>
          <option value="sse">sse · server từ xa (cũ)</option>
          <option value="ws">ws · server từ xa qua WebSocket</option>
          {type === "streamable-http" && <option value="streamable-http">streamable-http · tên khác của http</option>}
        </select>
        {type === "stdio" ? (
          <>
            <label htmlFor={ids.command}>Lệnh</label>
            <input id={ids.command} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" spellCheck={false} />
            <label htmlFor={ids.args}>Tham số</label>
            <textarea id={ids.args} value={args} onChange={(e) => setArgs(e.target.value)} rows={3} placeholder={"-y\n@modelcontextprotocol/server-github"} spellCheck={false} />
            <span className="field-help">Mỗi dòng một tham số. Mật khẩu trong URL đã bị che; giữ nguyên dòng đó thì giá trị cũ được giữ.</span>
          </>
        ) : (
          <>
            <label htmlFor={ids.url}>URL</label>
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
        <ValueRows title="Biến môi trường" rows={env} onChange={setEnv} scope={scope} keyPlaceholder="API_TOKEN" />
      ) : (
        <ValueRows title="Headers" rows={headers} onChange={setHeaders} scope={scope} keyPlaceholder="Authorization" />
      )}

      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      {props.actionsSlot ? createPortal(actions, props.actionsSlot) : <div className="perm-actions">{actions}</div>}
      <DiffDialog {...flow.dialog} confirmLabel={base ? "Lưu" : "Thêm server"} />
    </article>
  );
}

function ValueRows(props: { title: string; rows: Row[]; onChange: (rows: Row[]) => void; scope: Scope; keyPlaceholder: string }) {
  const update = (i: number, patch: Partial<Row>) => props.onChange(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="value-rows">
      <legend>{props.title}</legend>
      {props.scope === "project" && (
        <p className="field-help">
          Giá trị đánh dấu "bí mật" không ghi vào .mcp.json (file được commit): TaskPilot ghi <code>{"${TÊN}"}</code> và giữ giá trị trong kho
          env riêng, đưa vào các session nó mở.
        </p>
      )}
      {props.rows.map((r, i) => (
        <div key={i} className="value-row">
          <input aria-label="Tên" value={r.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={props.keyPlaceholder} spellCheck={false} disabled={r.existing} />
          <input
            aria-label={`Giá trị ${r.key}`}
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={r.existing ? `giữ nguyên (${r.masked})` : "giá trị"}
            type={r.secret ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
          />
          {props.scope === "project" && (
            <label className="secret-toggle">
              <input type="checkbox" checked={r.secret} onChange={(e) => update(i, { secret: e.target.checked })} /> bí mật
            </label>
          )}
          <button type="button" className="rule-remove" aria-label={`Bỏ ${r.key || "dòng này"}`} onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}>
            <Trash weight="bold" />
          </button>
        </div>
      ))}
      <Button icon={Plus} variant="quiet" onClick={() => props.onChange([...props.rows, { key: "", value: "", existing: false, masked: "", secret: true }])}>
        Thêm dòng
      </Button>
    </fieldset>
  );
}
