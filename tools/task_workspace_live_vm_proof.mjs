import path from "node:path";
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
const DEFAULT_BASE_URL = process.env.PUCKY_TASK_PROOF_BASE_URL || "https://pucky.fly.dev";

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: process.env.PUCKY_WORKSPACE_PROOF_TOKEN || process.env.PUCKY_API_TOKEN || process.env.PUCKY_OPERATOR_TOKEN || "",
    timeoutMs: 30000,
    runId: `live-task-proof-${Date.now()}`,
    restoreSeedState: true,
    cleanupFirst: true,
    reportDir: path.resolve("artifacts", "task-workspace-live-proof", new Date().toISOString().replace(/[:.]/g, "-")),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--run-id" && argv[index + 1]) {
      config.runId = String(argv[++index] || config.runId);
    } else if (arg === "--no-restore-seed-state") {
      config.restoreSeedState = false;
    } else if (arg === "--no-cleanup-first") {
      config.cleanupFirst = false;
    }
  }
  return config;
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

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  if (!String(config.apiToken || "").trim()) {
    throw new Error("Live task workspace proof requires --api-token or PUCKY_API_TOKEN/PUCKY_OPERATOR_TOKEN");
  }
  logStep(config, `starting live task workspace proof against ${config.baseUrl}`);
  let browser = null;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    const seed = await seedTaskProofWorkspace(config.baseUrl, config.apiToken, config.runId, {
      cleanupFirst: config.cleanupFirst,
      reportDir: config.reportDir,
    });
    const mobile = await runTaskWorkspaceProofMode(browser, config, "mobile", seed);
    if (config.restoreSeedState) {
      await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
    }
    const desktop = await runTaskWorkspaceProofMode(browser, config, "desktop", seed);
    if (config.restoreSeedState) {
      await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
    }
    const summary = {
      schema: "pucky.task_workspace_live_vm_proof.v1",
      ok: true,
      report_dir: config.reportDir,
      base_url: config.baseUrl,
      seed_manifest_path: seed.seed_manifest_path || "",
      seed_left_in_place: true,
      seed_restored_to_initial_state: Boolean(config.restoreSeedState),
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
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
