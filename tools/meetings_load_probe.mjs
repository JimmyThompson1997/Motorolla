import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  idleTurnStatus,
  installCodexPuckyBridge,
  readRuntimeFixtures,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_API_BASE = "https://pucky.fly.dev";
const DEFAULT_PAGE_URL = `${DEFAULT_API_BASE}/ui/pucky/latest/index.html?route=feed&reset_nav=1`;
const DEFAULT_TOKEN = process.env.PUCKY_API_TOKEN || "pucky-local-dev-token";
const MEETINGS_CACHE_KEY = "pucky.cover.meetings_cache.v1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    apiBase: process.env.PUCKY_LINKS_API_BASE || DEFAULT_API_BASE,
    apiToken: DEFAULT_TOKEN,
    pageUrl: DEFAULT_PAGE_URL,
    reportDir: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-base") {
      config.apiBase = String(argv[++index] || config.apiBase);
    } else if (arg === "--api-token") {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--page-url") {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir") {
      config.reportDir = String(argv[++index] || "");
    }
  }
  config.apiBase = String(config.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  return config;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emptyReplyCards() {
  return {
    schema: "pucky.reply_cards.v1",
    count: 0,
    cards: []
  };
}

function bridgeState(apiBase, apiToken) {
  return {
    apiBase,
    apiToken,
    replyCards: readRuntimeFixtures(repoRoot) || emptyReplyCards(),
    threadScope: {
      schema: "pucky.voice_thread_scope.v1",
      mode: "new_thread",
      thread_id: "",
      card_id: "",
      session_id: "",
      source_surface: "",
      label: "",
      updated_at: new Date().toISOString(),
      active: false
    }
  };
}

function bridgeResponse(state, message) {
  const command = String(message?.command || "");
  const args = message?.args && typeof message.args === "object" ? message.args : {};
  if (command === "ui.reply_cards.get" || command === "pucky.feed.sync") {
    return state.replyCards;
  }
  if (command === "pucky.turn.status") {
    return idleTurnStatus();
  }
  if (command === "pucky.turn.settings.get") {
    return {
      schema: "pucky.turn_settings.v1",
      reply_mode: "card_only",
      spoken_reply_enabled: false,
      arrival_cue_mode: "chime",
      accepted_chime_enabled: true,
      modes: ["card_only", "card_and_spoken"],
      arrival_cue_modes: ["none", "haptic", "chime", "haptic_and_chime"]
    };
  }
  if (command === "wake.status") {
    return {
      schema: "pucky.wake_word_status.v4",
      enabled: false,
      requested_enabled: false,
      running: false,
      state: "idle",
      proof_indicator: {
        active: false,
        visual_state: "idle",
        matched_phrase: "",
        transcript: "",
        remaining_ms: 0
      }
    };
  }
  if (command === "ui.surface.get") {
    return {
      schema: "pucky.ui_surface_status.v1",
      source_kind: "bundle_current",
      entrypoint_url: "",
      ui_version: "meetings-load-probe"
    };
  }
  if (command === "ui.default_audio_speed.get") {
    return {
      schema: "pucky.default_audio_speed.v1",
      speed: 1
    };
  }
  if (command === "meeting.recording.status") {
    return {
      schema: "pucky.meeting_recording_status.v1",
      state: "idle",
      active_meeting_id: null,
      meetings: []
    };
  }
  if (command === "voice.thread_scope.get") {
    return state.threadScope;
  }
  if (command === "voice.thread_scope.set") {
    state.threadScope = {
      ...state.threadScope,
      ...args,
      updated_at: new Date().toISOString(),
      active: Boolean(args?.thread_id || args?.session_id || args?.card_id)
    };
    return state.threadScope;
  }
  if (command === "voice.thread_scope.clear") {
    state.threadScope = {
      schema: "pucky.voice_thread_scope.v1",
      mode: "new_thread",
      thread_id: "",
      card_id: "",
      session_id: "",
      source_surface: "",
      label: "",
      updated_at: new Date().toISOString(),
      active: false
    };
    return state.threadScope;
  }
  if (command === "pucky.config.get") {
    return {
      schema: "pucky.config.v1",
      api_base_url: state.apiBase,
      api_token: state.apiToken
    };
  }
  if (command === "browser.open") {
    return { launched: true, uri: String(args.url || "") };
  }
  return {};
}

async function installApiProxy(context, apiBase, apiToken, requestLog, responseLog) {
  await context.route(`${apiBase}/api/**`, async route => {
    const request = route.request();
    const headers = { ...request.headers() };
    delete headers.origin;
    if (apiToken && !headers.authorization) {
      headers.authorization = `Bearer ${apiToken}`;
    }
    requestLog.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url()
    });
    const response = await route.fetch({
      method: request.method(),
      headers,
      postData: request.postDataBuffer() || undefined
    });
    const body = await response.body();
    responseLog.push({
      at: new Date().toISOString(),
      url: request.url(),
      status: response.status(),
      body_bytes: body.length,
      server_timing: String(response.headers()["server-timing"] || "")
    });
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body
    });
  });
}

async function readMeetingsMetrics(page) {
  return page.evaluate(() => {
    if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.meetingsMetrics !== "function") {
      return null;
    }
    return JSON.parse(JSON.stringify(window.PuckyUiDebug.meetingsMetrics()));
  });
}

async function readMeetingRows(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll(".meeting-row")).map(row => ({
      title: String(row.querySelector(".meeting-row-title")?.textContent || "").trim(),
      subtitle: String(row.querySelector(".meeting-row-subtitle")?.textContent || "").trim(),
      state: String(row.querySelector(".meeting-row-state")?.textContent || "").trim()
    }));
  });
}

async function waitForRoute(page, route, timeoutMs = 15000) {
  await page.waitForFunction(
    expected => document.querySelector(".app-shell")?.getAttribute("data-view") === expected,
    route,
    { timeout: timeoutMs }
  );
}

async function waitForMeetingRows(page, timeoutMs = 15000) {
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll(".meeting-row").length;
    if (rows <= 0) {
      return false;
    }
    if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.meetingsMetrics !== "function") {
      return true;
    }
    const metrics = window.PuckyUiDebug.meetingsMetrics();
    return Number(metrics.records_count || 0) > 0 && rows > 0;
  }, null, { timeout: timeoutMs });
}

async function clickRoute(page, route) {
  await page.click(`[data-route="${route}"]`);
  await waitForRoute(page, route);
}

async function saveShot(page, reportDir, name) {
  return saveScreenshot(page, reportDir, name);
}

function meetingsResponses(responseLog) {
  return responseLog.filter(entry => entry.url.includes("/api/meetings?compact=1"));
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const reportDir = config.reportDir || path.join(repoRoot, ".tmp", "meetings-load-probe", timestampSlug());
  ensureDir(reportDir);
  const consoleLogPath = path.join(reportDir, "console.log");
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const requestLog = [];
  const responseLog = [];
  const bridge = bridgeState(config.apiBase, config.apiToken);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: resolveChromePath()
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    await installCodexPuckyBridge(context, message => bridgeResponse(bridge, message));
    await installApiProxy(context, config.apiBase, config.apiToken, requestLog, responseLog);
    const page = await context.newPage();
    attachPageLogging(page, consoleLogPath);

    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.PuckyUiDebug && document.querySelector(".app-shell")), null, { timeout: 15000 });
    await page.evaluate(cacheKey => localStorage.removeItem(cacheKey), MEETINGS_CACHE_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.PuckyUiDebug && document.querySelector(".app-shell")), null, { timeout: 15000 });
    await waitForRoute(page, "feed");
    await saveShot(page, reportDir, "feed-initial");

    const coldRequestStart = meetingsResponses(responseLog).length;
    const coldStartedAt = Date.now();
    await clickRoute(page, "meetings");
    await waitForMeetingRows(page, 20000);
    const coldMs = Date.now() - coldStartedAt;
    const coldMetrics = await readMeetingsMetrics(page);
    const coldRows = await readMeetingRows(page);
    const coldRequestCount = meetingsResponses(responseLog).length - coldRequestStart;
    await saveShot(page, reportDir, "meetings-cold");

    await clickRoute(page, "feed");
    await sleep(150);

    const warmRequestStart = meetingsResponses(responseLog).length;
    const warmStartedAt = Date.now();
    await clickRoute(page, "meetings");
    await waitForMeetingRows(page, 5000);
    const warmMs = Date.now() - warmStartedAt;
    const warmMetrics = await readMeetingsMetrics(page);
    const warmRows = await readMeetingRows(page);
    const warmRequestCount = meetingsResponses(responseLog).length - warmRequestStart;
    await saveShot(page, reportDir, "meetings-warm");

    const refreshRequestStart = meetingsResponses(responseLog).length;
    const refreshResponsePromise = page.waitForResponse(
      response => response.url().includes("/api/meetings?compact=1"),
      { timeout: 20000 }
    );
    await page.click(".meetings-refresh");
    await refreshResponsePromise;
    await page.waitForFunction(() => {
      if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.meetingsMetrics !== "function") {
        return false;
      }
      return !window.PuckyUiDebug.meetingsMetrics().refresh_in_flight;
    }, null, { timeout: 20000 });
    const refreshMetrics = await readMeetingsMetrics(page);
    const refreshRows = await readMeetingRows(page);
    const refreshRequestCount = meetingsResponses(responseLog).length - refreshRequestStart;
    await saveShot(page, reportDir, "meetings-refresh");

    const meetingResponses = meetingsResponses(responseLog);
    const latestMeetingResponse = meetingResponses[meetingResponses.length - 1] || null;
    const coldRenderReadyMs = Number(coldMetrics?.last_render_ready_ms || 0);
    const warmRenderReadyMs = Number(warmMetrics?.last_render_ready_ms || 0);
    const refreshRenderReadyMs = Number(refreshMetrics?.last_render_ready_ms || 0);
    const summary = {
      schema: "pucky.meetings_load_probe.v1",
      page_url: config.pageUrl,
      api_base: config.apiBase,
      report_dir: reportDir,
      cold_switch_ms: coldMs,
      warm_switch_ms: warmMs,
      cold_request_delta: coldRequestCount,
      warm_request_delta: warmRequestCount,
      refresh_request_delta: refreshRequestCount,
      latest_payload_bytes: Number(latestMeetingResponse?.body_bytes || 0),
      cold_render_ready_ms: coldRenderReadyMs,
      warm_render_ready_ms: warmRenderReadyMs,
      refresh_render_ready_ms: refreshRenderReadyMs,
      cold_metrics: coldMetrics,
      warm_metrics: warmMetrics,
      refresh_metrics: refreshMetrics,
      cold_row_count: coldRows.length,
      warm_row_count: warmRows.length,
      refresh_row_count: refreshRows.length,
      cold_rows_sample: coldRows.slice(0, 5),
      warm_rows_sample: warmRows.slice(0, 5),
      meeting_requests: meetingResponses,
      expectations: {
        warm_under_150ms: warmRenderReadyMs > 0 && warmRenderReadyMs < 150,
        warm_zero_request: warmRequestCount === 0,
        refresh_exactly_one_request: refreshRequestCount === 1,
        payload_under_55kb: Number(latestMeetingResponse?.body_bytes || 0) < 55 * 1024
      }
    };
    writeJsonFile(path.join(reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    await context.close();
    await browser.close();
  } catch (error) {
    writeAutomationError(reportDir, error);
    throw error;
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
