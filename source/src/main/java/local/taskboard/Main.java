package local.taskboard;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.sun.net.httpserver.HttpServer;
import local.taskboard.agent.AgentRunner;
import local.taskboard.agent.CliAgentRunner;
import local.taskboard.agent.SimulatedAgentRunner;
import local.taskboard.backlog.BacklogClient;
import local.taskboard.config.BoardProperties;
import local.taskboard.config.ConfigLoader;
import local.taskboard.task.Prompts;
import local.taskboard.task.TaskFiles;
import local.taskboard.task.TaskService;
import local.taskboard.task.TaskStore;
import local.taskboard.web.EventHub;
import local.taskboard.web.HttpApi;

import java.awt.Desktop;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.concurrent.Executors;

/** Điểm khởi động: java -jar claude-task-board.jar [--config=application.yml] [--no-browser] */
public final class Main {

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        ConfigLoader.Loaded cfg = ConfigLoader.load(args);
        BoardProperties props = cfg.board();

        ObjectMapper json = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        BacklogClient backlog = new BacklogClient(props, json);
        TaskStore store = new TaskStore(props, json);
        TaskFiles files = new TaskFiles(props);
        Prompts prompts = new Prompts(props);
        EventHub hub = new EventHub(json);
        AgentRunner runner = props.getClaude().isSimulate()
                ? new SimulatedAgentRunner(Long.getLong("board.simulate.stepMillis", 1200L))
                : new CliAgentRunner(props.getClaude(), json);
        TaskService service = new TaskService(props, store, files, prompts, backlog, runner, hub);

        HttpServer server = HttpServer.create(new InetSocketAddress(cfg.address(), cfg.port()), 0);
        server.createContext("/", new HttpApi(service, store, files, backlog, props, hub, json));
        server.setExecutor(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "http");
            t.setDaemon(true);
            return t;
        }));
        server.start();

        String url = "http://" + ("0.0.0.0".equals(cfg.address()) ? "localhost" : cfg.address()) + ":" + cfg.port() + "/";
        Log.info("Cấu hình: {}", cfg.source());
        Log.info("Backlog: {}", backlog.isDemo() ? "chế độ DEMO (chưa cấu hình base-url/api-key)" : props.getBacklog().getBaseUrl());
        Log.info("Claude: {}", props.getClaude().isSimulate() ? "GIẢ LẬP (simulate=true)" : props.getClaude().getCommand());
        Log.info("Repo: {}", props.getRepo().getPath().isBlank() ? "(chưa cấu hình board.repo.path)" : props.getRepo().getPath());
        Log.info("Claude Task Board đang chạy tại {}", url);

        boolean noBrowser = false;
        for (String a : args) if (a.equals("--no-browser")) noBrowser = true;
        if (!noBrowser) openBrowser(url);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
            }
        } catch (Throwable ignored) {
            // Máy không có giao diện đồ họa: tự mở trình duyệt theo địa chỉ ở trên.
        }
    }
}
