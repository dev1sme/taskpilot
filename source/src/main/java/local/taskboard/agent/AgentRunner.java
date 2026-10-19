package local.taskboard.agent;

import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/** Chạy một lượt Claude Code và đẩy sự kiện ra ngoài theo thời gian thực. */
public interface AgentRunner {

    RunHandle start(RunSpec spec, Consumer<AgentEvent> sink);

    /** Kết quả cuối cùng của một lượt chạy. */
    record Outcome(int exitCode, boolean stopped, boolean isError, String sessionId, double costUsd,
                   String resultText, java.util.List<String> denials) {
    }

    /** Điều khiển một lượt đang chạy. */
    interface RunHandle {
        void stop();

        CompletableFuture<Outcome> done();
    }
}
