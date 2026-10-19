package local.taskboard.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import local.taskboard.Log;
import local.taskboard.backlog.BacklogClient;
import local.taskboard.config.BoardProperties;
import local.taskboard.task.TaskFiles;
import local.taskboard.task.TaskRecord;
import local.taskboard.task.TaskService;
import local.taskboard.task.TaskStore;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** REST API + phục vụ giao diện web tĩnh. */
public class HttpApi implements HttpHandler {

    private static final Pattern TASK_ACTION = Pattern.compile("^/api/tasks/([^/]+)(?:/([a-z]+))?(?:/(.+))?$");

    private final TaskService service;
    private final TaskStore store;
    private final TaskFiles files;
    private final BacklogClient backlog;
    private final BoardProperties props;
    private final EventHub hub;
    private final ObjectMapper json;

    public HttpApi(TaskService service, TaskStore store, TaskFiles files, BacklogClient backlog,
                   BoardProperties props, EventHub hub, ObjectMapper json) {
        this.service = service;
        this.store = store;
        this.files = files;
        this.backlog = backlog;
        this.props = props;
        this.hub = hub;
        this.json = json;
    }

    public record Body(String text, List<String> tools) {
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getRawPath();
        String method = ex.getRequestMethod();
        try {
            if (!path.startsWith("/api/")) {
                serveStatic(ex, path);
                return;
            }
            if (!sameOrigin(ex)) {
                send(ex, 403, Map.of("error", "Từ chối yêu cầu từ trang khác"));
                return;
            }
            if (path.equals("/api/events") && method.equals("GET")) {
                hub.serve(ex);
                return;
            }
            Object result = route(ex, method, path);
            send(ex, 200, result);
        } catch (IllegalStateException e) {
            send(ex, 409, Map.of("error", String.valueOf(e.getMessage())));
        } catch (IllegalArgumentException e) {
            send(ex, 400, Map.of("error", String.valueOf(e.getMessage())));
        } catch (NotFound e) {
            send(ex, 404, Map.of("error", "Không có đường dẫn " + path));
        } catch (IOException e) {
            send(ex, 502, Map.of("error", String.valueOf(e.getMessage())));
        } catch (Exception e) {
            Log.error("Lỗi xử lý {} {}", method, path, e);
            send(ex, 500, Map.of("error", String.valueOf(e.getMessage())));
        }
    }

    private Object route(HttpExchange ex, String method, String path) throws IOException {
        if (method.equals("GET") && path.equals("/api/config")) return config();
        if (method.equals("GET") && path.equals("/api/issues")) return backlog.listIssues();
        if (method.equals("GET") && path.equals("/api/tasks")) return store.all();

        Matcher m = TASK_ACTION.matcher(path);
        if (!m.matches()) throw new NotFound();
        String key = decode(m.group(1));
        String action = m.group(2);
        String rest = m.group(3);

        if (method.equals("DELETE") && action == null) {
            service.delete(key);
            return Map.of("ok", true);
        }
        if (method.equals("GET")) {
            if ("log".equals(action)) return service.log(key, 2000);
            if ("files".equals(action) && rest == null) {
                TaskRecord rec = requireTask(key);
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("dir", props.getRepo().getTasksDir() + "/" + rec.getFolder());
                r.put("files", files.list(rec.getFolder()));
                return r;
            }
            if ("files".equals(action)) {
                TaskRecord rec = requireTask(key);
                String name = decode(rest);
                return Map.of("name", name, "content", files.read(rec.getFolder(), name));
            }
            throw new NotFound();
        }
        if (method.equals("POST") && action != null) {
            Body body = readBody(ex);
            return switch (action) {
                case "start" -> service.start(key);
                case "approve" -> service.approve(key, body.text());
                case "revise" -> service.revise(key, body.text());
                case "followup" -> service.followup(key, body.text(), body.tools());
                case "retry" -> service.retry(key, body.tools());
                case "stop" -> service.stop(key);
                case "done" -> service.markDone(key);
                default -> throw new NotFound();
            };
        }
        throw new NotFound();
    }

    private Map<String, Object> config() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("demo", backlog.isDemo());
        m.put("simulate", props.getClaude().isSimulate());
        m.put("projectKey", props.getBacklog().getProjectKey());
        m.put("repoPath", props.getRepo().getPath());
        m.put("tasksDir", props.getRepo().getTasksDir());
        m.put("model", props.getClaude().getModel());
        m.put("implementSlots", props.getClaude().getImplementSlots());
        m.put("investigateSlots", props.getClaude().getInvestigateSlots());
        String repoError = null;
        try {
            files.repoPath();
        } catch (IllegalStateException e) {
            repoError = e.getMessage();
        }
        m.put("repoError", repoError);
        return m;
    }

    private TaskRecord requireTask(String key) {
        return store.find(key).orElseThrow(() -> new IllegalArgumentException("Không có task " + key));
    }

    private Body readBody(HttpExchange ex) throws IOException {
        byte[] raw = ex.getRequestBody().readAllBytes();
        if (raw.length == 0) return new Body(null, null);
        return json.readValue(raw, Body.class);
    }

    /** Chặn trang web lạ gửi lệnh tới tool đang chạy trên máy (CSRF). */
    private static boolean sameOrigin(HttpExchange ex) {
        String origin = ex.getRequestHeaders().getFirst("Origin");
        if (origin == null || ex.getRequestMethod().equals("GET")) return true;
        String host = ex.getRequestHeaders().getFirst("Host");
        return host != null && (origin.equals("http://" + host) || origin.equals("https://" + host));
    }

    private void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) {
            send(ex, 400, Map.of("error", "Đường dẫn không hợp lệ"));
            return;
        }
        try (InputStream in = HttpApi.class.getResourceAsStream("/static" + path)) {
            if (in == null) {
                byte[] b = "Not found".getBytes(StandardCharsets.UTF_8);
                ex.sendResponseHeaders(404, b.length);
                ex.getResponseBody().write(b);
                ex.close();
                return;
            }
            byte[] b = in.readAllBytes();
            ex.getResponseHeaders().set("Content-Type", contentType(path));
            ex.getResponseHeaders().set("Cache-Control", "no-cache");
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
        } finally {
            ex.close();
        }
    }

    private void send(HttpExchange ex, int status, Object body) throws IOException {
        byte[] b = json.writeValueAsBytes(body);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }

    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static String decode(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    private static final class NotFound extends RuntimeException {
    }
}
