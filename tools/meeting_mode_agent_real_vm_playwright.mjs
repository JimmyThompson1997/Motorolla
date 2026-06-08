import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  emptyPlayerState,
  ensureDir,
  idleTurnStatus,
  installCodexPuckyBridge,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 430, height: 932 };
const DEFAULT_REPORT_ROOT = path.join(repoRoot, ".tmp", "meeting-mode-real-vm-proof");

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: "",
    scenarioNames: [],
    bridgeMode: "none"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--base-url" && argv[index + 1]) {
      options.baseUrl = String(argv[index + 1] || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (token === "--report-dir" && argv[index + 1]) {
      options.reportDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (token === "--scenario" && argv[index + 1]) {
      options.scenarioNames.push(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }
    if (token === "--headed") {
      options.headless = false;
      continue;
    }
    if (token === "--with-bridge") {
      options.bridgeMode = "with_bridge";
      continue;
    }
  }
  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeTextFile(targetPath, text) {
  fs.writeFileSync(targetPath, String(text || ""), "utf8");
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").trim();
}

function runProcessResult(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
}

function gitOutput(args) {
  return runProcess("git", args, { cwd: repoRoot });
}

function repoState() {
  const branchStatus = gitOutput(["status", "--short", "--branch"]);
  const head = gitOutput(["rev-parse", "HEAD"]);
  const upstream = gitOutput(["rev-parse", "@{u}"]);
  return {
    branch_status: branchStatus,
    head,
    upstream,
    clean: !branchStatus.split(/\r?\n/).slice(1).some((line) => String(line || "").trim())
  };
}

function ensureCanonicalMasterClean() {
  const status = repoState();
  if (!String(status.branch_status || "").startsWith("## master...origin/master")) {
    throw new Error(`Canonical repo must be on master tracking origin/master. Saw: ${status.branch_status}`);
  }
  if (!status.clean) {
    throw new Error(`Canonical repo must be clean before real VM proof. Saw:\n${status.branch_status}`);
  }
  if (status.head !== status.upstream) {
    throw new Error(`Canonical repo HEAD ${status.head} does not match upstream ${status.upstream}`);
  }
  return status;
}

function resolveFlyctl() {
  const candidates = [
    "C:\\Users\\jimmy\\.fly\\bin\\flyctl.exe",
    "flyctl"
  ];
  for (const candidate of candidates) {
    try {
      const output = runProcess(candidate, ["version"], { cwd: repoRoot });
      if (output) {
        return candidate;
      }
    } catch (_) {
      // Try next candidate.
    }
  }
  throw new Error("Could not find flyctl for live VM token discovery");
}

function loadFlyEnvironment() {
  const flyctl = resolveFlyctl();
  const processResult = runProcessResult(flyctl, ["ssh", "console", "-a", "pucky", "--command", "env"], { cwd: repoRoot });
  const envText = String(processResult.stdout || "").trim();
  if (!envText) {
    throw new Error(String(processResult.stderr || processResult.stdout || "Could not read live Fly environment"));
  }
  const result = {};
  for (const line of envText.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1);
    result[key] = value;
  }
  return result;
}

function resolveApiToken() {
  const direct = String(process.env.PUCKY_API_TOKEN || "").trim();
  if (direct) {
    return direct;
  }
  const flyEnv = loadFlyEnvironment();
  const token = String(flyEnv.PUCKY_API_TOKEN || "").trim();
  if (!token) {
    throw new Error("Could not resolve PUCKY_API_TOKEN from environment or live Fly app");
  }
  return token;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload.detail || payload.error || `HTTP ${response.status}`));
  }
  return payload;
}

async function apiJson(baseUrl, apiToken, pathName, options = {}) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    ...(options.headers || {})
  };
  return fetchJson(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers,
    body: options.body
  });
}

async function fetchManifest(baseUrl) {
  return fetchJson(`${baseUrl}/ui/pucky/latest/manifest.json`);
}

async function fetchHealth(baseUrl) {
  return fetchJson(`${baseUrl}/healthz`);
}

async function fetchFeedSnapshot(baseUrl, apiToken) {
  const payload = await apiJson(baseUrl, apiToken, "/api/feed?limit=200");
  return {
    schema: "pucky.reply_cards.v1",
    count: Array.isArray(payload.items) ? payload.items.length : 0,
    cards: Array.isArray(payload.items) ? payload.items : []
  };
}

async function browserFeedSnapshot(page) {
  return page.evaluate(() => {
    const domCards = Array.from(document.querySelectorAll("[data-card-session-id]")).map((node) => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      title: (node.querySelector(".title")?.textContent || "").trim(),
      preview: (
        node.querySelector(".preview, .card-outbound-preview, .card-summary, .summary, .title")?.textContent || ""
      ).trim()
    }));
    const route = document.querySelector(".app-shell")?.getAttribute("data-view") || "";
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      const described = window.PuckyUiDebug.describe();
      if (described && typeof described === "object") {
        return {
          ...described,
          route: described.route || route,
          visible_cards: domCards.length ? domCards : Array.isArray(described.visible_cards) ? described.visible_cards : []
        };
      }
    }
    return {
      schema: "pucky.ui_surface.v1",
      route,
      detail: {
        open: false,
        type: "",
        card_id: "",
        session_id: "",
        thread_id: "",
        viewer: ""
      },
      visible_cards: domCards
    };
  });
}

async function fetchMeetingDetail(baseUrl, apiToken, meetingId) {
  return apiJson(baseUrl, apiToken, `/api/meetings/${encodeURIComponent(meetingId)}`);
}

async function fetchArtifactBase64(baseUrl, apiToken, artifactId) {
  const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) {
    throw new Error(`Artifact fetch failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    schema: "pucky.artifact_read.v1",
    mime_type: String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim(),
    content_base64: bytes.toString("base64"),
    bytes: bytes.length
  };
}

function artifactIdFromPath(rawPath) {
  const value = String(rawPath || "");
  const prefix = "fixtures/artifacts/";
  if (value.startsWith(prefix)) {
    return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function mimeTypeFromPath(rawPath) {
  const value = String(rawPath || "").toLowerCase();
  if (value.endsWith(".txt")) return "text/plain";
  if (value.endsWith(".html") || value.endsWith(".htm")) return "text/html";
  if (value.endsWith(".m4a")) return "audio/mp4";
  if (value.endsWith(".wav")) return "audio/wav";
  if (value.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

async function postMeeting(baseUrl, apiToken, payload) {
  return apiJson(baseUrl, apiToken, "/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function waitForMeetingState(baseUrl, apiToken, meetingId, expectedState, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = {};
  while (Date.now() < deadline) {
    lastPayload = await fetchMeetingDetail(baseUrl, apiToken, meetingId);
    const meeting = lastPayload.meeting || {};
    const state = String(meeting.state || "");
    if (state === expectedState) {
      return meeting;
    }
    if (state === "failed") {
      throw new Error(`Meeting ${meetingId} failed during wait for ${expectedState}: ${meeting.failure_stage || "unknown_stage"}: ${meeting.failure_reason || "unknown reason"}`);
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${meetingId} to reach ${expectedState}; last payload: ${JSON.stringify(lastPayload).slice(0, 2000)}`);
}

async function waitForMeetingProcessing(baseUrl, apiToken, meetingId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await fetchMeetingDetail(baseUrl, apiToken, meetingId);
    const meeting = payload.meeting || {};
    const state = String(meeting.state || "");
    if (state === "processing" || state === "completed") {
      return meeting;
    }
    if (state === "failed") {
      throw new Error(`Meeting ${meetingId} failed before processing: ${meeting.failure_stage || "unknown_stage"}: ${meeting.failure_reason || "unknown reason"}`);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${meetingId} to enter processing`);
}

async function triggerFeedRefresh(page) {
  await page.evaluate(() => window.PuckyUiDebug.dispatch("refresh_cards"));
  await delay(500);
}

async function waitForRoute(page, route, timeoutMs = 10000) {
  await page.waitForFunction((expectedRoute) => {
    return document.querySelector(".app-shell")?.getAttribute("data-view") === expectedRoute;
  }, route, { timeout: timeoutMs });
}

async function ensureDetailClosed(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hidden = await page.evaluate(() => document.getElementById("detail")?.getAttribute("aria-hidden") || "true");
    if (hidden === "true") {
      return;
    }
    const result = await page.evaluate(() => window.PuckyUiDebug.dispatch("back"));
    if (!result?.ok) {
      throw new Error(`Back action failed while closing detail: ${result?.error || "unknown error"}`);
    }
    await delay(150);
  }
  throw new Error("Timed out closing detail panel");
}

async function gotoRoute(page, route, timeoutMs = 10000) {
  await ensureDetailClosed(page);
  const currentRoute = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-view") || "");
  if (currentRoute !== route) {
    await page.locator(`[data-route="${route}"]`).first().click();
  }
  await waitForRoute(page, route, timeoutMs);
  await delay(250);
}

async function triggerMeetingsRefresh(page) {
  await gotoRoute(page, "meetings");
  const refreshButton = page.locator("button.meetings-refresh").first();
  if (await refreshButton.count()) {
    await refreshButton.click();
  }
  await delay(500);
}

async function browserRouteSnapshot(page, route) {
  if (route === "meetings") {
    await triggerMeetingsRefresh(page);
  } else {
    await gotoRoute(page, "feed");
    await triggerFeedRefresh(page);
  }
  return browserFeedSnapshot(page);
}

async function waitForMeetingRouteCard(page, meetingId, { pending = null, timeoutMs = 60000 } = {}) {
  const selector = `[data-card-session-id="${meetingId}"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerMeetingsRefresh(page);
    const card = page.locator(selector).first();
    if (await card.count()) {
      const className = await card.evaluate((node) => String(node.className || ""));
      if (pending === null) {
        return className;
      }
      const isPending = className.includes("card-pending-thread");
      if (Boolean(pending) === isPending) {
        return className;
      }
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for meetings route card ${meetingId}${pending === null ? "" : pending ? " pending" : " completed"}`);
}

async function waitForCardText(page, meetingId, text, timeoutMs = 60000) {
  const selector = `[data-card-session-id="${meetingId}"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerFeedRefresh(page);
    const content = await page.locator(selector).textContent().catch(() => "");
    if (String(content || "").includes(text)) {
      return;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for card ${meetingId} to include "${text}"`);
}

async function waitForDetail(page, detailType, viewer = null, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      hidden: document.getElementById("detail")?.getAttribute("aria-hidden") || "",
      type: document.getElementById("detail")?.getAttribute("data-detail-type") || "",
      viewer: document.getElementById("detail")?.getAttribute("data-detail-viewer") || ""
    }));
    if (state.hidden !== "true" && state.type === detailType && (viewer === null || state.viewer === viewer)) {
      return state;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for detail ${detailType}${viewer ? `/${viewer}` : ""}`);
}

async function openMeetingTranscript(page, meetingId) {
  const result = await page.evaluate((sessionId) => window.PuckyUiDebug.dispatch("open_card_action", { session_id: sessionId, action: "transcript" }), meetingId);
  if (!result?.ok) {
    throw new Error(`Could not open transcript action for ${meetingId}: ${result?.error || "unknown error"}`);
  }
  await waitForDetail(page, "transcript");
}

async function openMeetingAttachment(page, meetingId) {
  const result = await page.evaluate((sessionId) => window.PuckyUiDebug.dispatch("open_card_action", { session_id: sessionId, action: "attachment" }), meetingId);
  if (!result?.ok) {
    throw new Error(`Could not open attachment action for ${meetingId}: ${result?.error || "unknown error"}`);
  }
  await waitForDetail(page, "attachment", "html_iframe");
}

async function openMeetingRowSummary(page, meetingId) {
  await gotoRoute(page, "meetings");
  const body = page.locator(`[data-card-session-id="${meetingId}"] .card-body`).first();
  await body.waitFor({ state: "visible", timeout: 15000 });
  await body.click();
  await waitForDetail(page, "attachment", "html_iframe");
}

async function openMeetingRowAudio(page, meetingId) {
  await gotoRoute(page, "meetings");
  const audioAction = page.locator(`[data-card-session-id="${meetingId}"] .action.action-audio`).first();
  await audioAction.waitFor({ state: "visible", timeout: 15000 });
  await audioAction.click();
  await waitForDetail(page, "attachment", "audio_player");
}

async function backToDetail(page, detailType, viewer = null) {
  const result = await page.evaluate(() => window.PuckyUiDebug.dispatch("back"));
  if (!result?.ok) {
    throw new Error(`Back action failed: ${result?.error || "unknown error"}`);
  }
  await waitForDetail(page, detailType, viewer);
}

async function backToFeed(page) {
  const result = await page.evaluate(() => window.PuckyUiDebug.dispatch("back"));
  if (!result?.ok) {
    throw new Error(`Back action failed: ${result?.error || "unknown error"}`);
  }
  await ensureDetailClosed(page, 10000);
}

async function playAttachmentAudioAndWaitForAdvance(page, timeoutMs = 15000) {
  const locator = page.locator("#detail audio.attachment-audio-player").last();
  const before = await locator.evaluate((node) => ({
    currentTime: Number(node.currentTime || 0),
    duration: Number(node.duration || 0),
    paused: Boolean(node.paused),
    readyState: Number(node.readyState || 0)
  }));
  const playResult = await locator.evaluate(async (node) => {
    try {
      node.muted = true;
      await node.play();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  if (!playResult?.ok) {
    throw new Error(`Audio playback could not start: ${playResult?.error || "unknown error"}`);
  }
  await page.waitForFunction(() => {
    const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
    const audio = players.length ? players[players.length - 1] : null;
    return Boolean(audio && !audio.paused && Number(audio.currentTime || 0) > 0.25);
  }, {}, { timeout: timeoutMs });
  const after = await locator.evaluate((node) => ({
    currentTime: Number(node.currentTime || 0),
    duration: Number(node.duration || 0),
    paused: Boolean(node.paused),
    readyState: Number(node.readyState || 0)
  }));
  if (!(after.currentTime > before.currentTime)) {
    throw new Error(`Audio playback time did not advance (before=${before.currentTime}, after=${after.currentTime})`);
  }
  return { before, after };
}

async function waitForAudioViewerResolution(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const detail = document.getElementById("detail");
      const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
      const audio = players.length ? players[players.length - 1] : null;
      const error = detail?.querySelector(".attachment-error");
      return {
        detail_html: String(detail?.innerHTML || ""),
        audio_outer_html: String(audio?.outerHTML || ""),
        src: String(audio?.getAttribute("src") || ""),
        current_src: String(audio?.currentSrc || ""),
        error_text: String(error?.textContent || "").trim()
      };
    });
    if (state.error_text || state.src || state.current_src) {
      return state;
    }
    await delay(200);
  }
  return await page.evaluate(() => {
    const detail = document.getElementById("detail");
    const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
    const audio = players.length ? players[players.length - 1] : null;
    const error = detail?.querySelector(".attachment-error");
    return {
      detail_html: String(detail?.innerHTML || ""),
      audio_outer_html: String(audio?.outerHTML || ""),
      src: String(audio?.getAttribute("src") || ""),
      current_src: String(audio?.currentSrc || ""),
      error_text: String(error?.textContent || "").trim()
    };
  });
}

function createSilenceWavBuffer(durationMs = 450, sampleRate = 16000) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataSize = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function resolveFfmpegPath() {
  const output = runProcess("where.exe", ["ffmpeg"], { cwd: repoRoot });
  const candidate = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!candidate) {
    throw new Error("ffmpeg not found on PATH");
  }
  return candidate;
}

function runEdgeTts({ voice, text, targetPath }) {
  const args = ["-m", "edge_tts", "--voice", voice, "--text", text, "--write-media", targetPath];
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      runProcess("python", args, { cwd: repoRoot });
      return;
    } catch (error) {
      lastError = error;
      try {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      } catch (_) {
        // Leave any cleanup failure to the final retry error.
      }
      const message = String(error?.message || "");
      const retryable = message.includes("503") || message.includes("timed out") || message.includes("ECONNRESET");
      if (!retryable || attempt === 4) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200 * attempt);
    }
  }
  throw lastError || new Error("edge_tts failed");
}

function transcodeToWav(ffmpegPath, inputPath, outputPath) {
  runProcess(ffmpegPath, ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath], { cwd: repoRoot });
}

function concatWavFiles(ffmpegPath, orderedPaths, outputPath, workDir) {
  const concatPath = path.join(workDir, "concat.txt");
  const body = orderedPaths.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n");
  writeTextFile(concatPath, body);
  runProcess(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-acodec", "pcm_s16le", outputPath], { cwd: workDir });
}

function buildScenarioTimestamp(offsetMinutes = 0) {
  const value = new Date(Date.now() + offsetMinutes * 60_000);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return {
    meetingDate: `${year}${month}${day}`,
    isoStart: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    datePart: `${year}${month}${day}-${hour}${minute}${second}`
  };
}

function normalizeStem(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProofText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueMeetingId(label, offsetMinutes = 0) {
  const stamp = buildScenarioTimestamp(offsetMinutes);
  return {
    meetingId: `meeting-${stamp.datePart}-codex-realvm-${label}`,
    startedAt: stamp.isoStart
  };
}

async function fetchArtifactText(baseUrl, apiToken, artifactId) {
  const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) {
    throw new Error(`Artifact fetch failed (${response.status})`);
  }
  return response.text();
}

function wavDurationMs(audioPath) {
  const buffer = fs.readFileSync(audioPath);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Expected a PCM WAV fixture at ${audioPath}`);
  }
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", cursor, cursor + 4);
    const chunkSize = buffer.readUInt32LE(cursor + 4);
    const chunkDataOffset = cursor + 8;
    if (chunkId === "fmt " && chunkSize >= 16 && chunkDataOffset + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    const paddedChunkSize = chunkSize + (chunkSize % 2);
    cursor = chunkDataOffset + paddedChunkSize;
  }
  if (!(channels > 0 && sampleRate > 0 && bitsPerSample > 0 && dataSize > 0)) {
    throw new Error(`Unable to parse WAV metadata from ${audioPath}`);
  }
  const bytesPerSecond = Math.max(1, sampleRate * channels * Math.max(1, bitsPerSample / 8));
  return Math.max(1000, Math.round((dataSize / bytesPerSecond) * 1000));
}

function livePayload({ meetingId, startedAt, audioPath }) {
  const durationMs = wavDurationMs(audioPath);
  return {
    meeting_id: meetingId,
    started_at: startedAt,
    stopped_at: new Date(Date.parse(startedAt) + durationMs).toISOString().replace(".000Z", "Z"),
    duration_ms: durationMs,
    device_id: "codex-realvm-browser-proof",
    device_path: `/data/user/0/com.pucky.device.debug/files/voice/${meetingId}.wav`,
    mime_type: "audio/wav",
    audio_base64: fs.readFileSync(audioPath).toString("base64")
  };
}

function ensureGeneratedFixtures(reportDir) {
  const ffmpegPath = resolveFfmpegPath();
  const fixtureDir = path.join(reportDir, "generated-fixtures");
  const segmentDir = path.join(fixtureDir, "segments");
  ensureDir(fixtureDir);
  ensureDir(segmentDir);

  const silencePath = path.join(segmentDir, "silence-1200ms.wav");
  if (!fs.existsSync(silencePath)) {
    fs.writeFileSync(silencePath, createSilenceWavBuffer(1200));
  }

  const namedDuoOut = path.join(fixtureDir, "named-duo-3to5m-generated.wav");
  const anonymousDuoOut = path.join(fixtureDir, "anonymous-duo-3to5m-generated.wav");
  const namedTrioOut = path.join(fixtureDir, "named-trio-3to5m-generated.wav");
  const anonymousTrioOut = path.join(fixtureDir, "anonymous-trio-3to5m-generated.wav");

  const buildFixture = (name, segments) => {
    const wavParts = [];
    for (let index = 0; index < segments.length; index += 1) {
      const item = segments[index];
      const mp3Path = path.join(segmentDir, `${name}-${String(index + 1).padStart(2, "0")}.mp3`);
      const wavPath = path.join(segmentDir, `${name}-${String(index + 1).padStart(2, "0")}.wav`);
      if (!fs.existsSync(mp3Path)) {
        runEdgeTts({ voice: item.voice, text: item.text, targetPath: mp3Path });
      }
      if (!fs.existsSync(wavPath)) {
        transcodeToWav(ffmpegPath, mp3Path, wavPath);
      }
      wavParts.push(wavPath);
      if (index !== segments.length - 1) {
        wavParts.push(silencePath);
      }
    }
    return wavParts;
  };

  if (!fs.existsSync(namedDuoOut)) {
    const namedParts = buildFixture("named-duo-3to5m", [
      { voice: "en-US-GuyNeural", text: "Hi Maya, I'm Jimmy. Thanks for joining this partner rollout launch readiness review so we can get the deck, budget, and reseller email lined up before next week." },
      { voice: "en-US-AriaNeural", text: "Hi Jimmy, this is Maya. I finished the latest budget workbook last night, but I still need finance to confirm the open headcount line before I lock the totals." },
      { voice: "en-US-GuyNeural", text: "I'm Jimmy again. The main launch issue on my side is that the leadership deck still needs the reseller introduction email, the customer story slide, and a cleaner summary of the launch timeline." },
      { voice: "en-US-AriaNeural", text: "Maya speaking. On the finance side I also need to clean up the travel table, the contractor line, and the pricing sensitivity note before the budget is ready to share more broadly." },
      { voice: "en-US-GuyNeural", text: "Jimmy will send the launch deck to leadership by Tuesday June ninth, and I will include the first pass of the reseller introduction email in that deck packet at the same time." },
      { voice: "en-US-AriaNeural", text: "I am Maya, and I will send the revised budget workbook by Wednesday June tenth once finance confirms the headcount this afternoon and I can update the totals." },
      { voice: "en-US-GuyNeural", text: "Maya, please also own the pricing risk log. I want that document drafted by Tuesday June ninth so we can mention the biggest open pricing concerns during the Thursday partner call." },
      { voice: "en-US-AriaNeural", text: "That works. Maya will draft the pricing risk log by Tuesday June ninth, and I will send the reseller contact list by Friday June twelfth so sales has the latest names and addresses." },
      { voice: "en-US-GuyNeural", text: "Jimmy will schedule the internal launch dry run for Thursday June eleventh, and I will send the agenda for that dry run by Wednesday June tenth before lunch." },
      { voice: "en-US-AriaNeural", text: "I also need the updated pricing assumptions. Maya will review those assumptions by Thursday June eleventh and send comments back the same afternoon after the finance check is done." },
      { voice: "en-US-GuyNeural", text: "I want the frequently asked questions page cleaned up too. Jimmy will draft the frequently asked questions page by Monday June eighth and will call out the reseller onboarding steps in that draft." },
      { voice: "en-US-AriaNeural", text: "Once that arrives, Maya will review the pricing section and the travel estimate on Tuesday June ninth so the questions page and the budget use the same numbers." },
      { voice: "en-US-GuyNeural", text: "Another item is the leadership follow up note. Jimmy will send that note by Friday June twelfth with the dry-run outcome, the deck status, and the reseller email status." },
      { voice: "en-US-AriaNeural", text: "Maya will update the forecast notes inside the workbook by Wednesday June tenth, and I will highlight any remaining finance blockers in the same message as the revised budget." },
      { voice: "en-US-GuyNeural", text: "Let me recap the owners. Jimmy owns the launch deck, the reseller introduction email, the frequently asked questions page, the dry-run agenda, and the leadership follow up note." },
      { voice: "en-US-AriaNeural", text: "And Maya owns the revised budget workbook, the pricing risk log, the reseller contact list, the pricing assumptions review, and the forecast notes." },
      { voice: "en-US-GuyNeural", text: "Great. I'm Jimmy, and I want all of those dates held because the partner rollout window is tight and leadership expects a complete status update before the week is over." },
      { voice: "en-US-AriaNeural", text: "Understood. This is Maya, and I will keep the June ninth, June tenth, June eleventh, and June twelfth due dates visible in each follow up so nothing slips." }
    ]);
    concatWavFiles(ffmpegPath, namedParts, namedDuoOut, fixtureDir);
  }

  if (!fs.existsSync(anonymousDuoOut)) {
    const anonymousParts = buildFixture("anonymous-duo-3to5m", [
      { voice: "en-US-GuyNeural", text: "Thanks for joining this partner rollout launch readiness review so we can get the deck, budget, and reseller email lined up before next week." },
      { voice: "en-US-AriaNeural", text: "I finished the latest budget workbook last night, but I still need finance to confirm the open headcount line before I lock the totals." },
      { voice: "en-US-GuyNeural", text: "The main launch issue on my side is that the leadership deck still needs the reseller introduction email, the customer story slide, and a cleaner summary of the launch timeline." },
      { voice: "en-US-AriaNeural", text: "On the finance side I also need to clean up the travel table, the contractor line, and the pricing sensitivity note before the budget is ready to share more broadly." },
      { voice: "en-US-GuyNeural", text: "I will send the launch deck to leadership by Tuesday June ninth, and I will include the first pass of the reseller introduction email in that deck packet at the same time." },
      { voice: "en-US-AriaNeural", text: "I will send the revised budget workbook by Wednesday June tenth once finance confirms the headcount this afternoon and I can update the totals." },
      { voice: "en-US-GuyNeural", text: "Please also own the pricing risk log. I want that document drafted by Tuesday June ninth so we can mention the biggest open pricing concerns during the Thursday partner call." },
      { voice: "en-US-AriaNeural", text: "That works. I will draft the pricing risk log by Tuesday June ninth, and I will send the reseller contact list by Friday June twelfth so sales has the latest names and addresses." },
      { voice: "en-US-GuyNeural", text: "I will schedule the internal launch dry run for Thursday June eleventh, and I will send the agenda for that dry run by Wednesday June tenth before lunch." },
      { voice: "en-US-AriaNeural", text: "I also need the updated pricing assumptions. I will review those assumptions by Thursday June eleventh and send comments back the same afternoon after the finance check is done." },
      { voice: "en-US-GuyNeural", text: "I want the frequently asked questions page cleaned up too. I will draft the frequently asked questions page by Monday June eighth and will call out the reseller onboarding steps in that draft." },
      { voice: "en-US-AriaNeural", text: "Once that arrives, I will review the pricing section and the travel estimate on Tuesday June ninth so the questions page and the budget use the same numbers." },
      { voice: "en-US-GuyNeural", text: "Another item is the leadership follow up note. I will send that note by Friday June twelfth with the dry-run outcome, the deck status, and the reseller email status." },
      { voice: "en-US-AriaNeural", text: "I will update the forecast notes inside the workbook by Wednesday June tenth, and I will highlight any remaining finance blockers in the same message as the revised budget." },
      { voice: "en-US-GuyNeural", text: "Let me recap the owners. One speaker owns the launch deck, the reseller introduction email, the frequently asked questions page, the dry-run agenda, and the leadership follow up note." },
      { voice: "en-US-AriaNeural", text: "The other speaker owns the revised budget workbook, the pricing risk log, the reseller contact list, the pricing assumptions review, and the forecast notes." },
      { voice: "en-US-GuyNeural", text: "Great. I want all of those dates held because the partner rollout window is tight and leadership expects a complete status update before the week is over." },
      { voice: "en-US-AriaNeural", text: "Understood. I will keep the June ninth, June tenth, June eleventh, and June twelfth due dates visible in each follow up so nothing slips." }
    ]);
    concatWavFiles(ffmpegPath, anonymousParts, anonymousDuoOut, fixtureDir);
  }

  if (!fs.existsSync(namedTrioOut)) {
    const namedParts = buildFixture("named-trio-3to5m", [
      { voice: "en-US-GuyNeural", text: "Hi Jack and Maya, I'm Jimmy. Thanks for joining this partner rollout launch readiness meeting so we can line up the deck, the reseller email, the partner call, and the finance numbers." },
      { voice: "en-US-ChristopherNeural", text: "I'm Jack. I reviewed the partner checklist this morning, and the two biggest open items are the reseller introduction email and the frequently asked questions page for onboarding." },
      { voice: "en-US-AriaNeural", text: "I'm Maya. I updated the budget workbook last night, but I still need the finance headcount, the travel number, and the final pricing assumptions before I can lock the totals." },
      { voice: "en-US-GuyNeural", text: "Jimmy will send the launch deck to leadership by Tuesday June ninth, and I will include the first pass of the reseller introduction email plus the customer story slide in that deck packet." },
      { voice: "en-US-ChristopherNeural", text: "Jack will schedule the partner check in for Thursday June eleventh, and I will send the draft agenda by Wednesday June tenth so everyone can review the reseller questions in advance." },
      { voice: "en-US-AriaNeural", text: "Maya will send the revised budget workbook by Wednesday June tenth after finance confirms the headcount, and I will flag the biggest pricing changes in that same note." },
      { voice: "en-US-GuyNeural", text: "This is Jimmy again. I also need a short leadership follow up note by Friday June twelfth, and I will own that note after the dry run finishes on Thursday." },
      { voice: "en-US-ChristopherNeural", text: "Jack here again. I will draft the frequently asked questions page by Monday June eighth, and I will add the reseller onboarding steps, contact flow, and escalation path in the first version." },
      { voice: "en-US-AriaNeural", text: "Maya speaking. I will review the pricing section inside that frequently asked questions page by Tuesday June ninth so it matches the workbook and the travel assumptions." },
      { voice: "en-US-GuyNeural", text: "Jimmy will run the internal launch dry run on Thursday June eleventh, and I will send the dry-run agenda by Wednesday June tenth before lunch so the team can prepare." },
      { voice: "en-US-ChristopherNeural", text: "I also need to prepare the reseller question tracker. Jack will circulate that tracker by Tuesday June ninth, and I will keep it updated before the Thursday partner check in." },
      { voice: "en-US-AriaNeural", text: "Maya will send the pricing risk log by Tuesday June ninth, and I will update the forecast notes by Wednesday June tenth so leadership can see the remaining finance blockers clearly." },
      { voice: "en-US-GuyNeural", text: "Another deliverable is the customer story document. Jimmy will send that by Wednesday June tenth, and I will pull the main quote into the launch deck before the dry run." },
      { voice: "en-US-ChristopherNeural", text: "Jack will send the reseller email draft comments back by Tuesday June ninth, and I will verify the partner call attendee list by Wednesday June tenth before the agenda goes out." },
      { voice: "en-US-AriaNeural", text: "Maya will send the revised travel estimate by Friday June twelfth, and I will keep the contractor line visible in the workbook so finance can approve the final total quickly." },
      { voice: "en-US-GuyNeural", text: "Let me recap the owners. Jimmy owns the launch deck, the customer story, the dry run, and the leadership follow up note." },
      { voice: "en-US-ChristopherNeural", text: "Jack owns the partner check in, the frequently asked questions page, the reseller question tracker, the attendee list, and the email draft comments." },
      { voice: "en-US-AriaNeural", text: "Maya owns the revised budget workbook, the pricing section review, the pricing risk log, the forecast notes, and the revised travel estimate." },
      { voice: "en-US-GuyNeural", text: "Perfect. I'm Jimmy, and I want the June eighth, June ninth, June tenth, June eleventh, and June twelfth due dates repeated in every follow up so the partner rollout stays on schedule." },
      { voice: "en-US-AriaNeural", text: "That works for me. This is Maya, and I will watch the finance dependency closely so the budget and pricing pieces do not block the launch deck or the partner meeting." }
    ]);
    concatWavFiles(ffmpegPath, namedParts, namedTrioOut, fixtureDir);
  }

  if (!fs.existsSync(anonymousTrioOut)) {
    const anonymousParts = buildFixture("anonymous-trio-3to5m", [
      { voice: "en-US-GuyNeural", text: "Thanks for joining this partner rollout launch readiness meeting so we can line up the deck, the reseller email, the partner call, and the finance numbers." },
      { voice: "en-US-ChristopherNeural", text: "I reviewed the partner checklist this morning, and the two biggest open items are the reseller introduction email and the frequently asked questions page for onboarding." },
      { voice: "en-US-AriaNeural", text: "I updated the budget workbook last night, but I still need the finance headcount, the travel number, and the final pricing assumptions before I can lock the totals." },
      { voice: "en-US-GuyNeural", text: "I will send the launch deck to leadership by Tuesday June ninth, and I will include the first pass of the reseller introduction email plus the customer story slide in that deck packet." },
      { voice: "en-US-ChristopherNeural", text: "I will schedule the partner check in for Thursday June eleventh, and I will send the draft agenda by Wednesday June tenth so everyone can review the reseller questions in advance." },
      { voice: "en-US-AriaNeural", text: "I will send the revised budget workbook by Wednesday June tenth after finance confirms the headcount, and I will flag the biggest pricing changes in that same note." },
      { voice: "en-US-GuyNeural", text: "I also need a short leadership follow up note by Friday June twelfth, and I will own that note after the dry run finishes on Thursday." },
      { voice: "en-US-ChristopherNeural", text: "I will draft the frequently asked questions page by Monday June eighth, and I will add the reseller onboarding steps, contact flow, and escalation path in the first version." },
      { voice: "en-US-AriaNeural", text: "I will review the pricing section inside that frequently asked questions page by Tuesday June ninth so it matches the workbook and the travel assumptions." },
      { voice: "en-US-GuyNeural", text: "I will run the internal launch dry run on Thursday June eleventh, and I will send the dry-run agenda by Wednesday June tenth before lunch so the team can prepare." },
      { voice: "en-US-ChristopherNeural", text: "I also need to prepare the reseller question tracker. I will circulate that tracker by Tuesday June ninth, and I will keep it updated before the Thursday partner check in." },
      { voice: "en-US-AriaNeural", text: "I will send the pricing risk log by Tuesday June ninth, and I will update the forecast notes by Wednesday June tenth so leadership can see the remaining finance blockers clearly." },
      { voice: "en-US-GuyNeural", text: "Another deliverable is the customer story document. I will send that by Wednesday June tenth, and I will pull the main quote into the launch deck before the dry run." },
      { voice: "en-US-ChristopherNeural", text: "I will send the reseller email draft comments back by Tuesday June ninth, and I will verify the partner call attendee list by Wednesday June tenth before the agenda goes out." },
      { voice: "en-US-AriaNeural", text: "I will send the revised travel estimate by Friday June twelfth, and I will keep the contractor line visible in the workbook so finance can approve the final total quickly." },
      { voice: "en-US-GuyNeural", text: "One speaker owns the launch deck, the customer story, the dry run, and the leadership follow up note." },
      { voice: "en-US-ChristopherNeural", text: "Another speaker owns the partner check in, the frequently asked questions page, the reseller question tracker, the attendee list, and the email draft comments." },
      { voice: "en-US-AriaNeural", text: "The remaining speaker owns the revised budget workbook, the pricing section review, the pricing risk log, the forecast notes, and the revised travel estimate." },
      { voice: "en-US-GuyNeural", text: "I want the June eighth, June ninth, June tenth, June eleventh, and June twelfth due dates repeated in every follow up so the partner rollout stays on schedule." },
      { voice: "en-US-AriaNeural", text: "That works for me. I will watch the finance dependency closely so the budget and pricing pieces do not block the launch deck or the partner meeting." }
    ]);
    concatWavFiles(ffmpegPath, anonymousParts, anonymousTrioOut, fixtureDir);
  }

  return {
    namedDuoOut,
    anonymousDuoOut,
    namedTrioOut,
    anonymousTrioOut
  };
}

function buildScenarios(reportDir, namesFilter = []) {
  const fixtures = ensureGeneratedFixtures(reportDir);
  const namedDuo = uniqueMeetingId("named-duo-3to5m", 0);
  const anonymousDuo = uniqueMeetingId("anonymous-duo-3to5m", 1);
  const namedTrio = uniqueMeetingId("named-trio-3to5m", 2);
  const anonymousTrio = uniqueMeetingId("anonymous-trio-3to5m", 3);
  const scenarios = [
    {
      name: "named_duo_3to5m",
      meetingId: namedDuo.meetingId,
      payload: livePayload({
        meetingId: namedDuo.meetingId,
        startedAt: namedDuo.startedAt,
        audioPath: fixtures.namedDuoOut
      }),
      expectedNames: ["Jimmy", "Maya"],
      forbiddenNeutralLabels: ["speaker_0", "speaker_1"],
      expectedSummarySnippets: [
        "Jimmy",
        "Maya",
        "launch deck",
        "budget workbook",
        "pricing risk log",
        "June 8",
        "June 9",
        "June 10",
        "June 11",
        "June 12"
      ],
      expectedDueDateSnippets: ["June 8", "June 9", "June 10", "June 11", "June 12"]
    },
    {
      name: "anonymous_duo_3to5m",
      meetingId: anonymousDuo.meetingId,
      payload: livePayload({
        meetingId: anonymousDuo.meetingId,
        startedAt: anonymousDuo.startedAt,
        audioPath: fixtures.anonymousDuoOut
      }),
      forbiddenNames: ["Jimmy", "Jack", "Maya"],
      expectedNeutralSpeakerCount: 2,
      expectedSummarySnippets: [
        "launch deck",
        "budget workbook",
        "pricing risk log",
        "June 8",
        "June 9",
        "June 10",
        "June 11",
        "June 12"
      ],
      expectedDueDateSnippets: ["June 8", "June 9", "June 10", "June 11", "June 12"]
    },
    {
      name: "named_trio_3to5m",
      meetingId: namedTrio.meetingId,
      payload: livePayload({
        meetingId: namedTrio.meetingId,
        startedAt: namedTrio.startedAt,
        audioPath: fixtures.namedTrioOut
      }),
      expectedNames: ["Jimmy", "Jack", "Maya"],
      forbiddenNeutralLabels: ["speaker_0", "speaker_1", "speaker_2"],
      expectedSummarySnippets: [
        "Jimmy",
        "Jack",
        "Maya",
        "launch deck",
        "budget",
        "June 8",
        "June 9",
        "June 10",
        "June 11",
        "June 12"
      ],
      expectedDueDateSnippets: ["June 8", "June 9", "June 10", "June 11", "June 12"]
    },
    {
      name: "anonymous_trio_3to5m",
      meetingId: anonymousTrio.meetingId,
      payload: livePayload({
        meetingId: anonymousTrio.meetingId,
        startedAt: anonymousTrio.startedAt,
        audioPath: fixtures.anonymousTrioOut
      }),
      forbiddenNames: ["Jimmy", "Jack", "Maya"],
      expectedNeutralSpeakerCount: 3,
      expectedSummarySnippets: [
        "launch",
        "budget",
        "partner",
        "June 8",
        "June 9",
        "June 10",
        "June 11",
        "June 12"
      ],
      expectedDueDateSnippets: ["June 8", "June 9", "June 10", "June 11", "June 12"]
    }
  ];
  for (const scenario of scenarios) {
    const durationMs = Number(scenario?.payload?.duration_ms || 0);
    if (!(durationMs >= 180000 && durationMs <= 300000)) {
      throw new Error(`${scenario.name} fixture duration ${durationMs}ms is outside the 3-5 minute target`);
    }
  }
  if (!namesFilter.length) {
    return scenarios;
  }
  return scenarios.filter((item) => namesFilter.includes(item.name));
}

function summarizeAttachments(meeting) {
  const messages = Array.isArray(meeting?.feed_item?.transcript_messages) ? meeting.feed_item.transcript_messages : [];
  const assistant = messages.find((item) => String(item?.role || "").toLowerCase() === "assistant") || {};
  return Array.isArray(assistant.attachments) ? assistant.attachments : [];
}

function assertHumanLikeTitle(label, title, meetingId) {
  const clean = String(title || "").trim();
  if (!clean) {
    throw new Error(`${label} title is empty`);
  }
  if (clean === String(meetingId || "").trim()) {
    throw new Error(`${label} title fell back to raw meeting_id`);
  }
  if (/^meeting-\d{8,}/i.test(clean)) {
    throw new Error(`${label} title still looks machine-generated: ${clean}`);
  }
}

function distinctNeutralSpeakers(transcriptText) {
  return [...new Set((String(transcriptText || "").match(/speaker_\d+/gi) || []).map((value) => value.toLowerCase()))];
}

async function runScenario({
  page,
  baseUrl,
  apiToken,
  reportDir,
  scenario,
  bridgeMode
}) {
  const scenarioDir = path.join(reportDir, scenario.name);
  ensureDir(scenarioDir);
  const warnings = [];
  await ensureDetailClosed(page);

  const feedBeforeApi = await fetchFeedSnapshot(baseUrl, apiToken);
  const feedBeforeBrowser = await browserRouteSnapshot(page, "feed");
  writeJsonFile(path.join(scenarioDir, "feed_before.json"), {
    api: feedBeforeApi,
    browser: feedBeforeBrowser
  });
  const meetingsBeforeBrowser = await browserRouteSnapshot(page, "meetings");
  writeJsonFile(path.join(scenarioDir, "meetings_before.json"), meetingsBeforeBrowser);
  await gotoRoute(page, "feed");

  const postResponse = await postMeeting(baseUrl, apiToken, scenario.payload);
  writeJsonFile(path.join(scenarioDir, "meeting_post_response.json"), postResponse);

  await waitForMeetingProcessing(baseUrl, apiToken, scenario.meetingId);
  const processingPayload = await fetchMeetingDetail(baseUrl, apiToken, scenario.meetingId);
  writeJsonFile(path.join(scenarioDir, "meeting_processing.json"), processingPayload);

  await gotoRoute(page, "feed");
  await waitForCardText(page, scenario.meetingId, "Processing");
  const homePendingScreenshot = await saveScreenshot(page, scenarioDir, "01-home-pending-tile");

  const pendingMeetingsClass = await waitForMeetingRouteCard(page, scenario.meetingId, { pending: true });
  const meetingsPendingSnapshot = await browserFeedSnapshot(page);
  const meetingsPendingRow = Array.isArray(meetingsPendingSnapshot?.visible_cards)
    ? meetingsPendingSnapshot.visible_cards.find((item) => String(item?.session_id || "") === scenario.meetingId)
    : null;
  const meetingsPendingScreenshot = await saveScreenshot(page, scenarioDir, "02-meetings-pending-row");
  await gotoRoute(page, "feed");

  const completedMeeting = await waitForMeetingState(baseUrl, apiToken, scenario.meetingId, "completed");
  const completedPayload = await fetchMeetingDetail(baseUrl, apiToken, scenario.meetingId);
  writeJsonFile(path.join(scenarioDir, "meeting_completed.json"), completedPayload);

  const feedAfterBrowser = await browserRouteSnapshot(page, "feed");
  const feedAfterApi = await fetchFeedSnapshot(baseUrl, apiToken);
  writeJsonFile(path.join(scenarioDir, "feed_after.json"), {
    api: feedAfterApi,
    browser: feedAfterBrowser
  });
  const homeCompletedScreenshot = await saveScreenshot(page, scenarioDir, "03-home-completed-tile");

  const meetingsCompletedClass = await waitForMeetingRouteCard(page, scenario.meetingId, { pending: false });
  const meetingsAfterBrowser = await browserFeedSnapshot(page);
  writeJsonFile(path.join(scenarioDir, "meetings_after.json"), meetingsAfterBrowser);
  const meetingsCompletedScreenshot = await saveScreenshot(page, scenarioDir, "04-meetings-completed-row");
  const meetingsRowState = await page.locator(`[data-card-session-id="${scenario.meetingId}"]`).first().evaluate((node) => ({
    title: String(node.querySelector(".title")?.textContent || "").trim(),
    hasIdentity: Boolean(node.querySelector(".identity")),
    hasPreview: Boolean(node.querySelector(".preview")),
    audioButtons: node.querySelectorAll(".action.action-audio").length,
    actionButtons: node.querySelectorAll(".action").length
  }));
  await gotoRoute(page, "feed");

  const feedCard = Array.isArray(feedAfterApi?.cards)
    ? feedAfterApi.cards.find((item) => String(item?.session_id || item?.turn_id || "") === scenario.meetingId)
    : null;
  if (!feedCard) {
    throw new Error(`Could not find completed feed card for ${scenario.meetingId}`);
  }
  const feedReplyText = String(feedCard.summary || feedCard.text || "").trim();
  if (!feedReplyText) {
    throw new Error(`${scenario.name} feed tile reply text is empty`);
  }
  const tileMarkup = await page.locator(`[data-card-session-id="${scenario.meetingId}"]`).first().innerHTML();
  if (!/svg|material-symbols|card-icon/i.test(String(tileMarkup || ""))) {
    throw new Error(`${scenario.name} feed tile did not render an icon`);
  }

  const detailMeeting = completedPayload.meeting || {};

  if (String(detailMeeting.state || "") !== "completed") {
    throw new Error(`${scenario.name} did not reach completed state`);
  }
  if (String(detailMeeting.agent?.transcription_provider || "") !== "deepgram") {
    warnings.push("transcription_provider_missing_or_not_deepgram");
  }
  if (!String(detailMeeting.agent?.transcription_model || "").trim()) {
    warnings.push("transcription_model_missing");
  }
  if (String(detailMeeting.agent?.last_meeting_tool_name || detailMeeting.feed_item?.telemetry?.last_meeting_tool_name || "") !== "meeting_deepgram_transcribe") {
    warnings.push("last_meeting_tool_name_missing");
  }
  if (!detailMeeting.feed_item?.telemetry?.meeting_recording_title) {
    throw new Error(`${scenario.name} did not preserve recording_title in telemetry`);
  }
  assertHumanLikeTitle("Feed card", detailMeeting.title, scenario.meetingId);
  assertHumanLikeTitle("Recording", detailMeeting.recording_title, scenario.meetingId);
  const recordingStem = normalizeStem(detailMeeting.recording_title);
  if (!String(detailMeeting.canonical_basename || "").startsWith(recordingStem)) {
    throw new Error(`${scenario.name} canonical_basename does not derive from recording_title`);
  }
  if (!detailMeeting.feed_item?.telemetry?.meeting_recording_title || String(detailMeeting.feed_item.telemetry.meeting_recording_title || "") !== String(detailMeeting.recording_title || "")) {
    throw new Error(`${scenario.name} feed telemetry recording title mismatch`);
  }
  if (!String(pendingMeetingsClass || "").includes("card-pending-thread")) {
    throw new Error(`${scenario.name} meetings route did not expose a pending row state`);
  }
  if (String(meetingsCompletedClass || "").includes("card-pending-thread")) {
    throw new Error(`${scenario.name} meetings route row never converted out of pending state`);
  }
  if (!String(meetingsRowState.title || "").trim()) {
    throw new Error(`${scenario.name} missing completed meetings row`);
  }
  const meetingsRowTitle = String(meetingsRowState.title || "").trim();
  if (meetingsRowTitle !== String(detailMeeting.recording_title || "").trim()) {
    throw new Error(`${scenario.name} meetings row title did not use recording_title`);
  }
  if (meetingsRowState.hasIdentity) {
    throw new Error(`${scenario.name} meetings row still rendered a left identity control`);
  }
  if (meetingsRowState.hasPreview) {
    throw new Error(`${scenario.name} meetings row still rendered a preview/subtitle`);
  }
  if (meetingsRowState.audioButtons !== 1 || meetingsRowState.actionButtons !== 1) {
    throw new Error(`${scenario.name} meetings row did not keep exactly one right-side mic action`);
  }
  await gotoRoute(page, "feed");

  const attachments = summarizeAttachments(detailMeeting);
  const summaryAttachment = attachments.find((item) => String(item?.id || "") === `${scenario.meetingId}:html`);
  const transcriptHtmlAttachment = attachments.find((item) => String(item?.title || "") === "Transcript");
  if (!summaryAttachment) {
    throw new Error(`${scenario.name} is missing the HTML summary attachment`);
  }
  if (!transcriptHtmlAttachment) {
    throw new Error(`${scenario.name} is missing the Transcript attachment`);
  }
  for (const requiredLabel of ["Transcript (Plain Text)", "Transcript", "Meeting Audio"]) {
    if (!attachments.some((item) => String(item?.title || "") === requiredLabel)) {
      throw new Error(`${scenario.name} is missing attachment ${requiredLabel}`);
    }
  }

  const transcriptText = String(detailMeeting.transcript_text || "");
  if (!transcriptText.trim()) {
    throw new Error(`${scenario.name} transcript_text is empty`);
  }

  if (scenario.expectedNames) {
    for (const name of scenario.expectedNames) {
      if (!transcriptText.includes(name)) {
        throw new Error(`${scenario.name} transcript is missing named speaker ${name}`);
      }
    }
    for (const label of scenario.forbiddenNeutralLabels || []) {
      if (transcriptText.includes(label)) {
        throw new Error(`${scenario.name} transcript kept neutral label ${label} despite clear names`);
      }
    }
  }
  if (scenario.forbiddenNames) {
    for (const name of scenario.forbiddenNames) {
      if (transcriptText.includes(name)) {
        throw new Error(`${scenario.name} transcript invented or preserved forbidden name ${name}`);
      }
    }
    const neutralSpeakers = distinctNeutralSpeakers(transcriptText);
    if (neutralSpeakers.length !== Number(scenario.expectedNeutralSpeakerCount || 0)) {
      throw new Error(`${scenario.name} transcript did not preserve exactly ${scenario.expectedNeutralSpeakerCount} neutral speakers`);
    }
  }

  await openMeetingAttachment(page, scenario.meetingId);
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 15000 });
  const paperclipAttachmentTitle = String(await page.locator("#detail .detail-title").last().textContent() || "").trim();
  if (paperclipAttachmentTitle !== String(summaryAttachment.title || "").trim()) {
    throw new Error(`${scenario.name} paperclip opened ${paperclipAttachmentTitle || "an unexpected attachment"} instead of the summary HTML`);
  }
  const summaryFromHomeScreenshot = await saveScreenshot(page, scenarioDir, "05-summary-from-home-tile");
  await backToFeed(page);

  await openMeetingRowSummary(page, scenario.meetingId);
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 15000 });
  const summaryFromMeetingsScreenshot = await saveScreenshot(page, scenarioDir, "06-summary-from-meetings-row");

  const summaryText = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.textContent || frame?.srcdoc || "");
  });
  const renderedSummaryHtml = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.innerHTML || frame?.srcdoc || "");
  });
  writeTextFile(path.join(scenarioDir, "rendered_summary_html.html"), renderedSummaryHtml);
  const summaryFrame = page.frameLocator("#detail iframe.document-frame");

  if (!summaryAttachment?.artifact) {
    throw new Error(`${scenario.name} is missing Meeting Summary artifact metadata`);
  }
  const rawSummaryHtml = await fetchArtifactText(baseUrl, apiToken, String(summaryAttachment.artifact || ""));
  writeTextFile(path.join(scenarioDir, "raw_summary_html.html"), rawSummaryHtml);
  const rawTranscriptHtml = await fetchArtifactText(baseUrl, apiToken, String(transcriptHtmlAttachment.artifact || ""));
  writeTextFile(path.join(scenarioDir, "raw_transcript_html.html"), rawTranscriptHtml);

  if (!/href="\/api\/shared\/artifacts\/[^"]+\?token=/.test(rawSummaryHtml)) {
    throw new Error(`${scenario.name} raw summary HTML is missing a signed transcript HTML link`);
  }
  if (!/href="\/api\/shared\/meetings\/[^"]+\/audio\?token=/.test(rawSummaryHtml)) {
    throw new Error(`${scenario.name} raw summary HTML is missing a signed meeting audio link`);
  }
  if (rawSummaryHtml.includes("{{PUCKY_MEETING_TRANSCRIPT_LINK}}") || rawSummaryHtml.includes("{{PUCKY_MEETING_AUDIO_LINK}}")) {
    throw new Error(`${scenario.name} raw summary HTML still contains placeholder tokens`);
  }
  if (rawSummaryHtml.includes("/api/meetings/") || rawSummaryHtml.includes("/tmp/") || rawSummaryHtml.includes("<script")) {
    throw new Error(`${scenario.name} raw summary HTML still contains protected runtime links or inline script`);
  }
  if (!renderedSummaryHtml.includes("pucky-meeting-transcript-link") || !renderedSummaryHtml.includes("pucky-meeting-audio-link")) {
    throw new Error(`${scenario.name} rendered summary did not expose transcript/audio controls`);
  }
  if (renderedSummaryHtml.includes("/api/meetings/") || renderedSummaryHtml.includes("/tmp/") || renderedSummaryHtml.includes("<script")) {
    throw new Error(`${scenario.name} rendered summary still exposes protected runtime links or inline script`);
  }
  const normalizedSummaryText = normalizeProofText(summaryText);
  if (!normalizedSummaryText.includes("action")) {
    throw new Error(`${scenario.name} summary HTML did not render a visible action-items section`);
  }
  const summaryVisibleLinks = await summaryFrame.locator("a.document-open-link").allTextContents();
  if (summaryVisibleLinks.length !== 2) {
    throw new Error(`${scenario.name} summary HTML did not render exactly two visible document links`);
  }
  if (!summaryVisibleLinks.includes("Open Transcript") || !summaryVisibleLinks.includes("Listen To Audio")) {
    throw new Error(`${scenario.name} summary HTML did not render the expected transcript/audio link labels`);
  }

  if (scenario.expectedSummarySnippets) {
    for (const snippet of scenario.expectedSummarySnippets) {
      if (!normalizedSummaryText.includes(normalizeProofText(snippet))) {
        throw new Error(`${scenario.name} summary text is missing expected content: ${snippet}`);
      }
    }
  }
  if (scenario.expectedDueDateSnippets) {
    for (const dueDate of scenario.expectedDueDateSnippets) {
      if (!normalizedSummaryText.includes(normalizeProofText(dueDate))) {
        throw new Error(`${scenario.name} summary text is missing explicit due date ${dueDate}`);
      }
    }
  }
  if (scenario.forbiddenNames) {
    for (const name of scenario.forbiddenNames) {
      if (summaryText.includes(name)) {
        throw new Error(`${scenario.name} summary text invented forbidden name ${name}`);
      }
    }
  }

  await summaryFrame.locator("a.pucky-meeting-transcript-link").click();
  await waitForDetail(page, "attachment", "html_iframe");
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 15000 });
  const transcriptFromHtmlText = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.textContent || frame?.srcdoc || "");
  });
  if (!String(transcriptFromHtmlText || "").trim() || /transcript unavailable|html preview unavailable/i.test(String(transcriptFromHtmlText || ""))) {
    throw new Error(`${scenario.name} transcript link inside summary did not open transcript HTML detail`);
  }
  const transcriptFromHtmlScreenshot = await saveScreenshot(page, scenarioDir, "07-transcript-from-summary");
  await backToDetail(page, "attachment", "html_iframe");

  const bridgeConnected = await page.evaluate(() => Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function"));
  if (bridgeMode === "none" && bridgeConnected) {
    throw new Error(`${scenario.name} unexpectedly detected a native bridge in no-bridge mode`);
  }
  await page.frameLocator("#detail iframe.document-frame").locator("a.pucky-meeting-audio-link").click();
  await waitForDetail(page, "attachment", "audio_player");
  const audioResolution = await waitForAudioViewerResolution(page);
  const audioFromHtmlScreenshot = await saveScreenshot(page, scenarioDir, "08-audio-from-summary");
  writeJsonFile(path.join(scenarioDir, "audio_viewer_resolution.json"), audioResolution);
  if (audioResolution.error_text) {
    throw new Error(`${scenario.name} audio viewer reported an error: ${audioResolution.error_text}`);
  }
  const audioSource = String(audioResolution.src || audioResolution.current_src || "");
  if (!audioSource) {
    throw new Error(`${scenario.name} audio viewer did not resolve an audio source`);
  }
  if (!audioSource.includes("/api/shared/meetings/")) {
    throw new Error(`${scenario.name} audio viewer did not use the signed meeting audio URL`);
  }
  const summaryAudioPlayback = await playAttachmentAudioAndWaitForAdvance(page);
  const summaryAudioPlayingScreenshot = await saveScreenshot(page, scenarioDir, "09-audio-playing-from-summary");
  await backToDetail(page, "attachment", "html_iframe");
  await backToFeed(page);

  await openMeetingRowAudio(page, scenario.meetingId);
  const rowAudioResolution = await waitForAudioViewerResolution(page);
  writeJsonFile(path.join(scenarioDir, "row_audio_viewer_resolution.json"), rowAudioResolution);
  if (rowAudioResolution.error_text) {
    throw new Error(`${scenario.name} meetings row mic reported an error: ${rowAudioResolution.error_text}`);
  }
  const rowAudioPlayback = await playAttachmentAudioAndWaitForAdvance(page);
  const rowAudioPlayingScreenshot = await saveScreenshot(page, scenarioDir, "10-audio-playing-from-meetings-row");
  await backToFeed(page);

  writeJsonFile(path.join(scenarioDir, "bridge_trace.json"), {
    bridge_mode: bridgeMode,
    bridge_connected: bridgeConnected,
    commands: []
  });

  const result = {
    schema: "pucky.meeting_mode_real_vm_scenario.v1",
    name: scenario.name,
    meeting_id: scenario.meetingId,
    state: String(completedMeeting.state || ""),
    card_title: String(detailMeeting.title || ""),
    recording_title: String(detailMeeting.recording_title || ""),
    canonical_basename: String(detailMeeting.canonical_basename || ""),
    transcription_provider: String(detailMeeting.agent?.transcription_provider || ""),
    transcription_model: String(detailMeeting.agent?.transcription_model || ""),
    diarization_status: String(detailMeeting.diarization_status || ""),
    transcript_status: String(detailMeeting.transcript_status || ""),
    last_meeting_tool_name: String(detailMeeting.agent?.last_meeting_tool_name || detailMeeting.feed_item?.telemetry?.last_meeting_tool_name || ""),
    attachments: attachments.map((item) => String(item?.title || "")),
    bridge_mode: bridgeMode,
    bridge_connected: bridgeConnected,
    pending_meetings_row_class: String(pendingMeetingsClass || ""),
    completed_meetings_row_class: String(meetingsCompletedClass || ""),
    meetings_row_title: meetingsRowState.title,
    meetings_row_state: meetingsRowState,
    audio_playback_from_summary: summaryAudioPlayback,
    audio_playback_from_meetings_row: rowAudioPlayback,
    audio_source: String(audioSource || ""),
    transcript_text: transcriptText,
    summary_text: String(summaryText || ""),
    warnings,
    screenshots: {
      home_pending_tile: homePendingScreenshot,
      meetings_pending_row: meetingsPendingScreenshot,
      home_completed_tile: homeCompletedScreenshot,
      meetings_completed_row: meetingsCompletedScreenshot,
      summary_from_home_tile: summaryFromHomeScreenshot,
      summary_from_meetings_row: summaryFromMeetingsScreenshot,
      transcript_from_summary: transcriptFromHtmlScreenshot,
      audio_from_summary: audioFromHtmlScreenshot,
      audio_playing_from_summary: summaryAudioPlayingScreenshot,
      audio_playing_from_meetings_row: rowAudioPlayingScreenshot
    }
  };
  writeJsonFile(path.join(scenarioDir, "scenario_result.json"), result);
  return result;
}

function buildBridgeHandler({ baseUrl, apiToken, pathToMeetingId, bridgeState }) {
  const resolveMeetingAudioByPath = async (rawPath) => {
    const cleanPath = String(rawPath || "").trim();
    if (!cleanPath) {
      return null;
    }
    const knownMeetingId = pathToMeetingId.get(cleanPath);
    if (knownMeetingId) {
      return fetchMeetingDetail(baseUrl, apiToken, knownMeetingId);
    }
    const meetings = await apiJson(baseUrl, apiToken, "/api/meetings");
    const match = Array.isArray(meetings.meetings)
      ? meetings.meetings.find((item) => cleanPath === String(item?.device_path || "") || cleanPath === String(item?.audio_path || ""))
      : null;
    if (!match?.meeting_id) {
      return null;
    }
    pathToMeetingId.set(cleanPath, String(match.meeting_id));
    return fetchMeetingDetail(baseUrl, apiToken, String(match.meeting_id));
  };

  return async (message) => {
    const command = String(message?.command || "");
    const args = message && typeof message.args === "object" && message.args ? message.args : {};
    bridgeState.commands.push({ command, args });
    if (command === "pucky.config.get") {
      return {
        schema: "pucky.config.v1",
        api_base_url: baseUrl,
        api_token: apiToken
      };
    }
    if (command === "ui.reply_cards.get") {
      return fetchFeedSnapshot(baseUrl, apiToken);
    }
    if (command === "pucky.feed.sync") {
      return {
        schema: "pucky.feed_sync_result.v1",
        configured: true,
        reason: String(args.reason || "meeting_mode_real_vm_proof"),
        snapshot: await fetchFeedSnapshot(baseUrl, apiToken)
      };
    }
    if (command === "pucky.feed.action") {
      return {
        schema: "pucky.feed_action_result.v1",
        ok: true,
        action: String(args.action || ""),
        snapshot: await fetchFeedSnapshot(baseUrl, apiToken)
      };
    }
    if (command === "voice.thread_scope.get") {
      return {
        schema: "pucky.thread_scope.v1",
        mode: "new",
        thread_id: "",
        source: "",
        card_id: ""
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
    if (command === "player.state") {
      return bridgeState.playerState;
    }
    if (command === "player.load") {
      const loadedPath = String(args.path || args.device_path || args.artifact_path || "");
      bridgeState.playerState = emptyPlayerState({
        loaded: Boolean(loadedPath),
        state: loadedPath ? "paused" : "idle",
        title: String(args.title || ""),
        source: String(args.source || args.meeting_id || ""),
        path: loadedPath || null,
        filename: loadedPath ? path.basename(loadedPath) : null,
        can_seek: Boolean(loadedPath),
        duration_ms: loadedPath ? 12000 : 0
      });
      return bridgeState.playerState;
    }
    if (command === "player.play") {
      const loadedPath = String(args.path || args.device_path || bridgeState.playerState.path || "");
      bridgeState.playerState = {
        ...bridgeState.playerState,
        loaded: Boolean(loadedPath),
        state: loadedPath ? "playing" : bridgeState.playerState.state,
        is_playing: Boolean(loadedPath),
        path: loadedPath || bridgeState.playerState.path,
        filename: loadedPath ? path.basename(loadedPath) : bridgeState.playerState.filename
      };
      return bridgeState.playerState;
    }
    if (command === "pucky.turn.status") {
      return idleTurnStatus();
    }
    if (command === "artifact.read_base64") {
      const artifactId = artifactIdFromPath(args.path || "");
      if (artifactId) {
        return fetchArtifactBase64(baseUrl, apiToken, artifactId);
      }
      const localPath = String(args.path || "").trim();
      if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        const bytes = fs.readFileSync(localPath);
        return {
          schema: "pucky.artifact_read.v1",
          mime_type: mimeTypeFromPath(localPath),
          content_base64: bytes.toString("base64"),
          bytes: bytes.length
        };
      }
      const meeting = await resolveMeetingAudioByPath(args.path || "");
      if (!meeting?.meeting?.meeting_id) {
        throw new Error(`Unsupported artifact path: ${args.path || ""}`);
      }
      const response = await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(String(meeting.meeting.meeting_id || ""))}/audio`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        schema: "pucky.artifact_read.v1",
        mime_type: String(response.headers.get("content-type") || "audio/mp4").split(";", 1)[0].trim(),
        content_base64: bytes.toString("base64"),
        bytes: bytes.length
      };
    }
    if (command === "artifact.url") {
      const artifactId = artifactIdFromPath(args.path || "");
      if (artifactId) {
        return {
          schema: "pucky.artifact_url.v1",
          url: `${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`,
          path: String(args.path || ""),
          mime_type: "application/octet-stream",
          bytes: 0
        };
      }
      const localPath = String(args.path || "").trim();
      if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        const bytes = fs.readFileSync(localPath);
        const mimeType = mimeTypeFromPath(localPath);
        return {
          schema: "pucky.artifact_url.v1",
          url: `data:${mimeType};base64,${bytes.toString("base64")}`,
          path: localPath,
          mime_type: mimeType,
          bytes: bytes.length
        };
      }
      const meeting = await resolveMeetingAudioByPath(args.path || "");
      if (!meeting?.meeting?.meeting_id) {
        return {
          schema: "pucky.artifact_url.v1",
          url: String(args.path || ""),
          mime_type: "application/octet-stream",
          bytes: 0
        };
      }
      const response = await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(String(meeting.meeting.meeting_id || ""))}/audio`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const mimeType = String(response.headers.get("content-type") || meeting.meeting.mime_type || "audio/mp4").split(";", 1)[0].trim();
      return {
        schema: "pucky.artifact_url.v1",
        url: `data:${mimeType};base64,${bytes.toString("base64")}`,
        path: String(args.path || ""),
        mime_type: mimeType,
        bytes: bytes.length
      };
    }
    if (command === "meeting.recording.resolve_audio_link") {
      const meetingId = String(args.meeting_id || "").trim();
      const detail = meetingId ? await fetchMeetingDetail(baseUrl, apiToken, meetingId) : { meeting: {} };
      const meeting = detail.meeting || {};
      const response = meetingId
        ? await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/audio`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${apiToken}` }
          })
        : null;
      const bytes = response ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
      const mimeType = String(response?.headers.get("content-type") || meeting.mime_type || "audio/mp4").split(";", 1)[0].trim();
      return {
        schema: "pucky.meeting_audio_link.v1",
        meeting_id: meetingId,
        device_path: String(meeting.device_path || meeting.audio_path || ""),
        canonical_basename: String(meeting.canonical_basename || ""),
        recording_title: String(meeting.recording_title || ""),
        url: bytes.length ? `data:${mimeType};base64,${bytes.toString("base64")}` : "",
        mime_type: mimeType,
        source: "browser_real_vm_proof"
      };
    }
    throw new Error(`Unsupported bridge command: ${command}`);
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const reportDir = options.reportDir ? path.resolve(options.reportDir) : path.join(DEFAULT_REPORT_ROOT, nowStamp());
  const videoDir = path.join(reportDir, "videos");
  const consoleLogPath = path.join(reportDir, "console.log");
  const summaryPath = path.join(reportDir, "summary.json");
  ensureDir(reportDir);
  ensureDir(videoDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const summary = {
    schema: "pucky.meeting_mode_real_vm_proof.v1",
    started_at: new Date().toISOString(),
    base_url: options.baseUrl,
    bridge_mode: options.bridgeMode,
    report_dir: reportDir,
    scenarios: []
  };

  let browser;
  let context;
  let page;
  let pageVideo = null;
  const pathToMeetingId = new Map();
  const bridgeState = {
    commands: [],
    playerState: emptyPlayerState()
  };

  try {
    const gitState = ensureCanonicalMasterClean();
    summary.git = gitState;

    const apiToken = resolveApiToken();
    const health = await fetchHealth(options.baseUrl);
    if (String(health.deepgram_key || "") !== "present") {
      throw new Error("Real VM browser proof requires deepgram_key: present from /healthz");
    }
    const manifest = await fetchManifest(options.baseUrl);
    if (String(manifest.source_commit_full || "") !== String(gitState.head || "")) {
      throw new Error(`VM manifest commit ${manifest.source_commit_full || "<empty>"} does not match local master HEAD ${gitState.head}`);
    }
    if (String(manifest.source_branch || "") !== "master" || Boolean(manifest.source_dirty)) {
      throw new Error("VM manifest is not serving a clean master bundle");
    }
    summary.health = health;
    summary.manifest = manifest;
    writeJsonFile(path.join(reportDir, "healthz.json"), health);
    writeJsonFile(path.join(reportDir, "bundle_identity.json"), manifest);

    browser = await chromium.launch({
      headless: options.headless,
      executablePath: resolveChromePath(),
      args: ["--disable-extensions", "--autoplay-policy=no-user-gesture-required"]
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: videoDir, size: VIEWPORT }
    });
    if (options.bridgeMode === "with_bridge") {
      await installCodexPuckyBridge(context, buildBridgeHandler({
        baseUrl: options.baseUrl,
        apiToken,
        pathToMeetingId,
        bridgeState
      }));
    }
    page = await context.newPage();
    pageVideo = page.video();
    attachPageLogging(page, consoleLogPath);
    await page.goto(`${options.baseUrl}/ui/pucky/latest/`, { waitUntil: "load", timeout: 45000 });
    await page.waitForSelector("#feed", { timeout: 15000 });
    summary.screenshots = {
      home_initial: await saveScreenshot(page, reportDir, "00-home-initial")
    };

    const scenarios = buildScenarios(reportDir, options.scenarioNames);
    if (!scenarios.length) {
      throw new Error("No scenarios selected for real VM proof");
    }
    const failures = [];
    for (const scenario of scenarios) {
      try {
        const result = await runScenario({
          page,
          baseUrl: options.baseUrl,
          apiToken,
          reportDir,
          scenario,
          bridgeMode: options.bridgeMode
        });
        summary.scenarios.push({ ok: true, ...result });
      } catch (error) {
        const scenarioDir = path.join(reportDir, scenario.name);
        ensureDir(scenarioDir);
        const failure = {
          schema: "pucky.meeting_mode_real_vm_scenario_failure.v1",
          ok: false,
          name: scenario.name,
          meeting_id: scenario.meetingId,
          error: error?.message || String(error)
        };
        failures.push(failure);
        summary.scenarios.push(failure);
        writeJsonFile(path.join(scenarioDir, "scenario_error.json"), failure);
      }
    }
    summary.ok = failures.length === 0;
    if (failures.length) {
      summary.error = `${failures.length} scenario(s) failed`;
    }
  } catch (error) {
    summary.ok = false;
    summary.error = error?.message || String(error);
    writeAutomationError(reportDir, error);
    throw error;
  } finally {
    writeJsonFile(summaryPath, summary);
    let videoPath = "";
    try {
      if (context) {
        await context.close();
      }
      if (pageVideo) {
        videoPath = await pageVideo.path();
      }
    } catch (_) {
      // Best effort.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Best effort.
    }
    if (videoPath && fs.existsSync(summaryPath)) {
      const current = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      current.video_path = videoPath;
      current.bridge_mode = options.bridgeMode;
      current.bridge_commands = bridgeState.commands;
      writeJsonFile(summaryPath, current);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    summary_path: summaryPath
  }));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
