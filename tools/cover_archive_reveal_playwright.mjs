import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  emptyPlayerState,
  ensureDir,
  fileUrl,
  idleTurnStatus,
  installCodexPuckyBridge,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const reportDir = path.join(repoRoot, ".tmp", "cover-archive-reveal");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");
const VIEWPORT = { width: 430, height: 932 };
const TARGET_SESSION_ID = "fixture_morning";
const PENDING_SESSION_ID = "pending_archive_debug";

function initialTurnSettings() {
  return {
    schema: "pucky.turn_settings.v1",
    reply_mode: "card_only",
    spoken_reply_enabled: false,
    arrival_cue_mode: "haptic_and_chime",
    accepted_chime_enabled: true,
    modes: ["card_only", "card_and_spoken"],
    arrival_cue_modes: ["none", "haptic", "chime", "haptic_and_chime"]
  };
}

function initialWakeStatus() {
  return {
    schema: "pucky.wake_status.v1",
    enabled: true,
    requested_enabled: true,
    running: true,
    state: "armed",
    recognizer_state: "ready",
    suspended_reason: "",
    debug_recognizer_mode: "android",
    proof_indicator: {
      active: false,
      visual_state: "idle",
      matched_phrase: "",
      transcript: "",
      remaining_ms: 0
    }
  };
}

function initialMeetingRecordingStatus() {
  return {
    schema: "pucky.meeting_recording_status.v1",
    state: "idle",
    active_meeting_id: null
  };
}

function initialUiSurface(entrypointUrl) {
  return {
    schema: "pucky.ui_surface_status.v1",
    requested_url: entrypointUrl,
    active_url: entrypointUrl,
    entrypoint_url: entrypointUrl,
    source_kind: "bundle_current",
    ui_version: "browser-test",
    bridge_connected: false,
    ui_debug_available: true
  };
}

function createHarnessState(entrypointUrl) {
  const deployPath = path.join(repoRoot, "pucky_vm", "ui_src", "fixtures", "reply_cards_deploy.json");
  const deployFixture = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const pendingCard = {
    schema: "pucky.reply_card.v1",
    card_id: "pending-debug-card",
    session_id: PENDING_SESSION_ID,
    local_session_id: PENDING_SESSION_ID,
    pending_outbound: true,
    pending_state: "codex_running",
    pending_label: "Thinking",
    summary: "Pending reveal debug card",
    created_at: "2026-06-01T12:00:00Z",
    icon: "mail",
    accent: "#72c2ff"
  };
  const cards = [pendingCard, ...(Array.isArray(deployFixture.cards) ? deployFixture.cards : [])];
  return {
    cardsSnapshot: {
      schema: "pucky.reply_cards.v1",
      count: cards.length,
      cards
    },
    playerState: emptyPlayerState(),
    turnStatus: idleTurnStatus(),
    turnSettings: initialTurnSettings(),
    wakeStatus: initialWakeStatus(),
    meetingRecording: initialMeetingRecordingStatus(),
    uiSurface: initialUiSurface(entrypointUrl),
    threadScope: {
      active: false,
      mode: "",
      thread_id: "",
      source_surface: "",
      card_id: "",
      session_id: ""
    },
    defaultAudioSpeed: 1
  };
}

function markArchived(snapshot, args) {
  const cardId = String(args.card_id || "");
  const sessionId = String(args.session_id || "");
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const nextCards = cards.map((card) => {
    const sameCardId = cardId && String(card.card_id || "") === cardId;
    const sameSessionId = sessionId && String(card.session_id || card.turn_id || "") === sessionId;
    return sameCardId || sameSessionId ? { ...card, archived: true } : card;
  });
  return {
    schema: snapshot.schema || "pucky.reply_cards.v1",
    count: nextCards.length,
    cards: nextCards
  };
}

function dispatch(state, message) {
  const command = String(message.command || "");
  const args = message.args && typeof message.args === "object" ? message.args : {};
  switch (command) {
    case "ui.reply_cards.get":
      return state.cardsSnapshot;
    case "pucky.feed.sync":
      return {
        schema: "pucky.feed_sync_result.v1",
        configured: true,
        reason: String(args.reason || "browser_test"),
        snapshot: state.cardsSnapshot
      };
    case "pucky.feed.action":
      state.cardsSnapshot = markArchived(state.cardsSnapshot, args);
      return {
        schema: "pucky.feed_action_result.v1",
        ok: true,
        action: String(args.action || ""),
        snapshot: state.cardsSnapshot
      };
    case "voice.thread_scope.get":
      return state.threadScope;
    case "voice.thread_scope.set":
      state.threadScope = { ...state.threadScope, ...args };
      return state.threadScope;
    case "voice.thread_scope.clear":
      state.threadScope = {
        active: false,
        mode: "",
        thread_id: "",
        source_surface: "",
        card_id: "",
        session_id: ""
      };
      return state.threadScope;
    case "meeting.recording.status":
      return state.meetingRecording;
    case "player.state":
      return state.playerState;
    case "pucky.turn.status":
      return state.turnStatus;
    case "pucky.turn.settings.get":
      return state.turnSettings;
    case "pucky.turn.settings.set":
      state.turnSettings = {
        ...state.turnSettings,
        reply_mode: String(args.reply_mode || state.turnSettings.reply_mode || "card_only"),
        spoken_reply_enabled: String(args.reply_mode || state.turnSettings.reply_mode || "card_only") === "card_and_spoken",
        arrival_cue_mode: String(args.arrival_cue_mode || state.turnSettings.arrival_cue_mode || "haptic_and_chime")
      };
      return state.turnSettings;
    case "wake.status":
      return state.wakeStatus;
    case "ui.surface.get":
      return state.uiSurface;
    case "ui.default_audio_speed.get":
      return {
        schema: "pucky.default_audio_speed.v1",
        speed: state.defaultAudioSpeed
      };
    case "ui.default_audio_speed.set":
      state.defaultAudioSpeed = Number(args.speed || 1) || 1;
      return {
        schema: "pucky.default_audio_speed.v1",
        speed: state.defaultAudioSpeed
      };
    default:
      throw new Error(`Unsupported bridge command: ${command}`);
  }
}

async function dispatchTouchDrag(client, { startX, startY, endX, endY, steps = 10 }) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(startX), y: Math.round(startY), radiusX: 12, radiusY: 12 }]
  });
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{
        x: Math.round(startX + (endX - startX) * ratio),
        y: Math.round(startY + (endY - startY) * ratio),
        radiusX: 12,
        radiusY: 12
      }]
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
}

async function dragLeftOnCard(page, client, sessionId) {
  const body = page.locator(`[data-card-session-id="${sessionId}"] .card-body`);
  const box = await body.boundingBox();
  if (!box) {
    throw new Error(`No card body bounding box for ${sessionId}`);
  }
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.82;
  const endX = box.x + box.width * 0.22;
  await dispatchTouchDrag(client, {
    startX,
    startY: y,
    endX,
    endY: y,
    steps: 12
  });
  return box;
}

async function detailHidden(page) {
  return page.evaluate(() => document.getElementById("detail")?.getAttribute("aria-hidden") === "true");
}

async function wrapperOpen(page, sessionId) {
  return page.evaluate((innerSessionId) => {
    const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
    return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
  }, sessionId);
}

async function debugTrace(page) {
  return page.evaluate(() => window.__puckyArchiveRevealDebug?.getTrace?.() || []);
}

async function debugState(page) {
  return page.evaluate(() => window.__puckyArchiveRevealDebug?.getState?.() || {});
}

async function clearDebugTrace(page) {
  await page.evaluate(() => window.__puckyArchiveRevealDebug?.clearTrace?.());
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  ensureDir(reportDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const chromePath = resolveChromePath();
  const uiUrl = `${fileUrl(uiPath)}?debug_archive_reveal=1`;
  const state = createHarnessState(uiUrl);
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });

  const summary = {
    chrome_path: chromePath,
    ui_path: uiPath,
    ui_url: uiUrl,
    target_session_id: TARGET_SESSION_ID,
    pending_session_id: PENDING_SESSION_ID
  };

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await installCodexPuckyBridge(context, (message) => dispatch(state, message));

    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    attachPageLogging(page, consoleLogPath);

    await page.goto(uiUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="feed"]');
    await page.waitForSelector(`[data-card-session-id="${TARGET_SESSION_ID}"]`);

    summary.screenshots = {
      initial: await saveScreenshot(page, reportDir, "01-initial")
    };
    summary.pending_visible_count = await page.locator(`[data-card-session-id="${PENDING_SESSION_ID}"]`).count();
    expect(summary.pending_visible_count === 0, "Pending outbound rows should stay hidden in feed rendering");

    await clearDebugTrace(page);
    const targetBox = await dragLeftOnCard(page, client, TARGET_SESSION_ID);
    await page.waitForTimeout(250);
    summary.screenshots.reveal_open = await saveScreenshot(page, reportDir, "02-reveal-open");
    summary.trace_after_open = await debugTrace(page);
    summary.state_after_open = await debugState(page);
    summary.reveal_open_after_swipe = await wrapperOpen(page, TARGET_SESSION_ID);
    const tracePhases = new Set(summary.trace_after_open.map((entry) => entry.phase));
    const closeReasons = summary.trace_after_open.map((entry) => entry.close_reason).filter(Boolean);
    expect(tracePhases.has("begin"), "Expected archive reveal trace to record begin");
    expect(tracePhases.has("move"), "Expected archive reveal trace to record move");
    expect(tracePhases.has("finish"), "Expected archive reveal trace to record finish");

    if (summary.reveal_open_after_swipe) {
      expect(summary.trace_after_open.some((entry) => entry.phase === "open"), "Expected debug trace to record reveal open");
      expect(summary.state_after_open.offset === 88, `Expected open reveal offset 88, got ${summary.state_after_open.offset}`);

      await page.locator(`[data-card-session-id="${TARGET_SESSION_ID}"] .card-body`).click();
      await page.waitForFunction((innerSessionId) => {
        const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
        return !row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open");
      }, TARGET_SESSION_ID);
      summary.screenshots.after_body_close = await saveScreenshot(page, reportDir, "03-after-body-close");
      summary.detail_hidden_after_body_close = await detailHidden(page);
      expect(summary.detail_hidden_after_body_close, "Body tap while open should close reveal without opening detail");

      await dragLeftOnCard(page, client, TARGET_SESSION_ID);
      await page.waitForFunction((innerSessionId) => {
        const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
        return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
      }, TARGET_SESSION_ID);
      await page.mouse.click(4, Math.round(targetBox.y + 12));
      await page.waitForFunction((innerSessionId) => {
        const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
        return !row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open");
      }, TARGET_SESSION_ID);
      summary.screenshots.after_outside_close = await saveScreenshot(page, reportDir, "04-after-outside-close");
      summary.trace_after_outside_close = await debugTrace(page);
      expect(summary.trace_after_outside_close.some((entry) => entry.close_reason === "outside_dismiss"), "Expected outside dismiss close reason in trace");

      await dragLeftOnCard(page, client, TARGET_SESSION_ID);
      await page.waitForFunction((innerSessionId) => {
        const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
        return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
      }, TARGET_SESSION_ID);
      await page.locator(`xpath=//*[@data-card-session-id="${TARGET_SESSION_ID}"]/ancestor::*[contains(@class, "card-wrap")][1]//*[contains(@class, "archive-reveal-action")]`).click();
      await page.waitForFunction((innerSessionId) => !document.querySelector(`[data-card-session-id="${innerSessionId}"]`), TARGET_SESSION_ID);
      summary.screenshots.after_archive = await saveScreenshot(page, reportDir, "05-after-archive");
      summary.trace_after_archive = await debugTrace(page);
      summary.target_visible_after_archive = await page.locator(`[data-card-session-id="${TARGET_SESSION_ID}"]`).count();
      expect(summary.target_visible_after_archive === 0, "Archived card should be removed from visible feed");
    } else {
      expect(closeReasons.length > 0, "Expected a failing reveal swipe to report an explicit close reason");
      summary.close_reasons_after_failed_swipe = closeReasons;
    }

    await clearDebugTrace(page);
    await dispatchTouchDrag(client, {
      startX: 4,
      startY: 210,
      endX: 4,
      endY: 260,
      steps: 8
    });
    summary.trace_after_vertical_drag = await debugTrace(page);
    summary.screenshots.after_vertical_drag = await saveScreenshot(page, reportDir, "06-after-vertical-drag");
    expect(summary.trace_after_vertical_drag.some((entry) => entry.scope === "feed_rubberband"), "Expected feed rubber-band telemetry after vertical drag");

    writeJsonFile(summaryPath, summary);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  writeAutomationError(reportDir, error);
  console.error(error.stack || error.message);
  process.exit(1);
});
