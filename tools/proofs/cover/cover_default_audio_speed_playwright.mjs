import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  basename,
  clampSpeed,
  dismissAudioDetail,
  emptyPlayerState,
  ensureDir,
  fileUrl,
  formatSpeed,
  idleTurnStatus,
  installCodexPuckyBridge,
  openAudioDetail,
  readRuntimeFixtures,
  resolveChromePath,
  saveScreenshot,
  waitForText,
  writeJsonFile,
  writeAutomationError
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const reportDir = path.join(repoRoot, ".tmp", "cover-default-audio-speed");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");

const MOCK_STANDARD_DURATION_MS = 1000 * 60 * 19 + 57000;
const MOCK_AUDIOBOOK_DURATION_MS = 69897450;
const VIEWPORT = { width: 430, height: 932 };

function durationFor(pathOrSource) {
  return /pocket-computers/i.test(String(pathOrSource || ""))
    ? MOCK_AUDIOBOOK_DURATION_MS
    : MOCK_STANDARD_DURATION_MS;
}

function createHarnessState() {
  const fixtures = readRuntimeFixtures(repoRoot);
  return {
    defaultAudioSpeed: 1,
    cardsSnapshot: fixtures,
    playerState: emptyPlayerState()
  };
}

function queueLoadedState(current, args) {
  const playlist = String(args.playlist_path || "");
  const first = playlist ? `${playlist}#track1` : String((args.items && args.items[0] && args.items[0].path) || "");
  return {
    ...current,
    loaded: true,
    state: "loaded",
    is_playing: false,
    title: String(args.title || current.title || ""),
    source: playlist || null,
    path: first || null,
    filename: basename(first),
    queue_index: Number(args.index || 0),
    queue_count: playlist ? 83 : ((args.items && args.items.length) || 1),
    duration_ms: durationFor(playlist || first),
    can_seek: true
  };
}

function playState(current, args) {
  const nextPath = String(args.path || current.path || "");
  const nextSource = Object.prototype.hasOwnProperty.call(args, "source")
    ? (args.source || null)
    : (args.path ? null : (current.source || null));
  const startAtMs = Number(args.start_at_ms ?? current.position_ms ?? 0);
  return {
    ...current,
    schema: "pucky.player_state.v1",
    available: true,
    loaded: true,
    state: "playing",
    is_playing: true,
    title: String(args.title || current.title || ""),
    source: nextSource,
    path: nextPath || current.path || null,
    filename: basename(nextPath || current.path || ""),
    position_ms: Math.max(0, startAtMs),
    duration_ms: durationFor(nextPath || nextSource),
    speed: clampSpeed(args.speed ?? args.rate ?? current.speed ?? 1),
    can_seek: true,
    can_set_speed: true,
    audio_session_id: 1
  };
}

function stateFromSeek(current, args) {
  return {
    ...current,
    position_ms: Math.max(0, Number(args.position_ms || 0))
  };
}

function stateFromSpeed(current, args) {
  return {
    ...current,
    speed: clampSpeed(args.speed ?? args.rate ?? current.speed ?? 1)
  };
}

function dispatch(state, message) {
  const command = String(message.command || "");
  const args = message.args && typeof message.args === "object" ? message.args : {};
  switch (command) {
    case "ui.reply_cards.get":
      return state.cardsSnapshot;
    case "ui.default_audio_speed.get":
      return {
        schema: "pucky.default_audio_speed.v1",
        speed: state.defaultAudioSpeed
      };
    case "ui.default_audio_speed.set":
      state.defaultAudioSpeed = clampSpeed(args.speed ?? args.rate ?? 1);
      return {
        schema: "pucky.default_audio_speed.v1",
        speed: state.defaultAudioSpeed
      };
    case "player.state":
      return state.playerState;
    case "player.queue.set":
      state.playerState = queueLoadedState(state.playerState, args);
      return state.playerState;
    case "player.play":
      state.playerState = playState(state.playerState, args);
      return state.playerState;
    case "player.pause":
      state.playerState = { ...state.playerState, state: "paused", is_playing: false };
      return state.playerState;
    case "player.seek":
      state.playerState = stateFromSeek(state.playerState, args);
      return state.playerState;
    case "player.speed":
      state.playerState = stateFromSpeed(state.playerState, args);
      return state.playerState;
    case "pucky.turn.status":
      return idleTurnStatus();
    default:
      throw new Error(`Unsupported bridge command: ${command}`);
  }
}

async function textContent(page, selector) {
  const value = await page.locator(selector).textContent();
  return (value || "").trim();
}

async function openSheetSpeedPicker(page) {
  const selector = "#detail .control-speed";
  let usedFallback = false;
  try {
    await page.locator(selector).click();
    await page.waitForSelector("#speedOverlay.is-open", { timeout: 2000 });
  } catch (_) {
    usedFallback = true;
    await page.locator(selector).evaluate((node) => node.click());
    await page.waitForSelector("#speedOverlay.is-open");
  }
  return usedFallback;
}

async function run() {
  ensureDir(reportDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const chromePath = resolveChromePath();
  const state = createHarnessState();
  const screenshots = {};
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });

  const context = await browser.newContext({ viewport: VIEWPORT });
  await installCodexPuckyBridge(context, (message) => dispatch(state, message));

  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);

  const summary = {
    chrome_path: chromePath,
    ui_path: uiPath,
    ui_url: fileUrl(uiPath),
    screenshots
  };

  try {
    await page.goto(fileUrl(uiPath), { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="feed"]');
    await page.waitForSelector('[data-card-session-id="fixture_morning"]');

    screenshots.initialFeed = await saveScreenshot(page, reportDir, "01-initial-feed");

    await page.locator('[data-route="settings"]').click();
    await page.waitForSelector('[data-setting-id="default-audio-speed"]');
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1x");
    screenshots.settings = await saveScreenshot(page, reportDir, "02-settings");

    await page.locator('[data-setting-id="default-audio-speed"]').click();
    await page.waitForSelector('#speedOverlay.is-open');
    screenshots.settingPicker = await saveScreenshot(page, reportDir, "03-setting-picker");

    await page.locator('[data-speed-value="1.25"]').click();
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1.25x");
    screenshots.settingsUpdated = await saveScreenshot(page, reportDir, "04-settings-updated");

    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="settings"]');
    await page.locator('[data-route="settings"]').click();
    await page.waitForSelector('[data-setting-id="default-audio-speed"]');
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1.25x");
    screenshots.settingsReloaded = await saveScreenshot(page, reportDir, "05-settings-reloaded");

    await page.locator('[data-route="feed"]').click();
    await page.waitForSelector('button.action-audio[data-card-session-id="fixture_morning"]');

    await openAudioDetail(page, "fixture_morning");
    await waitForText(page, '#detail .control-speed', formatSpeed(1.25));
    screenshots.firstTileDefault = await saveScreenshot(page, reportDir, "06-first-tile-default");

    summary.sheetSpeedPickerFallback = await openSheetSpeedPicker(page);
    await page.locator('[data-speed-value="2"]').click();
    await waitForText(page, '#detail .control-speed', formatSpeed(2));
    screenshots.firstTileOverride = await saveScreenshot(page, reportDir, "07-first-tile-override");

    await dismissAudioDetail(page);

    await openAudioDetail(page, "fixture_leave");
    await waitForText(page, '#detail .control-speed', formatSpeed(1.25));
    screenshots.secondTileDefault = await saveScreenshot(page, reportDir, "08-second-tile-default");

    await dismissAudioDetail(page);

    await openAudioDetail(page, "fixture_morning");
    await waitForText(page, '#detail .control-speed', formatSpeed(2));
    screenshots.firstTileReplay = await saveScreenshot(page, reportDir, "09-first-tile-replay");

    summary.defaultAudioSpeed = state.defaultAudioSpeed;
    summary.morningReplaySpeed = await textContent(page, "#detail .control-speed");
    summary.playerState = state.playerState;
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
