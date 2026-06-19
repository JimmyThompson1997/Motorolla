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
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const reportDir = path.join(repoRoot, ".tmp", "cover-archive-reveal");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");
const VIEWPORT = { width: 430, height: 932 };

const REPLY_BUTTON_SESSION_ID = "reply_archive_button_debug";
const REPLY_SWIPE_SESSION_ID = "reply_archive_swipe_debug";
const PENDING_SESSION_ID = "pending_archive_debug";
const FAILED_PENDING_BUTTON_SESSION_ID = "failed_pending_archive_button_debug";
const FAILED_PENDING_SWIPE_SESSION_ID = "failed_pending_archive_swipe_debug";
const PENDING_THREAD_SESSION_ID = "pending_thread_archive_debug";
const FAILED_THREAD_BUTTON_SESSION_ID = "failed_thread_archive_button_debug";
const FAILED_THREAD_SWIPE_SESSION_ID = "failed_thread_archive_swipe_debug";

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

function replyCard({ cardId, sessionId, title, summary, createdAt, icon = "mail", accent = "#72c2ff" }) {
  return {
    schema: "pucky.reply_card.v1",
    card_id: cardId,
    session_id: sessionId,
    thread_id: `${sessionId}_thread`,
    title,
    summary,
    transcript: summary,
    created_at: createdAt,
    icon,
    accent,
    read: false
  };
}

function pendingCard({
  cardId,
  sessionId,
  title,
  summary,
  createdAt,
  pendingState,
  pendingLabel,
  failed = false,
  threadContinuation = false,
  threadId = "",
  icon = "mail",
  accent = "#72c2ff"
}) {
  return {
    schema: "pucky.reply_card.v1",
    card_id: cardId,
    session_id: sessionId,
    local_session_id: sessionId,
    thread_id: threadId,
    title,
    summary,
    transcript: summary,
    created_at: createdAt,
    icon,
    accent,
    pending_outbound: true,
    pending_state: pendingState,
    pending_label: pendingLabel,
    pending_thread_continuation: threadContinuation,
    read: false,
    ...(failed ? { error: "Fixture failure" } : {})
  };
}

function createHarnessState(entrypointUrl) {
  const cards = [
    replyCard({
      cardId: "reply-archive-button-card",
      sessionId: REPLY_BUTTON_SESSION_ID,
      title: "Reply archive button",
      summary: "Completed reply archived via the visible button.",
      createdAt: "2026-06-01T12:00:00Z"
    }),
    replyCard({
      cardId: "reply-archive-swipe-card",
      sessionId: REPLY_SWIPE_SESSION_ID,
      title: "Reply archive swipe",
      summary: "Completed reply archived from the left-swipe reveal.",
      createdAt: "2026-06-01T12:01:00Z"
    }),
    pendingCard({
      cardId: "pending-inflight-card",
      sessionId: PENDING_SESSION_ID,
      title: "Sending message",
      summary: "In-flight standalone pending card",
      createdAt: "2026-06-01T12:02:00Z",
      pendingState: "codex_running",
      pendingLabel: "Thinking"
    }),
    pendingCard({
      cardId: "failed-pending-button-card",
      sessionId: FAILED_PENDING_BUTTON_SESSION_ID,
      title: "Failed standalone pending button",
      summary: "Failed standalone pending card archived via button.",
      createdAt: "2026-06-01T12:03:00Z",
      pendingState: "failed",
      pendingLabel: "Failed",
      failed: true
    }),
    pendingCard({
      cardId: "failed-pending-swipe-card",
      sessionId: FAILED_PENDING_SWIPE_SESSION_ID,
      title: "Failed standalone pending swipe",
      summary: "Failed standalone pending card archived via swipe.",
      createdAt: "2026-06-01T12:04:00Z",
      pendingState: "failed",
      pendingLabel: "Failed",
      failed: true
    }),
    pendingCard({
      cardId: "pending-thread-inflight-card",
      sessionId: PENDING_THREAD_SESSION_ID,
      title: "Gmail Updated",
      summary: "In-flight thread continuation pending card",
      createdAt: "2026-06-01T12:05:00Z",
      pendingState: "codex_running",
      pendingLabel: "Thinking",
      threadContinuation: true,
      threadId: "gmail_thread_live"
    }),
    pendingCard({
      cardId: "failed-thread-button-card",
      sessionId: FAILED_THREAD_BUTTON_SESSION_ID,
      title: "Failed thread pending button",
      summary: "Failed thread-continuation pending card archived via button.",
      createdAt: "2026-06-01T12:06:00Z",
      pendingState: "failed",
      pendingLabel: "Failed",
      failed: true,
      threadContinuation: true,
      threadId: "failed_thread_button_live"
    }),
    pendingCard({
      cardId: "failed-thread-swipe-card",
      sessionId: FAILED_THREAD_SWIPE_SESSION_ID,
      title: "Failed thread pending swipe",
      summary: "Failed thread-continuation pending card archived via swipe.",
      createdAt: "2026-06-01T12:07:00Z",
      pendingState: "failed",
      pendingLabel: "Failed",
      failed: true,
      threadContinuation: true,
      threadId: "failed_thread_swipe_live"
    })
  ];

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

function sameCardIdentity(card, args) {
  const targetCardId = String(args.card_id || "");
  const targetSessionId = String(args.session_id || "");
  const cardId = String(card?.card_id || "");
  const sessionId = String(card?.session_id || card?.local_session_id || card?.turn_id || "");
  return Boolean((targetCardId && cardId === targetCardId) || (targetSessionId && sessionId === targetSessionId));
}

function markArchived(snapshot, args) {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const nextCards = cards.map(card => (sameCardIdentity(card, args) ? { ...card, archived: true } : card));
  return {
    schema: snapshot.schema || "pucky.reply_cards.v1",
    count: nextCards.length,
    cards: nextCards
  };
}

function markRead(snapshot, args) {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  const nextCards = cards.map(card => (sameCardIdentity(card, args) ? { ...card, read: true } : card));
  return {
    schema: snapshot.schema || "pucky.reply_cards.v1",
    count: nextCards.length,
    cards: nextCards
  };
}

function feedItemsFromSnapshot(snapshot, includeArchived = false) {
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
  return cards.filter(card => {
    if (!card || card.deleted) {
      return false;
    }
    const archived = Boolean(card.archived);
    return includeArchived ? archived : !archived;
  });
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

function cardSelector(sessionId) {
  return `article[data-card-session-id="${sessionId}"]`;
}

function wrapperSelector(sessionId) {
  return `xpath=//*[@data-card-session-id="${sessionId}"]/ancestor::*[contains(@class, "card-wrap")][1]`;
}

function revealActionSelector(sessionId) {
  return `${wrapperSelector(sessionId)}//*[contains(@class, "archive-reveal-action")]`;
}

function archiveButtonSelector(sessionId) {
  return revealActionSelector(sessionId);
}

async function ensureCardVisible(page, sessionId) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const card = page.locator(cardSelector(sessionId)).first();
    await card.waitFor({ state: "attached", timeout: 5000 });
    try {
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(120);
    }
  }
  throw lastError || new Error(`Could not keep ${sessionId} attached while scrolling into view`);
}

async function dragLeftOnCard(page, client, sessionId, options = {}) {
  await ensureCardVisible(page, sessionId);
  const card = page.locator(cardSelector(sessionId));
  const box = await card.boundingBox();
  if (!box) {
    throw new Error(`No card bounding box for ${sessionId}`);
  }
  const y = box.y + box.height / 2;
  const startRatio = Number.isFinite(options.startRatio) ? options.startRatio : 0.58;
  const endRatio = Number.isFinite(options.endRatio) ? options.endRatio : 0.12;
  const startX = box.x + box.width * startRatio;
  const endX = box.x + box.width * endRatio;
  await dispatchTouchDrag(client, {
    startX,
    startY: y,
    endX,
    endY: y,
    steps: Number.isFinite(options.steps) ? options.steps : 12
  });
  return box;
}

async function mouseDragOnCard(page, sessionId, options = {}) {
  await ensureCardVisible(page, sessionId);
  const card = page.locator(cardSelector(sessionId));
  const box = await card.boundingBox();
  if (!box) {
    throw new Error(`No card bounding box for ${sessionId}`);
  }
  const y = box.y + box.height / 2;
  const startRatio = Number.isFinite(options.startRatio) ? options.startRatio : 0.58;
  const endRatio = Number.isFinite(options.endRatio) ? options.endRatio : 0.12;
  const startX = box.x + box.width * startRatio;
  const endX = box.x + box.width * endRatio;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: Number.isFinite(options.steps) ? options.steps : 12 });
  await page.mouse.up();
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

async function cardVisibleCount(page, sessionId) {
  return page.locator(cardSelector(sessionId)).count();
}

async function archiveButtonCount(page, sessionId) {
  return page.locator(archiveButtonSelector(sessionId)).count();
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

async function captureVisibleCards(page) {
  return page.evaluate(() => window.PuckyUiDebug?.describe?.()?.visible_cards || []);
}

async function runPositiveSwipeArchive(page, client, summary, key, sessionId, screenshotPrefix, options = {}) {
  const result = { session_id: sessionId, method: "swipe" };
  await ensureCardVisible(page, sessionId);
  await page.waitForTimeout(250);
  result.archive_button_count = await archiveButtonCount(page, sessionId);
  expect(result.archive_button_count === 1, `${key}: expected archive button before swipe test`);
  result.before_screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-before`);

  if (options.exerciseThresholdClose) {
    await clearDebugTrace(page);
    await dragLeftOnCard(page, client, sessionId, {
      startRatio: 0.58,
      endRatio: 0.53,
      steps: 6
    });
    await page.waitForTimeout(250);
    result.threshold_close = {
      reveal_open: await wrapperOpen(page, sessionId),
      trace: await debugTrace(page),
      screenshot: await saveScreenshot(page, reportDir, `${screenshotPrefix}-threshold-close`)
    };
    expect(!result.threshold_close.reveal_open, `${key}: short swipe should not open archive reveal`);
    expect(!result.threshold_close.trace.some(entry => entry.phase === "open"), `${key}: short swipe should not record open trace`);
  }

  await clearDebugTrace(page);
  const box = await dragLeftOnCard(page, client, sessionId);
  await page.waitForFunction((innerSessionId) => {
    const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
    return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
  }, sessionId);
  result.reveal_open = await wrapperOpen(page, sessionId);
  expect(result.reveal_open, `${key}: expected swipe reveal to open`);
  result.trace_after_open = await debugTrace(page);
  result.state_after_open = await debugState(page);
  expect(result.trace_after_open.some(entry => entry.phase === "open"), `${key}: expected open trace event`);
  expect(result.state_after_open.offset === 88, `${key}: expected open offset 88`);
  result.open_screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-open`);

  if (options.exerciseBodyClose) {
    await page.locator(`${cardSelector(sessionId)} .card-body`).click();
    await page.waitForFunction((innerSessionId) => {
      const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
      return !row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open");
    }, sessionId);
    result.detail_hidden_after_body_close = await detailHidden(page);
    expect(result.detail_hidden_after_body_close, `${key}: body click while reveal is open should not open detail`);
    result.after_body_close_screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-body-close`);
    await page.waitForTimeout(250);

    await clearDebugTrace(page);
    await dragLeftOnCard(page, client, sessionId);
    await page.waitForFunction((innerSessionId) => {
      const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
      return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
    }, sessionId);
  }

  if (options.exerciseOutsideDismiss) {
    await page.mouse.click(4, Math.max(4, Math.round(box.y + 12)));
    await page.waitForFunction((innerSessionId) => {
      const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
      return !row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open");
    }, sessionId);
    result.trace_after_outside_close = await debugTrace(page);
    expect(result.trace_after_outside_close.some(entry => entry.close_reason === "outside_dismiss"), `${key}: expected outside dismiss close reason`);
    result.after_outside_close_screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-outside-close`);
    await page.waitForTimeout(250);

    await clearDebugTrace(page);
    await dragLeftOnCard(page, client, sessionId);
    await page.waitForFunction((innerSessionId) => {
      const row = document.querySelector(`[data-card-session-id="${innerSessionId}"]`);
      return Boolean(row?.closest(".card-wrap")?.classList.contains("is-archive-reveal-open"));
    }, sessionId);
  }

  await page.locator(revealActionSelector(sessionId)).click({ force: true });
  await page.waitForFunction((innerSessionId) => !document.querySelector(`[data-card-session-id="${innerSessionId}"]`), sessionId);
  result.after_visible = await cardVisibleCount(page, sessionId);
  expect(result.after_visible === 0, `${key}: archived card should disappear after swipe archive`);
  result.trace_after_archive = await debugTrace(page);
  result.after_screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-after`);
  result.visible_cards_after = await captureVisibleCards(page);
  summary.cases[key] = result;
}

async function runNegativePendingCase(page, client, summary, key, sessionId, screenshotPrefix) {
  const result = { session_id: sessionId, method: "negative" };
  await ensureCardVisible(page, sessionId);
  result.before_visible = await cardVisibleCount(page, sessionId);
  result.archive_button_count = await archiveButtonCount(page, sessionId);
  expect(result.before_visible === 1, `${key}: expected pending card to stay visible`);
  expect(result.archive_button_count === 0, `${key}: in-flight pending card should not show an archive button`);
  await clearDebugTrace(page);
  await dragLeftOnCard(page, client, sessionId);
  await page.waitForTimeout(250);
  result.reveal_open = await wrapperOpen(page, sessionId);
  result.trace = await debugTrace(page);
  expect(!result.reveal_open, `${key}: in-flight pending card should not open archive reveal`);
  expect(!result.trace.some(entry => entry.phase === "open"), `${key}: in-flight pending card should not record open trace`);
  result.screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-negative`);
  summary.cases[key] = result;
}

async function runVerticalDragSpotCheck(page, client, summary) {
  await ensureCardVisible(page, PENDING_SESSION_ID);
  const card = page.locator(cardSelector(PENDING_SESSION_ID));
  const box = await card.boundingBox();
  if (!box) {
    throw new Error("Could not locate the in-flight pending card for vertical drag");
  }
  await clearDebugTrace(page);
  await dispatchTouchDrag(client, {
    startX: box.x + box.width * 0.5,
    startY: box.y + box.height * 0.35,
    endX: box.x + box.width * 0.5,
    endY: box.y + box.height * 0.35 + 92,
    steps: 8
  });
  summary.vertical_drag = {
    trace: await debugTrace(page),
    screenshot: await saveScreenshot(page, reportDir, "99-vertical-drag")
  };
  expect(!summary.vertical_drag.trace.some(entry => entry.scope === "feed_rubberband"), "Home vertical drag should not invoke feed rubber-band telemetry");
  expect(!summary.vertical_drag.trace.some(entry => entry.phase === "open"), "Home vertical drag should not open archive reveal");
}

async function run() {
  ensureDir(reportDir);
  for (const entry of fs.readdirSync(reportDir, { withFileTypes: true })) {
    fs.rmSync(path.join(reportDir, entry.name), { recursive: true, force: true });
  }
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
    session_ids: {
      reply_button: REPLY_BUTTON_SESSION_ID,
      reply_swipe: REPLY_SWIPE_SESSION_ID,
      pending_inflight: PENDING_SESSION_ID,
      failed_pending_button: FAILED_PENDING_BUTTON_SESSION_ID,
      failed_pending_swipe: FAILED_PENDING_SWIPE_SESSION_ID,
      pending_thread_inflight: PENDING_THREAD_SESSION_ID,
      failed_thread_button: FAILED_THREAD_BUTTON_SESSION_ID,
      failed_thread_swipe: FAILED_THREAD_SWIPE_SESSION_ID
    },
    cases: {}
  };

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.exposeBinding("__codexFeedApiRequest", async (_source, raw) => {
      const request = JSON.parse(String(raw || "{}"));
      const url = new URL(String(request.url || "https://pucky.fly.dev/api/feed"));
      if (url.pathname === "/api/feed/actions") {
        const payload = request.body && typeof request.body === "object" ? request.body : {};
        const action = String(payload.action || "");
        if (action === "archive") {
          state.cardsSnapshot = markArchived(state.cardsSnapshot, payload);
        } else if (action === "mark_read") {
          state.cardsSnapshot = markRead(state.cardsSnapshot, payload);
        }
        return {
          status: 200,
          body: {
            schema: "pucky.feed_action_result.v1",
            ok: true,
            action
          }
        };
      }
      const includeArchived = url.searchParams.get("include_archived") === "1";
      const items = feedItemsFromSnapshot(state.cardsSnapshot, includeArchived);
      return {
        status: 200,
        body: {
          schema: "pucky.feed.v1",
          ok: true,
          items,
          count: items.length,
          next_cursor: "",
          has_more: false
        }
      };
    });
    await context.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init = undefined) => {
        const requestUrl = typeof input === "string"
          ? input
          : (input && typeof input === "object" && "url" in input ? String(input.url || "") : String(input || ""));
        const resolvedUrl = new URL(requestUrl, window.location.href);
        if (resolvedUrl.pathname === "/api/feed" || resolvedUrl.pathname === "/api/feed/actions") {
          let parsedBody = null;
          if (init && typeof init === "object" && "body" in init) {
            const rawBody = init.body;
            if (typeof rawBody === "string") {
              try {
                parsedBody = JSON.parse(rawBody);
              } catch (_) {
                parsedBody = rawBody;
              }
            } else {
              parsedBody = rawBody ?? null;
            }
          }
          const response = await window.__codexFeedApiRequest(JSON.stringify({
            url: resolvedUrl.toString(),
            method: String((init && init.method) || (typeof input === "object" && input && "method" in input ? input.method : "GET")).toUpperCase(),
            body: parsedBody
          }));
          return new Response(JSON.stringify(response.body || {}), {
            status: Number(response.status || 200),
            headers: { "Content-Type": "application/json" }
          });
        }
        return nativeFetch(input, init);
      };
    });
    await installCodexPuckyBridge(context, message => dispatch(state, message));

    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    attachPageLogging(page, consoleLogPath);

    await page.goto(uiUrl, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="feed"]');
    await page.waitForSelector(cardSelector(REPLY_BUTTON_SESSION_ID));
    summary.initial_visible_cards = await captureVisibleCards(page);
    summary.initial_screenshot = await saveScreenshot(page, reportDir, "01-initial");

    await clearDebugTrace(page);
    await mouseDragOnCard(page, REPLY_BUTTON_SESSION_ID);
    await page.waitForTimeout(250);
    summary.cases.reply_fine_pointer_negative = {
      session_id: REPLY_BUTTON_SESSION_ID,
      method: "fine_pointer_negative",
      reveal_open: await wrapperOpen(page, REPLY_BUTTON_SESSION_ID),
      trace: await debugTrace(page),
      screenshot: await saveScreenshot(page, reportDir, "02-reply-fine-pointer-negative")
    };
    expect(!summary.cases.reply_fine_pointer_negative.reveal_open, "reply_fine_pointer_negative: mouse drag should not open archive reveal");
    expect(!summary.cases.reply_fine_pointer_negative.trace.some(entry => entry.phase === "open"), "reply_fine_pointer_negative: mouse drag should not record open trace");
    await runPositiveSwipeArchive(page, client, summary, "reply_swipe", REPLY_SWIPE_SESSION_ID, "03-reply-swipe", {
      exerciseThresholdClose: true,
      exerciseBodyClose: true
    });
    await runNegativePendingCase(page, client, summary, "pending_inflight", PENDING_SESSION_ID, "04-pending-inflight");
    await runPositiveSwipeArchive(page, client, summary, "failed_pending_swipe_first", FAILED_PENDING_BUTTON_SESSION_ID, "05-failed-pending-swipe-first");
    await runPositiveSwipeArchive(page, client, summary, "failed_pending_swipe", FAILED_PENDING_SWIPE_SESSION_ID, "06-failed-pending-swipe", {
      exerciseOutsideDismiss: true
    });
    await runNegativePendingCase(page, client, summary, "pending_thread_inflight", PENDING_THREAD_SESSION_ID, "07-pending-thread-inflight");
    await runPositiveSwipeArchive(page, client, summary, "failed_thread_swipe_first", FAILED_THREAD_BUTTON_SESSION_ID, "08-failed-thread-swipe-first");
    await runPositiveSwipeArchive(page, client, summary, "failed_thread_swipe", FAILED_THREAD_SWIPE_SESSION_ID, "09-failed-thread-swipe");
    await runVerticalDragSpotCheck(page, client, summary);

    summary.final_visible_cards = await captureVisibleCards(page);
    writeJsonFile(summaryPath, summary);
  } finally {
    void browser.close().catch(() => {});
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    writeAutomationError(reportDir, error);
    console.error(error.stack || error.message);
    process.exit(1);
  });
