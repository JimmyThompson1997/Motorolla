import http from "node:http";

const [deviceId, type, argsJson = "{}"] = process.argv.slice(2);
if (!deviceId || !type) {
  console.error("Usage: node send-command.js <device_id> <type> [argsJson]");
  process.exit(2);
}

const body = JSON.stringify({ type, args: JSON.parse(argsJson) });
const req = http.request({
  host: "127.0.0.1",
  port: Number(process.env.PORT || 8787),
  method: "POST",
  path: `/devices/${encodeURIComponent(deviceId)}/commands`,
  headers: {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  }
}, res => {
  const chunks = [];
  res.on("data", chunk => chunks.push(chunk));
  res.on("end", () => {
    console.log(Buffer.concat(chunks).toString("utf8"));
    process.exit(res.statusCode >= 400 ? 1 : 0);
  });
});
req.on("error", error => {
  console.error(error);
  process.exit(1);
});
req.end(body);
