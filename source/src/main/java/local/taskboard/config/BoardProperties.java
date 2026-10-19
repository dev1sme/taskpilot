package local.taskboard.config;


import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Toàn bộ cấu hình của tool, đọc từ application.yml (tiền tố "board"). */
public class BoardProperties {

    /** Nơi tool lưu dữ liệu riêng: danh sách task, log, thư mục làm việc của Claude. */
    private String dataDir = System.getProperty("user.home") + "/.claude-task-board";
    /** Thư mục chứa prompt tùy chỉnh. Để trống thì dùng prompt mặc định đóng gói sẵn. */
    private String promptsDir = "";
    /** Ngôn ngữ Claude dùng khi viết tài liệu .md. */
    private String docLanguage = "tiếng Việt";

    private Repo repo = new Repo();
    private Backlog backlog = new Backlog();
    private Claude claude = new Claude();

    public Path dataPath() {
        return Path.of(dataDir).toAbsolutePath().normalize();
    }

    public static class Repo {
        /** Đường dẫn tới repo code mà Claude sẽ làm việc. */
        private String path = "";
        /** Thư mục tài liệu task, tương đối với repo. */
        private String tasksDir = ".claude/tasks";
        /** Tên thư mục cho mỗi task. Hỗ trợ {issueKey} và {slug}. */
        private String folderPattern = "{issueKey}";

        public String getPath() { return path; }
        public void setPath(String path) { this.path = path; }
        public String getTasksDir() { return tasksDir; }
        public void setTasksDir(String tasksDir) { this.tasksDir = tasksDir; }
        public String getFolderPattern() { return folderPattern; }
        public void setFolderPattern(String folderPattern) { this.folderPattern = folderPattern; }
    }

    public static class Backlog {
        /** Ví dụ: https://tencongty.backlog.com hoặc https://tencongty.backlog.jp. Để trống = chế độ demo. */
        private String baseUrl = "";
        private String apiKey = "";
        /** Mã project trên Backlog, ví dụ PROJ. */
        private String projectKey = "";
        /** Chỉ hiện task được giao cho mình. */
        private boolean onlyMine = true;
        /** Ẩn các task có trạng thái này. */
        private List<String> excludeStatuses = new ArrayList<>(List.of("完了", "Closed", "Đóng"));
        /** Tên trạng thái sẽ chuyển sang khi bấm Start. Để trống = không đổi. */
        private String statusOnStart = "";
        /** Tên trạng thái sẽ chuyển sang khi Claude làm xong. Để trống = không đổi. */
        private String statusOnDone = "";
        /** Đăng tóm tắt kết quả thành comment trên task khi làm xong. */
        private boolean commentOnDone = true;

        public boolean isDemo() {
            return baseUrl == null || baseUrl.isBlank() || apiKey == null || apiKey.isBlank();
        }

        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getProjectKey() { return projectKey; }
        public void setProjectKey(String projectKey) { this.projectKey = projectKey; }
        public boolean isOnlyMine() { return onlyMine; }
        public void setOnlyMine(boolean onlyMine) { this.onlyMine = onlyMine; }
        public List<String> getExcludeStatuses() { return excludeStatuses; }
        public void setExcludeStatuses(List<String> excludeStatuses) { this.excludeStatuses = excludeStatuses; }
        public String getStatusOnStart() { return statusOnStart; }
        public void setStatusOnStart(String statusOnStart) { this.statusOnStart = statusOnStart; }
        public String getStatusOnDone() { return statusOnDone; }
        public void setStatusOnDone(String statusOnDone) { this.statusOnDone = statusOnDone; }
        public boolean isCommentOnDone() { return commentOnDone; }
        public void setCommentOnDone(boolean commentOnDone) { this.commentOnDone = commentOnDone; }
    }

    public static class Claude {
        /** Lệnh chạy Claude Code. Có thể là đường dẫn đầy đủ tới claude / claude.exe. */
        private String command = "claude";
        /** Model, ví dụ sonnet hoặc opus. Để trống = mặc định của Claude Code. */
        private String model = "";
        /** true = không gọi Claude thật, chỉ giả lập để thử giao diện. */
        private boolean simulate = false;
        /** Số task được điều tra song song (chỉ đọc code nên chạy song song an toàn). */
        private int investigateSlots = 3;
        /** Số task được code cùng lúc. Để 1 vì các task cùng sửa một repo. */
        private int implementSlots = 1;
        private int maxTurns = 0;
        private double maxBudgetUsd = 0;
        /** Công cụ được dùng ở bước điều tra (ngoài quyền ghi vào thư mục tài liệu của task). */
        private List<String> investigateAllowedTools = new ArrayList<>(List.of("Read", "Glob", "Grep"));
        /** Lệnh shell được tự động cho phép ở bước code. Lệnh khác sẽ bị từ chối và hiện trên giao diện. */
        private List<String> implementAllowedTools = new ArrayList<>(List.of(
                "Bash(mvn *)", "Bash(./mvnw *)", "Bash(mvnw *)", "Bash(gradle *)", "Bash(./gradlew *)",
                "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git add *)",
                "Bash(git commit *)", "Bash(git checkout -b *)", "Bash(git switch -c *)"));
        /** Tham số bổ sung truyền thẳng cho claude. */
        private List<String> extraArgs = new ArrayList<>();

        public String getCommand() { return command; }
        public void setCommand(String command) { this.command = command; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public boolean isSimulate() { return simulate; }
        public void setSimulate(boolean simulate) { this.simulate = simulate; }
        public int getInvestigateSlots() { return investigateSlots; }
        public void setInvestigateSlots(int investigateSlots) { this.investigateSlots = investigateSlots; }
        public int getImplementSlots() { return implementSlots; }
        public void setImplementSlots(int implementSlots) { this.implementSlots = implementSlots; }
        public int getMaxTurns() { return maxTurns; }
        public void setMaxTurns(int maxTurns) { this.maxTurns = maxTurns; }
        public double getMaxBudgetUsd() { return maxBudgetUsd; }
        public void setMaxBudgetUsd(double maxBudgetUsd) { this.maxBudgetUsd = maxBudgetUsd; }
        public List<String> getInvestigateAllowedTools() { return investigateAllowedTools; }
        public void setInvestigateAllowedTools(List<String> v) { this.investigateAllowedTools = v; }
        public List<String> getImplementAllowedTools() { return implementAllowedTools; }
        public void setImplementAllowedTools(List<String> v) { this.implementAllowedTools = v; }
        public List<String> getExtraArgs() { return extraArgs; }
        public void setExtraArgs(List<String> extraArgs) { this.extraArgs = extraArgs; }
    }

    public String getDataDir() { return dataDir; }
    public void setDataDir(String dataDir) { this.dataDir = dataDir; }
    public String getPromptsDir() { return promptsDir; }
    public void setPromptsDir(String promptsDir) { this.promptsDir = promptsDir; }
    public String getDocLanguage() { return docLanguage; }
    public void setDocLanguage(String docLanguage) { this.docLanguage = docLanguage; }
    public Repo getRepo() { return repo; }
    public void setRepo(Repo repo) { this.repo = repo; }
    public Backlog getBacklog() { return backlog; }
    public void setBacklog(Backlog backlog) { this.backlog = backlog; }
    public Claude getClaude() { return claude; }
    public void setClaude(Claude claude) { this.claude = claude; }
}
