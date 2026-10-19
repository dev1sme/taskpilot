package local.taskboard.task;

import local.taskboard.backlog.BacklogIssue;
import local.taskboard.config.BoardProperties;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Quản lý tài liệu .md của task.
 *
 * <p>Claude Code chạy nền không được phép ghi vào thư mục .claude/ của repo (thư mục được bảo vệ),
 * nên Claude ghi vào "thư mục làm việc" riêng của task (~/.claude-task-board/work/&lt;tên&gt;),
 * còn tool sao chép các file .md đó sang &lt;repo&gt;/.claude/tasks/&lt;tên&gt;/ sau mỗi lần ghi.</p>
 */
public class TaskFiles {

    private static final Pattern SAFE_NAME = Pattern.compile("[\\p{L}\\p{N} ._()\\-]+\\.md");

    private final BoardProperties props;

    public TaskFiles(BoardProperties props) {
        this.props = props;
    }

    public Path repoPath() {
        String p = props.getRepo().getPath();
        if (p == null || p.isBlank()) {
            throw new IllegalStateException("Chưa cấu hình board.repo.path (đường dẫn repo code) trong application.yml");
        }
        Path repo = Path.of(p).toAbsolutePath().normalize();
        if (!Files.isDirectory(repo)) throw new IllegalStateException("Không thấy thư mục repo: " + repo);
        return repo;
    }

    public String folderName(BacklogIssue issue) {
        String name = props.getRepo().getFolderPattern()
                .replace("{issueKey}", issue.key())
                .replace("{slug}", slug(issue.summary()));
        name = name.replaceAll("[\\\\/:*?\"<>|]", "-").replaceAll("-{2,}", "-").replaceAll("^-|-$", "");
        return name.isBlank() ? issue.key() : name;
    }

    /** Thư mục tài liệu trong repo: &lt;repo&gt;/.claude/tasks/&lt;tên&gt; */
    public Path repoTaskDir(String folder) {
        return repoPath().resolve(props.getRepo().getTasksDir()).resolve(folder).normalize();
    }

    /** Thư mục làm việc của Claude cho task này (ngoài repo). */
    public Path workDir(String folder) {
        return props.dataPath().resolve("work").resolve(folder).normalize();
    }

    /** Chuẩn bị thư mục: lấy lại tài liệu cũ (nếu có) và ghi 00-task.md từ nội dung Backlog. */
    public void seed(String folder, BacklogIssue issue) throws IOException {
        Path work = workDir(folder);
        Path repoDir = repoTaskDir(folder);
        Files.createDirectories(work);
        Files.createDirectories(repoDir);
        try (Stream<Path> s = Files.list(repoDir)) {
            for (Path f : s.filter(TaskFiles::isMd).toList()) {
                Path target = work.resolve(f.getFileName().toString());
                if (!Files.exists(target)) Files.copy(f, target);
            }
        }
        String task = "# " + issue.key() + ": " + issue.summary() + "\n\n"
                + "- Loại: " + issue.issueType() + "\n"
                + "- Ưu tiên: " + issue.priority() + "\n"
                + "- Trạng thái trên Backlog: " + issue.status() + "\n"
                + (issue.url().isBlank() ? "" : "- Link: " + issue.url() + "\n")
                + "\n## Mô tả\n\n" + (issue.description().isBlank() ? "(không có mô tả)" : issue.description()) + "\n";
        Files.writeString(work.resolve("00-task.md"), task, StandardCharsets.UTF_8);
        mirror(folder);
    }

    /** Sao chép các file .md mới/thay đổi từ thư mục làm việc sang .claude/tasks/&lt;tên&gt; trong repo. */
    public synchronized void mirror(String folder) {
        Path work = workDir(folder);
        if (!Files.isDirectory(work)) return;
        try {
            Path repoDir = repoTaskDir(folder);
            Files.createDirectories(repoDir);
            try (Stream<Path> s = Files.list(work)) {
                for (Path f : s.filter(TaskFiles::isMd).toList()) {
                    Path target = repoDir.resolve(f.getFileName().toString());
                    byte[] src = Files.readAllBytes(f);
                    if (!Files.exists(target) || !Arrays.equals(src, Files.readAllBytes(target))) {
                        Files.write(target, src);
                    }
                }
            }
        } catch (IOException | IllegalStateException e) {
            // Không làm hỏng lượt chạy vì lỗi sao chép; lần sau sẽ thử lại.
        }
    }

    public List<FileInfo> list(String folder) throws IOException {
        Path dir = preferredDir(folder);
        if (!Files.isDirectory(dir)) return List.of();
        List<FileInfo> out = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            for (Path f : s.filter(TaskFiles::isMd).sorted().toList()) {
                out.add(new FileInfo(f.getFileName().toString(), Files.size(f), Files.getLastModifiedTime(f).toMillis()));
            }
        }
        return out;
    }

    public String read(String folder, String name) throws IOException {
        if (!SAFE_NAME.matcher(name).matches()) throw new IllegalArgumentException("Tên file không hợp lệ");
        Path dir = preferredDir(folder);
        Path f = dir.resolve(name).normalize();
        if (!f.getParent().equals(dir.normalize())) throw new IllegalArgumentException("Tên file không hợp lệ");
        return Files.readString(f, StandardCharsets.UTF_8);
    }

    public String readIfExists(String folder, String name) {
        try {
            return read(folder, name);
        } catch (Exception e) {
            return null;
        }
    }

    private Path preferredDir(String folder) {
        try {
            Path repoDir = repoTaskDir(folder);
            if (Files.isDirectory(repoDir)) return repoDir;
        } catch (IllegalStateException ignored) {
        }
        return workDir(folder);
    }

    private static boolean isMd(Path p) {
        return Files.isRegularFile(p) && p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".md");
    }

    static String slug(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s.replace('đ', 'd').replace('Đ', 'D'), Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-|-$", "");
        return n.length() > 40 ? n.substring(0, 40).replaceAll("-$", "") : n;
    }

    public record FileInfo(String name, long size, long modified) {
    }
}
