package local.taskboard.task;

import local.taskboard.config.BoardProperties;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Đọc mẫu prompt (investigate.md, implement.md, revise.md, retry.md) và thay biến {{ten}}.
 * Muốn sửa prompt: copy thư mục prompts/ ra ngoài và đặt board.prompts-dir trỏ tới đó.
 */
public class Prompts {

    private final BoardProperties props;

    public Prompts(BoardProperties props) {
        this.props = props;
    }

    public String render(String name, Map<String, String> vars) {
        String tpl = load(name);
        for (Map.Entry<String, String> e : vars.entrySet()) {
            tpl = tpl.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue());
        }
        return tpl;
    }

    private String load(String name) {
        String dir = props.getPromptsDir();
        try {
            if (dir != null && !dir.isBlank()) {
                Path p = Path.of(dir, name + ".md");
                if (Files.exists(p)) return Files.readString(p, StandardCharsets.UTF_8);
            }
            try (InputStream in = Prompts.class.getResourceAsStream("/prompts/" + name + ".md")) {
                if (in == null) throw new IOException("không có trong gói");
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Không đọc được prompt " + name + ": " + e.getMessage(), e);
        }
    }
}
