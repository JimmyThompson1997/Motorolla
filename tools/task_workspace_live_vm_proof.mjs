import path from "node:path";
import { execFileSync } from "node:child_process";
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

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  const proofToken = String(process.env.PUCKY_WORKSPACE_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  const operatorToken = String(process.env.PUCKY_OPERATOR_TOKEN || "").trim();
  if (operatorToken) {
    return operatorToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function localGitState() {
  try {
    return {
      head: runGit(["rev-parse", "HEAD"]),
      headShort: runGit(["rev-parse", "--short", "HEAD"]),
    };
  } catch (_error) {
    return {
      head: "",
      headShort: "",
    };
  }
}

async function fetchRemoteManifest(baseUrl, refreshKey) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load remote manifest (${response.status}) from ${url.toString()}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload || typeof payload !== "object") {
    throw new Error(`Remote manifest from ${url.toString()} was not valid JSON`);
  }
  return {
    manifest: payload,
    manifestUrl: url.toString(),
  };
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    runId: `live-task-proof-${Date.now()}`,
    restoreSeedState: true,
    cleanupFirst: true,
    filterOnly: false,
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
    } else if (arg === "--filter-only") {
      config.filterOnly = true;
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
    throw new Error("Live task workspace proof requires --api-token or PUCKY_WEB_UI_TOKEN/PUCKY_API_TOKEN/PUCKY_OPERATOR_TOKEN/PUCKY_WORKSPACE_PROOF_TOKEN");
  }
  const gitState = localGitState();
  config.refreshKey = gitState.headShort || `manual-${Date.now()}`;
  logStep(config, `starting live task workspace proof against ${config.baseUrl}`);
  let browser = null;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    const remoteManifestResult = await fetchRemoteManifest(config.baseUrl, config.refreshKey);
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
      manifest_url: remoteManifestResult.manifestUrl,
      remote_manifest: remoteManifestResult.manifest,
      source_commit_full: String(remoteManifestResult.manifest?.source_commit_full || gitState.head || ""),
      source_commit_short: String(remoteManifestResult.manifest?.source_commit_short || gitState.headShort || ""),
      ui_version: String(remoteManifestResult.manifest?.ui_version || ""),
      refresh_key: config.refreshKey,
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
