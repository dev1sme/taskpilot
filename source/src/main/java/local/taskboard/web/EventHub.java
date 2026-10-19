package local.taskboard.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Đẩy sự kiện thời gian thực (Server-Sent Events) tới các tab trình duyệt đang mở. */
public class EventHub {

    private final ObjectMapper json;
    private final List<Client> clients = new CopyOnWriteArrayList<>();

    public EventHub(ObjectMapper json) {
        this.json = json;
        ScheduledExecutorService ses = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "sse-heartbeat");
            t.setDaemon(true);
            return t;
        });
        ses.scheduleAtFixedRate(() -> publish("ping", System.currentTimeMillis()), 20, 20, TimeUnit.SECONDS);
    }

    /** Giữ kết nối của trình duyệt mở cho tới khi trình duyệt đóng tab. */
    public void serve(HttpExchange ex) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.getResponseHeaders().set("X-Accel-Buffering", "no");
        ex.sendResponseHeaders(200, 0);
        Client c = new Client(ex.getResponseBody());
        clients.add(c);
        c.send("hello", "\"ok\"");
        try {
            c.closed.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            clients.remove(c);
            try {
                ex.close();
            } catch (Exception ignored) {
            }
        }
    }

    public void publish(String name, Object data) {
        String payload;
        try {
            payload = json.writeValueAsString(data);
        } catch (IOException e) {
            return;
        }
        for (Client c : clients) {
            if (!c.send(name, payload)) clients.remove(c);
        }
    }

    private static final class Client {
        private final OutputStream out;
        private final CountDownLatch closed = new CountDownLatch(1);

        Client(OutputStream out) {
            this.out = out;
        }

        synchronized boolean send(String name, String payload) {
            if (closed.getCount() == 0) return false;
            try {
                out.write(("event: " + name + "\ndata: " + payload + "\n\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
                return true;
            } catch (IOException e) {
                closed.countDown();
                return false;
            }
        }
    }
}
