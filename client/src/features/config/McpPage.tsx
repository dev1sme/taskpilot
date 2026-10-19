import { Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { McpServer } from "../../api/types";
import { ConfigHeader, EmptyCard, LoadError, ScopeTag } from "./parts";
import { useConfig } from "./useConfig";

/** MCP servers Claude sees for this repo, from every scope. Secret values come masked from the server. */
export function McpPage() {
  const { data, error, loading, reload } = useConfig(api.mcp);
  const [picked, setPicked] = useState<string | null>(null);
  const servers = data?.servers ?? [];
  const keyOf = (s: McpServer) => `${s.scope}:${s.name}`;
  const current = servers.find((s) => keyOf(s) === picked) ?? servers[0];

  return (
    <div className="page">
      <ConfigHeader
        title="MCP servers"
        subtitle="Server Claude dùng để gọi công cụ bên ngoài, gộp từ .mcp.json và ~/.claude.json"
        loading={loading}
        onReload={() => void reload()}
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
        {data && servers.length === 0 ? (
          <EmptyCard title="Chưa có MCP server">
            Khai báo server cho cả team trong .mcp.json ở gốc repo, hoặc riêng cho ba bằng lệnh claude mcp add.
          </EmptyCard>
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
                    <span className={`mcp-dot${s.missingEnv.length ? " is-warn" : ""}`} aria-hidden="true" />
                    <span className="mcp-text">
                      <span className="mono mcp-name">{s.name}</span>
                      <span className="mcp-meta">
                        {s.type}
                        {s.missingEnv.length > 0 && ` · thiếu ${s.missingEnv.join(", ")}`}
                      </span>
                    </span>
                    <ScopeTag scope={s.scope} />
                  </button>
                </li>
              ))}
            </ul>
            {current && <McpDetail server={current} source={data?.sources.find((x) => x.scope === current.scope)?.path ?? ""} />}
          </div>
        )}
      </div>
    </div>
  );
}

function McpDetail({ server, source }: { server: McpServer; source: string }) {
  return (
    <article className="card library-detail" aria-labelledby="mcp-title">
      <header className="lib-head">
        <h2 id="mcp-title" className="mono">
          {server.name}
        </h2>
        <ScopeTag scope={server.scope} />
        <span className="pill">{server.type}</span>
      </header>
      <p className="mono lib-path">{source}</p>
      {server.missingEnv.length > 0 && (
        <p className="alert-warn" role="alert">
          <Warning weight="fill" aria-hidden="true" />
          <span>
            Biến môi trường <code>{server.missingEnv.join(", ")}</code> chưa được đặt, nên server có thể không khởi động được.
          </span>
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
      <p className="hint">Kiểm tra kết nối và sửa cấu hình có ở giai đoạn C. Giá trị secret luôn bị che.</p>
    </article>
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
