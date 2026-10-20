import { CheckCircle, CircleNotch, HourglassMedium, Key, PencilSimple, Plugs, Plus, Trash, Warning, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { McpCheck, McpEntryForm, McpServer, Scope } from "../../api/types";
import { useWorkspace } from "../../app/workspace";
import { Button } from "../../components/Button";
import { toast } from "../../components/Toast";
import { McpForm } from "./McpForm";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError, ScopeTag, SCOPE_LABEL } from "./parts";
import { useConfig } from "./useConfig";

type Editing = { scope: Scope; base: McpEntryForm | null; baseHash: string } | null;

/** MCP servers Claude sees for this repo, from every scope; add, edit, delete and check them. */
export function McpPage() {
  const { data, error, loading, reload } = useConfig(["mcp"], api.mcp);
  const { reloadInventory } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  // The form renders its cancel / save buttons into the toolbar.
  const [actionsSlot, setActionsSlot] = useState<HTMLSpanElement | null>(null);
  const servers = data?.servers ?? [];
  const keyOf = (s: McpServer) => `${s.scope}:${s.name}`;
  const current = servers.find((s) => keyOf(s) === picked) ?? servers[0];

  const refresh = () => {
    void reload();
    void reloadInventory();
  };

  const startAdd = async (scope: Scope) => {
    try {
      const { hash } = await api.mcpAddHash(scope);
      setEditing({ scope, base: null, baseHash: hash });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  const startEdit = async (s: McpServer) => {
    try {
      const form = await api.mcpEntry(s.scope, s.name);
      setEditing({ scope: s.scope, base: form, baseHash: form.hash });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <div className="page">
      <ConfigHeader title="MCP servers" subtitle="Server Claude dùng để gọi công cụ bên ngoài, gộp từ .mcp.json và ~/.claude.json" />
      <ConfigToolbar
        loading={loading}
        onReload={refresh}
        actions={
          editing ? (
            <span ref={setActionsSlot} className="toolbar-slot" />
          ) : (
            <>
              <span className="scope-hint" aria-hidden="true">
                Thêm vào:
              </span>
              <div className="segmented" role="group" aria-label="Thêm server vào">
                {(["project", "local", "user"] as Scope[]).map((s) => (
                  <button key={s} type="button" onClick={() => void startAdd(s)} title={s === "project" ? ".mcp.json (cả team)" : s === "local" ? "Riêng ba, repo này" : "Riêng ba, mọi repo"}>
                    <Plus aria-hidden="true" /> {SCOPE_LABEL[s]}
                  </button>
                ))}
              </div>
            </>
          )
        }
      />
      <LoadError error={error} />
      <div className="page-body">
        {data?.sources
          .filter((s) => s.error)
          .map((s) => (
            <p key={s.scope} className="error config-error" role="alert">
              {s.path}: {s.error}
            </p>
          ))}
        {editing ? (
          <McpForm
            scope={editing.scope}
            base={editing.base}
            baseHash={editing.baseHash}
            actionsSlot={actionsSlot}
            onDone={(name) => {
              if (name) setPicked(`${editing.scope}:${name}`);
              setEditing(null);
              refresh();
            }}
          />
        ) : data && servers.length === 0 ? (
          <EmptyCard title="Chưa có MCP server">Thêm server cho cả team (Project, lưu vào .mcp.json) hoặc riêng cho ba (Local/User).</EmptyCard>
        ) : (
          <div className="library">
            <ul className="mcp-list" aria-label="Danh sách server">
              {servers.map((s) => (
                <li key={keyOf(s)}>
                  <button
                    type="button"
                    className="mcp-item"
                    aria-current={current && keyOf(current) === keyOf(s) ? "true" : undefined}
                    onClick={() => setPicked(keyOf(s))}
                  >
                    <span className={`mcp-dot${s.error || s.missingEnv.length ? " is-warn" : ""}`} aria-hidden="true" />
                    <span className="mcp-text">
                      <span className="mono mcp-name">{s.name}</span>
                      <span className="mcp-meta">
                        {s.error ? "lỗi cấu hình" : s.type}
                        {s.missingEnv.length > 0 && ` · thiếu ${s.missingEnv.join(", ")}`}
                      </span>
                    </span>
                    <ScopeTag scope={s.scope} />
                  </button>
                </li>
              ))}
            </ul>
            {current && (
              <McpDetail
                key={keyOf(current)}
                server={current}
                source={data?.sources.find((x) => x.scope === current.scope)?.path ?? ""}
                onEdit={() => void startEdit(current)}
                onChanged={refresh}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const CHECK_ICON: Record<McpCheck["status"], typeof CheckCircle> = {
  connected: CheckCircle,
  failed: XCircle,
  pending: HourglassMedium,
  auth: Key,
  unknown: Warning,
};

const CHECK_HINT: Partial<Record<McpCheck["status"], string>> = {
  pending: "Server trong .mcp.json cần được duyệt: mở claude trong repo này và đồng ý dùng server.",
  auth: "Server cần đăng nhập: chạy claude mcp login hoặc /mcp trong claude.",
  failed: "Claude không kết nối được. Kiểm tra lệnh, URL và biến môi trường.",
};

function McpDetail({ server, source, onEdit, onChanged }: { server: McpServer; source: string; onEdit: () => void; onChanged: () => void }) {
  const [check, setCheck] = useState<McpCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await api.mcpCheck(server.name));
    } catch (e) {
      setCheck({ status: "unknown", label: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const { hash } = await api.mcpEntry(server.scope, server.name);
      await api.mcpDelete(server.scope, server.name, hash);
      toast(`Đã xoá ${server.name}. Có thể khôi phục trong Lịch sử thay đổi.`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const CheckIcon = check ? CHECK_ICON[check.status] : null;

  return (
    <article className="card library-detail" aria-labelledby="mcp-title">
      <header className="lib-head">
        <h2 id="mcp-title" className="mono">
          {server.name}
        </h2>
        <ScopeTag scope={server.scope} />
        <span className="pill">{server.type}</span>
        <div className="lib-actions">
          <Button icon={Plugs} busy={checking} onClick={() => void runCheck()}>
            Kiểm tra kết nối
          </Button>
          <Button icon={PencilSimple} onClick={onEdit}>
            Sửa
          </Button>
          {confirmDelete ? (
            <Button icon={Trash} variant="danger" busy={deleting} onClick={() => void remove()}>
              Xác nhận xoá
            </Button>
          ) : (
            <Button icon={Trash} variant="quiet" onClick={() => setConfirmDelete(true)}>
              Xoá
            </Button>
          )}
        </div>
      </header>
      <p className="mono lib-path">{source}</p>

      {checking && (
        <p className="check-result" role="status">
          <CircleNotch className="spin" aria-hidden="true" /> Đang hỏi claude…
        </p>
      )}
      {check && CheckIcon && !checking && (
        <div className={`check-result is-${check.status}`} role="status">
          <CheckIcon weight="fill" aria-hidden="true" />
          <span>
            <strong>{check.label}</strong>
            {CHECK_HINT[check.status] && <span className="check-hint">{CHECK_HINT[check.status]}</span>}
          </span>
        </div>
      )}

      {server.error && (
        <p className="error" role="alert">
          {server.error}
        </p>
      )}
      {server.missingEnv.map((v) => (
        <MissingVar key={v} name={v} onSaved={onChanged} />
      ))}
      {server.fromTaskPilot.length > 0 && (
        <p className="hint">
          TaskPilot cung cấp <code>{server.fromTaskPilot.join(", ")}</code> cho các session nó mở (kho env riêng, không commit).
        </p>
      )}

      <dl className="fields">
        {server.command && (
          <div>
            <dt>Lệnh</dt>
            <dd className="mono">{server.command}</dd>
          </div>
        )}
        {server.args.length > 0 && (
          <div>
            <dt>Tham số</dt>
            <dd className="chips">
              {server.args.map((a, i) => (
                <code key={i} className="chip">
                  {a}
                </code>
              ))}
            </dd>
          </div>
        )}
        {server.url && (
          <div>
            <dt>URL</dt>
            <dd className="mono">{server.url}</dd>
          </div>
        )}
      </dl>
      <Values title="Biến môi trường" values={server.env} missing={server.missingEnv} />
      <Values title="Headers" values={server.headers} missing={server.missingEnv} />
    </article>
  );
}

/** A ${VAR} nobody sets: let the user give TaskPilot's sessions a value for it. */
function MissingVar({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="alert-warn missing-var"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api.envSet(name, value);
          toast(`Đã lưu ${name} cho các session TaskPilot mở.`);
          setValue("");
          onSaved();
        } catch (err) {
          toast((err as Error).message, { error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Warning weight="fill" aria-hidden="true" />
      <div className="missing-body">
        <label htmlFor={`env-${name}`}>
          Biến <code>{name}</code> chưa được đặt, nên server có thể không khởi động. Đặt giá trị cho các session TaskPilot mở:
        </label>
        <div className="missing-row">
          <input id={`env-${name}`} type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" placeholder="giá trị" />
          <Button type="submit" busy={busy} disabled={!value}>
            Lưu
          </Button>
        </div>
      </div>
    </form>
  );
}

function Values({ title, values, missing }: { title: string; values: McpServer["env"]; missing: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="env-table">
      <div className="pane-label">{title}</div>
      {values.map((v) => {
        const unset = v.reference && missing.some((m) => v.value.includes(m));
        return (
          <div key={v.key} className="env-row">
            <span className="mono">{v.key}</span>
            <span className={`mono env-value${v.reference ? " is-ref" : ""}${unset ? " is-unset" : ""}`}>
              {v.value}
              {unset && " (chưa đặt)"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
