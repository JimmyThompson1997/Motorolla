package com.pucky.device.local;

import com.pucky.device.ui.PuckyHomeState;
import com.pucky.device.util.Json;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class LocalControlServer implements Closeable {
    public static final int DEFAULT_PORT = 8765;

    private final PuckyHomeState homeState;
    private final int requestedPort;
    private final ExecutorService workers = Executors.newCachedThreadPool();

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile boolean running;
    private volatile int port;

    public LocalControlServer(PuckyHomeState homeState) {
        this(homeState, DEFAULT_PORT);
    }

    public LocalControlServer(PuckyHomeState homeState, int requestedPort) {
        this.homeState = homeState;
        this.requestedPort = requestedPort;
    }

    public synchronized void start() throws IOException {
        if (running) {
            return;
        }
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), requestedPort));
        port = serverSocket.getLocalPort();
        running = true;
        acceptThread = new Thread(this::acceptLoop, "pucky-local-control");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    public int port() {
        return port;
    }

    public boolean isRunning() {
        return running;
    }

    @Override
    public synchronized void close() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // Closing the listener is best-effort during app shutdown.
            }
        }
        workers.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                workers.execute(() -> handle(socket));
            } catch (SocketException e) {
                if (running) {
                    e.printStackTrace();
                }
            } catch (IOException e) {
                if (running) {
                    e.printStackTrace();
                }
            }
        }
    }

    private void handle(Socket socket) {
        try (Socket ignored = socket) {
            socket.setSoTimeout(5000);
            Request request = Request.read(socket.getInputStream());
            Response response = route(request);
            response.write(socket.getOutputStream());
        } catch (Exception e) {
            try {
                Response.json(500, error("internal_error", e.getMessage())).write(socket.getOutputStream());
            } catch (IOException ignored) {
                // The peer may already have closed the connection.
            }
        }
    }

    private Response route(Request request) {
        if ("GET".equals(request.method) && "/v1/health".equals(request.path)) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.local_control.health.v1");
            Json.put(out, "ok", true);
            Json.put(out, "bind", "127.0.0.1");
            Json.put(out, "port", port);
            Json.put(out, "updated_at", Instant.now().toString());
            Json.put(out, "ui_state", homeState.snapshot());
            return Response.json(200, out);
        }
        if ("GET".equals(request.method) && "/v1/ui/state".equals(request.path)) {
            return Response.json(200, homeState.snapshot());
        }
        if ("POST".equals(request.method) && "/v1/ui/render".equals(request.path)) {
            return render(request.bodyJson());
        }
        if ("POST".equals(request.method) && "/v1/command".equals(request.path)) {
            return command(request.bodyJson());
        }
        return Response.json(404, error("not_found", request.method + " " + request.path));
    }

    private Response command(JSONObject body) {
        String type = body.optString("type", "");
        if ("ui.render".equals(type) || "ui.home.render".equals(type)) {
            JSONObject args = body.optJSONObject("args");
            return render(args == null ? new JSONObject() : args);
        }
        if ("ui.state.get".equals(type)) {
            return Response.json(200, homeState.snapshot());
        }
        return Response.json(400, error("unsupported_command", type));
    }

    private Response render(JSONObject body) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.local_control.render_result.v1");
        Json.put(out, "ok", true);
        Json.put(out, "state", homeState.render(body));
        return Response.json(200, out);
    }

    private static JSONObject error(String code, String message) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.local_control.error.v1");
        Json.put(out, "ok", false);
        Json.put(out, "code", code);
        Json.put(out, "message", message == null ? "" : message);
        return out;
    }

    private static final class Request {
        private final String method;
        private final String path;
        private final byte[] body;

        private Request(String method, String path, byte[] body) {
            this.method = method;
            this.path = path;
            this.body = body;
        }

        private JSONObject bodyJson() {
            String raw = new String(body, StandardCharsets.UTF_8).trim();
            if (raw.isEmpty()) {
                return new JSONObject();
            }
            try {
                return new JSONObject(raw);
            } catch (JSONException e) {
                throw new IllegalArgumentException("Invalid JSON body: " + e.getMessage());
            }
        }

        private static Request read(InputStream input) throws IOException {
            byte[] headerBytes = readHeaders(input);
            String headerText = new String(headerBytes, StandardCharsets.ISO_8859_1);
            String[] lines = headerText.split("\\r?\\n");
            if (lines.length == 0 || lines[0].trim().isEmpty()) {
                throw new IOException("Empty request");
            }
            String[] requestLine = lines[0].split(" ");
            if (requestLine.length < 2) {
                throw new IOException("Invalid request line");
            }
            Map<String, String> headers = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int separator = lines[i].indexOf(':');
                if (separator > 0) {
                    headers.put(
                            lines[i].substring(0, separator).trim().toLowerCase(Locale.US),
                            lines[i].substring(separator + 1).trim());
                }
            }
            int length = 0;
            if (headers.containsKey("content-length")) {
                length = Integer.parseInt(headers.get("content-length"));
            }
            byte[] body = readBody(input, Math.max(0, length));
            return new Request(requestLine[0], stripQuery(requestLine[1]), body);
        }

        private static byte[] readBody(InputStream input, int length) throws IOException {
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length) {
                int count = input.read(body, offset, length - offset);
                if (count == -1) {
                    break;
                }
                offset += count;
            }
            if (offset == length) {
                return body;
            }
            byte[] trimmed = new byte[offset];
            System.arraycopy(body, 0, trimmed, 0, offset);
            return trimmed;
        }

        private static byte[] readHeaders(InputStream input) throws IOException {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int matched = 0;
            int value;
            while ((value = input.read()) != -1) {
                out.write(value);
                if ((matched == 0 || matched == 2) && value == '\r') {
                    matched++;
                } else if ((matched == 1 || matched == 3) && value == '\n') {
                    matched++;
                    if (matched == 4) {
                        return out.toByteArray();
                    }
                } else {
                    matched = value == '\r' ? 1 : 0;
                }
                if (out.size() > 8192) {
                    throw new IOException("Headers too large");
                }
            }
            throw new IOException("Incomplete headers");
        }

        private static String stripQuery(String path) {
            int query = path.indexOf('?');
            return query >= 0 ? path.substring(0, query) : path;
        }
    }

    private static final class Response {
        private final int status;
        private final JSONObject body;

        private Response(int status, JSONObject body) {
            this.status = status;
            this.body = body;
        }

        private static Response json(int status, JSONObject body) {
            return new Response(status, body);
        }

        private void write(OutputStream output) throws IOException {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            String statusText = status == 200 ? "OK" : "Error";
            String headers = "HTTP/1.1 " + status + " " + statusText + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Content-Length: " + bytes.length + "\r\n"
                    + "Connection: close\r\n"
                    + "\r\n";
            output.write(headers.getBytes(StandardCharsets.ISO_8859_1));
            output.write(bytes);
            output.flush();
        }
    }
}
