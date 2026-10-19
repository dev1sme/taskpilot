"use strict";

/* ======================================================================
   Claude Task Board – giao diện
   ====================================================================== */

const COLUMNS = [
  { id: "backlog", title: "Backlog", color: "var(--s-backlog)", hint: "chưa bắt đầu" },
  { id: "INVESTIGATING", title: "Điều tra", color: "var(--s-invest)" },
  { id: "PLAN_REVIEW", title: "Chờ duyệt plan", color: "var(--s-review)", review: true },
  { id: "IMPLEMENTING", title: "Đang code", color: "var(--s-impl)" },
  { id: "ATTENTION", title: "Cần xem lại", color: "var(--s-fail)" },
  { id: "DONE", title: "Xong", color: "var(--s-done)" },
];

const STAGE_TEXT = {
  INVESTIGATING: "Điều tra & lên kế hoạch",
  PLAN_REVIEW: "Chờ duyệt kế hoạch",
  IMPLEMENTING: "Đang implement",
  DONE: "Đã xong",
  FAILED: "Lỗi",
  STOPPED: "Đã dừng",
};
const STAGE_COLOR = {
  INVESTIGATING: "var(--s-invest)", PLAN_REVIEW: "var(--s-review)", IMPLEMENTING: "var(--s-impl)",
  DONE: "var(--s-done)", FAILED: "var(--s-fail)", STOPPED: "var(--s-fail)",
};

const state = {
  config: {},
  issues: [],
  tasks: new Map(),
  selected: null,
  tab: "log",
  log: [],
  docs: { files: [], dir: "", current: null },
  issuesError: null,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------- API */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

async function act(key, action, body) {
  try {
    const t = await api(`/api/tasks/${encodeURIComponent(key)}/${action}`, { method: "POST", body: body || {} });
    upsert(t);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

/* ---------------------------------------------------------------- load */

async function loadAll() {
  state.config = await api("/api/config");
  renderTop();
  (await api("/api/tasks")).forEach((t) => state.tasks.set(t.issueKey, t));
  await loadIssues();
}

async function loadIssues() {
  try {
    state.issues = await api("/api/issues");
    state.issuesError = null;
  } catch (e) {
    state.issuesError = "Không tải được danh sách task từ Backlog: " + e.message;
  }
  renderBanner();
  renderBoard();
}

function upsert(t) {
  state.tasks.set(t.issueKey, t);
  renderBoard();
  if (state.selected === t.issueKey) renderDrawer();
}

/* ---------------------------------------------------------------- realtime */

function connect() {
  const es = new EventSource("/api/events");
  es.addEventListener("hello", () => $("#conn").classList.add("ok"));
  es.onerror = () => $("#conn").classList.remove("ok");
  es.addEventListener("task", (e) => upsert(JSON.parse(e.data)));
  es.addEventListener("removed", (e) => {
    const { key } = JSON.parse(e.data);
    state.tasks.delete(key);
    if (state.selected === key) closeDrawer();
    renderBoard();
  });
  es.addEventListener("log", (e) => {
    const { key, line } = JSON.parse(e.data);
    if (key !== state.selected) return;
    state.log.push(line);
    appendLog(line);
  });
  es.addEventListener("files", (e) => {
    const { key } = JSON.parse(e.data);
    if (key === state.selected && state.tab === "docs") loadDocs(true);
  });
}

/* ---------------------------------------------------------------- top bar */

function renderTop() {
  const c = state.config;
  $("#project").textContent = c.projectKey ? `Project ${c.projectKey}` : "";
  const modes = [];
  if (c.demo) modes.push(`<span class="mode warn" title="Chưa cấu hình base-url / api-key của Backlog">Backlog demo</span>`);
  if (c.simulate) modes.push(`<span class="mode warn" title="board.claude.simulate=true">Claude giả lập</span>`);
  if (c.model) modes.push(`<span class="mode">Model ${esc(c.model)}</span>`);
  $("#modes").innerHTML = modes.join("");
  renderBanner();
}

function renderBanner() {
  const msgs = [];
  if (state.config.repoError) msgs.push(state.config.repoError);
  if (state.issuesError) msgs.push(state.issuesError);
  const b = $("#banner");
  b.hidden = msgs.length === 0;
  b.innerHTML = msgs.map(esc).join("<br>");
}

/* ---------------------------------------------------------------- board */

function columnOf(t) {
  if (t.stage === "FAILED" || t.stage === "STOPPED") return "ATTENTION";
  return t.stage;
}

function renderBoard() {
  const started = new Set(state.tasks.keys());
  const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  state.issues.filter((i) => !started.has(i.key)).forEach((i) => groups.backlog.push({ issue: i }));
  state.tasks.forEach((t) => groups[columnOf(t)]?.push({ task: t }));

  const waiting = groups.PLAN_REVIEW.filter((x) => !busy(x.task)).length + groups.ATTENTION.length;
  const w = $("#waiting");
  w.hidden = waiting === 0;
  w.textContent = `${waiting} việc đang chờ bạn`;

  $("#board").innerHTML = COLUMNS.map((c) => {
    const items = groups[c.id];
    const body = items.length
      ? items.map((x) => (x.issue ? issueCard(x.issue) : taskCard(x.task))).join("")
      : `<div class="empty">${emptyText(c.id)}</div>`;
    return `<section class="col ${c.review ? "review" : ""}" style="--c:${c.color}">
      <div class="col-head"><h3>${c.title}</h3><span class="count">${items.length}</span>
        ${c.hint ? `<span class="hint">${c.hint}</span>` : ""}</div>
      <div class="col-body">${body}</div></section>`;
  }).join("");
  tickTimers();
}

function emptyText(id) {
  return {
    backlog: state.issuesError ? "Chưa tải được Backlog." : "Không còn task mở nào.",
    INVESTIGATING: "Bấm Bắt đầu ở một task Backlog.",
    PLAN_REVIEW: "Chưa có kế hoạch nào chờ duyệt.",
    IMPLEMENTING: "Chưa có task nào đang code.",
    ATTENTION: "Không có task lỗi.",
    DONE: "Chưa có task hoàn thành.",
  }[id];
}

function issueCard(i) {
  const meta = [i.issueType, i.priority && `Ưu tiên ${i.priority}`, i.status].filter(Boolean);
  return `<div class="card" style="--c:var(--s-backlog)">
    <div class="key">${esc(i.key)}</div>
    <div class="title">${esc(i.summary)}</div>
    <div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
    <div class="row"><span class="spacer"></span>
      <button class="btn small" data-start="${esc(i.key)}" type="button">Bắt đầu</button></div>
  </div>`;
}

function busy(t) { return t && (t.running || t.queued); }

function taskCard(t) {
  const color = STAGE_COLOR[t.stage];
  const status = t.running
    ? `<span class="pulse" style="--c:${color}">Claude đang chạy</span>`
    : t.queued ? `<span class="pulse queued">Chờ lượt</span>` : "";
  const meta = [];
  if (t.running && t.runStartedAt) meta.push(`<span data-since="${esc(t.runStartedAt)}"></span>`);
  if (t.costUsd > 0) meta.push(`<span>~$${t.costUsd.toFixed(2)}</span>`);
  if (t.stage === "FAILED") meta.push(`<span style="color:var(--s-fail)">Lỗi</span>`);
  if (t.stage === "STOPPED") meta.push(`<span>Đã dừng</span>`);
  return `<button type="button" class="card ${t.running ? "running" : ""} ${state.selected === t.issueKey ? "selected" : ""}"
      style="--c:${color}" data-open="${esc(t.issueKey)}">
    <div class="key">${esc(t.issueKey)}</div>
    <div class="title">${esc(t.summary)}</div>
    ${status || meta.length ? `<div class="meta">${status}${meta.join("")}</div>` : ""}
    ${t.lastActivity ? `<div class="activity" title="${esc(t.lastActivity)}">${esc(t.lastActivity)}</div>` : ""}
  </button>`;
}

function tickTimers() {
  document.querySelectorAll("[data-since]").forEach((el) => {
    el.textContent = duration(Date.now() - Date.parse(el.dataset.since));
  });
}

function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút ${s % 60} giây`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

/* ---------------------------------------------------------------- drawer */

async function openDrawer(key) {
  state.selected = key;
  state.log = [];
  state.docs = { files: [], dir: "", current: null };
  const t = state.tasks.get(key);
  state.tab = t && t.stage === "PLAN_REVIEW" && !busy(t) ? "docs" : "log";
  $("#drawer").hidden = false;
  renderBoard();
  renderDrawer();
  selectTab(state.tab);
  try {
    state.log = await api(`/api/tasks/${encodeURIComponent(key)}/log`);
  } catch { state.log = []; }
  renderLog();
}

function closeDrawer() {
  state.selected = null;
  $("#drawer").hidden = true;
  renderBoard();
}

function renderDrawer() {
  const t = state.tasks.get(state.selected);
  if (!t) return;
  const color = STAGE_COLOR[t.stage];
  $("#drawer").style.setProperty("--c", color);
  $(".drawer-head").style.setProperty("--c", color);
  const key = $("#d-key");
  key.textContent = t.issueKey;
  if (t.url) key.href = t.url; else key.removeAttribute("href");
  $("#d-summary").textContent = t.summary;
  const parts = [`<strong>${STAGE_TEXT[t.stage] || t.stage}</strong>`];
  if (t.running) parts.push("Claude đang chạy");
  if (t.queued) parts.push("đang chờ lượt");
  if (t.costUsd > 0) parts.push(`chi phí ước tính ~$${t.costUsd.toFixed(2)}`);
  $("#d-stage").innerHTML = parts.join(", ");
  renderActions(t);
  $("#task-view").innerHTML = md(`# ${t.issueKey}: ${t.summary}\n\n${t.description || "(không có mô tả)"}`);
}

function renderActions(t) {
  const box = $("#d-actions");
  // Không vẽ lại khi người dùng đang gõ trong ô nhập của chính task này.
  if (box.dataset.key === t.issueKey && box.dataset.sig === actionSig(t) && box.contains(document.activeElement)) return;
  box.dataset.key = t.issueKey;
  box.dataset.sig = actionSig(t);

  const k = esc(t.issueKey);
  if (busy(t)) {
    box.innerHTML = `
      <p class="note">${esc(t.lastActivity || "")}</p>
      <div class="buttons"><button class="btn danger" data-act="stop" data-key="${k}" type="button">Dừng Claude</button></div>`;
    return;
  }

  let html = "";
  if (t.stage === "PLAN_REVIEW") {
    html += `<p class="callout review">Đọc kế hoạch ở tab Tài liệu (02-plan.md). Duyệt để Claude bắt đầu code, hoặc ghi góp ý để Claude sửa kế hoạch.</p>
      <textarea id="a-text" placeholder="Góp ý cho kế hoạch, hoặc ghi chú khi duyệt (không bắt buộc)"></textarea>
      <div class="buttons">
        <button class="btn review" data-act="approve" data-key="${k}" type="button">Duyệt và bắt đầu code</button>
        <button class="btn ghost" data-act="revise" data-key="${k}" type="button">Yêu cầu sửa kế hoạch</button>
      </div>`;
  }
  if (t.stage === "FAILED" || t.stage === "STOPPED") {
    const msg = t.stage === "FAILED" ? `Lượt chạy gặp lỗi: ${t.lastResult || t.lastActivity || ""}` : "Đã dừng giữa chừng.";
    html += `<p class="callout fail">${esc(truncate(msg, 400))}</p>`;
  }
  if (t.denials && t.denials.length) {
    html += `<div class="denials"><p class="note">Claude bị từ chối quyền ở lượt vừa rồi. Tích để cấp thêm quyền cho riêng task này rồi bấm Chạy lại hoặc Gửi tin nhắn.</p>
      ${t.denials.map((d, i) => `<label class="denial"><input type="checkbox" data-deny="${i}">
        <code>${esc(truncate(d, 80))}</code><input type="text" data-rule="${i}" value="${esc(suggestRule(d))}" aria-label="Quy tắc quyền"></label>`).join("")}</div>`;
  }
  if (t.stage === "FAILED" || t.stage === "STOPPED") {
    html += `<div class="buttons"><button class="btn" data-act="retry" data-key="${k}" type="button">Chạy lại</button>
      <button class="btn ghost" data-act="done" data-key="${k}" type="button">Đánh dấu đã xong</button></div>`;
  }
  if (t.sessionId && t.stage !== "PLAN_REVIEW") {
    html += `<textarea id="a-msg" placeholder="Nhắn thêm cho Claude trong cùng phiên, ví dụ: sửa lại tên hàm theo convention của module…"></textarea>
      <div class="buttons"><button class="btn ghost" data-act="followup" data-key="${k}" type="button">Gửi tin nhắn</button>
      ${t.stage === "DONE" ? `<button class="btn ghost" data-act="start" data-key="${k}" type="button">Làm lại từ đầu</button>` : ""}
      <span style="flex:1"></span>
      <button class="btn danger small" data-act="delete" data-key="${k}" type="button">Xoá khỏi bảng</button></div>`;
  }
  box.innerHTML = html;
}

function actionSig(t) {
  return [t.stage, t.running, t.queued, (t.denials || []).length, !!t.sessionId].join("|");
}

/* Gợi ý quy tắc quyền từ mô tả thao tác bị từ chối, ví dụ "Bash: npm test --x" -> "Bash(npm test *)" */
function suggestRule(d) {
  const m = /^(\w+)(?::\s*(.*))?$/.exec(d);
  if (!m) return d;
  const [, tool, detail] = m;
  if (tool === "Bash" && detail) {
    const words = detail.trim().split(/\s+/).slice(0, 2).join(" ");
    return `Bash(${words} *)`;
  }
  if ((tool === "Edit" || tool === "Write") && detail) return `Edit(${detail})`;
  if (tool === "WebFetch" && detail) {
    try { return `WebFetch(domain:${new URL(detail).hostname})`; } catch { return "WebFetch"; }
  }
  return tool;
}

function chosenTools() {
  return [...document.querySelectorAll("[data-deny]")]
    .filter((c) => c.checked)
    .map((c) => document.querySelector(`[data-rule="${c.dataset.deny}"]`).value.trim())
    .filter(Boolean);
}

async function onAction(btn) {
  const key = btn.dataset.key;
  const a = btn.dataset.act;
  const text = $("#a-text")?.value.trim() || "";
  const msg = $("#a-msg")?.value.trim() || "";
  if (a === "revise" && !text) return toast("Hãy ghi góp ý cho kế hoạch trước.", true);
  if (a === "followup" && !msg) return toast("Hãy nhập nội dung tin nhắn.", true);
  if (a === "delete") {
    if (!confirm(`Xoá ${key} khỏi bảng? Tài liệu .md trong repo vẫn được giữ.`)) return;
    try {
      await api(`/api/tasks/${encodeURIComponent(key)}`, { method: "DELETE" });
      state.tasks.delete(key);
      closeDrawer();
      await loadIssues();
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (a === "start" && !confirm(`Bắt đầu lại ${key} từ bước điều tra với một phiên Claude mới?`)) return;
  btn.disabled = true;
  const body = {
    approve: { text },
    revise: { text },
    followup: { text: msg, tools: chosenTools() },
    retry: { tools: chosenTools() },
  }[a] || {};
  const ok = await act(key, a, body);
  btn.disabled = false;
  if (ok) {
    toast({ approve: "Đã duyệt, Claude bắt đầu code", revise: "Đã gửi góp ý, Claude đang sửa kế hoạch",
      followup: "Đã gửi tin nhắn", retry: "Đã chạy lại", stop: "Đang dừng Claude", done: "Đã đánh dấu xong",
      start: "Đã bắt đầu lại" }[a] || "Đã gửi");
    if (["approve", "revise", "followup", "retry", "start"].includes(a)) selectTab("log");
  }
}

/* ---------------------------------------------------------------- tabs */

function selectTab(name) {
  state.tab = name;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("#tab-log").hidden = name !== "log";
  $("#tab-docs").hidden = name !== "docs";
  $("#tab-task").hidden = name !== "task";
  if (name === "docs") loadDocs(false);
}

function renderLog() {
  const el = $("#tab-log");
  el.innerHTML = state.log.length ? "" : `<p class="empty">Chưa có hoạt động nào.</p>`;
  state.log.forEach((l) => el.appendChild(logEntry(l)));
  el.scrollTop = el.scrollHeight;
}

function appendLog(line) {
  const el = $("#tab-log");
  el.querySelector(".empty")?.remove();
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.appendChild(logEntry(line));
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function logEntry(l) {
  const d = document.createElement("div");
  d.className = `entry ${l.kind}`;
  const t = new Date(l.ts);
  const hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0"), ss = String(t.getSeconds()).padStart(2, "0");
  d.innerHTML = `<time>${hh}:${mm}:${ss}</time><div class="body"></div>`;
  d.querySelector(".body").textContent = l.text;
  return d;
}

async function loadDocs(keepCurrent) {
  const key = state.selected;
  if (!key) return;
  try {
    const r = await api(`/api/tasks/${encodeURIComponent(key)}/files`);
    if (key !== state.selected) return;
    state.docs.files = r.files;
    state.docs.dir = r.dir;
    const names = r.files.map((f) => f.name);
    let cur = keepCurrent ? state.docs.current : null;
    if (!cur || !names.includes(cur)) {
      const t = state.tasks.get(key);
      const prefer = t?.stage === "DONE" ? "04-summary.md" : t?.stage === "IMPLEMENTING" ? "03-progress.md" : "02-plan.md";
      cur = names.includes(prefer) ? prefer : names[names.length - 1];
    }
    state.docs.current = cur || null;
    renderDocsList();
    if (cur) await showDoc(cur);
    else $("#docs-view").innerHTML = `<p class="empty">Chưa có tài liệu nào.</p>`;
  } catch (e) {
    $("#docs-view").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

function renderDocsList() {
  $("#docs-list").innerHTML = `<div class="dir">${esc(state.docs.dir)}</div>` + state.docs.files
    .map((f) => `<button type="button" data-doc="${esc(f.name)}" aria-pressed="${f.name === state.docs.current}">${esc(f.name)}</button>`)
    .join("");
}

async function showDoc(name) {
  state.docs.current = name;
  renderDocsList();
  try {
    const r = await api(`/api/tasks/${encodeURIComponent(state.selected)}/files/${encodeURIComponent(name)}`);
    $("#docs-view").innerHTML = md(r.content);
  } catch (e) {
    $("#docs-view").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

/* ---------------------------------------------------------------- markdown (tối giản, không cần internet) */

function md(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const n = Math.min(h[1].length, 3); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const cb = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        items.push(cb ? `<li class="check">${cb[1] === " " ? "☐" : "☑"} ${inline(cb[2])}</li>` : `<li>${inline(text)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+\.)\s|>)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

/* ---------------------------------------------------------------- misc */

function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }

let toastTimer;
function toast(text, error) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("error", !!error);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), error ? 5000 : 2500);
}

document.addEventListener("click", async (e) => {
  const start = e.target.closest("[data-start]");
  if (start) {
    start.disabled = true;
    try {
      const t = await api(`/api/tasks/${encodeURIComponent(start.dataset.start)}/start`, { method: "POST", body: {} });
      upsert(t);
      toast(`Đã bắt đầu ${t.issueKey}`);
      openDrawer(t.issueKey);
    } catch (err) {
      toast(err.message, true);
      start.disabled = false;
    }
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) return openDrawer(open.dataset.open);
  const actBtn = e.target.closest("[data-act]");
  if (actBtn) return onAction(actBtn);
  const tab = e.target.closest(".tabs button");
  if (tab) return selectTab(tab.dataset.tab);
  const doc = e.target.closest("[data-doc]");
  if (doc) return showDoc(doc.dataset.doc);
});

$("#d-close").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.selected) closeDrawer(); });
$("#refresh").addEventListener("click", loadIssues);
$("#waiting").addEventListener("click", () => {
  const t = [...state.tasks.values()].find((x) => (x.stage === "PLAN_REVIEW" && !busy(x)) || x.stage === "FAILED" || x.stage === "STOPPED");
  if (t) openDrawer(t.issueKey);
});
setInterval(tickTimers, 1000);
setInterval(loadIssues, 5 * 60 * 1000);

loadAll().then(connect).catch((e) => toast(e.message, true));
