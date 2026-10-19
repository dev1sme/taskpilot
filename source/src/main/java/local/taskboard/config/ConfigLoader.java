package local.taskboard.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Đọc cấu hình từ file YAML.
 * Thứ tự tìm: tham số --config=đường/dẫn.yml → ./application.yml (cạnh nơi chạy) → mặc định trong gói.
 */
public final class ConfigLoader {

    public record Loaded(BoardProperties board, String address, int port, String source) {
    }

    private ConfigLoader() {
    }

    @SuppressWarnings("unchecked")
    public static Loaded load(String[] args) throws IOException {
        Path explicit = null;
        for (String a : args) {
            if (a.startsWith("--config=")) explicit = Path.of(a.substring("--config=".length()));
        }
        Map<String, Object> root;
        String source;
        if (explicit != null) {
            if (!Files.exists(explicit)) throw new IOException("Không thấy file cấu hình " + explicit.toAbsolutePath());
            root = read(Files.newBufferedReader(explicit, StandardCharsets.UTF_8));
            source = explicit.toAbsolutePath().toString();
        } else if (Files.exists(Path.of("application.yml"))) {
            root = read(Files.newBufferedReader(Path.of("application.yml"), StandardCharsets.UTF_8));
            source = Path.of("application.yml").toAbsolutePath().toString();
        } else {
            try (InputStream in = ConfigLoader.class.getResourceAsStream("/application.yml")) {
                root = in == null ? new LinkedHashMap<>() : read(new java.io.InputStreamReader(in, StandardCharsets.UTF_8));
            }
            source = "(mặc định trong gói)";
        }

        Map<String, Object> server = (Map<String, Object>) root.getOrDefault("server", Map.of());
        Map<String, Object> board = (Map<String, Object>) root.getOrDefault("board", Map.of());

        ObjectMapper m = new ObjectMapper()
                .setPropertyNamingStrategy(PropertyNamingStrategies.KEBAB_CASE)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
        BoardProperties props;
        try {
            props = m.convertValue(board == null ? Map.of() : board, BoardProperties.class);
        } catch (IllegalArgumentException e) {
            throw new IOException("Cấu hình 'board' trong " + source + " không hợp lệ: " + e.getMessage(), e);
        }
        String address = String.valueOf(server.getOrDefault("address", "127.0.0.1"));
        int port = Integer.parseInt(String.valueOf(server.getOrDefault("port", 8787)));
        return new Loaded(props, address, port, source);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> read(Reader r) throws IOException {
        try (r) {
            Object o = new Yaml().load(r);
            return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<>();
        }
    }
}
