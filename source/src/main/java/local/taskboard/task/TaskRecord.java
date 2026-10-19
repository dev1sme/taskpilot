package local.taskboard.task;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Trạng thái một task mà tool đang quản lý. Lưu vào tasks.json. */
public class TaskRecord {

    public enum Stage { INVESTIGATING, PLAN_REVIEW, IMPLEMENTING, DONE, FAILED, STOPPED }

    public enum Phase { INVESTIGATE, IMPLEMENT }

    private String issueKey;
    private String summary;
    private String description;
    private String url;
    private String folder;
    private Stage stage;
    private Phase phase;
    private boolean running;
    private boolean queued;
    private String sessionId;
    private double costUsd;
    private String lastActivity;
    private String lastResult;
    private List<String> denials = new ArrayList<>();
    private List<String> extraAllowedTools = new ArrayList<>();
    private Instant createdAt;
    private Instant updatedAt;
    private Instant runStartedAt;

    public void touch() {
        updatedAt = Instant.now();
    }

    public String getIssueKey() { return issueKey; }
    public void setIssueKey(String issueKey) { this.issueKey = issueKey; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    public String getFolder() { return folder; }
    public void setFolder(String folder) { this.folder = folder; }
    public Stage getStage() { return stage; }
    public void setStage(Stage stage) { this.stage = stage; }
    public Phase getPhase() { return phase; }
    public void setPhase(Phase phase) { this.phase = phase; }
    public boolean isRunning() { return running; }
    public void setRunning(boolean running) { this.running = running; }
    public boolean isQueued() { return queued; }
    public void setQueued(boolean queued) { this.queued = queued; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public double getCostUsd() { return costUsd; }
    public void setCostUsd(double costUsd) { this.costUsd = costUsd; }
    public String getLastActivity() { return lastActivity; }
    public void setLastActivity(String lastActivity) { this.lastActivity = lastActivity; }
    public String getLastResult() { return lastResult; }
    public void setLastResult(String lastResult) { this.lastResult = lastResult; }
    public List<String> getDenials() { return denials; }
    public void setDenials(List<String> denials) { this.denials = denials; }
    public List<String> getExtraAllowedTools() { return extraAllowedTools; }
    public void setExtraAllowedTools(List<String> extraAllowedTools) { this.extraAllowedTools = extraAllowedTools; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Instant getRunStartedAt() { return runStartedAt; }
    public void setRunStartedAt(Instant runStartedAt) { this.runStartedAt = runStartedAt; }
}
