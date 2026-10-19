package local.taskboard.task;

/**
 * Một dòng nhật ký hiển thị trong tab Tiến trình.
 *
 * @param ts   thời điểm (epoch millis)
 * @param kind info | text | tool | ok | error | denied | result | phase
 * @param text nội dung
 */
public record LogLine(long ts, String kind, String text) {
    public static LogLine now(String kind, String text) {
        return new LogLine(System.currentTimeMillis(), kind, text);
    }
}
