package local.taskboard.agent;

import local.taskboard.Log;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.taskboard.config.BoardProperties;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * Chạy Claude Code thật qua CLI:
 * {@code claude -p --output-format stream-json --verbose ...}, prompt gửi qua stdin.
 */
public class CliAgentRunner implements AgentRunner {

    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    private final BoardProperties.Claude cfg;
    private final StreamParser parser;

    public CliAgentRunner(BoardProperties.Claude cfg, ObjectMapper json) {
        this.cfg = cfg;
        this.parser = new StreamParser(json);
    }

    @Override
    public RunHandle start(RunSpec spec, Consumer<AgentEvent> sink) {
        List<String> cmd = buildCommand(spec);
        Log.info("Chạy Claude [{}] trong {}: {}", spec.label(), spec.cwd(), String.join(" ", cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd).directory(spec.cwd().toFile());
        pb.environment().put("NO_COLOR", "1");

        CompletableFuture<Outcome> done = new CompletableFuture<>();
        Process process;
        try {
            process = pb.start();
        } catch (IOException e) {
            String msg = "Không chạy được lệnh '" + cfg.getCommand() + "'. Kiểm tra Claude Code đã cài và có trong PATH,"
                    + " hoặc đặt board.claude.command là đường dẫn đầy đủ. Chi tiết: " + e.getMessage();
            sink.accept(AgentEvent.of(AgentEvent.Kind.STDERR, msg));
            done.complete(new Outcome(-1, false, true, spec.resumeSessionId(), 0, msg, List.of()));
            return new RunHandle() {
                public void stop() { }
                public CompletableFuture<Outcome> done() { return done; }
            };
        }

        Handle handle = new Handle(process, done);

        // Gửi prompt qua stdin rồi đóng lại (tránh lỗi trích dẫn tham số dài trên Windows).
        bg(() -> {
            try (OutputStream os = process.getOutputStream()) {
                os.write(spec.prompt().getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) {
                Log.debug("Ghi stdin thất bại: {}", e.getMessage());
            }
        });

        // Đọc stderr: chỉ giữ để báo lỗi.
        List<String> stderrTail = new ArrayList<>();
        Thread errReader = bg(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (line.isBlank()) continue;
                    synchronized (stderrTail) {
                        stderrTail.add(line);
                        if (stderrTail.size() > 30) stderrTail.remove(0);
                    }
                    sink.accept(AgentEvent.of(AgentEvent.Kind.STDERR, line));
                }
            } catch (IOException ignored) {
            }
        });

        // Đọc stdout (stream-json) và chờ tiến trình kết thúc.
        bg(() -> {
            String sessionId = spec.resumeSessionId();
            AgentEvent result = null;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    for (AgentEvent ev : parser.parse(line)) {
                        if (ev.sessionId() != null && !ev.sessionId().isBlank()) sessionId = ev.sessionId();
                        if (ev.kind() == AgentEvent.Kind.RESULT) result = ev;
                        sink.accept(ev);
                    }
                }
            } catch (IOException e) {
                Log.debug("Đọc stdout thất bại: {}", e.getMessage());
            }
            int code;
            try {
                code = process.waitFor();
                errReader.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                code = -1;
            }
            boolean isError = handle.stopped || code != 0 || (result != null && result.isError()) || result == null;
            String text = result != null ? result.text() : "";
            if (result == null && !handle.stopped) {
                synchronized (stderrTail) {
                    text = "Claude Code kết thúc (mã " + code + ") mà không trả kết quả." +
                            (stderrTail.isEmpty() ? "" : "\n" + String.join("\n", stderrTail));
                }
            }
            done.complete(new Outcome(code, handle.stopped, isError, sessionId,
                    result != null ? result.costUsd() : 0, text,
                    result != null ? result.denials() : List.of()));
        });

        return handle;
    }

    List<String> buildCommand(RunSpec spec) {
        List<String> cmd = new ArrayList<>(resolveExecutable(cfg.getCommand()));
        cmd.add("-p");
        cmd.add("--output-format");
        cmd.add("stream-json");
        cmd.add("--verbose");
        cmd.add("--permission-mode");
        cmd.add(spec.permissionMode());
        if (spec.resumeSessionId() != null && !spec.resumeSessionId().isBlank()) {
            cmd.add("--resume");
            cmd.add(spec.resumeSessionId());
        }
        if (spec.workDir() != null) {
            cmd.add("--add-dir");
            cmd.add(spec.workDir().toString());
        }
        if (!spec.allowedTools().isEmpty()) {
            cmd.add("--allowedTools");
            cmd.add(String.join(",", spec.allowedTools()));
        }
        if (!spec.disallowedTools().isEmpty()) {
            cmd.add("--disallowedTools");
            cmd.add(String.join(",", spec.disallowedTools()));
        }
        if (cfg.getModel() != null && !cfg.getModel().isBlank()) {
            cmd.add("--model");
            cmd.add(cfg.getModel());
        }
        if (cfg.getMaxTurns() > 0) {
            cmd.add("--max-turns");
            cmd.add(String.valueOf(cfg.getMaxTurns()));
        }
        if (cfg.getMaxBudgetUsd() > 0) {
            cmd.add("--max-budget-usd");
            cmd.add(String.valueOf(cfg.getMaxBudgetUsd()));
        }
        cmd.addAll(cfg.getExtraArgs());
        return cmd;
    }

    /**
     * Trên Windows, ProcessBuilder không tự chạy được file .cmd (bản cài qua npm).
     * Ưu tiên claude.exe (bản cài native); nếu chỉ có .cmd thì chạy qua cmd.exe /c.
     */
    static List<String> resolveExecutable(String command) {
        if (!WINDOWS) return List.of(command);
        String lower = command.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".exe")) return List.of(command);
        if (lower.endsWith(".cmd") || lower.endsWith(".bat")) return List.of("cmd.exe", "/c", command);
        try {
            Process p = new ProcessBuilder("where", command).redirectErrorStream(true).start();
            List<String> found;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                found = r.lines().map(String::trim).filter(s -> !s.isEmpty()).toList();
            }
            p.waitFor();
            for (String f : found) if (f.toLowerCase(Locale.ROOT).endsWith(".exe")) return List.of(f);
            for (String f : found) {
                String fl = f.toLowerCase(Locale.ROOT);
                if (fl.endsWith(".cmd") || fl.endsWith(".bat")) return List.of("cmd.exe", "/c", f);
            }
        } catch (Exception e) {
            Log.debug("Không tìm được '{}' bằng where: {}", command, e.getMessage());
        }
        return List.of(command);
    }

    /**
     * Quy tắc cho phép ghi vào một thư mục tuyệt đối, theo cú pháp quyền của Claude Code:
     * {@code Edit(//đường/dẫn/**)}. Đường dẫn Windows được đổi sang dạng /c/Users/...
     */
    public static String editRuleFor(Path dir) {
        String p = dir.toAbsolutePath().normalize().toString().replace('\\', '/');
        if (p.length() > 1 && p.charAt(1) == ':') {
            p = "/" + Character.toLowerCase(p.charAt(0)) + p.substring(2);
        }
        if (!p.startsWith("/")) p = "/" + p;
        return "Edit(/" + p + "/**)";
    }

    static Thread bg(Runnable r) {
        Thread t = new Thread(r, "claude-io");
        t.setDaemon(true);
        t.start();
        return t;
    }

    public static boolean commandLooksAvailable(String command) {
        Path p = Path.of(command);
        if (p.isAbsolute()) return Files.isExecutable(p);
        return true;
    }

    private static final class Handle implements RunHandle {
        private final Process process;
        private final CompletableFuture<Outcome> done;
        private volatile boolean stopped;

        Handle(Process process, CompletableFuture<Outcome> done) {
            this.process = process;
            this.done = done;
        }

        @Override
        public void stop() {
            stopped = true;
            process.descendants().forEach(ProcessHandle::destroy);
            process.destroy();
            bg(() -> {
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException ignored) {
                }
                if (process.isAlive()) {
                    process.descendants().forEach(ProcessHandle::destroyForcibly);
                    process.destroyForcibly();
                }
            });
        }

        @Override
        public CompletableFuture<Outcome> done() {
            return done;
        }
    }
}
