import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  basename,
  emptyPlayerState,
  ensureDir,
  fileUrl,
  idleTurnStatus,
  installCodexPuckyBridge,
  openAudioDetail,
  readRuntimeFixtures,
  resolveChromePath,
  saveScreenshot,
  writeJsonFile,
  writeAutomationError
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const reportDir = path.join(repoRoot, ".tmp", "cover-pause-scrubber");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");

const VIEWPORT = { width: 430, height: 932 };
const DEFAULT_DURATION_MS = 15000;
const DEFAULT_SPEED = 1.25;
const TARGET_SESSION_ID = "fixture_morning";

function createHarnessState() {
  return {
    cardsSnapshot: readRuntimeFixtures(repoRoot),
    playerState: emptyPlayerState({ speed: DEFAULT_SPEED }),
    playStartedAtMs: 0,
    playBasePositionMs: 0,
    nextAudioSessionId: 10
  };
}

function idleWakeStatus() {
  return {
    schema: "pucky.wake_status.v1",
    enabled: true,
    running: true,
    state: "armed",
    recognizer_state: "ready",
    proof_indicator: { active: false, visual_state: "idle", matched_phrase: "", transcript: "", remaining_ms: 0 }
  };
}

function currentPlayerState(state) {
  const current = state.playerState;
  if (!current.loaded || !current.is_playing) {
    return current;
  }
  const elapsedMs = Math.max(0, Date.now() - state.playStartedAtMs);
  const durationMs = Math.max(0, Number(current.duration_ms || 0));
  const positionMs = Math.min(durationMs, state.playBasePositionMs + elapsedMs);
  if (durationMs > 0 && positionMs >= durationMs) {
    state.playerState = {
      ...current,
      state: "completed",
      is_playing: false,
      position_ms: durationMs
    };
    state.playBasePositionMs = durationMs;
    state.playStartedAtMs = 0;
    return state.playerState;
  }
  return {
    ...current,
    position_ms: positionMs
  };
}

function beginPlayback(state, args) {
  const current = currentPlayerState(state);
  const nextPath = String(args.path || current.path || "");
  const nextSource = Object.prototype.hasOwnProperty.call(args, "source")
    ? (args.source || null)
    : (args.path ? null : (current.source || null));
  const nextPosition = Math.max(0, Number(args.start_at_ms ?? current.position_ms ?? 0));
  state.playBasePositionMs = nextPosition;
  state.playStartedAtMs = Date.now();
  state.nextAudioSessionId += 1;
  state.playerState = {
    ...current,
    loaded: true,
    state: "playing",
    is_playing: true,
    title: String(args.title || current.title || ""),
    source: nextSource,
    path: nextPath || current.path || null,
    filename: basename(nextPath || current.path || ""),
    position_ms: nextPosition,
    duration_ms: DEFAULT_DURATION_MS,
    speed: Number(args.speed ?? args.rate ?? current.speed ?? DEFAULT_SPEED) || DEFAULT_SPEED,
    can_seek: true,
    can_set_speed: true,
    audio_session_id: state.nextAudioSessionId
  };
  return state.playerState;
}

function dispatch(state, message) {
  const command = String(message.command || "");
  const args = message.args && typeof message.args === "object" ? message.args : {};
  switch (command) {
    case "ui.reply_cards.get":
      return state.cardsSnapshot;
    case "ui.default_audio_speed.get":
      return { schema: "pucky.default_audio_speed.v1", speed: DEFAULT_SPEED };
    case "ui.default_audio_speed.set":
      return { schema: "pucky.default_audio_speed.v1", speed: DEFAULT_SPEED };
    case "voice.thread_scope.get":
      return { active: false, mode: "", thread_id: "", source_surface: "", card_id: "", session_id: "" };
    case "voice.thread_scope.set":
    case "voice.thread_scope.clear":
      return { active: false, mode: "", thread_id: "", source_surface: "", card_id: "", session_id: "" };
    case "pucky.turn.status":
      return idleTurnStatus();
    case "wake.status":
      return idleWakeStatus();
    case "player.state":
      state.playerState = currentPlayerState(state);
      return state.playerState;
    case "player.play":
      return beginPlayback(state, args);
    case "player.pause": {
      const current = currentPlayerState(state);
      state.playBasePositionMs = Number(current.position_ms || 0);
      state.playStartedAtMs = 0;
      state.playerState = {
        ...current,
        state: "paused",
        is_playing: false
      };
      return state.playerState;
    }
    case "player.seek": {
      const current = currentPlayerState(state);
      const nextPosition = Math.max(0, Math.min(DEFAULT_DURATION_MS, Number(args.position_ms || 0)));
      if (current.is_playing) {
        state.playBasePositionMs = nextPosition;
        state.playStartedAtMs = Date.now();
      } else {
        state.playBasePositionMs = nextPosition;
        state.playStartedAtMs = 0;
      }
      state.playerState = {
        ...current,
        position_ms: nextPosition
      };
      return state.playerState;
    }
    case "player.speed":
      state.playerState = {
        ...currentPlayerState(state),
        speed: Number(args.speed ?? args.rate ?? DEFAULT_SPEED) || DEFAULT_SPEED
      };
      return state.playerState;
    default:
      throw new Error(`Unsupported bridge command: ${command}`);
  }
}

async function detailState(page) {
  return page.evaluate(() => {
    const detail = document.getElementById("detail");
    const play = detail?.querySelector(".control-play");
    const elapsed = detail?.querySelector(".time-elapsed")?.textContent?.trim() || "";
    const remaining = detail?.querySelector(".time-remaining")?.textContent?.trim() || "";
    const slider = detail?.querySelector(".scrub-slider");
    return {
      playLabel: play?.getAttribute("aria-label") || "",
      elapsed,
      remaining,
      positionMs: Number(slider?.dataset?.positionMs || 0)
    };
  });
}

async function resetDetailPlayback(page) {
  await page.evaluate(async () => {
    await window.Pucky.request({ command: "player.pause", args: {} });
    await window.Pucky.request({ command: "player.seek", args: { position_ms: 0 } });
  });
  await page.waitForTimeout(300);
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
  const state = createHarnessState();
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
    ui_url: fileUrl(uiPath),
    session_id: TARGET_SESSION_ID
  };

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await installCodexPuckyBridge(context, (message) => dispatch(state, message));

    const page = await context.newPage();
    attachPageLogging(page, consoleLogPath);

    await page.goto(fileUrl(uiPath), { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="feed"]');
    await page.waitForSelector(`[data-card-session-id="${TARGET_SESSION_ID}"]`);
    await openAudioDetail(page, TARGET_SESSION_ID);
    await resetDetailPlayback(page);

    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(1500);
    summary.after_play = await detailState(page);
    summary.player_during_play = dispatch(state, { command: "player.state", args: {} });
    await saveScreenshot(page, reportDir, "01-after-play");

    await page.waitForTimeout(3500);
    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(400);
    summary.after_pause = await detailState(page);
    summary.player_after_pause = dispatch(state, { command: "player.state", args: {} });
    await saveScreenshot(page, reportDir, "02-after-pause");

    expect(summary.after_pause.playLabel === "Play", `Expected paused control label to be Play, got ${summary.after_pause.playLabel}`);
    expect(summary.after_pause.positionMs >= 3000, `Expected paused scrubber position >= 3000ms, got ${summary.after_pause.positionMs}`);
    expect(summary.player_after_pause.state === "paused", `Expected native player state paused, got ${summary.player_after_pause.state}`);
    expect(summary.player_after_pause.is_playing === false, "Expected paused player to report is_playing false");
    expect(summary.player_after_pause.position_ms >= 3000, `Expected paused player position >= 3000ms, got ${summary.player_after_pause.position_ms}`);

    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(400);
    summary.after_resume = await detailState(page);
    summary.player_after_resume = dispatch(state, { command: "player.state", args: {} });
    await saveScreenshot(page, reportDir, "03-after-resume");

    expect(summary.after_resume.playLabel === "Pause", `Expected resumed control label to be Pause, got ${summary.after_resume.playLabel}`);
    expect(summary.after_resume.positionMs >= summary.after_pause.positionMs, "Expected resumed scrubber position to stay at or beyond the paused position");
    expect(summary.player_after_resume.is_playing === true, "Expected resumed player to be playing");
    expect(summary.player_after_resume.position_ms >= summary.player_after_pause.position_ms, "Expected resumed player position to continue from the paused position");

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
