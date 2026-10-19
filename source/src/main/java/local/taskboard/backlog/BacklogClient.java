package local.taskboard.backlog;

import local.taskboard.Log;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import local.taskboard.config.BoardProperties;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Gọi Nulab Backlog API v2 (xác thực bằng API key).
 * Khi chưa cấu hình baseUrl/apiKey thì trả về dữ liệu demo để thử giao diện.
 */
public class BacklogClient {


    private final BoardProperties.Backlog cfg;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    private Long projectId;
    private Long myselfId;
    private List<JsonNode> statuses;

    public BacklogClient(BoardProperties props, ObjectMapper json) {
        this.cfg = props.getBacklog();
        this.json = json;
    }

    public boolean isDemo() {
        return cfg.isDemo();
    }

    /** Danh sách task đang mở của project (mới cập nhật lên đầu). */
    public List<BacklogIssue> listIssues() throws IOException {
        if (isDemo()) return DemoData.issues();
        Map<String, List<String>> q = new LinkedHashMap<>();
        q.put("projectId[]", List.of(String.valueOf(projectId())));
        if (cfg.isOnlyMine()) q.put("assigneeId[]", List.of(String.valueOf(myselfId())));
        List<String> openStatusIds = statuses().stream()
                .filter(s -> cfg.getExcludeStatuses().stream().noneMatch(x -> x.equalsIgnoreCase(s.path("name").asText())))
                .map(s -> s.path("id").asText())
                .toList();
        if (!openStatusIds.isEmpty()) q.put("statusId[]", openStatusIds);
        q.put("count", List.of("100"));
        q.put("sort", List.of("updated"));
        q.put("order", List.of("desc"));

        JsonNode arr = get("/api/v2/issues", q);
        List<BacklogIssue> out = new ArrayList<>();
        arr.forEach(n -> out.add(toIssue(n)));
        return out;
    }

    public BacklogIssue getIssue(String key) throws IOException {
        if (isDemo()) {
            return DemoData.issues().stream().filter(i -> i.key().equals(key)).findFirst()
                    .orElseThrow(() -> new IOException("Không tìm thấy task " + key));
        }
        return toIssue(get("/api/v2/issues/" + enc(key), Map.of()));
    }

    /** Đổi trạng thái task theo tên trạng thái (ví dụ "処理中" hoặc "In Progress"). */
    public void changeStatus(String key, String statusName, String comment) throws IOException {
        if (isDemo() || statusName == null || statusName.isBlank()) return;
        Optional<JsonNode> st = statuses().stream()
                .filter(s -> s.path("name").asText().equalsIgnoreCase(statusName.trim()))
                .findFirst();
        if (st.isEmpty()) {
            Log.warn("Không có trạng thái tên '{}' trong project {}", statusName, cfg.getProjectKey());
            return;
        }
        Map<String, String> form = new LinkedHashMap<>();
        form.put("statusId", st.get().path("id").asText());
        if (comment != null && !comment.isBlank()) form.put("comment", comment);
        send("PATCH", "/api/v2/issues/" + enc(key), form);
    }

    public void addComment(String key, String content) throws IOException {
        if (isDemo() || content == null || content.isBlank()) return;
        send("POST", "/api/v2/issues/" + enc(key) + "/comments", Map.of("content", content));
    }

    public String issueUrl(String key) {
        if (isDemo()) return "";
        return trimSlash(cfg.getBaseUrl()) + "/view/" + key;
    }

    // ---------------------------------------------------------------- internals

    private synchronized long projectId() throws IOException {
        if (projectId == null) {
            if (cfg.getProjectKey() == null || cfg.getProjectKey().isBlank())
                throw new IOException("Chưa cấu hình board.backlog.project-key");
            projectId = get("/api/v2/projects/" + enc(cfg.getProjectKey()), Map.of()).path("id").asLong();
        }
        return projectId;
    }

    private synchronized long myselfId() throws IOException {
        if (myselfId == null) myselfId = get("/api/v2/users/myself", Map.of()).path("id").asLong();
        return myselfId;
    }

    private synchronized List<JsonNode> statuses() throws IOException {
        if (statuses == null) {
            List<JsonNode> list = new ArrayList<>();
            get("/api/v2/projects/" + enc(cfg.getProjectKey()) + "/statuses", Map.of()).forEach(list::add);
            statuses = list;
        }
        return statuses;
    }

    private BacklogIssue toIssue(JsonNode n) {
        String key = n.path("issueKey").asText();
        return new BacklogIssue(
                key,
                n.path("summary").asText(""),
                n.path("description").asText(""),
                n.path("status").path("name").asText(""),
                n.path("priority").path("name").asText(""),
                n.path("issueType").path("name").asText(""),
                n.path("assignee").path("name").asText(""),
                n.path("updated").asText(""),
                issueUrl(key));
    }

    private JsonNode get(String path, Map<String, List<String>> query) throws IOException {
        StringBuilder url = new StringBuilder(trimSlash(cfg.getBaseUrl())).append(path)
                .append("?apiKey=").append(enc(cfg.getApiKey()));
        query.forEach((k, vals) -> vals.forEach(v -> url.append('&').append(enc(k)).append('=').append(enc(v))));
        HttpRequest req = HttpRequest.newBuilder(URI.create(url.toString()))
                .timeout(Duration.ofSeconds(30)).GET().build();
        return execute(req);
    }

    private JsonNode send(String method, String path, Map<String, String> form) throws IOException {
        String url = trimSlash(cfg.getBaseUrl()) + path + "?apiKey=" + enc(cfg.getApiKey());
        String body = form.entrySet().stream()
                .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        return execute(req);
    }

    private JsonNode execute(HttpRequest req) throws IOException {
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() >= 400) {
                throw new IOException("Backlog API trả lỗi " + res.statusCode() + ": " + abbreviate(res.body(), 300));
            }
            return json.readTree(res.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Bị ngắt khi gọi Backlog API", e);
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    private static String trimSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    private static String abbreviate(String s, int max) {
        return s == null ? "" : (s.length() <= max ? s : s.substring(0, max) + "…");
    }
}
