import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  idleTurnStatus,
  installCodexPuckyBridge,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const reportRoot = path.join(repoRoot, ".tmp", "session-model-defaults-proof");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = path.join(reportRoot, runId);
const consoleLogPath = path.join(reportDir, "console.log");
const serverLogPath = path.join(reportDir, "server.log");
const summaryPath = path.join(reportDir, "summary.json");
const tracePath = path.join(reportDir, "trace.zip");
const turnLogsPath = path.join(reportDir, "turn-log-entries.json");
const videoDir = path.join(reportDir, "videos");

const VIEWPORT = { width: 430, height: 932 };
const TURN_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];
const TURN_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh"];
const TURN_REPLY_MODES = ["card_only", "card_and_spoken"];
const TURN_ARRIVAL_CUE_MODES = ["none", "haptic", "chime", "haptic_and_chime"];
const DEFAULT_TURN_MODEL = "gpt-5.4-mini";
const DEFAULT_TURN_REASONING_EFFORT = "low";
const DEFAULT_API_TOKEN = "session-model-defaults-proof-token";

class ProofError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProofError";
    this.details = details;
  }
}

function shortIso() {
  return new Date().toISOString();
}

function settingLabelForModel(value) {
  if (value === "gpt-5.4") return "GPT-5.4";
  if (value === "gpt-5.4-nano") return "GPT-5.4 nano";
  return "GPT-5.4 mini";
}

function settingLabelForReasoning(value) {
  if (value === "none") return "None";
  if (value === "medium") return "Medium";
  if (value === "high") return "High";
  if (value === "xhigh") return "Extra high";
  return "Low";
}

function normalizeModel(value) {
  const clean = String(value || "").trim().toLowerCase();
  return TURN_MODEL_OPTIONS.includes(clean) ? clean : DEFAULT_TURN_MODEL;
}

function normalizeReasoningEffort(value) {
  const clean = String(value || "").trim().toLowerCase();
  return TURN_REASONING_EFFORT_OPTIONS.includes(clean) ? clean : DEFAULT_TURN_REASONING_EFFORT;
}

function createTurnSettings(overrides = {}) {
  const model = normalizeModel(overrides.model);
  const reasoningEffort = normalizeReasoningEffort(overrides.reasoning_effort);
  const replyMode = String(overrides.reply_mode || "card_only").trim().toLowerCase() === "card_and_spoken"
    ? "card_and_spoken"
    : "card_only";
  const arrivalCueMode = String(overrides.arrival_cue_mode || "chime").trim().toLowerCase();
  return {
    schema: "pucky.turn_settings.v1",
    reply_mode: replyMode,
    spoken_reply_enabled: replyMode === "card_and_spoken",
    arrival_cue_mode: TURN_ARRIVAL_CUE_MODES.includes(arrivalCueMode) ? arrivalCueMode : "chime",
    accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
    model,
    reasoning_effort: reasoningEffort,
    modes: TURN_REPLY_MODES,
    arrival_cue_modes: TURN_ARRIVAL_CUE_MODES,
    model_options: TURN_MODEL_OPTIONS,
    reasoning_effort_options: TURN_REASONING_EFFORT_OPTIONS
  };
}

function createThreadScope(overrides = {}) {
  const threadId = String(overrides.thread_id || "").trim();
  const active = Boolean(overrides.active ?? threadId);
  return {
    schema: "pucky.voice_thread_scope.v1",
    mode: active ? String(overrides.mode || "existing_thread") : "new_thread",
    thread_id: active ? threadId : "",
    card_id: active ? String(overrides.card_id || "").trim() : "",
    session_id: active ? String(overrides.session_id || "").trim() : "",
    source_surface: active ? String(overrides.source_surface || "").trim() : "",
    label: active ? String(overrides.label || "").trim() : "",
    updated_at: String(overrides.updated_at || shortIso()),
    active
  };
}

function createWakeStatus() {
  return {
    schema: "pucky.wake_word_status.v4",
    enabled: false,
    requested_enabled: false,
    running: false,
    state: "idle",
    suspended_reason: "",
    engine: "android_stt_sentinel",
    requested_engine: "android_stt_sentinel",
    effective_engine: "stopped",
    mode: "android_stt_wake",
    scope: "awake_and_unlocked_foreground",
    debug_recognizer_mode: "android",
    recognizer_state: "idle",
    restart_count: 0,
    last_restart_reason: "",
    last_transcript: "",
    last_alternatives: [],
    last_error_code: "",
    last_error_message: "",
    last_match: {
      matched_phrase: "",
      match_source: "",
      matched_at: ""
    },
    proof_indicator: {
      active: false,
      visual_state: "idle",
      matched_phrase: "",
      transcript: "",
      remaining_ms: 0,
      expires_at_elapsed_ms: 0
    }
  };
}

function createUiSurface(baseUrl) {
  const url = `${baseUrl}/ui/pucky/latest/`;
  return {
    schema: "pucky.ui_surface.v1",
    requested_url: url,
    active_url: url,
    entrypoint_url: url,
    fallback_asset_url: "",
    ui_version: "session-model-defaults-proof",
    source_kind: "local_server",
    bridge_connected: true
  };
}

function createBridgeState(baseUrl) {
  return {
    baseUrl,
    turnSettings: createTurnSettings(),
    threadScope: createThreadScope(),
    wakeStatus: createWakeStatus(),
    defaultAudioSpeed: 1,
    lastTurnId: "",
    lastTurnStatus: idleTurnStatus(),
    requestLog: []
  };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ProofError(`HTTP ${response.status} for ${url}`, {
      url,
      status: response.status,
      payload
    });
  }
  return payload;
}

async function fetchAllFeedItems(baseUrl, token) {
  const items = [];
  const seen = new Set();
  let cursor = "";
  for (let guard = 0; guard < 20; guard += 1) {
    const params = new URLSearchParams({
      limit: "100",
      include_archived: "1"
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const payload = await fetchJson(`${baseUrl}/api/feed?${params.toString()}`, {
      headers: authHeaders(token)
    });
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    for (const item of pageItems) {
      const key = String(item?.card_id || item?.session_id || item?.turn_id || `${items.length}`);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
    }
    if (!payload.has_more || !payload.next_cursor) {
      break;
    }
    cursor = String(payload.next_cursor);
  }
  return {
    schema: "pucky.reply_cards.v1",
    count: items.length,
    cards: items
  };
}

async function fetchTurnStatus(baseUrl, token, turnId) {
  if (!turnId) {
    return idleTurnStatus();
  }
  return fetchJson(`${baseUrl}/api/turn/status?turn_id=${encodeURIComponent(turnId)}`, {
    headers: authHeaders(token)
  });
}

function summarizeOrigin(origin) {
  const value = origin && typeof origin === "object" ? origin : {};
  return {
    thread_id: String(value.thread_id || ""),
    source: String(value.source || ""),
    model: String(value.model || ""),
    model_provider: String(value.model_provider || ""),
    reasoning_effort: String(value.reasoning_effort || "")
  };
}

function summarizeTurnResult(result) {
  return {
    card_id: String(result?.card_id || ""),
    session_id: String(result?.session_id || ""),
    turn_id: String(result?.turn_id || ""),
    title: String(result?.title || result?.card?.title || ""),
    origin: summarizeOrigin(result?.origin || result?.card?.origin),
    telemetry: {
      requested_model: String(result?.telemetry?.requested_model || ""),
      requested_reasoning_effort: String(result?.telemetry?.requested_reasoning_effort || ""),
      origin_model: String(result?.telemetry?.origin_model || ""),
      origin_reasoning_effort: String(result?.telemetry?.origin_reasoning_effort || ""),
      requested_thread_mode: String(result?.telemetry?.requested_thread_mode || ""),
      requested_thread_id: String(result?.telemetry?.requested_thread_id || ""),
      thread_mode: String(result?.telemetry?.thread_mode || ""),
      thread_reused: Boolean(result?.telemetry?.thread_reused)
    }
  };
}

function summarizeFeedItem(item) {
  return {
    card_id: String(item?.card_id || ""),
    session_id: String(item?.session_id || ""),
    turn_id: String(item?.turn_id || ""),
    title: String(item?.title || ""),
    summary: String(item?.summary || ""),
    origin: summarizeOrigin(item?.origin)
  };
}

function summarizeLogEntry(entry) {
  return {
    event: String(entry?.event || ""),
    turn_id: String(entry?.turn_id || ""),
    session_id: String(entry?.session_id || ""),
    status: String(entry?.status || ""),
    requested_model: String(entry?.requested_model || ""),
    requested_reasoning_effort: String(entry?.requested_reasoning_effort || ""),
    origin_thread_id: String(entry?.origin_thread_id || ""),
    origin_model: String(entry?.origin_model || ""),
    origin_reasoning_effort: String(entry?.origin_reasoning_effort || ""),
    requested_thread_id: String(entry?.requested_thread_id || ""),
    thread_mode: String(entry?.thread_mode || ""),
    thread_reused: Boolean(entry?.thread_reused)
  };
}

function recordAssertion(scenario, label, expected, actual) {
  scenario.assertions.push({
    label,
    expected,
    actual,
    pass: expected === actual
  });
  if (expected !== actual) {
    throw new ProofError(`Assertion failed: ${label}`, {
      scenario: scenario.name,
      expected,
      actual
    });
  }
}

function recordCondition(scenario, label, pass, actual) {
  scenario.assertions.push({
    label,
    pass: Boolean(pass),
    actual
  });
  if (!pass) {
    throw new ProofError(`Assertion failed: ${label}`, {
      scenario: scenario.name,
      actual
    });
  }
}

function parseStructuredLogs(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    const text = String(line || "").trim();
    if (!text.startsWith("{") || !text.endsWith("}")) {
      continue;
    }
    try {
      parsed.push(JSON.parse(text));
    } catch (_) {
      // Ignore non-JSON log lines.
    }
  }
  return parsed;
}

async function waitForStructuredLogEntry(logPath, turnId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = parseStructuredLogs(logPath).filter((entry) => String(entry?.turn_id || "") === turnId);
    if (entries.length) {
      return entries[entries.length - 1];
    }
    await delay(250);
  }
  throw new ProofError(`Timed out waiting for structured log entry for ${turnId}`, {
    turn_id: turnId,
    log_path: logPath
  });
}

async function waitForServerReady(baseUrl, child, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ProofError("Local pucky_vm server exited before becoming ready", {
        exit_code: child.exitCode,
        server_log: serverLogPath
      });
    }
    try {
      const response = await fetch(`${baseUrl}/ui/pucky/latest/manifest.json`, {
        cache: "no-store"
      });
      if (response.ok) {
        return;
      }
    } catch (_) {
      // Keep polling until the local server is ready.
    }
    await delay(500);
  }
  throw new ProofError("Timed out waiting for local pucky_vm server to start", {
    base_url: baseUrl,
    server_log: serverLogPath
  });
}

function startServerProcess(port) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PORT: String(port),
    PUCKY_PORT: String(port),
    PUCKY_API_TOKEN: DEFAULT_API_TOKEN,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || "dg-proof",
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY || "",
    PUCKY_FEED_DB_PATH: path.join(reportDir, "pucky_feed.sqlite3"),
    PUCKY_ACTION_LEDGER_PATH: path.join(reportDir, "pucky_action_ledger.sqlite3"),
    PUCKY_DB_PATH: path.join(reportDir, "pucky_broker.sqlite3"),
    PUCKY_CODEX_MODEL: DEFAULT_TURN_MODEL,
    PUCKY_CODEX_REASONING_EFFORT: DEFAULT_TURN_REASONING_EFFORT,
    CODEX_APP_SERVER_COMMAND: "cmd /c codex app-server --listen stdio://"
  };
  const child = spawn("python", ["-c", "from pucky_vm.server import main; raise SystemExit(main())"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const append = (prefix) => (chunk) => {
    fs.appendFileSync(serverLogPath, `${prefix}${String(chunk)}`, "utf8");
  };
  child.stdout.on("data", append(""));
  child.stderr.on("data", append("[stderr] "));
  child.on("error", (error) => {
    fs.appendFileSync(serverLogPath, `[spawn-error] ${error.stack || error.message}\n`, "utf8");
  });
  return { child, env };
}

function terminateServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    child.kill();
  } catch (_) {
    // Fall through to taskkill below.
  }
  if (child.exitCode === null) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function describePage(page) {
  return page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      return window.PuckyUiDebug.describe();
    }
    return {};
  });
}

async function waitForAppShell(page, timeoutMs = 30000) {
  await page.waitForSelector(".app-shell", { timeout: timeoutMs });
  await page.waitForTimeout(200);
}

async function openSettings(page) {
  await page.locator('[data-route="settings"]').click();
  await page.waitForSelector(".settings-page", { timeout: 30000 });
  await page.waitForTimeout(150);
}

async function goHome(page) {
  await page.evaluate(() => window.PuckyUiDebug.dispatch("goto_home", {}));
  await waitForAppShell(page);
  await page.waitForTimeout(200);
}

async function refreshFeed(page) {
  await page.evaluate(() => window.PuckyUiDebug.dispatch("refresh_cards", {}));
  await page.waitForTimeout(300);
}

async function currentSettingLabel(page, settingId) {
  const selector = `[data-setting-id="${settingId}"] .settings-selector-button-label`;
  await page.locator(selector).waitFor({ state: "visible", timeout: 15000 });
  const text = await page.locator(selector).textContent();
  return String(text || "").trim();
}

async function assertTextVisible(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
}

async function selectSettingOption(page, settingId, nextValue, expectedLabel, overlayShotPath = "") {
  await page.locator(`[data-setting-id="${settingId}"] .settings-selector-button`).click();
  await page.waitForSelector("#settingsSelectorOverlay.is-open", { timeout: 15000 });
  if (overlayShotPath) {
    await page.screenshot({ path: overlayShotPath, fullPage: true });
  }
  await page.locator(`#settingsSelectorOverlay .settings-selector-option[data-selector-value="${nextValue}"]`).click();
  await page.waitForFunction(() => {
    const overlay = document.getElementById("settingsSelectorOverlay");
    return Boolean(overlay && !overlay.classList.contains("is-open"));
  }, {}, { timeout: 15000 });
  const label = await currentSettingLabel(page, settingId);
  if (label !== expectedLabel) {
    throw new ProofError(`Settings UI did not update ${settingId} to ${expectedLabel}`, {
      setting_id: settingId,
      expected_label: expectedLabel,
      actual_label: label
    });
  }
  return label;
}

async function waitForVisibleCard(page, sessionId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const surface = await describePage(page);
    const cards = Array.isArray(surface.visible_cards) ? surface.visible_cards : [];
    if (cards.some((item) => String(item?.session_id || "") === sessionId || String(item?.card_id || "") === sessionId)) {
      return surface;
    }
    await refreshFeed(page);
    await delay(350);
  }
  throw new ProofError(`Timed out waiting for card ${sessionId} to appear in the feed`, {
    session_id: sessionId
  });
}

async function sendTextTurn(baseUrl, token, bridgeState, options) {
  const payload = {
    text: options.text,
    turn_id: options.turn_id,
    reply_mode: "card_only",
    thread_mode: options.thread_mode || "new",
    model: options.model,
    reasoning_effort: options.reasoning_effort,
    ...(options.thread_id ? { thread_id: options.thread_id } : {})
  };
  const result = await fetchJson(`${baseUrl}/api/turn/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(payload)
  });
  bridgeState.lastTurnId = String(options.turn_id);
  bridgeState.lastTurnStatus = await fetchTurnStatus(baseUrl, token, bridgeState.lastTurnId);
  return {
    payload,
    result
  };
}

async function feedItemByTurnId(baseUrl, token, turnId) {
  const snapshot = await fetchAllFeedItems(baseUrl, token);
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const item = cards.find((entry) => {
    const sessionId = String(entry?.session_id || "");
    const entryTurnId = String(entry?.turn_id || "");
    return sessionId === turnId || entryTurnId === turnId;
  });
  if (!item) {
    throw new ProofError(`Persisted feed item not found for ${turnId}`, {
      turn_id: turnId
    });
  }
  return item;
}

async function buildScenarioRecord(page, baseUrl, token, bridgeState, definition, summary) {
  const scenario = {
    name: definition.name,
    started_at: shortIso(),
    expected: {
      selected_model: definition.selectedModel,
      selected_reasoning_effort: definition.selectedReasoning,
      expected_origin_model: definition.expectedOriginModel,
      expected_origin_reasoning_effort: definition.expectedOriginReasoning,
      thread_mode: definition.threadMode
    },
    assertions: [],
    screenshots: {},
    ui: {},
    request: {},
    response: {},
    turn_status: {},
    feed_item: {},
    log_entry: {}
  };

  await openSettings(page);
  scenario.screenshots.settings_before = await saveScreenshot(page, reportDir, `${definition.slug}-settings-before`);
  scenario.screenshots.model_overlay = path.join(reportDir, `${definition.slug}-model-overlay.png`);
  scenario.screenshots.reasoning_overlay = path.join(reportDir, `${definition.slug}-reasoning-overlay.png`);
  await selectSettingOption(
    page,
    "turn-model",
    definition.selectedModel,
    settingLabelForModel(definition.selectedModel),
    scenario.screenshots.model_overlay
  );
  await selectSettingOption(
    page,
    "turn-reasoning-effort",
    definition.selectedReasoning,
    settingLabelForReasoning(definition.selectedReasoning),
    scenario.screenshots.reasoning_overlay
  );
  scenario.screenshots.settings_after = await saveScreenshot(page, reportDir, `${definition.slug}-settings-after`);
  scenario.ui.setting_labels = {
    model: await currentSettingLabel(page, "turn-model"),
    reasoning_effort: await currentSettingLabel(page, "turn-reasoning-effort")
  };
  scenario.ui.settings_snapshot = await describePage(page);

  recordAssertion(scenario, "UI model label", settingLabelForModel(definition.selectedModel), scenario.ui.setting_labels.model);
  recordAssertion(
    scenario,
    "UI reasoning label",
    settingLabelForReasoning(definition.selectedReasoning),
    scenario.ui.setting_labels.reasoning_effort
  );

  const request = await sendTextTurn(baseUrl, token, bridgeState, {
    text: definition.prompt,
    turn_id: definition.turnId,
    thread_mode: definition.threadMode,
    thread_id: definition.threadId,
    model: bridgeState.turnSettings.model,
    reasoning_effort: bridgeState.turnSettings.reasoning_effort
  });
  scenario.request = request.payload;
  scenario.response = summarizeTurnResult(request.result);
  scenario.turn_status = await fetchTurnStatus(baseUrl, token, definition.turnId);
  const logEntry = await waitForStructuredLogEntry(serverLogPath, definition.turnId);
  scenario.log_entry = summarizeLogEntry(logEntry);
  const feedItem = await feedItemByTurnId(baseUrl, token, definition.turnId);
  scenario.feed_item = summarizeFeedItem(feedItem);

  await goHome(page);
  scenario.ui.feed_before_refresh = await describePage(page);
  await refreshFeed(page);
  scenario.ui.feed_after_refresh = await waitForVisibleCard(page, definition.turnId, 30000);
  scenario.screenshots.feed = await saveScreenshot(page, reportDir, `${definition.slug}-feed`);

  recordAssertion(scenario, "Request model payload", definition.selectedModel, String(scenario.request.model || ""));
  recordAssertion(
    scenario,
    "Request reasoning payload",
    definition.selectedReasoning,
    String(scenario.request.reasoning_effort || "")
  );
  recordAssertion(
    scenario,
    "Response telemetry requested_model",
    definition.selectedModel,
    scenario.response.telemetry.requested_model
  );
  recordAssertion(
    scenario,
    "Response telemetry requested_reasoning_effort",
    definition.selectedReasoning,
    scenario.response.telemetry.requested_reasoning_effort
  );
  recordAssertion(
    scenario,
    "Response origin model",
    definition.expectedOriginModel,
    scenario.response.origin.model
  );
  recordAssertion(
    scenario,
    "Response origin reasoning_effort",
    definition.expectedOriginReasoning,
    scenario.response.origin.reasoning_effort
  );
  recordAssertion(
    scenario,
    "Feed origin model",
    definition.expectedOriginModel,
    scenario.feed_item.origin.model
  );
  recordAssertion(
    scenario,
    "Feed origin reasoning_effort",
    definition.expectedOriginReasoning,
    scenario.feed_item.origin.reasoning_effort
  );
  recordAssertion(
    scenario,
    "Structured log requested_model",
    definition.selectedModel,
    scenario.log_entry.requested_model
  );
  recordAssertion(
    scenario,
    "Structured log requested_reasoning_effort",
    definition.selectedReasoning,
    scenario.log_entry.requested_reasoning_effort
  );
  recordAssertion(
    scenario,
    "Structured log origin_model",
    definition.expectedOriginModel,
    scenario.log_entry.origin_model
  );
  recordAssertion(
    scenario,
    "Structured log origin_reasoning_effort",
    definition.expectedOriginReasoning,
    scenario.log_entry.origin_reasoning_effort
  );
  recordAssertion(
    scenario,
    "Turn status result",
    "ok",
    String(scenario.turn_status.status || "")
  );
  recordAssertion(
    scenario,
    "Turn status turn_id",
    definition.turnId,
    String(scenario.turn_status.turn_id || "")
  );
  recordCondition(
    scenario,
    "Visible feed card includes new session",
    Array.isArray(scenario.ui.feed_after_refresh.visible_cards)
      && scenario.ui.feed_after_refresh.visible_cards.some((item) => String(item?.session_id || "") === definition.turnId),
    scenario.ui.feed_after_refresh.visible_cards
  );

  scenario.finished_at = shortIso();
  summary.scenarios.push(scenario);
  return scenario;
}

async function run() {
  ensureDir(reportDir);
  ensureDir(videoDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");
  fs.writeFileSync(serverLogPath, "", "utf8");

  const summary = {
    schema: "pucky.session_model_defaults_proof.v1",
    report_dir: reportDir,
    started_at: shortIso(),
    console_log_path: consoleLogPath,
    server_log_path: serverLogPath,
    trace_path: tracePath,
    turn_logs_path: turnLogsPath,
    scenarios: []
  };

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const { child, env } = startServerProcess(port);
  summary.base_url = baseUrl;
  summary.server_env = {
    port,
    feed_db_path: env.PUCKY_FEED_DB_PATH,
    action_ledger_path: env.PUCKY_ACTION_LEDGER_PATH,
    broker_db_path: env.PUCKY_DB_PATH,
    codex_model: env.PUCKY_CODEX_MODEL,
    codex_reasoning_effort: env.PUCKY_CODEX_REASONING_EFFORT,
    deepgram_key_stubbed: env.DEEPGRAM_API_KEY === "dg-proof"
  };

  let browser;
  let context;
  let page;
  let pageVideo = null;

  try {
    await waitForServerReady(baseUrl, child);

    const chromePath = resolveChromePath();
    summary.chrome_path = chromePath;
    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        "--disable-extensions",
        "--autoplay-policy=no-user-gesture-required"
      ]
    });

    const bridgeState = createBridgeState(baseUrl);
    const bridgeHandler = async (message) => {
      const command = String(message?.command || "");
      const args = message && typeof message.args === "object" && message.args ? message.args : {};
      bridgeState.requestLog.push({
        at: shortIso(),
        command,
        args
      });
      if (command === "pucky.turn.settings.get") {
        return bridgeState.turnSettings;
      }
      if (command === "pucky.turn.settings.set") {
        bridgeState.turnSettings = createTurnSettings({
          ...bridgeState.turnSettings,
          ...args
        });
        return bridgeState.turnSettings;
      }
      if (command === "ui.reply_cards.get") {
        return fetchAllFeedItems(baseUrl, DEFAULT_API_TOKEN);
      }
      if (command === "pucky.feed.sync") {
        const snapshot = await fetchAllFeedItems(baseUrl, DEFAULT_API_TOKEN);
        return {
          schema: "pucky.feed_sync_result.v1",
          configured: true,
          reason: String(args.reason || "session_model_defaults_proof"),
          snapshot
        };
      }
      if (command === "pucky.turn.status") {
        bridgeState.lastTurnStatus = await fetchTurnStatus(baseUrl, DEFAULT_API_TOKEN, bridgeState.lastTurnId);
        return bridgeState.lastTurnStatus;
      }
      if (command === "voice.thread_scope.get") {
        return bridgeState.threadScope;
      }
      if (command === "voice.thread_scope.set") {
        bridgeState.threadScope = createThreadScope(args);
        return bridgeState.threadScope;
      }
      if (command === "voice.thread_scope.clear") {
        bridgeState.threadScope = createThreadScope();
        return bridgeState.threadScope;
      }
      if (command === "wake.status") {
        return bridgeState.wakeStatus;
      }
      if (command === "ui.default_audio_speed.get") {
        return {
          schema: "pucky.default_audio_speed.v1",
          speed: bridgeState.defaultAudioSpeed
        };
      }
      if (command === "ui.surface.get") {
        return createUiSurface(baseUrl);
      }
      if (command === "pucky.config.get") {
        return {
          schema: "pucky.config.v1",
          api_base_url: baseUrl
        };
      }
      if (command === "browser.open") {
        return {
          launched: true,
          uri: String(args.url || "")
        };
      }
      if (command === "pucky.turn.sent_cue.test" || command === "pucky.turn.arrival_cue.test") {
        return {
          schema: "pucky.turn_arrival_cue_playback.v1",
          test: true,
          arrival_cue_mode: String(bridgeState.turnSettings.arrival_cue_mode || "chime"),
          played: true
        };
      }
      if (command === "pucky.turn.received_cue.test") {
        return {
          schema: "pucky.turn_reply_received_cue_playback.v1",
          test: true,
          played: true
        };
      }
      throw new ProofError(`Unsupported bridge command: ${command}`, {
        command,
        args
      });
    };

    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: {
        dir: videoDir,
        size: VIEWPORT
      }
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await installCodexPuckyBridge(context, bridgeHandler);

    page = await context.newPage();
    pageVideo = page.video();
    attachPageLogging(page, consoleLogPath);

    await page.goto(`${baseUrl}/ui/pucky/latest/`, { waitUntil: "load", timeout: 180000 });
    await waitForAppShell(page);

    await openSettings(page);
    await assertTextVisible(page, "Session model");
    await assertTextVisible(page, "Thinking level");
    await assertTextVisible(page, "Applies to new sessions.");

    const baselineScenario = {
      name: "baseline",
      started_at: shortIso(),
      assertions: [],
      screenshots: {},
      ui: {}
    };
    baselineScenario.ui.setting_labels = {
      model: await currentSettingLabel(page, "turn-model"),
      reasoning_effort: await currentSettingLabel(page, "turn-reasoning-effort")
    };
    recordAssertion(baselineScenario, "Baseline model label", "GPT-5.4 mini", baselineScenario.ui.setting_labels.model);
    recordAssertion(baselineScenario, "Baseline reasoning label", "Low", baselineScenario.ui.setting_labels.reasoning_effort);
    baselineScenario.ui.surface = await describePage(page);
    baselineScenario.screenshots.settings = await saveScreenshot(page, reportDir, "00-baseline-settings");
    baselineScenario.finished_at = shortIso();
    summary.scenarios.push(baselineScenario);

    const scenario1 = await buildScenarioRecord(
      page,
      baseUrl,
      DEFAULT_API_TOKEN,
      bridgeState,
      {
        name: "override-away-from-default",
        slug: "01-override",
        selectedModel: "gpt-5.4",
        selectedReasoning: "medium",
        expectedOriginModel: "gpt-5.4",
        expectedOriginReasoning: "medium",
        threadMode: "new",
        turnId: `proof-model-defaults-override-${Date.now()}`,
        prompt: "Scenario override-away-from-default. Reply with one short sentence only. Do not use external app tools."
      },
      summary
    );

    const scenario2 = await buildScenarioRecord(
      page,
      baseUrl,
      DEFAULT_API_TOKEN,
      bridgeState,
      {
        name: "revert-to-current-default",
        slug: "02-revert",
        selectedModel: "gpt-5.4-mini",
        selectedReasoning: "low",
        expectedOriginModel: "gpt-5.4-mini",
        expectedOriginReasoning: "low",
        threadMode: "new",
        turnId: `proof-model-defaults-revert-${Date.now()}`,
        prompt: "Scenario revert-to-current-default. Reply with one short sentence only. Do not use external app tools."
      },
      summary
    );

    const scenario3 = await buildScenarioRecord(
      page,
      baseUrl,
      DEFAULT_API_TOKEN,
      bridgeState,
      {
        name: "existing-thread-safety",
        slug: "03-existing-thread",
        selectedModel: "gpt-5.4-nano",
        selectedReasoning: "high",
        expectedOriginModel: scenario1.response.origin.model,
        expectedOriginReasoning: scenario1.response.origin.reasoning_effort,
        threadMode: "existing",
        threadId: scenario1.response.origin.thread_id,
        turnId: `proof-model-defaults-existing-${Date.now()}`,
        prompt: "Scenario existing-thread-safety. Reply with one short sentence only. Do not use external app tools."
      },
      summary
    );

    recordAssertion(
      scenario3,
      "Existing-thread telemetry requested_thread_id",
      scenario1.response.origin.thread_id,
      scenario3.response.telemetry.requested_thread_id
    );
    recordAssertion(
      scenario3,
      "Existing-thread response thread_id",
      scenario1.response.origin.thread_id,
      scenario3.response.origin.thread_id
    );
    recordAssertion(
      scenario3,
      "Existing-thread structured log requested_thread_id",
      scenario1.response.origin.thread_id,
      scenario3.log_entry.requested_thread_id
    );

    const structuredTurnLogs = [
      scenario1.log_entry,
      scenario2.log_entry,
      scenario3.log_entry
    ];
    writeJsonFile(turnLogsPath, structuredTurnLogs);
    summary.structured_turn_logs = structuredTurnLogs;
    summary.bridge_request_count = bridgeState.requestLog.length;
    summary.bridge_request_log = bridgeState.requestLog;
    summary.finished_at = shortIso();
    summary.status = "ok";
    writeJsonFile(summaryPath, summary);
  } finally {
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath }).catch(() => {});
      }
    } catch (_) {
      // Best effort during teardown.
    }
    let videoPath = "";
    try {
      if (context) {
        await context.close();
      }
      if (pageVideo) {
        videoPath = await pageVideo.path();
      }
    } catch (_) {
      // Best effort during teardown.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Best effort during teardown.
    }
    terminateServer(child);
    if (videoPath && fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      summary.video_path = videoPath;
      writeJsonFile(summaryPath, summary);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    summary_path: summaryPath,
    trace_path: tracePath,
    server_log_path: serverLogPath,
    console_log_path: consoleLogPath,
    turn_logs_path: turnLogsPath
  }));
}

run().catch((error) => {
  ensureDir(reportDir);
  writeAutomationError(reportDir, error);
  try {
    const failureSummary = {
      schema: "pucky.session_model_defaults_proof.v1",
      status: "failed",
      report_dir: reportDir,
      started_at: shortIso(),
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        details: error?.details || {}
      }
    };
    writeJsonFile(summaryPath, failureSummary);
  } catch (_) {
    // Ignore follow-on summary failures.
  }
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
