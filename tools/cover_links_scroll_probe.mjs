import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  fileUrl,
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
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");

const DEFAULT_API_BASE = "https://pucky.fly.dev";
const DEFAULT_SAMPLE_MS = 50;
const DEFAULT_BURST_MS = 100;
const DEFAULT_BURST_DURATION_MS = 2000;
const DEFAULT_TARGET_ROW = 200;
const VIEWPORT = { width: 430, height: 932 };
const LINKS_ROW_HEIGHT = 62;
const REMOTE_LOGO_HOST_PATTERNS = [
  "logos.composio.dev",
  "logo.clearbit.com",
  "google.com/s2/favicons",
  "t0.gstatic.com/faviconV2",
];

const GESTURES = [
  { name: "slow-drag", distance: 1800, durationMs: 1200, steps: 18 },
  { name: "medium-fling", distance: 4800, durationMs: 900, steps: 14 },
  { name: "fast-fling", distance: 9000, durationMs: 1000, steps: 18, captureBurst: true }
];

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    apiBase: process.env.PUCKY_LINKS_API_BASE || DEFAULT_API_BASE,
    apiToken: resolveApiToken(),
    pageUrl: `${fileUrl(uiPath)}?route=connect`,
    reportDir: "",
    sampleMs: DEFAULT_SAMPLE_MS,
    burstMs: DEFAULT_BURST_MS,
    burstDurationMs: DEFAULT_BURST_DURATION_MS,
    targetRow: DEFAULT_TARGET_ROW
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
    } else if (arg === "--sample-ms") {
      config.sampleMs = positiveInt(argv[++index], config.sampleMs);
    } else if (arg === "--burst-ms") {
      config.burstMs = positiveInt(argv[++index], config.burstMs);
    } else if (arg === "--burst-duration-ms") {
      config.burstDurationMs = positiveInt(argv[++index], config.burstDurationMs);
    } else if (arg === "--target-row") {
      config.targetRow = positiveInt(argv[++index], config.targetRow);
    }
  }
  config.apiBase = String(config.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  return config;
}

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureScreenshot(page, reportDir, name) {
  return saveScreenshot(page, reportDir, name);
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
    replyCards: readRuntimeFixtures(repoRoot) || emptyReplyCards()
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
      ui_version: "links-v1-simplicity"
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
  if (command === "voice.thread_scope.clear" || command === "voice.thread_scope.set") {
    return {
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
  }
  if (command === "browser.open") {
    return {
      launched: true,
      uri: String(args.url || "")
    };
  }
  if (command === "pucky.config.get") {
    return {
      schema: "pucky.config.v1",
      api_base_url: state.apiBase,
      api_token: state.apiToken
    };
  }
  return {};
}

async function installApiProxy(context, apiBase, apiToken, requestLog) {
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
      url: request.url(),
      post_data: request.postData() || ""
    });
    try {
      const response = await route.fetch({
        method: request.method(),
        headers,
        postData: request.postDataBuffer() || undefined
      });
      await route.fulfill({ response });
    } catch (error) {
      const detail = String(error?.message || error || "");
      if (/Request context disposed|Target page, context or browser has been closed/i.test(detail)) {
        await route.abort("failed");
        return;
      }
      throw error;
    }
  });
}

async function readMetrics(page) {
  return page.evaluate(() => {
    if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.linksMetrics !== "function") {
      return null;
    }
    return JSON.parse(JSON.stringify(window.PuckyUiDebug.linksMetrics()));
  });
}

async function readVisibleLogoState(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".links-app-row"));
    const visibleRows = rows.map(row => {
      const img = row.querySelector(".links-app-logo");
      const fallback = row.querySelector(".links-app-fallback");
      return {
        slug: String(row.getAttribute("data-links-slug") || ""),
        has_logo: Boolean(img),
        logo_src: String(img?.getAttribute("src") || ""),
        fallback_text: String(fallback?.textContent || "").trim(),
      };
    });
    return {
      visible_row_count: visibleRows.length,
      visible_logo_count: visibleRows.filter(row => row.has_logo && row.logo_src).length,
      visible_fallback_count: visibleRows.filter(row => row.fallback_text).length,
      sample_rows: visibleRows.slice(0, 8),
    };
  });
}

async function readProbeState(page) {
  const [metrics, logos] = await Promise.all([readMetrics(page), readVisibleLogoState(page)]);
  return { metrics, logos };
}

function stateMetrics(state) {
  return state?.metrics || state;
}

function approxRow(state) {
  const metrics = stateMetrics(state);
  const scrollTop = Number(metrics?.list?.scroll_top || 0);
  return Math.max(0, Math.floor(scrollTop / LINKS_ROW_HEIGHT));
}

async function waitForLinksReady(page, targetRow) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const probe = await readProbeState(page);
    const metrics = probe.metrics;
    if (
      metrics
      && metrics.catalog_source === "bundle"
      && Number(metrics.filtered_app_count || 0) >= targetRow
      && metrics.active_scroller === "links-scrollport"
      && Number(probe.logos?.visible_logo_count || 0) > 0
      && Number(probe.logos?.visible_fallback_count || 0) === 0
    ) {
      return probe;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for bundle-backed Links metrics to become ready");
}

async function startBurstScreenshots(page, reportDir, gestureName, everyMs, durationMs) {
  const shots = [];
  const startedAt = Date.now();
  let index = 0;
  while (Date.now() - startedAt < durationMs) {
    shots.push(await captureScreenshot(page, reportDir, `${gestureName}-burst-${String(index).padStart(3, "0")}`));
    index += 1;
    await sleep(everyMs);
  }
  return shots;
}

async function sampleGesture(page, sampleMs, durationMs) {
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    const probe = await readProbeState(page);
    samples.push({
      at_ms: Date.now() - startedAt,
      approx_row: approxRow(probe),
      metrics: probe.metrics,
      logos: probe.logos,
    });
    await sleep(sampleMs);
  }
  return samples;
}

async function runGesture(page, reportDir, gesture, sampleMs, burstMs, burstDurationMs) {
  const before = await readProbeState(page);
  const beforeScreenshot = await captureScreenshot(page, reportDir, `${gesture.name}-before`);

  let burstPromise = null;
  if (gesture.captureBurst) {
    burstPromise = startBurstScreenshots(page, reportDir, gesture.name, burstMs, burstDurationMs);
  }
  const samplerPromise = sampleGesture(page, sampleMs, gesture.durationMs + 500);

  const stepDelay = Math.max(16, Math.round(gesture.durationMs / gesture.steps));
  const stepDistance = gesture.distance / gesture.steps;
  for (let step = 0; step < gesture.steps; step += 1) {
    await page.evaluate((delta) => {
      const element = document.getElementById("linksScrollport");
      if (!element) {
        throw new Error("linksScrollport missing");
      }
      element.scrollBy({ top: delta, behavior: "auto" });
    }, stepDistance);
    await sleep(stepDelay);
  }

  await sleep(300);
  const samples = await samplerPromise;
  const burstShots = burstPromise ? await burstPromise : [];
  const after = await readProbeState(page);
  const afterScreenshot = await captureScreenshot(page, reportDir, `${gesture.name}-after`);

  return {
    name: gesture.name,
    before,
    after,
    before_screenshot: beforeScreenshot,
    after_screenshot: afterScreenshot,
    burst_screenshots: burstShots,
    samples,
    approx_row_before: approxRow(before),
    approx_row_after: approxRow(after)
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const reportDir = config.reportDir || path.join(repoRoot, ".tmp", "cover-links-scroll-probe", timestampSlug());
  ensureDir(reportDir);
  const tracePath = path.join(reportDir, "trace.zip");
  const videoDir = path.join(reportDir, "video");
  ensureDir(videoDir);

  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true
  });

  let summaryPath = "";
  let pageVideo = null;
  let context = null;
  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      screen: VIEWPORT,
      hasTouch: true,
      isMobile: true,
      recordVideo: {
        dir: videoDir,
        size: VIEWPORT
      }
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const apiRequestLog = [];
    await installApiProxy(context, config.apiBase, config.apiToken, apiRequestLog);

    const localPreview = config.pageUrl.startsWith("file://");
    if (localPreview) {
      const bridge = bridgeState(config.apiBase, config.apiToken);
      await installCodexPuckyBridge(context, message => bridgeResponse(bridge, message));
    }

    const page = await context.newPage();
    pageVideo = page.video();
    const consoleLogPath = path.join(reportDir, "console.log");
    attachPageLogging(page, consoleLogPath);
    const networkLog = [];
    page.on("request", request => {
      networkLog.push({
        at: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        resource_type: request.resourceType(),
        is_navigation: request.isNavigationRequest(),
      });
    });

    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded" });
    await waitForLinksReady(page, config.targetRow);
    await sleep(400);

    const screenshots = {
      initial: await captureScreenshot(page, reportDir, "00-initial"),
    };
    const initialState = await readProbeState(page);

    const gestures = [];
    for (const gesture of GESTURES) {
      const result = await runGesture(page, reportDir, gesture, config.sampleMs, config.burstMs, config.burstDurationMs);
      gestures.push(result);
    }

    screenshots.final = await captureScreenshot(page, reportDir, "99-final");
    const finalState = await readProbeState(page);
    const finalMetrics = finalState.metrics;

    const catalogRequests = apiRequestLog.filter(entry => String(entry.url).includes("/api/links/composio/catalog"));
    const remoteLogoRequests = networkLog.filter(entry => REMOTE_LOGO_HOST_PATTERNS.some(pattern => String(entry.url).includes(pattern)));
    if (catalogRequests.length) {
      throw new Error(`Expected zero runtime catalog requests, saw ${catalogRequests.length}`);
    }
    if (remoteLogoRequests.length) {
      throw new Error(`Expected zero remote logo requests, saw ${remoteLogoRequests.length}`);
    }
    if (String(finalMetrics?.catalog_source || "") !== "bundle") {
      throw new Error(`Expected catalog_source=bundle, saw ${String(finalMetrics?.catalog_source || "") || "<missing>"}`);
    }
    if (String(finalMetrics?.active_scroller || "") !== "links-scrollport") {
      throw new Error(`Expected active_scroller=links-scrollport, saw ${String(finalMetrics?.active_scroller || "") || "<missing>"}`);
    }
    if (Number(finalState?.logos?.visible_logo_count || 0) <= 0) {
      throw new Error("Expected visible Links rows to contain bundled logo images");
    }
    if (Number(finalState?.logos?.visible_fallback_count || 0) !== 0) {
      throw new Error(`Expected zero fallback initials, saw ${Number(finalState?.logos?.visible_fallback_count || 0)}`);
    }
    if (approxRow(finalMetrics) < config.targetRow) {
      throw new Error(`Expected to scroll past row ${config.targetRow}, only reached about row ${approxRow(finalMetrics)}`);
    }

    const summary = {
      ok: true,
      page_url: config.pageUrl,
      local_preview: localPreview,
      api_base: config.apiBase,
      target_row: config.targetRow,
      request_log_path: path.join(reportDir, "requests.json"),
      api_request_log_path: path.join(reportDir, "api-requests.json"),
      console_log_path: consoleLogPath,
      trace_path: tracePath,
      initial_metrics: initialState.metrics,
      final_metrics: finalMetrics,
      initial_logos: initialState.logos,
      final_logos: finalState.logos,
      route_open: {
        catalog_requests: catalogRequests.length,
        remote_logo_requests: remoteLogoRequests.length,
        session_ready: Boolean(initialState.metrics?.session_ready || finalMetrics?.session_ready),
        connected_loaded: Boolean(finalMetrics?.connected_loaded)
      },
      screenshots,
      gestures
    };
    writeJsonFile(path.join(reportDir, "requests.json"), networkLog);
    writeJsonFile(path.join(reportDir, "api-requests.json"), apiRequestLog);
    summaryPath = path.join(reportDir, "summary.json");
    writeJsonFile(summaryPath, summary);
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    await context.close();
    context = null;
    let videoPath = "";
    if (pageVideo) {
      videoPath = await pageVideo.path();
    }
    if (videoPath && fs.existsSync(summaryPath)) {
      const persisted = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      persisted.video_path = videoPath;
      writeJsonFile(summaryPath, persisted);
    }
    console.log(JSON.stringify({ ...summary, video_path: videoPath }, null, 2));
  } catch (error) {
    writeAutomationError(reportDir, error);
    throw error;
  } finally {
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath }).catch(() => {});
        await context.close().catch(() => {});
      }
    } catch (_) {
      // Best effort during teardown.
    }
    await Promise.race([browser.close(), sleep(3000)]);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
