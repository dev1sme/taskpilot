import { MagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import type { LibraryItem, LibraryKind } from "../../api/types";
import { Markdown } from "../../components/Markdown";
import { ConfigHeader, EmptyCard, LoadError, ScopeTag } from "./parts";
import { useConfig } from "./useConfig";

const COPY: Record<LibraryKind, { title: string; subtitle: string; empty: string; prefix: string }> = {
  agents: {
    title: "Agents",
    subtitle: "Subagent Claude có thể giao việc: .claude/agents và ~/.claude/agents",
    empty: "Chưa có agent. Mỗi agent là một file .md có frontmatter name, description, tools trong .claude/agents/.",
    prefix: "",
  },
  commands: {
    title: "Commands",
    subtitle: "Slash command riêng: .claude/commands và ~/.claude/commands",
    empty: "Chưa có command. Mỗi file .md trong .claude/commands/ là một lệnh /tên-file.",
    prefix: "/",
  },
  skills: {
    title: "Skills",
    subtitle: "Skill Claude tự dùng khi phù hợp: .claude/skills và ~/.claude/skills",
    empty: "Chưa có skill. Mỗi skill là một thư mục có SKILL.md trong .claude/skills/.",
    prefix: "",
  },
};

/** Agents, commands or skills: searchable list on the left, the selected item on the right. */
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { data, error, loading, reload } = useConfig(() => api.library(kind));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const copy = COPY[kind];

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((i) => !q || `${i.name} ${i.description}`.toLowerCase().includes(q));
  }, [data, query]);
  const keyOf = (i: LibraryItem) => `${i.scope}:${i.path}`;
  const current = items.find((i) => keyOf(i) === picked) ?? items[0];

  return (
    <div className="page">
      <ConfigHeader title={copy.title} subtitle={copy.subtitle} loading={loading} onReload={() => void reload()} />
      <LoadError error={error} />
      <div className="page-body">
        {data && data.length === 0 ? (
          <EmptyCard title={`Chưa có ${copy.title.toLowerCase()}`}>{copy.empty}</EmptyCard>
        ) : (
          <div className="library">
            <div className="library-list">
              <label className="filter">
                <MagnifyingGlass aria-hidden="true" />
                <span className="sr-only">Lọc</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Lọc ${copy.title.toLowerCase()}`} />
              </label>
              <ul>
                {items.map((i) => (
                  <li key={keyOf(i)}>
                    <button
                      type="button"
                      className="lib-item"
                      aria-current={current && keyOf(current) === keyOf(i) ? "true" : undefined}
                      onClick={() => setPicked(keyOf(i))}
                    >
                      <span className="lib-name mono">
                        {copy.prefix}
                        {i.name}
                      </span>
                      <ScopeTag scope={i.scope} />
                      {i.description && <span className="lib-desc">{i.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {current && <LibraryDetail item={current} prefix={copy.prefix} />}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryDetail({ item, prefix }: { item: LibraryItem; prefix: string }) {
  return (
    <article className="card library-detail" aria-labelledby="lib-title">
      <header className="lib-head">
        <h2 id="lib-title" className="mono">
          {prefix}
          {item.name}
        </h2>
        <ScopeTag scope={item.scope} />
      </header>
      <p className="mono lib-path">{item.path}</p>
      {item.error && (
        <p className="error" role="alert">
          {item.error}
        </p>
      )}
      {item.description && <p className="lib-description">{item.description}</p>}
      {item.fields.length > 0 && (
        <dl className="fields">
          {item.fields.map((f) => (
            <div key={f.key}>
              <dt>{f.key}</dt>
              <dd className="mono">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.files && item.files.length > 0 && (
        <div>
          <div className="pane-label">File đi kèm</div>
          <ul className="file-list">
            {item.files.map((f) => (
              <li key={f} className="mono">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lib-body">
        <div className="pane-label">Nội dung</div>
        <Markdown source={item.body} />
      </div>
    </article>
  );
}
