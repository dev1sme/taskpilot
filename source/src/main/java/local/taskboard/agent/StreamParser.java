package local.taskboard.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * Chuyển từng dòng JSON của "claude -p --output-format stream-json --verbose"
 * thành các {@link AgentEvent} dễ hiển thị. Sự kiện không cần thiết bị bỏ qua.
 */
public class StreamParser {

    private final ObjectMapper json;

    public StreamParser(ObjectMapper json) {
        this.json = json;
    }

    public List<AgentEvent> parse(String line) {
        List<AgentEvent> out = new ArrayList<>();
        if (line == null || line.isBlank()) return out;
        JsonNode e;
        try {
            e = json.readTree(line);
        } catch (Exception ex) {
            out.add(AgentEvent.of(AgentEvent.Kind.STDERR, line));
            return out;
        }
        String type = e.path("type").asText();
        switch (type) {
            case "system" -> {
                String sub = e.path("subtype").asText();
                if ("init".equals(sub)) {
                    out.add(AgentEvent.init(e.path("session_id").asText(null), e.path("model").asText("")));
                } else if ("api_retry".equals(sub)) {
                    out.add(AgentEvent.of(AgentEvent.Kind.INFO, "API đang thử lại (lần " + e.path("attempt").asInt()
                            + ", lỗi " + e.path("error").asText() + ")"));
                }
            }
            case "assistant" -> {
                // Bỏ qua tin nhắn của subagent để log gọn hơn, chỉ giữ lời gọi công cụ.
                boolean fromSubagent = !e.path("parent_tool_use_id").isNull() && !e.path("parent_tool_use_id").isMissingNode();
                for (JsonNode b : e.path("message").path("content")) {
                    String bt = b.path("type").asText();
                    if ("text".equals(bt) && !fromSubagent) {
                        String t = b.path("text").asText("").trim();
                        if (!t.isEmpty()) out.add(AgentEvent.of(AgentEvent.Kind.TEXT, t));
                    } else if ("tool_use".equals(bt)) {
                        String name = b.path("name").asText();
                        out.add(AgentEvent.tool(name, (fromSubagent ? "↳ " : "") + describeTool(name, b.path("input"))));
                    }
                }
            }
            case "user" -> {
                for (JsonNode b : e.path("message").path("content")) {
                    if ("tool_result".equals(b.path("type").asText())) {
                        boolean err = b.path("is_error").asBoolean(false);
                        out.add(AgentEvent.toolResult(err, abbreviate(contentText(b.path("content")), err ? 400 : 160)));
                    }
                }
            }
            case "result" -> {
                List<String> denials = new ArrayList<>();
                for (JsonNode d : e.path("permission_denials")) {
                    denials.add(describeTool(d.path("tool_name").asText(), d.path("tool_input")));
                }
                boolean isError = e.path("is_error").asBoolean(false) || !"success".equals(e.path("subtype").asText("success"));
                String text = e.path("result").asText("");
                if (text.isBlank() && isError) text = "Kết thúc với lỗi: " + e.path("subtype").asText();
                out.add(AgentEvent.result(text, e.path("session_id").asText(null),
                        e.path("total_cost_usd").asDouble(0), isError, denials));
            }
            default -> {
                // stream_event, rate_limit_event, autocompact_state... không cần hiển thị
            }
        }
        return out;
    }

    /** Mô tả ngắn một lời gọi công cụ, ví dụ "Read src/Foo.java" hoặc "Bash: mvn test". */
    static String describeTool(String name, JsonNode in) {
        String detail = switch (name) {
            case "Read", "Write", "Edit", "MultiEdit", "NotebookEdit" -> in.path("file_path").asText(in.path("notebook_path").asText(""));
            case "Bash" -> in.path("command").asText("");
            case "Grep" -> in.path("pattern").asText("") + (in.hasNonNull("path") ? " trong " + in.path("path").asText() : "");
            case "Glob" -> in.path("pattern").asText("");
            case "WebFetch" -> in.path("url").asText("");
            case "WebSearch" -> in.path("query").asText("");
            case "Task", "Agent" -> in.path("description").asText(in.path("subagent_type").asText(""));
            case "TodoWrite", "TaskCreate", "TaskUpdate" -> "cập nhật danh sách việc";
            default -> "";
        };
        return detail.isBlank() ? name : name + ": " + abbreviate(detail.replace('\n', ' '), 200);
    }

    private static String contentText(JsonNode c) {
        if (c.isTextual()) return c.asText();
        StringBuilder sb = new StringBuilder();
        for (JsonNode part : c) {
            if (part.has("text")) sb.append(part.path("text").asText()).append(' ');
        }
        return sb.toString();
    }

    static String abbreviate(String s, int max) {
        if (s == null) return "";
        String one = s.strip();
        return one.length() <= max ? one : one.substring(0, max) + "…";
    }
}
