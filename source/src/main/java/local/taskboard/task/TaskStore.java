package local.taskboard.task;

import local.taskboard.Log;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import local.taskboard.config.BoardProperties;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Lưu danh sách task vào ~/.claude-task-board/tasks.json và log từng task vào logs/&lt;key&gt;.jsonl. */
public class TaskStore {


    private final ObjectMapper json;
    private final Path file;
    private final Path logsDir;
    private final Map<String, TaskRecord> tasks = new ConcurrentHashMap<>();

    public TaskStore(BoardProperties props, ObjectMapper json) throws IOException {
        this.json = json.copy().enable(SerializationFeature.INDENT_OUTPUT);
        Path data = props.dataPath();
        Files.createDirectories(data);
        this.file = data.resolve("tasks.json");
        this.logsDir = data.resolve("logs");
        Files.createDirectories(logsDir);
        load();
    }

    private void load() {
        if (!Files.exists(file)) return;
        try {
            List<TaskRecord> list = json.readValue(file.toFile(), new TypeReference<List<TaskRecord>>() {
            });
            for (TaskRecord t : list) {
                // Tool vừa khởi động lại: các lượt đang chạy dở coi như đã dừng.
                if (t.isRunning() || t.isQueued()) {
                    t.setRunning(false);
                    t.setQueued(false);
                    t.setStage(TaskRecord.Stage.STOPPED);
                    t.setLastActivity("Tool đã khởi động lại khi task đang chạy");
                }
                tasks.put(t.getIssueKey(), t);
            }
        } catch (IOException e) {
            Log.error("Không đọc được {}: {}", file, e.getMessage());
        }
    }

    public Optional<TaskRecord> find(String key) {
        return Optional.ofNullable(tasks.get(key));
    }

    public Collection<TaskRecord> all() {
        List<TaskRecord> list = new ArrayList<>(tasks.values());
        list.sort(Comparator.comparing(TaskRecord::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder())));
        return list;
    }

    public void put(TaskRecord t) {
        tasks.put(t.getIssueKey(), t);
        save();
    }

    public void remove(String key) {
        tasks.remove(key);
        save();
    }

    public synchronized void save() {
        try {
            Path tmp = file.resolveSibling("tasks.json.tmp");
            json.writeValue(tmp.toFile(), new ArrayList<>(tasks.values()));
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            Log.error("Không lưu được {}: {}", file, e.getMessage());
        }
    }

    public synchronized void appendLog(String key, LogLine line) {
        try (BufferedWriter w = Files.newBufferedWriter(logFile(key), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
            w.write(json.copy().disable(SerializationFeature.INDENT_OUTPUT).writeValueAsString(line));
            w.newLine();
        } catch (IOException e) {
            Log.warn("Không ghi được log của {}: {}", key, e.getMessage());
        }
    }

    public List<LogLine> readLog(String key, int limit) {
        Path f = logFile(key);
        if (!Files.exists(f)) return List.of();
        try {
            List<String> lines = Files.readAllLines(f, StandardCharsets.UTF_8);
            List<LogLine> out = new ArrayList<>();
            for (String l : lines.subList(Math.max(0, lines.size() - limit), lines.size())) {
                try {
                    out.add(json.readValue(l, LogLine.class));
                } catch (IOException ignored) {
                }
            }
            return out;
        } catch (IOException e) {
            return List.of();
        }
    }

    private Path logFile(String key) {
        return logsDir.resolve(key.replaceAll("[^A-Za-z0-9_.-]", "_") + ".jsonl");
    }
}
