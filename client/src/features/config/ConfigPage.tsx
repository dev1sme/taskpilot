import { useWorkspace } from "../../app/workspace";
import type { ConfigSection } from "../../app/router";
import type { Inventory } from "../../api/types";
import { PageHeader } from "../shell/PageHeader";
import "./config.css";

const SECTIONS: Record<ConfigSection, { title: string; file: string; what: string; count: (i: Inventory) => string }> = {
  memory: {
    title: "CLAUDE.md",
    file: "CLAUDE.md, CLAUDE.local.md",
    what: "Đọc và sửa hướng dẫn Claude nạp mỗi session, kèm mục lục, ước tính token, kiểm tra @import và xem diff trước khi lưu.",
    count: (i) => (i.claudeMd.exists ? `${i.claudeMd.lines} dòng, ${i.claudeMd.headings.length} mục` : "Chưa có file"),
  },
  settings: {
    title: "Settings & quyền",
    file: ".claude/settings.json, settings.local.json",
    what: "Danh sách lệnh và công cụ Claude được phép hoặc bị chặn, theo từng file settings.",
    count: (i) => `${i.claudeDir.allow} cho phép · ${i.claudeDir.deny} bị chặn`,
  },
  hooks: {
    title: "Hooks",
    file: ".claude/settings.json → hooks",
    what: "Các lệnh tự chạy theo sự kiện của Claude (trước/sau khi dùng công cụ, khi kết thúc lượt…).",
    count: (i) => `${i.claudeDir.hooks} hook`,
  },
  agents: {
    title: "Agents",
    file: ".claude/agents/*.md",
    what: "Subagent của repo: mô tả, công cụ được dùng, model và prompt hệ thống.",
    count: (i) => `${i.claudeDir.agents} agent`,
  },
  commands: {
    title: "Commands",
    file: ".claude/commands/**/*.md",
    what: "Slash command riêng của repo và nội dung prompt của chúng.",
    count: (i) => `${i.claudeDir.commands} command`,
  },
  skills: {
    title: "Skills",
    file: ".claude/skills/*/SKILL.md",
    what: "Skill của repo: mô tả, khi nào Claude dùng, và các file đi kèm.",
    count: (i) => `${i.claudeDir.skills} skill`,
  },
  mcp: {
    title: "MCP servers",
    file: ".mcp.json",
    what: "Server MCP của repo: kiểu, lệnh, biến môi trường, trạng thái kết nối; sửa có xem diff, secret lưu riêng vào settings.local.json.",
    count: (i) => (i.mcp.exists ? `${i.mcp.servers.length} server` : "Chưa có .mcp.json"),
  },
};

/** Placeholder for the configuration pages until they are built (phases B and C). */
export function ConfigPage({ section }: { section: ConfigSection }) {
  const { inventory } = useWorkspace();
  const s = SECTIONS[section];

  return (
    <div className="page">
      <PageHeader title={s.title} subtitle={<span className="mono">{s.file}</span>} />
      <div className="page-body">
        <section className="coming" aria-labelledby="coming-title">
          <span className="coming-badge">Giai đoạn B</span>
          <h2 id="coming-title">Trang này đang được xây</h2>
          <p>{s.what}</p>
          {inventory && (
            <p className="coming-now">
              Hiện trong repo: <strong>{s.count(inventory)}</strong>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
