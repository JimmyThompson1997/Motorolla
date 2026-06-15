import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  installCodexPuckyBridge,
  readRuntimeFixtures,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiRoot = path.join(repoRoot, "pucky_vm", "ui_src");
const defaultReportDir = path.join(repoRoot, "artifacts", "cover-voice-status-dot");

const VIEWPORTS = {
  cover: { width: 380, height: 420 },
  phone: { width: 430, height: 932 },
  desktop: { width: 1024, height: 768 },
};

const EXPECTED_COLORS = {
  idle: "#586574",
  armed: "#3a84ff",
  recording: "#ff3b30",
  uploading: "#ffb000",
  thinking: "#ffb000",
  speaking: "#3a84ff",
  meeting_recording: "#a855f7",
};

const EXPECTED_LABELS = {
  idle: "idle",
  armed: "armed",
  recording: "recording",
  uploading: "uploading",
  thinking: "thinking",
  speaking: "speaking",
  meeting_recording: "meeting recording",
};

function parseArgs(argv) {
  const config = {
    pageUrl: "",
    reportDir: defaultReportDir,
    timeoutMs: 30000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || "").trim();
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeHex(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }
  const match = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return raw;
  }
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function buildPageUrl(baseUrl, { theme = "light", route = "", resetNav = true } = {}) {
  const url = new URL(String(baseUrl));
  if (theme) {
    url.searchParams.set("theme", theme);
  } else {
    url.searchParams.delete("theme");
  }
  if (route) {
    url.searchParams.set("route", route);
  } else {
    url.searchParams.delete("route");
  }
  if (resetNav) {
    url.searchParams.set("reset_nav", "1");
  } else {
    url.searchParams.delete("reset_nav");
  }
  return url.toString();
}

function mockArtifactResult(requestPath) {
  const title = String(requestPath || "artifact")
    .replace(/^.*\//, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ");
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:24px;font:16px/1.45 system-ui;background:#f5f9ff;color:#17202a}article{max-width:720px;margin:0 auto}h1{font-size:28px;margin:0 0 12px}</style><article><h1>${title}</h1><p>Proof artifact preview.</p><p>This keeps the real browser path alive without depending on the native shell.</p></article>`;
  return {
    mime_type: "text/html",
    content_base64: Buffer.from(html, "utf8").toString("base64"),
  };
}

function createFeedSnapshot() {
  const runtime = readRuntimeFixtures(repoRoot);
  const cards = [];
  const baseCards = Array.isArray(runtime.cards) ? runtime.cards.slice(0, 5) : [];
  for (let pass = 0; pass < 4; pass += 1) {
    baseCards.forEach((raw, index) => {
      const suffix = `${pass + 1}-${index + 1}`;
      const sessionId = `${String(raw.session_id || raw.card_id || "fixture").replace(/[^a-z0-9_-]/gi, "_")}-${suffix}`;
      const title = `${String(raw.title || "Fixture card")} ${pass + 1}`;
      const threadId = `thread-${index + 1}`;
      cards.push({
        ...raw,
        card_id: String(raw.card_id || sessionId),
        session_id: sessionId,
        local_session_id: sessionId,
        title,
        preview: String(raw.preview || raw.summary || title),
        summary: String(raw.summary || raw.preview || title),
        kind: raw.kind || "",
        origin: {
          ...(raw.origin || {}),
          thread_id: threadId,
          thread_title: title,
        },
      });
    });
  }
  return {
    schema: "pucky.reply_cards.v1",
    count: cards.length,
    next_cursor: "",
    has_more: false,
    items: cards,
  };
}

function createMeetingsPayload() {
  return {
    meetings: [
      {
        meeting_id: "meeting-proof-1",
        title: "Weekly product sync",
        state: "completed",
        started_at: "2026-06-14T15:00:00Z",
        updated_at: "2026-06-14T15:22:00Z",
        duration_ms: 1320000,
        transcript_text: "Talked through next release work and blockers.",
        audio_path: "/mock/meeting-proof-1.mp4",
        mime_type: "audio/mp4",
        card: {
          summary: "Release blockers triaged and owners assigned.",
          transcript_messages: [
            { role: "user", text: "What changed in the release plan?" },
            { role: "assistant", text: "Two blockers got owners and the launch date held." },
          ],
        },
        feed_item: {
          summary: "Release blockers triaged and owners assigned.",
          transcript_messages: [
            { role: "assistant", text: "Two blockers got owners and the launch date held." },
          ],
        },
      },
    ],
  };
}

function createLinksPayload() {
  return {
    apps: [
      { slug: "gmail", name: "Gmail", counts: { active: 2 } },
      { slug: "calendar", name: "Google Calendar", counts: { active: 1 } },
    ],
  };
}

function createWorkspacePayload() {
  return { items: [] };
}

function createBridgeState(baseUrl) {
  const feed = createFeedSnapshot();
  return {
    config: {
      api_base_url: new URL(baseUrl).origin,
      api_token: "cover-proof-token",
    },
    turnStatus: {
      schema: "pucky.turn_status.v1",
      configured: true,
      last_status: { state: "idle", visual_state: "idle" },
      indicator: {
        schema: "pucky.turn_indicator.v1",
        state: "idle",
        visual_state: "idle",
        mic_on: false,
        hearing: false,
        speech_detected: false,
        uploading: false,
        speaking: false,
        failed: false,
        active: false,
        remote_stage: "",
      },
    },
    turnSettings: {
      schema: "pucky.turn_settings.v1",
      reply_mode: "card_only",
      spoken_reply_enabled: false,
      arrival_cue_mode: "chime",
      accepted_chime_enabled: true,
      model: "gpt-5",
      reasoning_effort: "medium",
      modes: ["card_only", "card_and_spoken"],
      arrival_cue_modes: ["none", "chime", "haptic_and_chime"],
      model_options: ["gpt-5"],
      reasoning_effort_options: ["low", "medium", "high"],
    },
    wakeStatus: {
      schema: "pucky.wake_status.v1",
      enabled: false,
      requested_enabled: false,
      running: false,
      state: "idle",
      proof_indicator: {
        active: false,
        visual_state: "idle",
        matched_phrase: "",
        transcript: "",
        remaining_ms: 0,
      },
    },
    uiSurface: {
      schema: "pucky.ui_surface.v1",
      source_kind: "bundle_current",
      entrypoint_url: "",
      ui_version: "cover-voice-status-dot-proof",
    },
    phoneRole: {
      schema: "pucky.phone_role_status.v1",
      loaded: true,
      state: "unavailable",
      role_held: false,
      eligible: false,
      role_available: false,
      package_name: "com.pucky.device.debug",
      default_dialer_package: "",
      default_dialer_label: "",
      stock_incall_ui_replaced_when_held: true,
      source: "cover_proof",
      read_only: false,
      error_code: "",
      error_detail: "",
      device_id: "cover-proof",
    },
    defaultAudioSpeed: 1,
    meetingRecording: {
      schema: "pucky.meeting_recording_status.v1",
      state: "idle",
    },
    feed,
    commandLog: [],
  };
}

async function startStaticServer(rootDir) {
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname || "/");
      if (pathname === "/") {
        pathname = "/index.html";
      }
      const resolved = path.resolve(rootDir, `.${pathname}`);
      if (!resolved.startsWith(rootDir)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mimeTypeFor(resolved),
        "Cache-Control": "no-store",
      });
      fs.createReadStream(resolved).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(String(error && error.message || error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert(port > 0, "Failed to allocate a local static server port");
  return {
    baseUrl: `http://127.0.0.1:${port}/index.html`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function installApiMocks(context, bridgeState) {
  const meetingsPayload = createMeetingsPayload();
  const linksPayload = createLinksPayload();
  const workspacePayload = createWorkspacePayload();
  await context.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const pathname = requestUrl.pathname;
    const json = (payload, status = 200) => route.fulfill({
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(payload),
    });
    if (pathname === "/api/feed") {
      return json(bridgeState.feed);
    }
    if (pathname === "/api/feed/actions") {
      return json({ ok: true });
    }
    if (pathname === "/api/meetings") {
      return json(meetingsPayload);
    }
    if (/^\/api\/meetings\/[^/]+$/.test(pathname)) {
      return json({ meeting: meetingsPayload.meetings[0] });
    }
    if (pathname === "/api/links/composio/portal-url") {
      return json({
        portal_url: "https://example.test/connect",
        token: "cover-proof-token",
        auth_mode: "browser",
        available: true,
      });
    }
    if (pathname === "/api/links/composio/my-apps") {
      return json(linksPayload);
    }
    if (pathname === "/api/card-icons") {
      return json({ icons: [] });
    }
    if (pathname.startsWith("/api/workspace/")) {
      if (/^\/api\/workspace\/assets\/[^/]+$/.test(pathname)) {
        return json({
          ok: true,
          asset: {
            id: pathname.split("/").pop(),
            kind: "html",
            html: "<!doctype html><p>Workspace asset preview.</p>",
          },
        });
      }
      return json(workspacePayload);
    }
    return json({ ok: false, error: `Unhandled mock endpoint: ${pathname}` }, 404);
  });
}

function commandResultForState(bridgeState, message) {
  const command = String(message.command || "");
  const args = message.args && typeof message.args === "object" ? message.args : {};
  bridgeState.commandLog.push({
    command,
    args,
    at: new Date().toISOString(),
  });
  if (command === "pucky.config.get") {
    return bridgeState.config;
  }
  if (command === "pucky.turn.status") {
    return bridgeState.turnStatus;
  }
  if (command === "pucky.turn.settings.get") {
    return bridgeState.turnSettings;
  }
  if (command === "pucky.turn.settings.set") {
    const replyMode = String(args.reply_mode || args.mode || bridgeState.turnSettings.reply_mode || "card_only");
    const arrivalCueMode = String(args.arrival_cue_mode || bridgeState.turnSettings.arrival_cue_mode || "chime");
    bridgeState.turnSettings = {
      ...bridgeState.turnSettings,
      reply_mode: replyMode,
      spoken_reply_enabled: replyMode === "card_and_spoken",
      arrival_cue_mode: arrivalCueMode,
      accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
    };
    return bridgeState.turnSettings;
  }
  if (command === "wake.status") {
    return bridgeState.wakeStatus;
  }
  if (command === "meeting.recording.status") {
    return bridgeState.meetingRecording;
  }
  if (command === "phone.role.status") {
    return bridgeState.phoneRole;
  }
  if (command === "ui.default_audio_speed.get") {
    return {
      schema: "pucky.default_audio_speed.v1",
      speed: bridgeState.defaultAudioSpeed,
    };
  }
  if (command === "ui.surface.get") {
    return bridgeState.uiSurface;
  }
  if (command === "artifact.read_base64") {
    return mockArtifactResult(args.path || args.url || "");
  }
  if (command === "artifact.url") {
    return {
      schema: "pucky.artifact_url.v1",
      url: String(args.path || args.url || ""),
      mime_type: "text/html",
      bytes: 0,
    };
  }
  if (command === "player.state") {
    return {
      schema: "pucky.player_state.v1",
      available: true,
      loaded: false,
      state: "idle",
      is_playing: false,
      can_seek: false,
      can_set_speed: true,
      position_ms: 0,
      duration_ms: 0,
      speed: 1,
      audio_session_id: 1,
    };
  }
  throw new Error(`Unsupported bridge command: ${command}`);
}

function buildTurnStatus(visualState) {
  const stateByVisual = {
    idle: { state: "idle", remote_stage: "", uploading: false, speaking: false, failed: false, active: false },
    armed: { state: "armed", remote_stage: "", uploading: false, speaking: false, failed: false, active: true },
    recording: { state: "recording", remote_stage: "", uploading: false, speaking: false, failed: false, active: true },
    uploading: { state: "uploading", remote_stage: "stt_running", uploading: true, speaking: false, failed: false, active: true },
    thinking: { state: "codex_running", remote_stage: "codex_running", uploading: false, speaking: false, failed: false, active: true },
    speaking: { state: "speaking", remote_stage: "tts_running", uploading: false, speaking: true, failed: false, active: true },
    failed: { state: "failed", remote_stage: "", uploading: false, speaking: false, failed: true, active: false },
  };
  const entry = stateByVisual[visualState];
  assert(entry, `Unsupported turn visual state: ${visualState}`);
  const renderedVisualState = visualState === "failed" ? "idle" : visualState;
  return {
    schema: "pucky.turn_status.v1",
    configured: true,
    last_status: {
      state: entry.state,
      visual_state: renderedVisualState,
      remote_stage: entry.remote_stage,
    },
    indicator: {
      schema: "pucky.turn_indicator.v1",
      state: entry.state,
      visual_state: renderedVisualState,
      mic_on: visualState === "armed" || visualState === "recording",
      hearing: visualState === "recording",
      speech_detected: visualState === "recording",
      uploading: entry.uploading,
      speaking: entry.speaking,
      failed: entry.failed,
      active: entry.active,
      remote_stage: entry.remote_stage,
      stt_running: entry.remote_stage === "stt_running",
      codex_running: entry.remote_stage === "codex_running",
      tts_running: entry.remote_stage === "tts_running",
    },
  };
}

function buildReplyRecoveryPendingStatus() {
  return {
    schema: "pucky.turn_status.v1",
    configured: true,
    reply_recovery_pending: true,
    response_transport_error: "SocketTimeoutException: timeout",
    player_state: {
      state: "idle",
      source: "",
      is_playing: false,
    },
    last_status: {
      turn_id: "turn-recovery-pending-proof",
      state: "tts_running",
      visual_state: "uploading",
      remote_stage: "completed",
      reply_recovery_pending: true,
      response_transport_error: "SocketTimeoutException: timeout",
      server_turn_status: {
        stage: "completed",
        feed_persisted: true,
      },
    },
    indicator: {
      schema: "pucky.turn_indicator.v1",
      state: "tts_running",
      visual_state: "uploading",
      mic_on: false,
      hearing: false,
      speech_detected: false,
      uploading: true,
      speaking: false,
      failed: false,
      active: true,
      remote_stage: "completed",
      stt_running: false,
      codex_running: false,
      tts_running: true,
    },
  };
}

async function waitForHome(page, timeoutMs) {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".app-shell");
    return Boolean(
      shell
      && shell.getAttribute("data-theme") === "light"
      && shell.getAttribute("data-chrome-mode") === "home-shell"
      && document.querySelector(".light-shell[data-light-route=\"home\"] .light-app-grid")
    );
  }, {}, { timeout: timeoutMs });
}

async function waitForRoute(page, { theme, route, selector, timeoutMs }) {
  await page.waitForFunction(
    ({ expectedTheme, expectedRoute, expectedSelector }) => {
      const shell = document.querySelector(".app-shell");
      if (!shell || shell.getAttribute("data-theme") !== expectedTheme) {
        return false;
      }
      const current = shell.getAttribute("data-canonical-route") || shell.getAttribute("data-view") || "";
      return current === expectedRoute && Boolean(document.querySelector(expectedSelector));
    },
    { expectedTheme: theme, expectedRoute: route, expectedSelector: selector },
    { timeout: timeoutMs },
  );
}

async function clickTile(page, label, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-app-label="${label}"]`);
  await tile.first().waitFor({ state: "visible", timeout: timeoutMs });
  await tile.first().click();
}

async function backToHome(page, timeoutMs) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const atHome = await page.evaluate(() => Boolean(document.querySelector(".light-shell[data-light-route=\"home\"] .light-app-grid")));
    if (atHome) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForHome(page, timeoutMs);
}

async function openFirstFeedDetail(page, timeoutMs) {
  const body = page.locator("#feed article.card .card-body").first();
  await body.waitFor({ state: "visible", timeout: timeoutMs });
  await body.click();
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && (detail.classList.contains("is-open") || detail.getAttribute("aria-hidden") === "false"));
  }, {}, { timeout: timeoutMs });
}

async function setViewport(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(150);
}

async function driveTurnStatus(page, bridgeState, visualState, options = {}) {
  bridgeState.turnStatus = buildTurnStatus(visualState);
  if (options.emitEvent === false) {
    return;
  }
  await page.evaluate((payload) => {
    window.Pucky.__event("pucky.turn.status", payload);
  }, bridgeState.turnStatus);
}

async function driveTurnStatusPayload(page, bridgeState, payload, options = {}) {
  bridgeState.turnStatus = payload;
  if (options.emitEvent === false) {
    return;
  }
  await page.evaluate((payload) => {
    window.Pucky.__event("pucky.turn.status", payload);
  }, bridgeState.turnStatus);
}

async function waitForVoiceVisualState(page, visualState, timeoutMs) {
  await page.waitForFunction((expectedVisualState) => {
    const surface = window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function"
      ? window.PuckyUiDebug.describe()
      : null;
    const className = String(surface?.voice_status?.class_name || "");
    return className.includes(`voice-status-${expectedVisualState}`);
  }, visualState, { timeout: timeoutMs });
}

async function readVoiceSnapshot(page) {
  return page.evaluate(() => {
    const surface = window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function"
      ? window.PuckyUiDebug.describe()
      : {};
    const voice = document.getElementById("voiceStatus");
    const style = voice ? window.getComputedStyle(voice) : null;
    const header = document.querySelector(".light-page-header-shell, .page-header-shell, .settings-page-header");
    const overlay = document.getElementById("settingsSelectorOverlay");
    const detail = document.getElementById("detail");
    return {
      voice_count: document.querySelectorAll("#voiceStatus").length,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      surface,
      z_index: {
        voice: Number(style?.zIndex || 0),
        header: Number(header ? window.getComputedStyle(header).zIndex || 0 : 0),
        overlay: Number(overlay ? window.getComputedStyle(overlay).zIndex || 0 : 0),
        detail: Number(detail ? window.getComputedStyle(detail).zIndex || 0 : 0),
      },
    };
  });
}

function assertVoiceSnapshot(checkpointName, snapshot, expectation, extra = {}) {
  const voice = snapshot.surface && snapshot.surface.voice_status ? snapshot.surface.voice_status : null;
  assert(snapshot.voice_count === 1, `${checkpointName}: expected exactly one #voiceStatus, saw ${snapshot.voice_count}`);
  assert(voice && voice.exists, `${checkpointName}: voice_status missing`);
  assert(voice.hidden === false, `${checkpointName}: voice_status.hidden should be false`);
  assert(voice.aria_hidden === "false", `${checkpointName}: voice_status aria-hidden should be false`);
  assert(voice.computed_display !== "none", `${checkpointName}: voice_status display should not be none`);
  assert(voice.computed_visibility !== "hidden", `${checkpointName}: voice_status visibility should not be hidden`);
  assert(Number(voice.computed_opacity || 0) > 0, `${checkpointName}: voice_status opacity should be > 0`);
  assert(voice.rect && voice.rect.width > 0 && voice.rect.height > 0, `${checkpointName}: voice_status rect missing or zero-sized`);
  assert(voice.rect.top >= 0 && voice.rect.top <= 48, `${checkpointName}: voice_status top ${voice.rect.top} was not inside the top band`);
  const rightMargin = Math.round(snapshot.viewport.width - Number(voice.rect.right || 0));
  assert(rightMargin >= 0 && rightMargin <= 24, `${checkpointName}: voice_status right margin ${rightMargin} was out of range`);
  assert(String(voice.class_name || "").includes(`voice-status-${expectation.visualState}`), `${checkpointName}: expected class voice-status-${expectation.visualState}, saw ${voice.class_name}`);
  assert(normalizeHex(voice.voice_color) === EXPECTED_COLORS[expectation.visualState], `${checkpointName}: expected voice color ${EXPECTED_COLORS[expectation.visualState]}, saw ${voice.voice_color}`);
  assert(String(voice.label || "") === `Turn state: ${EXPECTED_LABELS[expectation.visualState]}`, `${checkpointName}: unexpected aria label ${voice.label}`);
  assert(String(voice.title || "") === `Turn: ${EXPECTED_LABELS[expectation.visualState]}`, `${checkpointName}: unexpected title ${voice.title}`);
  assert(snapshot.z_index.voice >= snapshot.z_index.header, `${checkpointName}: voice z-index ${snapshot.z_index.voice} was below header ${snapshot.z_index.header}`);
  if (extra.requireAboveOverlay) {
    assert(snapshot.z_index.voice >= snapshot.z_index.overlay, `${checkpointName}: voice z-index ${snapshot.z_index.voice} was below overlay ${snapshot.z_index.overlay}`);
  }
  if (extra.requireAboveDetail) {
    assert(snapshot.z_index.voice >= snapshot.z_index.detail, `${checkpointName}: voice z-index ${snapshot.z_index.voice} was below detail ${snapshot.z_index.detail}`);
  }
}

async function captureCheckpoint(page, reportDir, summary, name, expectation, options = {}) {
  const snapshotBeforeScroll = await readVoiceSnapshot(page);
  assertVoiceSnapshot(name, snapshotBeforeScroll, expectation, options);
  let stability = null;
  if (options.scrollTarget === "feed") {
    await page.evaluate(() => {
      const feed = document.getElementById("feed");
      if (feed) {
        feed.scrollTop = feed.scrollHeight;
      }
    });
    await page.waitForTimeout(150);
    const after = await readVoiceSnapshot(page);
    assertVoiceSnapshot(name, after, expectation, options);
    const topDelta = Math.abs(Number(after.surface.voice_status.rect.top || 0) - Number(snapshotBeforeScroll.surface.voice_status.rect.top || 0));
    const rightDelta = Math.abs(Number(after.surface.voice_status.rect.right || 0) - Number(snapshotBeforeScroll.surface.voice_status.rect.right || 0));
    assert(topDelta <= 1 && rightDelta <= 1, `${name}: voice_status rect shifted after feed scroll`);
    stability = { top_delta: topDelta, right_delta: rightDelta, target: "feed" };
  } else if (options.scrollTarget === "detail") {
    await page.evaluate(() => {
      const detail = document.getElementById("detail");
      if (detail) {
        detail.scrollTop = detail.scrollHeight;
      }
    });
    await page.waitForTimeout(150);
    const after = await readVoiceSnapshot(page);
    assertVoiceSnapshot(name, after, expectation, options);
    const topDelta = Math.abs(Number(after.surface.voice_status.rect.top || 0) - Number(snapshotBeforeScroll.surface.voice_status.rect.top || 0));
    const rightDelta = Math.abs(Number(after.surface.voice_status.rect.right || 0) - Number(snapshotBeforeScroll.surface.voice_status.rect.right || 0));
    assert(topDelta <= 1 && rightDelta <= 1, `${name}: voice_status rect shifted after detail scroll`);
    stability = { top_delta: topDelta, right_delta: rightDelta, target: "detail" };
  }
  const screenshotPath = await saveScreenshot(page, reportDir, name);
  const snapshotPath = path.join(reportDir, `${name}.voice_status.json`);
  writeJsonFile(snapshotPath, snapshotBeforeScroll);
  summary.screenshots[name] = screenshotPath;
  summary.checkpoints[name] = {
    ok: true,
    expectation,
    snapshot_path: snapshotPath,
    viewport: snapshotBeforeScroll.viewport,
    route: snapshotBeforeScroll.surface?.route || "",
    canonical_route: snapshotBeforeScroll.surface?.home_feed?.active_route || "",
    voice_status: snapshotBeforeScroll.surface?.voice_status || null,
    stability,
  };
}

async function waitForSettingsSelector(page, timeoutMs) {
  await page.waitForSelector("#settingsSelectorOverlay.is-open .settings-selector-sheet", { timeout: timeoutMs });
}

async function waitForReplyModeValue(page, expected, timeoutMs) {
  await page.waitForFunction(
    (label) => {
      const node = document.querySelector('[data-setting-id="reply-playback"] .settings-selector-button-label');
      return Boolean(node && node.textContent && node.textContent.trim() === label);
    },
    expected,
    { timeout: timeoutMs },
  );
}

async function setReplyModeViaSettings(page, expectedValue, timeoutMs) {
  await page.locator('[data-setting-id="reply-playback"] .settings-selector-button').click();
  await waitForSettingsSelector(page, timeoutMs);
  await page.locator(`#settingsSelectorOverlay [data-selector-value="${expectedValue}"]`).click();
  const expectedLabel = expectedValue === "card_and_spoken" ? "Card + voice" : "Card only";
  await waitForReplyModeValue(page, expectedLabel, timeoutMs);
}

async function openReplyModeOverlay(page, timeoutMs) {
  await page.locator('[data-setting-id="reply-playback"] .settings-selector-button').click();
  await waitForSettingsSelector(page, timeoutMs);
}

async function closeReplyModeOverlay(page) {
  await page.evaluate(() => {
    const overlay = document.getElementById("settingsSelectorOverlay");
    if (overlay) {
      overlay.click();
    }
  });
  await page.waitForTimeout(150);
}

async function navigateTo(page, url, waitFor) {
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await waitFor();
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const summaryPath = path.join(config.reportDir, "summary.json");
  const consoleLogPath = path.join(config.reportDir, "console.log");
  fs.writeFileSync(consoleLogPath, "", "utf8");

  let localServer = null;
  let browser = null;
  const summary = {
    ok: false,
    report_dir: config.reportDir,
    page_url: "",
    chrome_path: "",
    local_server: null,
    screenshots: {},
    checkpoints: {},
    settings: {},
    card_only_lifecycle: {},
    poll_only_detection: {},
    failed_terminal_visible: {},
    reply_recovery_active_visible: {},
    bridge_commands: [],
  };

  try {
    if (!config.pageUrl) {
      localServer = await startStaticServer(uiRoot);
      summary.local_server = { base_url: localServer.baseUrl };
    }
    const basePageUrl = config.pageUrl || localServer.baseUrl;
    summary.page_url = basePageUrl;
    const chromePath = resolveChromePath();
    summary.chrome_path = chromePath;
    const bridgeState = createBridgeState(basePageUrl);

    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        "--disable-extensions",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORTS.phone });
    await installCodexPuckyBridge(context, (message) => commandResultForState(bridgeState, message));
    await installApiMocks(context, bridgeState);

    const page = await context.newPage();
    attachPageLogging(page, consoleLogPath);

    await navigateTo(page, buildPageUrl(basePageUrl, { theme: "light", resetNav: true }), () => waitForHome(page, config.timeoutMs));
    await driveTurnStatus(page, bridgeState, "idle");
    await captureCheckpoint(page, config.reportDir, summary, "01-light-home-idle", { visualState: "idle" });

    const turnStatusPollsBefore = bridgeState.commandLog.filter((entry) => entry.command === "pucky.turn.status").length;
    await driveTurnStatus(page, bridgeState, "armed", { emitEvent: false });
    await waitForVoiceVisualState(page, "armed", config.timeoutMs);
    const turnStatusPollsAfter = bridgeState.commandLog.filter((entry) => entry.command === "pucky.turn.status").length;
    assert(turnStatusPollsAfter > turnStatusPollsBefore, "Poll-only listening checkpoint never re-queried pucky.turn.status");
    await captureCheckpoint(page, config.reportDir, summary, "02-light-home-listening-blue", { visualState: "armed" });
    summary.poll_only_detection = {
      detected_without_event: true,
      visual_state: "armed",
      turn_status_polls_before: turnStatusPollsBefore,
      turn_status_polls_after: turnStatusPollsAfter,
    };

    await driveTurnStatus(page, bridgeState, "recording");
    await captureCheckpoint(page, config.reportDir, summary, "03-light-home-hearing-red", { visualState: "recording" });

    await clickTile(page, "Inbox", config.timeoutMs);
    await waitForRoute(page, {
      theme: "light",
      route: "inbox",
      selector: "#feed article.card, #feed .empty",
      timeoutMs: config.timeoutMs,
    });
    await driveTurnStatus(page, bridgeState, "thinking");
    await captureCheckpoint(page, config.reportDir, summary, "04-light-inbox-thinking-visible", { visualState: "thinking" }, { scrollTarget: "feed" });

    await openFirstFeedDetail(page, config.timeoutMs);
    await driveTurnStatus(page, bridgeState, "recording");
    await captureCheckpoint(page, config.reportDir, summary, "05-light-detail-hearing-red", { visualState: "recording" }, { requireAboveDetail: true, scrollTarget: "detail" });
    await backToHome(page, config.timeoutMs);

    await clickTile(page, "Settings", config.timeoutMs);
    await waitForRoute(page, {
      theme: "light",
      route: "settings",
      selector: '[data-setting-id="reply-playback"]',
      timeoutMs: config.timeoutMs,
    });
    await setReplyModeViaSettings(page, "card_and_spoken", config.timeoutMs);
    await openReplyModeOverlay(page, config.timeoutMs);
    const latestSetCommand = [...bridgeState.commandLog].reverse().find((entry) => entry.command === "pucky.turn.settings.set");
    assert(latestSetCommand && latestSetCommand.args.reply_mode === "card_and_spoken", "Settings UI never sent reply_mode card_and_spoken");
    await captureCheckpoint(page, config.reportDir, summary, "06-light-settings-reply-playback-card-voice", { visualState: "recording" }, { requireAboveOverlay: true });
    await closeReplyModeOverlay(page);
    await waitForReplyModeValue(page, "Card + voice", config.timeoutMs);

    await driveTurnStatus(page, bridgeState, "speaking");
    await captureCheckpoint(page, config.reportDir, summary, "07-light-settings-replying-blue", { visualState: "speaking" });

    await backToHome(page, config.timeoutMs);
    await clickTile(page, "Connect", config.timeoutMs);
    await waitForRoute(page, {
      theme: "light",
      route: "connect",
      selector: ".links-page",
      timeoutMs: config.timeoutMs,
    });
    await driveTurnStatus(page, bridgeState, "armed");
    await captureCheckpoint(page, config.reportDir, summary, "08-light-connect-listening-blue", { visualState: "armed" });

    await backToHome(page, config.timeoutMs);
    bridgeState.meetingRecording = {
      ...bridgeState.meetingRecording,
      state: "recording",
    };
    await clickTile(page, "Meetings", config.timeoutMs);
    await waitForRoute(page, {
      theme: "light",
      route: "meetings",
      selector: ".meetings-page",
      timeoutMs: config.timeoutMs,
    });
    await driveTurnStatus(page, bridgeState, "recording");
    await page.waitForTimeout(200);
    await captureCheckpoint(page, config.reportDir, summary, "09-light-meetings-recording-purple", { visualState: "meeting_recording" });
    bridgeState.meetingRecording = {
      ...bridgeState.meetingRecording,
      state: "idle",
    };

    await navigateTo(page, buildPageUrl(basePageUrl, { theme: "dark", route: "feed", resetNav: true }), () => waitForRoute(page, {
      theme: "dark",
      route: "inbox",
      selector: "#feed article.card, #feed .empty",
      timeoutMs: config.timeoutMs,
    }));
    await driveTurnStatus(page, bridgeState, "armed");
    await captureCheckpoint(page, config.reportDir, summary, "10-dark-feed-listening-blue", { visualState: "armed" });

    await setViewport(page, VIEWPORTS.cover);
    await navigateTo(page, buildPageUrl(basePageUrl, { theme: "light", resetNav: true }), () => waitForHome(page, config.timeoutMs));
    await driveTurnStatus(page, bridgeState, "recording");
    await captureCheckpoint(page, config.reportDir, summary, "11-cover-viewport-hearing-red", { visualState: "recording" });

    await setViewport(page, VIEWPORTS.desktop);
    bridgeState.turnSettings = {
      ...bridgeState.turnSettings,
      reply_mode: "card_and_spoken",
      spoken_reply_enabled: true,
    };
    await navigateTo(page, buildPageUrl(basePageUrl, { theme: "light", route: "settings", resetNav: true }), () => waitForRoute(page, {
      theme: "light",
      route: "settings",
      selector: '[data-setting-id="reply-playback"]',
      timeoutMs: config.timeoutMs,
    }));
    await driveTurnStatus(page, bridgeState, "speaking");
    await captureCheckpoint(page, config.reportDir, summary, "12-desktop-viewport-replying-blue", { visualState: "speaking" });

    await setReplyModeViaSettings(page, "card_only", config.timeoutMs);
    const latestCardOnly = [...bridgeState.commandLog].reverse().find((entry) => entry.command === "pucky.turn.settings.set");
    assert(latestCardOnly && latestCardOnly.args.reply_mode === "card_only", "Settings UI never sent reply_mode card_only");
    await driveTurnStatus(page, bridgeState, "idle");
    const cardOnlyStates = [];
    for (const visualState of ["armed", "recording", "uploading", "thinking", "idle"]) {
      await driveTurnStatus(page, bridgeState, visualState);
      const snapshot = await readVoiceSnapshot(page);
      assertVoiceSnapshot(`card_only:${visualState}`, snapshot, { visualState });
      cardOnlyStates.push({
        visual_state: visualState,
        class_name: snapshot.surface?.voice_status?.class_name || "",
        voice_color: snapshot.surface?.voice_status?.voice_color || "",
      });
    }
    summary.card_only_lifecycle = {
      exercised: true,
      states: cardOnlyStates,
      speaking_required: false,
    };

    await driveTurnStatus(page, bridgeState, "failed");
    const failedSnapshot = await readVoiceSnapshot(page);
    assertVoiceSnapshot("failed_terminal_visible", failedSnapshot, { visualState: "idle" });
    summary.failed_terminal_visible = {
      exercised: true,
      class_name: failedSnapshot.surface?.voice_status?.class_name || "",
      voice_color: failedSnapshot.surface?.voice_status?.voice_color || "",
    };

    await navigateTo(page, buildPageUrl(basePageUrl, { theme: "light", resetNav: true }), () => waitForHome(page, config.timeoutMs));
    await driveTurnStatusPayload(page, bridgeState, buildReplyRecoveryPendingStatus());
    const recoverySnapshot = await readVoiceSnapshot(page);
    assertVoiceSnapshot("reply_recovery_active_visible", recoverySnapshot, { visualState: "uploading" });
    summary.reply_recovery_active_visible = {
      exercised: true,
      class_name: recoverySnapshot.surface?.voice_status?.class_name || "",
      voice_color: recoverySnapshot.surface?.voice_status?.voice_color || "",
      remote_stage: recoverySnapshot.surface?.turn_timing?.events?.slice(-1)?.[0]?.remote_stage || "",
    };
    await captureCheckpoint(page, config.reportDir, summary, "13-light-home-recovery-uploading-visible", { visualState: "uploading" });

    summary.settings = {
      reply_mode: bridgeState.turnSettings.reply_mode,
      latest_set_commands: bridgeState.commandLog.filter((entry) => entry.command === "pucky.turn.settings.set"),
    };
    summary.bridge_commands = bridgeState.commandLog;
    summary.ok = true;
    writeJsonFile(summaryPath, summary);
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    summary.ok = false;
    summary.error = error.message || String(error);
    writeJsonFile(summaryPath, summary);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (localServer) {
      await localServer.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
