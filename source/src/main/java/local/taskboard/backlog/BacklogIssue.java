package local.taskboard.backlog;

/** Một task (issue) trên Nulab Backlog, rút gọn những trường tool cần. */
public record BacklogIssue(
        String key,
        String summary,
        String description,
        String status,
        String priority,
        String issueType,
        String assignee,
        String updated,
        String url) {
}
