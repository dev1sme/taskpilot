package local.taskboard.task;

import local.taskboard.Log;
import local.taskboard.agent.AgentEvent;
import local.taskboard.agent.AgentRunner;
import local.taskboard.agent.CliAgentRunner;
import local.taskboard.agent.RunSpec;
import local.taskboard.backlog.BacklogClient;
import local.taskboard.backlog.BacklogIssue;
import local.taskboard.config.BoardProperties;
import local.taskboard.task.TaskRecord.Phase;
import local.taskboard.task.TaskRecord.Stage;
import local.taskboard.web.EventHub;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;

/**
 * Điều phối vòng đời một task:
 * <pre>
 * Start → INVESTIGATING (Claude điều tra + viết plan, không sửa code)
 *       → PLAN_REVIEW   (chờ người duyệt: Duyệt / Yêu cầu sửa)
 *       → IMPLEMENTING  (Claude code theo plan, cùng phiên Claude)
 *       → DONE          (đăng comment + đổi trạng thái trên Backlog nếu có cấu hình)
 * Lỗi → FAILED, bấm Dừng → STOPPED; cả hai đều có thể Chạy lại hoặc Gửi tin nhắn.
 * </pre>
 */
public class TaskService {

    private static final Pattern ISSUE_KEY = Pattern.compile("[A-Za-z0-9_]+-[0-9]+");

    private final BoardProperties props;
    private final TaskStore store;
    private final TaskFiles files;
    private final Prompts prompts;
    private final BacklogClient backlog;
    private final AgentRunner runner;
    private final EventHub hub;

    private final Semaphore investigateSlots;
    private final Semaphore implementSlots;
    private final ExecutorService exec = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "task-run");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, AgentRunner.RunHandle> handles = new ConcurrentHashMap<>();
    private final Map<String, Future<?>> futures = new ConcurrentHashMap<>();
    private final Map<String, String> lastTool = new ConcurrentHashMap<>();
    private final Map<String, String> lastText = new ConcurrentHashMap<>();

    public TaskService(BoardProperties props, TaskStore store, TaskFiles files, Prompts prompts,
                       BacklogClient backlog, AgentRunner runner, EventHub hub) {
        this.props = props;
        this.store = store;
        this.files = files;
        this.prompts = prompts;
        this.backlog = backlog;
        this.runner = runner;
        this.hub = hub;
        this.investigateSlots = new Semaphore(Math.max(1, props.getClaude().getInvestigateSlots()), true);
        this.implementSlots = new Semaphore(Math.max(1, props.getClaude().getImplementSlots()), true);
    }

    // ------------------------------------------------------------------ actions

    public TaskRecord start(String key) {
        checkKey(key);
        TaskRecord existing = store.find(key).orElse(null);
        if (existing != null && busy(existing)) throw new IllegalStateException(key + " đang chạy.");

        BacklogIssue issue;
        try {
            issue = backlog.getIssue(key);
        } catch (IOException e) {
            throw new IllegalStateException("Không lấy được task từ Backlog: " + e.getMessage());
        }
        String folder = files.folderName(issue);
        try {
            files.seed(folder, issue);
        } catch (IOException e) {
            throw new IllegalStateException("Không tạo được thư mục tài liệu: " + e.getMessage());
        }

        TaskRecord rec = existing != null ? existing : new TaskRecord();
        rec.setIssueKey(key);
        rec.setSummary(issue.summary());
        rec.setDescription(issue.description());
        rec.setUrl(issue.url());
        rec.setFolder(folder);
        rec.setStage(Stage.INVESTIGATING);
        rec.setPhase(Phase.INVESTIGATE);
        rec.setSessionId(null);
        rec.setCostUsd(0);
        rec.setLastResult(null);
        rec.setDenials(new ArrayList<>());
        if (rec.getCreatedAt() == null) rec.setCreatedAt(Instant.now());
        rec.touch();
        store.put(rec);

        String statusOnStart = props.getBacklog().getStatusOnStart();
        if (statusOnStart != null && !statusOnStart.isBlank()) {
            exec.submit(() -> {
                try {
                    backlog.changeStatus(key, statusOnStart, null);
                } catch (IOException e) {
                    log(rec, "error", "Không đổi được trạng thái trên Backlog: " + e.getMessage());
                }
            });
        }

        launch(rec, Phase.INVESTIGATE, "investigate", prompts.render("investigate", vars(rec, Map.of())), null);
        return rec;
    }

    public TaskRecord approve(String key, String note) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException(key + " đang chạy.");
        if (rec.getStage() != Stage.PLAN_REVIEW) throw new IllegalStateException("Task chưa ở bước chờ duyệt plan.");
        rec.setStage(Stage.IMPLEMENTING);
        rec.setPhase(Phase.IMPLEMENT);
        String noteText = note == null || note.isBlank() ? "" : "\nGhi chú của người duyệt: " + note.trim() + "\n";
        launch(rec, Phase.IMPLEMENT, "implement",
                prompts.render("implement", vars(rec, Map.of("note", noteText))), rec.getSessionId());
        return rec;
    }

    public TaskRecord revise(String key, String feedback) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException(key + " đang chạy.");
        if (rec.getStage() != Stage.PLAN_REVIEW) throw new IllegalStateException("Task chưa ở bước chờ duyệt plan.");
        if (feedback == null || feedback.isBlank()) throw new IllegalArgumentException("Hãy nhập góp ý cho kế hoạch.");
        rec.setStage(Stage.INVESTIGATING);
        rec.setPhase(Phase.INVESTIGATE);
        launch(rec, Phase.INVESTIGATE, "revise",
                prompts.render("revise", vars(rec, Map.of("feedback", feedback.trim()))), rec.getSessionId());
        return rec;
    }

    /** Gửi thêm một tin nhắn cho Claude trong cùng phiên (có thể kèm quyền bổ sung). */
    public TaskRecord followup(String key, String message, List<String> extraTools) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException(key + " đang chạy.");
        if (message == null || message.isBlank()) throw new IllegalArgumentException("Hãy nhập nội dung tin nhắn.");
        addExtraTools(rec, extraTools);
        Phase phase = currentPhase(rec);
        rec.setPhase(phase);
        rec.setStage(phase == Phase.IMPLEMENT ? Stage.IMPLEMENTING : Stage.INVESTIGATING);
        launch(rec, phase, "followup",
                prompts.render("followup", vars(rec, Map.of("message", message.trim()))), rec.getSessionId());
        return rec;
    }

    public TaskRecord retry(String key, List<String> extraTools) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException(key + " đang chạy.");
        addExtraTools(rec, extraTools);
        Phase phase = currentPhase(rec);
        rec.setPhase(phase);
        rec.setStage(phase == Phase.IMPLEMENT ? Stage.IMPLEMENTING : Stage.INVESTIGATING);
        String prompt;
        if (rec.getSessionId() != null) {
            prompt = prompts.render("retry", vars(rec, Map.of("phase", phase == Phase.IMPLEMENT ? "implement" : "điều tra & lên kế hoạch")));
        } else if (phase == Phase.IMPLEMENT) {
            prompt = prompts.render("implement", vars(rec, Map.of("note", "")));
        } else {
            prompt = prompts.render("investigate", vars(rec, Map.of()));
        }
        launch(rec, phase, "retry", prompt, rec.getSessionId());
        return rec;
    }

    public TaskRecord stop(String key) {
        TaskRecord rec = require(key);
        AgentRunner.RunHandle h = handles.get(key);
        if (h != null) {
            log(rec, "info", "Đang dừng Claude…");
            h.stop();
        } else {
            Future<?> f = futures.get(key);
            if (f != null) f.cancel(true);
        }
        return rec;
    }

    public void delete(String key) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException("Hãy dừng task trước khi xoá khỏi bảng.");
        store.remove(key);
        hub.publish("removed", Map.of("key", key));
    }

    public TaskRecord markDone(String key) {
        TaskRecord rec = require(key);
        if (busy(rec)) throw new IllegalStateException(key + " đang chạy.");
        rec.setStage(Stage.DONE);
        rec.setLastActivity("Đánh dấu hoàn thành thủ công");
        rec.touch();
        store.save();
        publishTask(rec);
        return rec;
    }

    // ------------------------------------------------------------------ run loop

    private void launch(TaskRecord rec, Phase phase, String label, String prompt, String resumeSessionId) {
        String key = rec.getIssueKey();
        Path repo = files.repoPath();
        Path work = files.workDir(rec.getFolder());

        rec.setQueued(true);
        rec.setRunning(false);
        rec.setDenials(new ArrayList<>());
        rec.setLastActivity("Đang chờ lượt chạy…");
        rec.touch();
        store.save();
        publishTask(rec);
        log(rec, "phase", "▶ " + labelText(label));

        Future<?> f = exec.submit(() -> {
            Semaphore sem = phase == Phase.IMPLEMENT ? implementSlots : investigateSlots;
            try {
                sem.acquire();
            } catch (InterruptedException e) {
                rec.setQueued(false);
                rec.setStage(Stage.STOPPED);
                rec.setLastActivity("Đã huỷ khi đang chờ lượt");
                rec.touch();
                store.save();
                publishTask(rec);
                log(rec, "info", "Đã huỷ khi đang chờ lượt");
                futures.remove(key);
                return;
            }
            try {
                rec.setQueued(false);
                rec.setRunning(true);
                rec.setRunStartedAt(Instant.now());
                rec.setLastActivity("Đang khởi động Claude…");
                rec.touch();
                store.save();
                publishTask(rec);

                RunSpec spec = buildSpec(rec, phase, label, repo, work, prompt, resumeSessionId);
                AgentRunner.RunHandle h = runner.start(spec, ev -> onEvent(rec, ev));
                handles.put(key, h);
                AgentRunner.Outcome out = h.done().join();
                handles.remove(key);
                onFinish(rec, phase, out);
            } catch (Exception e) {
                handles.remove(key);
                Log.error("Lỗi khi chạy {}", key, e);
                rec.setRunning(false);
                rec.setStage(Stage.FAILED);
                rec.setLastActivity("Lỗi: " + e.getMessage());
                rec.touch();
                store.save();
                publishTask(rec);
                log(rec, "error", "Lỗi: " + e.getMessage());
            } finally {
                sem.release();
                futures.remove(key);
            }
        });
        futures.put(key, f);
    }

    private RunSpec buildSpec(TaskRecord rec, Phase phase, String label, Path repo, Path work,
                              String prompt, String resume) {
        BoardProperties.Claude c = props.getClaude();
        List<String> allowed = new ArrayList<>();
        List<String> disallowed = new ArrayList<>();
        String mode;
        if (phase == Phase.INVESTIGATE) {
            // Chế độ Manual: chỉ đọc; riêng thư mục tài liệu của task được phép ghi. Không cho chạy shell.
            mode = "default";
            allowed.addAll(c.getInvestigateAllowedTools());
            allowed.add(CliAgentRunner.editRuleFor(work));
            allowed.addAll(rec.getExtraAllowedTools());
            boolean extraBash = rec.getExtraAllowedTools().stream().anyMatch(t -> t.startsWith("Bash"));
            if (!extraBash) disallowed.add("Bash");
        } else {
            // Chế độ acceptEdits: được sửa file trong repo; lệnh shell chỉ chạy được nếu nằm trong danh sách cho phép.
            mode = "acceptEdits";
            allowed.addAll(c.getImplementAllowedTools());
            allowed.add(CliAgentRunner.editRuleFor(work));
            allowed.addAll(rec.getExtraAllowedTools());
        }
        return new RunSpec(label, repo, work, prompt, resume, mode, dedupe(allowed), disallowed);
    }

    private void onEvent(TaskRecord rec, AgentEvent ev) {
        String key = rec.getIssueKey();
        switch (ev.kind()) {
            case INIT -> {
                if (ev.sessionId() != null) rec.setSessionId(ev.sessionId());
                log(rec, "info", ev.text());
            }
            case TEXT -> {
                lastText.put(key, ev.text());
                rec.setLastActivity(firstLine(ev.text()));
                log(rec, "text", ev.text());
                publishTask(rec);
            }
            case TOOL -> {
                lastTool.put(key, ev.toolName() == null ? "" : ev.toolName());
                String shown = shortenPaths(rec, ev.text());
                rec.setLastActivity(shown);
                log(rec, "tool", shown);
                publishTask(rec);
            }
            case TOOL_RESULT -> {
                if (ev.isError()) log(rec, "error", ev.text());
                String t = lastTool.getOrDefault(key, "");
                if (t.equals("Write") || t.equals("Edit") || t.equals("MultiEdit") || t.equals("Bash")) {
                    files.mirror(rec.getFolder());
                    hub.publish("files", Map.of("key", key));
                }
            }
            case RESULT -> {
                if (ev.sessionId() != null) rec.setSessionId(ev.sessionId());
                // Câu trả lời cuối thường trùng với đoạn text vừa in; chỉ in thêm khi khác.
                if (ev.isError() || !ev.text().equals(lastText.get(key))) log(rec, ev.isError() ? "error" : "result", ev.text());
            }
            case STDERR -> log(rec, "stderr", ev.text());
            case INFO, DENIED -> log(rec, "info", ev.text());
        }
    }

    private void onFinish(TaskRecord rec, Phase phase, AgentRunner.Outcome out) {
        files.mirror(rec.getFolder());
        hub.publish("files", Map.of("key", rec.getIssueKey()));

        rec.setRunning(false);
        if (out.sessionId() != null) rec.setSessionId(out.sessionId());
        if (out.costUsd() > 0) rec.setCostUsd(out.costUsd());
        rec.setDenials(new ArrayList<>(out.denials()));
        rec.setLastResult(out.resultText());
        String took = rec.getRunStartedAt() == null ? "" : human(Duration.between(rec.getRunStartedAt(), Instant.now()));

        if (out.stopped()) {
            rec.setStage(Stage.STOPPED);
            rec.setLastActivity("Đã dừng");
            log(rec, "phase", "■ Đã dừng" + meta(took, rec));
        } else if (out.isError()) {
            rec.setStage(Stage.FAILED);
            rec.setLastActivity("Lỗi: " + firstLine(out.resultText()));
            log(rec, "phase", "✕ Kết thúc với lỗi, mã " + out.exitCode() + meta(took, rec));
        } else if (phase == Phase.INVESTIGATE) {
            rec.setStage(Stage.PLAN_REVIEW);
            boolean hasPlan = files.readIfExists(rec.getFolder(), "02-plan.md") != null;
            rec.setLastActivity(hasPlan ? "Kế hoạch sẵn sàng, chờ duyệt" : "Xong bước điều tra nhưng chưa thấy 02-plan.md");
            log(rec, "phase", "✓ Xong điều tra & lên kế hoạch" + meta(took, rec));
        } else {
            rec.setStage(Stage.DONE);
            rec.setLastActivity("Đã implement xong");
            log(rec, "phase", "✓ Xong implement" + meta(took, rec));
            reportDone(rec);
        }
        if (!out.denials().isEmpty()) {
            log(rec, "denied", "Claude bị từ chối quyền với " + out.denials().size() + " thao tác:\n- "
                    + String.join("\n- ", out.denials().stream().map(d -> shortenPaths(rec, d)).toList()));
        }
        rec.touch();
        store.save();
        publishTask(rec);
    }

    private void reportDone(TaskRecord rec) {
        BoardProperties.Backlog b = props.getBacklog();
        if (backlog.isDemo()) return;
        String summary = files.readIfExists(rec.getFolder(), "04-summary.md");
        if (summary == null || summary.isBlank()) summary = rec.getLastResult();
        String comment = b.isCommentOnDone()
                ? abbreviate("[Claude Task Board] Đã implement xong, chờ review.\n\n" + (summary == null ? "" : summary), 9000)
                : null;
        exec.submit(() -> {
            try {
                if (b.getStatusOnDone() != null && !b.getStatusOnDone().isBlank()) {
                    backlog.changeStatus(rec.getIssueKey(), b.getStatusOnDone(), comment);
                } else if (comment != null) {
                    backlog.addComment(rec.getIssueKey(), comment);
                }
                if (comment != null) log(rec, "info", "Đã đăng tóm tắt lên Backlog");
            } catch (IOException e) {
                log(rec, "error", "Không cập nhật được Backlog: " + e.getMessage());
            }
        });
    }

    // ------------------------------------------------------------------ helpers

    public List<LogLine> log(String key, int limit) {
        return store.readLog(key, limit);
    }

    private void log(TaskRecord rec, String kind, String text) {
        LogLine line = LogLine.now(kind, text == null ? "" : text);
        store.appendLog(rec.getIssueKey(), line);
        hub.publish("log", Map.of("key", rec.getIssueKey(), "line", line));
    }

    private void publishTask(TaskRecord rec) {
        hub.publish("task", rec);
    }

    private TaskRecord require(String key) {
        checkKey(key);
        return store.find(key).orElseThrow(() -> new IllegalArgumentException("Không có task " + key + " trên bảng."));
    }

    private static void checkKey(String key) {
        if (key == null || !ISSUE_KEY.matcher(key).matches()) throw new IllegalArgumentException("Mã task không hợp lệ: " + key);
    }

    private static boolean busy(TaskRecord r) {
        return r.isRunning() || r.isQueued();
    }

    private static Phase currentPhase(TaskRecord rec) {
        if (rec.getStage() == Stage.IMPLEMENTING || rec.getStage() == Stage.DONE) return Phase.IMPLEMENT;
        if (rec.getStage() == Stage.PLAN_REVIEW) return Phase.INVESTIGATE;
        return rec.getPhase() == null ? Phase.INVESTIGATE : rec.getPhase();
    }

    private static void addExtraTools(TaskRecord rec, List<String> extra) {
        if (extra == null) return;
        for (String t : extra) {
            String s = t == null ? "" : t.trim();
            if (!s.isEmpty() && !rec.getExtraAllowedTools().contains(s)) rec.getExtraAllowedTools().add(s);
        }
    }

    private Map<String, String> vars(TaskRecord rec, Map<String, String> extra) {
        Map<String, String> v = new LinkedHashMap<>();
        v.put("issueKey", rec.getIssueKey());
        v.put("summary", rec.getSummary());
        v.put("workDir", files.workDir(rec.getFolder()).toString());
        v.put("repoDocsDir", props.getRepo().getTasksDir() + "/" + rec.getFolder());
        v.put("language", props.getDocLanguage());
        v.putAll(extra);
        return v;
    }

    private static List<String> dedupe(List<String> in) {
        return new ArrayList<>(new java.util.LinkedHashSet<>(in));
    }

    /** Rút gọn đường dẫn dài cho dễ đọc: thư mục tài liệu → "tài liệu/", repo → đường dẫn tương đối. */
    private String shortenPaths(TaskRecord rec, String text) {
        if (text == null) return "";
        String work = files.workDir(rec.getFolder()).toString();
        String out = text.replace(work + java.io.File.separator, "tài liệu/").replace(work + "/", "tài liệu/");
        try {
            String repo = files.repoPath().toString();
            out = out.replace(repo + java.io.File.separator, "").replace(repo + "/", "").replace(repo, "repo");
        } catch (IllegalStateException ignored) {
        }
        return out;
    }

    private static String labelText(String label) {
        return switch (label) {
            case "investigate" -> "Bắt đầu điều tra & lên kế hoạch";
            case "revise" -> "Sửa kế hoạch theo góp ý";
            case "implement" -> "Bắt đầu implement";
            case "followup" -> "Gửi tin nhắn tiếp cho Claude";
            case "retry" -> "Chạy lại";
            default -> label;
        };
    }

    private static String meta(String took, TaskRecord rec) {
        List<String> parts = new ArrayList<>();
        if (!took.isBlank()) parts.add(took);
        if (rec.getCostUsd() > 0) parts.add(String.format("~$%.2f", rec.getCostUsd()));
        return parts.isEmpty() ? "" : " (" + String.join(", ", parts) + ")";
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        String l = s.strip();
        int i = l.indexOf('\n');
        if (i >= 0) l = l.substring(0, i);
        return abbreviate(l, 160);
    }

    private static String abbreviate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private static String human(Duration d) {
        long s = d.getSeconds();
        if (s < 60) return s + " giây";
        if (s < 3600) return (s / 60) + " phút " + (s % 60) + " giây";
        return (s / 3600) + " giờ " + ((s % 3600) / 60) + " phút";
    }
}
