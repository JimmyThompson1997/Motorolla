import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const fixturesPath = path.join(repoRoot, "pucky_vm", "ui_src", "fixtures", "reply_cards.json");
const reportDir = path.join(repoRoot, ".tmp", "cover-default-audio-speed");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");

const MOCK_STANDARD_DURATION_MS = 1000 * 60 * 19 + 57000;
const MOCK_AUDIOBOOK_DURATION_MS = 69897450;
const MIN_PLAYBACK_SPEED = 0.5;
const MAX_PLAYBACK_SPEED = 3;
const VIEWPORT = { width: 430, height: 932 };

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function resolveChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome executable not found");
}

function clampSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, parsed));
}

function formatSpeed(value) {
  return `${Number(clampSpeed(value).toFixed(2)).toString()}x`;
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function durationFor(pathOrSource) {
  return /pocket-computers/i.test(String(pathOrSource || ""))
    ? MOCK_AUDIOBOOK_DURATION_MS
    : MOCK_STANDARD_DURATION_MS;
}

function emptyPlayerState() {
  return {
    schema: "pucky.player_state.v1",
    available: true,
    loaded: false,
    state: "idle",
    title: "",
    source: null,
    path: null,
    filename: null,
    queue_index: -1,
    queue_count: 0,
    speed: 1,
    audio_session_id: 1,
    can_set_speed: true,
    is_playing: false,
    position_ms: 0,
    duration_ms: 0,
    can_seek: false
  };
}

function readFixtures() {
  return JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
}

function basename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function createHarnessState() {
  const fixtures = readFixtures();
  return {
    defaultAudioSpeed: 1,
    cardsSnapshot: fixtures,
    playerState: emptyPlayerState()
  };
}

function createTurnStatus() {
  return {
    schema: "pucky.turn_status.v1",
    configured: true,
    last_status: { state: "idle" },
    voice_capture: { state: "idle", hearing: false },
    indicator: {
      schema: "pucky.turn_indicator.v1",
      state: "idle",
      mic_on: false,
      hearing: false,
      uploading: false,
      speaking: false,
      failed: false
    }
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
      return createTurnStatus();
    default:
      throw new Error(`Unsupported bridge command: ${command}`);
  }
}

async function screenshot(page, name) {
  const target = path.join(reportDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function waitForText(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: innerSelector, expected: innerExpected }) => {
      const node = document.querySelector(innerSelector);
      return Boolean(node && node.textContent && node.textContent.includes(innerExpected));
    },
    { selector, expected }
  );
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

async function dismissAudioSheet(page) {
  await page.locator("#detail .detail-back").click();
  await page.waitForFunction(() => document.getElementById("detail")?.getAttribute("aria-hidden") === "true");
  return true;
}

async function openAudioSheet(page, sessionId) {
  const selector = `[data-card-session-id="${sessionId}"] .wave-row`;
  const waitForOpen = () => page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && (detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open")));
  }, {}, { timeout: 2500 });
  try {
    await page.locator(selector).click();
    await waitForOpen();
    return;
  } catch (_) {
    // Fall through to stronger event dispatch options for flaky headless clicks.
  }
  try {
    await page.locator(selector).dispatchEvent("click");
    await waitForOpen();
    return;
  } catch (_) {
    // Fall through.
  }
  await page.locator(selector).evaluate((node) => node.click());
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && (detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open")));
  });
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
  await context.exposeBinding("__codexPuckyPostMessage", async ({ page }, raw) => {
    let id = "";
    let payload;
    try {
      const parsed = JSON.parse(String(raw || "{}"));
      id = String(parsed.id || "");
      payload = {
        ok: true,
        result: dispatch(state, parsed)
      };
    } catch (error) {
      payload = {
        ok: false,
        error: error.message || String(error),
        error_type: error.name || "Error"
      };
    }
    if (id) {
      await page.evaluate(
        ({ callbackId, callbackPayload }) => {
          window.Pucky && window.Pucky.__resolve && window.Pucky.__resolve(callbackId, callbackPayload);
        },
        { callbackId: id, callbackPayload: payload }
      );
    }
    return null;
  });
  await context.addInitScript(() => {
    window.PuckyAndroid = {
      postMessage(raw) {
        window.__codexPuckyPostMessage(raw);
      }
    };
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    fs.appendFileSync(consoleLogPath, `[console:${message.type()}] ${message.text()}\n`, "utf8");
  });
  page.on("pageerror", (error) => {
    fs.appendFileSync(consoleLogPath, `[pageerror] ${error.message}\n`, "utf8");
  });

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

    screenshots.initialFeed = await screenshot(page, "01-initial-feed");

    await page.locator('[data-route="settings"]').click();
    await page.waitForSelector('[data-setting-id="default-audio-speed"]');
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1x");
    screenshots.settings = await screenshot(page, "02-settings");

    await page.locator('[data-setting-id="default-audio-speed"]').click();
    await page.waitForSelector('#speedOverlay.is-open');
    screenshots.settingPicker = await screenshot(page, "03-setting-picker");

    await page.locator('[data-speed-value="1.25"]').click();
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1.25x");
    screenshots.settingsUpdated = await screenshot(page, "04-settings-updated");

    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="settings"]');
    await page.locator('[data-route="settings"]').click();
    await page.waitForSelector('[data-setting-id="default-audio-speed"]');
    await waitForText(page, '[data-setting-id="default-audio-speed"] .settings-card-value', "1.25x");
    screenshots.settingsReloaded = await screenshot(page, "05-settings-reloaded");

    await page.locator('[data-route="feed"]').click();
    await page.waitForSelector('button.action-audio[data-card-session-id="fixture_morning"]');

    await page.locator('button.action-audio[data-card-session-id="fixture_morning"]').click();
    await page.waitForSelector('[data-card-session-id="fixture_morning"] .wave-row');
    await openAudioSheet(page, "fixture_morning");
    await waitForText(page, '#detail .control-speed', formatSpeed(1.25));
    screenshots.firstTileDefault = await screenshot(page, "06-first-tile-default");

    summary.sheetSpeedPickerFallback = await openSheetSpeedPicker(page);
    await page.locator('[data-speed-value="2"]').click();
    await waitForText(page, '#detail .control-speed', formatSpeed(2));
    screenshots.firstTileOverride = await screenshot(page, "07-first-tile-override");

    summary.firstDismissFallback = await dismissAudioSheet(page);

    await page.locator('button.action-audio[data-card-session-id="fixture_leave"]').click();
    await page.waitForSelector('[data-card-session-id="fixture_leave"] .wave-row');
    await openAudioSheet(page, "fixture_leave");
    await waitForText(page, '#detail .control-speed', formatSpeed(1.25));
    screenshots.secondTileDefault = await screenshot(page, "08-second-tile-default");

    summary.secondDismissFallback = await dismissAudioSheet(page);

    await page.locator('button.action-audio[data-card-session-id="fixture_morning"]').click();
    await page.waitForSelector('[data-card-session-id="fixture_morning"] .wave-row');
    await openAudioSheet(page, "fixture_morning");
    await waitForText(page, '#detail .control-speed', formatSpeed(2));
    screenshots.firstTileReplay = await screenshot(page, "09-first-tile-replay");

    summary.defaultAudioSpeed = state.defaultAudioSpeed;
    summary.morningReplaySpeed = await textContent(page, "#detail .control-speed");
    summary.playerState = state.playerState;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  ensureDir(reportDir);
  fs.writeFileSync(path.join(reportDir, "automation-error.txt"), `${error.stack || error.message}\n`, "utf8");
  console.error(error.stack || error.message);
  process.exit(1);
});
