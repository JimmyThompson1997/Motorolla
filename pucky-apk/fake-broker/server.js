import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const devices = new Map();
const commands = new Map();
const history = [];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, devices: devices.size, history: history.length });
    }
    if (req.method === "GET" && url.pathname === "/devices") {
      return json(res, 200, {
        devices: [...devices.entries()].map(([id, device]) => ({
          device_id: id,
          online: device.socket.readyState === device.socket.OPEN,
          last_seen: device.lastSeen,
          hello: device.hello ?? null
        }))
      });
    }
    if (req.method === "GET" && url.pathname === "/history") {
      return json(res, 200, { history });
    }
    const commandMatch = url.pathname.match(/^\/devices\/([^/]+)\/commands(?:\/([^/]+))?$/);
    if (commandMatch && req.method === "POST" && !commandMatch[2]) {
      const deviceId = decodeURIComponent(commandMatch[1]);
      const body = await readBody(req);
      const command = normalizeCommand(body);
      command.device_id = deviceId;
      command.status = "queued";
      commands.set(command.id, command);
      record({ event: "command_queued", command });
      const device = devices.get(deviceId);
      if (!device || device.socket.readyState !== device.socket.OPEN) {
        command.status = "device_offline";
        return json(res, 409, { error: "DEVICE_OFFLINE", command });
      }
      device.socket.send(JSON.stringify({
        schema: "pucky.command.v1",
        id: command.id,
        type: command.type,
        args: command.args ?? {},
        created_at: command.created_at ?? new Date().toISOString(),
        ttl_ms: command.ttl_ms ?? 30000
      }));
      command.status = "sent";
      record({ event: "command_sent", command });
      return json(res, 202, { command });
    }
    const rawMatch = url.pathname.match(/^\/devices\/([^/]+)\/raw$/);
    if (rawMatch && req.method === "POST") {
      const deviceId = decodeURIComponent(rawMatch[1]);
      const text = await readText(req);
      const device = devices.get(deviceId);
      if (!device || device.socket.readyState !== device.socket.OPEN) {
        return json(res, 409, { error: "DEVICE_OFFLINE" });
      }
      device.socket.send(text);
      record({ event: "raw_sent", device_id: deviceId, text });
      return json(res, 202, { sent: true, text });
    }
    if (commandMatch && req.method === "GET" && commandMatch[2]) {
      const command = commands.get(decodeURIComponent(commandMatch[2]));
      return command ? json(res, 200, command) : json(res, 404, { error: "NOT_FOUND" });
    }
    return json(res, 404, { error: "NOT_FOUND" });
  } catch (error) {
    return json(res, 500, { error: error.message, stack: error.stack });
  }
});

const wss = new WebSocketServer({ server, path: undefined });
wss.on("connection", (socket, req) => {
  const match = req.url.match(/^\/v1\/devices\/([^/]+)\/connect/);
  if (!match) {
    socket.close(1008, "bad path");
    return;
  }
  const deviceId = decodeURIComponent(match[1]);
  const device = { socket, lastSeen: new Date().toISOString(), hello: null };
  devices.set(deviceId, device);
  record({ event: "device_connected", device_id: deviceId });

  socket.on("message", raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      message = { schema: "unknown", raw: raw.toString() };
    }
    device.lastSeen = new Date().toISOString();
    if (message.schema === "pucky.hello.v1") {
      device.hello = message;
    }
    if (message.schema === "pucky.command_ack.v1" || message.schema === "pucky.command_result.v1") {
      const command = commands.get(message.id);
      if (command) {
        command.status = message.status;
        if (message.schema.endsWith("ack.v1")) {
          command.ack = message;
        } else {
          command.result = message;
        }
      }
    }
    record({ event: "device_message", device_id: deviceId, message });
  });

  socket.on("close", (code, reason) => {
    record({ event: "device_closed", device_id: deviceId, code, reason: reason.toString() });
    devices.delete(deviceId);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "fake_broker_listening", port }));
});

function normalizeCommand(body) {
  const command = typeof body === "object" && body ? body : {};
  return {
    id: command.id || `cmd_${randomUUID()}`,
    type: command.type || "ping",
    args: command.args || {},
    ttl_ms: command.ttl_ms || 30000
    , created_at: command.created_at
  };
}

function record(entry) {
  history.push({ timestamp: new Date().toISOString(), ...entry });
  while (history.length > 500) {
    history.shift();
  }
  console.log(JSON.stringify(history[history.length - 1]));
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readText(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
