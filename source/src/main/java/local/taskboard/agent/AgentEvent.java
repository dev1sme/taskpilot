package local.taskboard.agent;

import java.util.List;

/**
 * Một sự kiện rút gọn từ luồng stream-json của Claude Code.
 *
 * @param kind      loại sự kiện
 * @param text      nội dung hiển thị cho người dùng
 * @param sessionId session của Claude (có trong INIT và RESULT)
 * @param costUsd   chi phí ước tính (chỉ có trong RESULT)
 * @param isError   kết quả lỗi (TOOL_RESULT, RESULT)
 * @param denials   các thao tác bị từ chối quyền (RESULT)
 * @param toolName  tên công cụ (TOOL)
 */
public record AgentEvent(Kind kind, String text, String sessionId, double costUsd, boolean isError,
                         List<String> denials, String toolName) {

    public enum Kind { INIT, TEXT, TOOL, TOOL_RESULT, DENIED, RESULT, STDERR, INFO }

    public static AgentEvent of(Kind kind, String text) {
        return new AgentEvent(kind, text, null, 0, false, List.of(), null);
    }

    public static AgentEvent tool(String name, String summary) {
        return new AgentEvent(Kind.TOOL, summary, null, 0, false, List.of(), name);
    }

    public static AgentEvent toolResult(boolean isError, String text) {
        return new AgentEvent(Kind.TOOL_RESULT, text, null, 0, isError, List.of(), null);
    }

    public static AgentEvent init(String sessionId, String model) {
        return new AgentEvent(Kind.INIT, "Bắt đầu phiên Claude" + (model == null || model.isBlank() ? "" : ", model " + model),
                sessionId, 0, false, List.of(), null);
    }

    public static AgentEvent result(String text, String sessionId, double cost, boolean isError, List<String> denials) {
        return new AgentEvent(Kind.RESULT, text, sessionId, cost, isError, denials, null);
    }
}
