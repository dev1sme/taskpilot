package local.taskboard.agent;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * Giả lập Claude Code để thử giao diện mà không tốn token (board.claude.simulate=true).
 * Ghi các file .md mẫu vào thư mục tài liệu của task và phát sự kiện như thật.
 */
public class SimulatedAgentRunner implements AgentRunner {

    private final long stepMillis;

    public SimulatedAgentRunner(long stepMillis) {
        this.stepMillis = stepMillis;
    }

    @Override
    public RunHandle start(RunSpec spec, Consumer<AgentEvent> sink) {
        CompletableFuture<Outcome> done = new CompletableFuture<>();
        String session = spec.resumeSessionId() != null ? spec.resumeSessionId() : UUID.randomUUID().toString();
        boolean[] stopped = {false};

        Thread t = new Thread(() -> {
            try {
                sink.accept(AgentEvent.init(session, "simulated"));
                boolean implement = spec.label().equals("implement")
                        || (spec.permissionMode().equals("acceptEdits") && !spec.label().equals("investigate"));
                if (!implement) {
                    step(sink, stopped, AgentEvent.tool("Read", "Read: " + spec.workDir().resolve("00-task.md")));
                    step(sink, stopped, AgentEvent.of(AgentEvent.Kind.TEXT, "Mình sẽ tìm các phần code liên quan tới task này."));
                    step(sink, stopped, AgentEvent.tool("Grep", "Grep: ReportController trong src"));
                    step(sink, stopped, AgentEvent.tool("Read", "Read: src/main/java/com/example/report/ReportService.java"));
                    write(spec.workDir().resolve("01-investigation.md"), """
                            # Điều tra

                            ## Code liên quan
                            - `ReportController` – endpoint báo cáo hiện tại
                            - `ReportService#findRevenue` – truy vấn dữ liệu

                            ## Nhận xét
                            Đã có sẵn bộ lọc theo ngày, có thể tái sử dụng.
                            """);
                    step(sink, stopped, AgentEvent.tool("Write", "Write: " + spec.workDir().resolve("01-investigation.md")));
                    step(sink, stopped, AgentEvent.toolResult(false, "File created successfully"));
                    write(spec.workDir().resolve("02-plan.md"), """
                            # Kế hoạch

                            1. Thêm endpoint `GET /reports/revenue.csv`
                            2. Tái sử dụng `ReportService#findRevenue`
                            3. Viết `CsvWriter` nhỏ, có test
                            4. Thêm nút "Xuất CSV" trên giao diện

                            ## Rủi ro
                            - Dữ liệu lớn: cần stream thay vì nạp hết vào bộ nhớ

                            ## Kiểm thử
                            - `mvn test`
                            """);
                    step(sink, stopped, AgentEvent.tool("Write", "Write: " + spec.workDir().resolve("02-plan.md")));
                    step(sink, stopped, AgentEvent.toolResult(false, "File created successfully"));
                    finish(done, sink, session, "Đã điều tra và viết kế hoạch 4 bước trong 02-plan.md. Chờ duyệt.", 0.18);
                } else {
                    step(sink, stopped, AgentEvent.of(AgentEvent.Kind.TEXT, "Bắt đầu implement theo kế hoạch đã duyệt."));
                    step(sink, stopped, AgentEvent.tool("Bash", "Bash: git switch -c feature/task"));
                    step(sink, stopped, AgentEvent.tool("Edit", "Edit: src/main/java/com/example/report/ReportController.java"));
                    write(spec.workDir().resolve("03-progress.md"), "# Tiến độ\n\n- [x] Bước 1: endpoint\n- [x] Bước 2\n- [ ] Bước 3\n");
                    step(sink, stopped, AgentEvent.tool("Write", "Write: " + spec.workDir().resolve("03-progress.md")));
                    step(sink, stopped, AgentEvent.toolResult(false, "File created successfully"));
                    step(sink, stopped, AgentEvent.tool("Bash", "Bash: mvn -q test"));
                    step(sink, stopped, AgentEvent.toolResult(false, "Tests run: 42, Failures: 0"));
                    write(spec.workDir().resolve("03-progress.md"), "# Tiến độ\n\n- [x] Bước 1\n- [x] Bước 2\n- [x] Bước 3\n- [x] Bước 4\n");
                    write(spec.workDir().resolve("04-summary.md"), """
                            # Tóm tắt

                            - Thêm endpoint `GET /reports/revenue.csv`
                            - Thêm `CsvWriter` và test
                            - `mvn test`: 42 test, không lỗi
                            """);
                    step(sink, stopped, AgentEvent.tool("Write", "Write: " + spec.workDir().resolve("04-summary.md")));
                    step(sink, stopped, AgentEvent.toolResult(false, "File created successfully"));
                    finish(done, sink, session, "Đã implement xong, test đều qua. Tóm tắt trong 04-summary.md.", 0.62);
                }
            } catch (StoppedException e) {
                done.complete(new Outcome(143, true, true, session, 0, "Đã dừng", List.of()));
            } catch (Exception e) {
                done.complete(new Outcome(1, false, true, session, 0, e.getMessage(), List.of()));
            }
        }, "simulated-claude");
        t.setDaemon(true);
        t.start();

        return new RunHandle() {
            public void stop() {
                stopped[0] = true;
            }

            public CompletableFuture<Outcome> done() {
                return done;
            }
        };
    }

    private void step(Consumer<AgentEvent> sink, boolean[] stopped, AgentEvent ev) throws InterruptedException {
        if (stopped[0]) throw new StoppedException();
        Thread.sleep(stepMillis);
        if (stopped[0]) throw new StoppedException();
        sink.accept(ev);
    }

    private void finish(CompletableFuture<Outcome> done, Consumer<AgentEvent> sink, String session, String text, double cost) {
        sink.accept(AgentEvent.result(text, session, cost, false, List.of()));
        done.complete(new Outcome(0, false, false, session, cost, text, List.of()));
    }

    private static void write(Path p, String content) throws IOException {
        Files.createDirectories(p.getParent());
        Files.writeString(p, content, StandardCharsets.UTF_8);
    }

    private static final class StoppedException extends RuntimeException {
    }
}
