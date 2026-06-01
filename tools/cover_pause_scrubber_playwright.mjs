import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const fixturesPath = path.join(repoRoot, "pucky_vm", "ui_src", "fixtures", "reply_cards.json");
const reportDir = path.join(repoRoot, ".tmp", "cover-pause-scrubber");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");

const VIEWPORT = { width: 430, height: 932 };
const DEFAULT_DURATION_MS = 15000;
const DEFAULT_SPEED = 1.25;
const TARGET_SESSION_ID = "fixture_morning";

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

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

function basename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function readFixtures() {
  return JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
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
    speed: DEFAULT_SPEED,
    audio_session_id: 1,
    can_set_speed: true,
    is_playing: false,
    position_ms: 0,
    duration_ms: 0,
    can_seek: false
  };
}

function createHarnessState() {
  return {
    cardsSnapshot: readFixtures(),
    playerState: emptyPlayerState(),
    playStartedAtMs: 0,
    playBasePositionMs: 0,
    nextAudioSessionId: 10
  };
}

function idleTurnStatus() {
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

async function screenshot(page, name) {
  const target = path.join(reportDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function waitForOpenDetail(page) {
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && (detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open")));
  });
}

async function openAudioDetail(page, sessionId) {
  const opened = await page.evaluate(async (activeSessionId) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const audio = document.querySelector(`button.action-audio[data-card-session-id="${activeSessionId}"]`);
    if (!audio) {
      return false;
    }
    audio.click();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const wave = document.querySelector(`[data-card-session-id="${activeSessionId}"] .wave-row`);
      if (wave) {
        wave.click();
        return true;
      }
      await sleep(50);
    }
    return false;
  }, sessionId);
  if (!opened) {
    throw new Error(`Unable to open waveform detail for ${sessionId}`);
  }
  await waitForOpenDetail(page);
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
    await context.exposeBinding("__codexPuckyPostMessage", async ({ page }, raw) => {
      let callbackId = "";
      let payload;
      try {
        const parsed = JSON.parse(String(raw || "{}"));
        callbackId = String(parsed.id || "");
        payload = { ok: true, result: dispatch(state, parsed) };
      } catch (error) {
        payload = {
          ok: false,
          error: error.message || String(error),
          error_type: error.name || "Error"
        };
      }
      if (callbackId) {
        await page.evaluate(({ id, result }) => {
          window.Pucky && window.Pucky.__resolve && window.Pucky.__resolve(id, result);
        }, { id: callbackId, result: payload });
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

    await page.goto(fileUrl(uiPath), { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-route="feed"]');
    await page.waitForSelector(`[data-card-session-id="${TARGET_SESSION_ID}"]`);
    await openAudioDetail(page, TARGET_SESSION_ID);
    await resetDetailPlayback(page);

    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(1500);
    summary.after_play = await detailState(page);
    summary.player_during_play = dispatch(state, { command: "player.state", args: {} });
    await screenshot(page, "01-after-play");

    await page.waitForTimeout(3500);
    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(400);
    summary.after_pause = await detailState(page);
    summary.player_after_pause = dispatch(state, { command: "player.state", args: {} });
    await screenshot(page, "02-after-pause");

    expect(summary.after_pause.playLabel === "Play", `Expected paused control label to be Play, got ${summary.after_pause.playLabel}`);
    expect(summary.after_pause.positionMs >= 3000, `Expected paused scrubber position >= 3000ms, got ${summary.after_pause.positionMs}`);
    expect(summary.player_after_pause.state === "paused", `Expected native player state paused, got ${summary.player_after_pause.state}`);
    expect(summary.player_after_pause.is_playing === false, "Expected paused player to report is_playing false");
    expect(summary.player_after_pause.position_ms >= 3000, `Expected paused player position >= 3000ms, got ${summary.player_after_pause.position_ms}`);

    await page.locator("#detail .control-play").click();
    await page.waitForTimeout(400);
    summary.after_resume = await detailState(page);
    summary.player_after_resume = dispatch(state, { command: "player.state", args: {} });
    await screenshot(page, "03-after-resume");

    expect(summary.after_resume.playLabel === "Pause", `Expected resumed control label to be Pause, got ${summary.after_resume.playLabel}`);
    expect(summary.after_resume.positionMs >= summary.after_pause.positionMs, "Expected resumed scrubber position to stay at or beyond the paused position");
    expect(summary.player_after_resume.is_playing === true, "Expected resumed player to be playing");
    expect(summary.player_after_resume.position_ms >= summary.player_after_pause.position_ms, "Expected resumed player position to continue from the paused position");

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
