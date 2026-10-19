package local.taskboard.agent;

import java.nio.file.Path;
import java.util.List;

/**
 * Mô tả một lần chạy Claude Code ở chế độ không tương tác (claude -p).
 *
 * @param label           tên bước (investigate, implement, revise, followup, retry) – dùng cho log và chế độ giả lập
 * @param cwd             thư mục repo, nơi Claude chạy
 * @param workDir         thư mục tài liệu riêng của task (Claude được ghi vào đây)
 * @param prompt          nội dung prompt, gửi qua stdin
 * @param resumeSessionId tiếp tục phiên cũ nếu khác null
 * @param permissionMode  default | acceptEdits | ...
 * @param allowedTools    các quy tắc --allowedTools
 * @param disallowedTools các quy tắc --disallowedTools
 */
public record RunSpec(String label, Path cwd, Path workDir, String prompt, String resumeSessionId,
                      String permissionMode, List<String> allowedTools, List<String> disallowedTools) {
}
