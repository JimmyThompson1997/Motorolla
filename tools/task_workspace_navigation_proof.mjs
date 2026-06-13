import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  logStep,
  restoreTaskProofSeed,
  runTaskWorkspaceProofMode,
  seedTaskProofWorkspace,
} from "./task_workspace_proof_shared.mjs";
import {
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile,
} from "./cover_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(ROOT, "tools", "workspace_apps_proof_server.py");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8767;
const DEFAULT_TOKEN = "proof-token";

function parseArgs(argv) {
  const config = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    apiToken: DEFAULT_TOKEN,
    timeoutMs: 20000,
    reportDir: path.resolve(".tmp", "task-workspace-navigation-proof", String(Date.now())),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--host" && argv[index + 1]) {
      config.host = String(argv[++index] || config.host);
    } else if (arg === "--port" && argv[index + 1]) {
      config.port = Number(argv[++index] || config.port) || config.port;
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Number(argv[++index] || config.timeoutMs) || config.timeoutMs;
    }
  }
  return config;
}

async function chooseAvailablePort(host, preferredPort) {
  const tryPort = (port) => new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(0));
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? Number(address.port || 0) : 0;
      server.close(() => resolve(resolvedPort));
    });
  });
  const preferred = await tryPort(preferredPort);
  if (preferred) {
    return preferred;
  }
  const ephemeral = await tryPort(0);
  if (ephemeral) {
    return ephemeral;
  }
  throw new Error("Could not find an available localhost port for the workspace proof server");
}

async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  if (process.env.CODEX_NODE_MODULES) {
    candidates.push(process.env.CODEX_NODE_MODULES);
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(
      process.env.USERPROFILE,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules"
    ));
  }
  candidates.push(path.join(ROOT, "node_modules"));
  for (const candidate of candidates) {
    try {
      const resolved = require.resolve("playwright-core", { paths: [candidate] });
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod?.chromium || mod?.default?.chromium;
      if (chromium) {
        return chromium;
      }
    } catch (_error) {
      // Try next candidate.
    }
  }
  throw new Error("Could not resolve playwright-core from bundled or local node_modules");
}

function startProofServer(config) {
  const stateDir = path.join(config.reportDir, "state");
  fs.rmSync(stateDir, { recursive: true, force: true });
  ensureDir(stateDir);
  const stdoutPath = path.join(config.reportDir, "server.stdout.log");
  const stderrPath = path.join(config.reportDir, "server.stderr.log");
  let stdoutBuffer = "";
  const server = spawn("python", [
    SERVER_SCRIPT,
    "--host", config.host,
    "--port", String(config.port),
    "--api-token", config.apiToken,
    "--state-dir", stateDir,
  ], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", chunk => {
    const text = String(chunk || "");
    stdoutBuffer += text;
    fs.appendFileSync(stdoutPath, text);
  });
  server.stderr.on("data", chunk => fs.appendFileSync(stderrPath, chunk));
  return {
    server,
    stateDir,
    stdoutPath,
    stderrPath,
    getStdoutBuffer: () => stdoutBuffer,
  };
}

function waitForServerReady(runtime, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = String(runtime.getStdoutBuffer?.() || "");
    if (buffer.includes("workspace proof server:")) {
      resolve(buffer);
      return;
    }
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Timed out waiting for workspace proof server to start"));
      }
    }, timeoutMs);
    runtime.server.stdout.on("data", chunk => {
      buffer += String(chunk || "");
      if (!settled && buffer.includes("workspace proof server:")) {
        settled = true;
        clearTimeout(timeout);
        resolve(buffer);
      }
    });
    runtime.server.once("exit", code => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Workspace proof server exited before ready (code ${code ?? "unknown"})`));
      }
    });
  });
}

async function stopProcess(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill();
  await new Promise(resolve => {
    child.once("exit", () => resolve());
    setTimeout(() => resolve(), 2000);
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  logStep(config, "starting task workspace navigation proof");
  config.port = await chooseAvailablePort(config.host, config.port);
  logStep(config, `using localhost port ${config.port}`);
  const serverRuntime = startProofServer(config);
  let browser = null;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    await waitForServerReady(serverRuntime, config.timeoutMs);
    logStep(config, "proof server ready");
    const baseUrl = `http://${config.host}:${config.port}`;
    const seed = await seedTaskProofWorkspace(baseUrl, config.apiToken, `local-task-proof-${Date.now()}`, {
      cleanupFirst: true,
      reportDir: config.reportDir,
    });
    const mobile = await runTaskWorkspaceProofMode(browser, { ...config, baseUrl }, "mobile", seed);
    await restoreTaskProofSeed(baseUrl, config.apiToken, seed);
    const desktop = await runTaskWorkspaceProofMode(browser, { ...config, baseUrl }, "desktop", seed);
    await restoreTaskProofSeed(baseUrl, config.apiToken, seed);
    const summary = {
      schema: "pucky.task_workspace_navigation_proof.v2",
      ok: true,
      report_dir: config.reportDir,
      seed_manifest_path: seed.seed_manifest_path || "",
      base_url: baseUrl,
      server: {
        host: config.host,
        port: config.port,
        state_dir: serverRuntime.stateDir,
        stdout_log: serverRuntime.stdoutPath,
        stderr_log: serverRuntime.stderrPath,
      },
      mobile,
      desktop,
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopProcess(serverRuntime.server);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
