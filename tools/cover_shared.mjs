import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MIN_PLAYBACK_SPEED = 0.5;
export const MAX_PLAYBACK_SPEED = 3;

export function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

export function resolveChromePath() {
  const envPath = String(process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
  const cacheCandidates = [];
  for (const root of [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright")
  ]) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const base = path.join(root, entry.name);
      cacheCandidates.push(
        path.join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(base, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(base, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(base, "chrome-linux", "chrome"),
        path.join(base, "chrome-win", "chrome.exe")
      );
    }
  }
  const candidates = [
    envPath,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    path.join(os.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ...cacheCandidates
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome executable not found");
}

export function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

export function basename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function clampSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, parsed));
}

export function formatSpeed(value) {
  return `${Number(clampSpeed(value).toFixed(2)).toString()}x`;
}

export function emptyPlayerState(overrides = {}) {
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
    can_seek: false,
    ...overrides
  };
}

export function idleTurnStatus() {
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

export function readRuntimeFixtures(repoRoot) {
  const deployPath = path.join(repoRoot, "pucky_vm", "ui_src", "fixtures", "reply_cards_deploy.json");
  const deployFixture = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const cards = Array.isArray(deployFixture.cards) ? deployFixture.cards.map(runtimeCardFromDeploy) : [];
  return {
    schema: "pucky.reply_cards.v1",
    count: cards.length,
    cards
  };
}

function runtimeCardFromDeploy(rawCard) {
  const card = JSON.parse(JSON.stringify(rawCard || {}));
  const audioArtifact = String(card.audio_artifact || "").trim();
  const htmlArtifact = String(card.html_artifact || "").trim();
  const deviceAudioPath = String(card.device_audio_path || "").trim();
  const publicAudioPath = String(card.public_audio_path || "").trim();
  const publicAudioPlaylistPath = String(card.public_audio_playlist_path || "").trim();
  const impliedAudioArtifact = inferredAudioArtifactName({
    card,
    htmlArtifact,
    deviceAudioPath,
    publicAudioPath
  });

  delete card.audio_artifact;
  delete card.html_artifact;
  delete card.device_audio_path;
  delete card.public_audio_path;
  delete card.public_audio_playlist_path;

  if (audioArtifact) {
    card.audio_path = artifactMockPath(audioArtifact);
  } else if (impliedAudioArtifact) {
    card.audio_path = artifactMockPath(impliedAudioArtifact);
  } else if (deviceAudioPath) {
    card.audio_path = deviceAudioPath;
  } else if (publicAudioPath) {
    card.audio_path = publicAudioPath;
  }
  if (publicAudioPlaylistPath) {
    card.audio_playlist_path = publicAudioPlaylistPath;
  }
  if (htmlArtifact) {
    card.html_path = artifactMockPath(htmlArtifact);
  }
  if (Array.isArray(card.attachments)) {
    card.attachments = card.attachments.map(runtimeAttachmentFromDeploy);
  }
  if (Array.isArray(card.images)) {
    card.images = card.images.map(runtimeAttachmentFromDeploy);
  }
  if (Array.isArray(card.transcript_messages)) {
    card.transcript_messages = card.transcript_messages.map((message) => {
      const copy = JSON.parse(JSON.stringify(message || {}));
      if (Array.isArray(copy.attachments)) {
        copy.attachments = copy.attachments.map(runtimeAttachmentFromDeploy);
      }
      if (Array.isArray(copy.images)) {
        copy.images = copy.images.map(runtimeAttachmentFromDeploy);
      }
      return copy;
    });
  }
  return card;
}

function runtimeAttachmentFromDeploy(attachment) {
  const item = JSON.parse(JSON.stringify(attachment || {}));
  const artifact = String(item.artifact || "").trim();
  if (artifact && !String(item.path || "").trim()) {
    item.path = artifactMockPath(artifact);
  }
  return item;
}

function artifactMockPath(artifactName) {
  return `/mock/${String(artifactName || "").replace(/^\/+/, "")}`;
}

function inferredAudioArtifactName({ card, htmlArtifact, deviceAudioPath, publicAudioPath }) {
  if (!htmlArtifact || !(deviceAudioPath || publicAudioPath)) {
    return "";
  }
  if (!Array.isArray(card.audio_timestamps) || !card.audio_timestamps.length) {
    return "";
  }
  return `${path.parse(htmlArtifact).name}.wav`;
}

export async function installCodexPuckyBridge(context, handler) {
  await context.exposeBinding("__codexPuckyPostMessage", async ({ page }, raw) => {
    let callbackId = "";
    let payload;
    try {
      const parsed = JSON.parse(String(raw || "{}"));
      callbackId = String(parsed.id || "");
      payload = {
        ok: true,
        result: await handler(parsed)
      };
    } catch (error) {
      payload = {
        ok: false,
        error: error.message || String(error),
        error_type: error.name || "Error"
      };
    }
    if (callbackId) {
      await page.evaluate(
        ({ id, result }) => {
          window.Pucky && window.Pucky.__resolve && window.Pucky.__resolve(id, result);
        },
        { id: callbackId, result: payload }
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
}

export function attachPageLogging(page, consoleLogPath) {
  page.on("console", (message) => {
    fs.appendFileSync(consoleLogPath, `[console:${message.type()}] ${message.text()}\n`, "utf8");
  });
  page.on("pageerror", (error) => {
    fs.appendFileSync(consoleLogPath, `[pageerror] ${error.message}\n`, "utf8");
  });
}

export function writeAutomationError(reportDir, error) {
  ensureDir(reportDir);
  fs.writeFileSync(path.join(reportDir, "automation-error.txt"), `${error.stack || error.message}\n`, "utf8");
}

export function writeJsonFile(targetPath, payload) {
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function saveScreenshot(page, reportDir, name) {
  const target = path.join(reportDir, `${name}.png`);
  await page.screenshot({
    path: target,
    fullPage: true,
    animations: "disabled",
    timeout: 120000,
  });
  return target;
}

export async function waitForText(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: innerSelector, expected: innerExpected }) => {
      const node = document.querySelector(innerSelector);
      return Boolean(node && node.textContent && node.textContent.includes(innerExpected));
    },
    { selector, expected }
  );
}

export async function waitForDetailOpen(page, timeout = 2500) {
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && (detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open")));
  }, {}, { timeout });
}

export async function openAudioDetail(page, sessionId) {
  const audioSelector = `button.action-audio[data-card-session-id="${sessionId}"]`;
  const waveSelector = `[data-card-session-id="${sessionId}"] .wave-row`;
  const audioButton = page.locator(audioSelector);
  if (await audioButton.count()) {
    await audioButton.click();
    await page.waitForSelector(waveSelector);
  }
  try {
    await page.locator(waveSelector).click();
    await waitForDetailOpen(page);
    return;
  } catch (_) {
    // Fall through to stronger event dispatch options for flaky headless clicks.
  }
  try {
    await page.locator(waveSelector).dispatchEvent("click");
    await waitForDetailOpen(page);
    return;
  } catch (_) {
    // Fall through.
  }
  await page.locator(waveSelector).evaluate((node) => node.click());
  await waitForDetailOpen(page);
}

export async function dismissAudioDetail(page) {
  await page.locator("#detail .detail-back").click();
  await page.waitForFunction(() => document.getElementById("detail")?.getAttribute("aria-hidden") === "true");
}
