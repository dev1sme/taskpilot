package local.taskboard;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** Ghi log đơn giản ra console. Dùng {} làm chỗ điền tham số. */
public final class Log {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");
    private static final boolean DEBUG = Boolean.getBoolean("board.debug");
    private static final java.io.PrintStream OUT = stream(java.io.FileDescriptor.out);
    private static final java.io.PrintStream ERR = stream(java.io.FileDescriptor.err);

    /** Dùng bảng mã của console nếu nó hỗ trợ tiếng Việt, nếu không thì UTF-8. */
    private static java.io.PrintStream stream(java.io.FileDescriptor fd) {
        java.nio.charset.Charset cs = java.nio.charset.StandardCharsets.UTF_8;
        String enc = System.getProperty("stdout.encoding", System.getProperty("sun.stdout.encoding"));
        try {
            if (enc != null) {
                java.nio.charset.Charset c = java.nio.charset.Charset.forName(enc);
                if (c.newEncoder().canEncode("Tiếng Việt")) cs = c;
            }
        } catch (Exception ignored) {
        }
        return new java.io.PrintStream(new java.io.FileOutputStream(fd), true, cs);
    }

    private Log() {
    }

    public static void info(String msg, Object... args) {
        print("INFO ", msg, args);
    }

    public static void warn(String msg, Object... args) {
        print("WARN ", msg, args);
    }

    public static void error(String msg, Object... args) {
        print("ERROR", msg, args);
    }

    public static void debug(String msg, Object... args) {
        if (DEBUG) print("DEBUG", msg, args);
    }

    private static void print(String level, String msg, Object... args) {
        StringBuilder sb = new StringBuilder();
        int argi = 0;
        for (int i = 0; i < msg.length(); i++) {
            if (msg.charAt(i) == '{' && i + 1 < msg.length() && msg.charAt(i + 1) == '}' && argi < args.length) {
                sb.append(args[argi++]);
                i++;
            } else {
                sb.append(msg.charAt(i));
            }
        }
        Throwable t = argi < args.length && args[args.length - 1] instanceof Throwable th ? th : null;
        String line = LocalTime.now().format(TIME) + " " + level + " " + sb;
        if (t != null) {
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            line += "\n" + sw;
        }
        (level.startsWith("E") || level.startsWith("W") ? ERR : OUT).println(line);
    }
}
